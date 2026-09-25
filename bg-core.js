/*!
 * bg-core.js — 背景透明化 & 最小尺寸裁剪 · 核心算法
 *
 * 设计约束：
 *   - 纯计算模块，不引用任何 DOM API
 *   - UMD 导出：浏览器挂 window.BGCore，Node 下 module.exports
 *   - 不就地修改输入缓冲
 *   - 全流程 O(w*h) 单遍扫描
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BGCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SQRT3 = Math.sqrt(3);
  var ALPHA_MIN = 8;        // 低于此 alpha 视为"原本就是透明的"
  var REFINE_LIMIT = 48;    // 背景色收窄容差
  var MAX_PIXELS = 4e7;     // 拒绝载入的像素数上限
  var MAX_SIDE = 16384;     // 单边上兜（主流浏览器 canvas 硬限制）

  var DEFAULTS = {
    bgColor: null,
    tolerance: 20,
    softness: 0.3,
    connectivity: 'edge',
    crop: true,
    margin: 0,
    cropAlphaThreshold: 8,
    sampleThickness: 2
  };

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function num(v, fallback) { return isNum(v) ? v : fallback; }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function normalizeOptions(options) {
    var o = options || {};
    var bg = null;
    if (Array.isArray(o.bgColor) && o.bgColor.length >= 3) {
      bg = [
        Math.round(clamp(num(o.bgColor[0], 0), 0, 255)),
        Math.round(clamp(num(o.bgColor[1], 0), 0, 255)),
        Math.round(clamp(num(o.bgColor[2], 0), 0, 255))
      ];
    }
    return {
      bgColor: bg,
      tolerance: clamp(num(o.tolerance, DEFAULTS.tolerance), 0, 100),
      softness: clamp(num(o.softness, DEFAULTS.softness), 0, 1),
      connectivity: o.connectivity === 'global' ? 'global' : 'edge',
      crop: o.crop !== false,
      margin: Math.max(0, Math.round(num(o.margin, DEFAULTS.margin))),
      cropAlphaThreshold: Math.round(
        clamp(num(o.cropAlphaThreshold, DEFAULTS.cropAlphaThreshold), 0, 255)
      ),
      sampleThickness: Math.max(1, Math.round(num(o.sampleThickness, DEFAULTS.sampleThickness)))
    };
  }

  /* ------------------------------------------------------------------ *
   * 4.2 色差度量（归一化到 0..255）
   * ------------------------------------------------------------------ */

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db) / SQRT3;
  }

  /* ------------------------------------------------------------------ *
   * 4.1 背景色估计
   * ------------------------------------------------------------------ */

  function estimateBackground(data, width, height, thickness) {
    var w = width | 0, h = height | 0;
    if (w <= 0 || h <= 0) return null;
    if (!data || data.length < w * h * 4) {
      throw new TypeError('estimateBackground: 数据长度与尺寸不匹配');
    }

    var t = Math.max(1, Math.round(num(thickness, DEFAULTS.sampleThickness)));
    var step = Math.max(1, Math.round(Math.max(w, h) / 400));

    var rs = [], gs = [], bs = [];
    var x, y, i, a;

    // 上下整行 + 左右整列，避免重复计数四角
    for (y = 0; y < h; y += step) {
      var isTop = y < t;
      var isBottom = y >= h - t;
      if (!isTop && !isBottom) {
        for (x = 0; x < w; x += step) {
          if (x >= t && x < w - t) continue;
          i = (y * w + x) * 4;
          a = data[i + 3];
          if (a < ALPHA_MIN) continue;
          rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
        }
        continue;
      }
      for (x = 0; x < w; x += step) {
        i = (y * w + x) * 4;
        a = data[i + 3];
        if (a < ALPHA_MIN) continue;
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      }
    }

    var n = rs.length;
    if (n === 0) return null; // 整图已透明

    var mid = n >> 1;
    rs.sort(cmp); gs.sort(cmp); bs.sort(cmp);
    var r0 = rs[mid], g0 = gs[mid], b0 = bs[mid];

    // 收窄：只对贴近中位数的样本求均值，抗边框杂色与越界主体
    var limit2 = REFINE_LIMIT * REFINE_LIMIT;
    var sr = 0, sg = 0, sb = 0, cnt = 0;
    for (var k = 0; k < n; k++) {
      var dr = rs[k] - r0, dg = gs[k] - g0, db = bs[k] - b0;
      if (dr * dr + dg * dg + db * db > limit2) continue;
      sr += rs[k]; sg += gs[k]; sb += bs[k]; cnt++;
    }
    if (cnt === 0) return [r0, g0, b0];

    return [
      Math.round(sr / cnt),
      Math.round(sg / cnt),
      Math.round(sb / cnt)
    ];
  }

  function cmp(a, b) { return a - b; }

  /* ------------------------------------------------------------------ *
   * 4.4 alpha 计算
   * 分支顺序不可调换：softness=0 时 kIn===kT，必须由前两个分支兜住除法。
   * ------------------------------------------------------------------ */

  function alphaFor(d2, kIn2, kT2, kIn, kT) {
    if (d2 <= kIn2) return 0;
    if (d2 >= kT2) return -1;
    return Math.round((Math.sqrt(d2) - kIn) / (kT - kIn) * 255);
  }

  /* ------------------------------------------------------------------ *
   * 4.5 背景移除 — global
   * ------------------------------------------------------------------ */

  function removeGlobal(data, w, h, br, bg, bb, kIn2, kT2, kIn, kT) {
    var total = w * h;
    var removed = 0;
    for (var p = 0; p < total; p++) {
      var i = p * 4;
      if (data[i + 3] < ALPHA_MIN) continue; // 原本就透明，不重复计数
      var dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb;
      var a = alphaFor(dr * dr + dg * dg + db * db, kIn2, kT2, kIn, kT);
      if (a >= 0) { data[i + 3] = a; removed++; }
    }
    return removed;
  }

  /* ------------------------------------------------------------------ *
   * 4.5 背景移除 — edge（4 连通泛滥填充）
   * ------------------------------------------------------------------ */

  function removeEdge(data, w, h, br, bg, bb, kIn2, kT2, kIn, kT) {
    var total = w * h;
    var seen = new Uint8Array(total);
    var stack = new Int32Array(total);
    var sp = 0;
    var removed = 0;
    var x, y, p, i, d2, a;

    function push(px, py) {
      var idx = py * w + px;
      if (seen[idx]) return;
      var ii = idx * 4;
      var dr = data[ii] - br, dg = data[ii + 1] - bg, db = data[ii + 2] - bb;
      if (dr * dr + dg * dg + db * db > kT2) return;
      seen[idx] = 1;
      stack[sp++] = idx;
    }

    // 种子：四条边上的全部像素
    for (x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

    while (sp > 0) {
      p = stack[--sp];
      i = p * 4;
      x = p % w;
      y = (p - x) / w;

      var r0 = data[i] - br, g0 = data[i + 1] - bg, b0 = data[i + 2] - bb;
      d2 = r0 * r0 + g0 * g0 + b0 * b0;
      a = alphaFor(d2, kIn2, kT2, kIn, kT);
      if (a >= 0 && data[i + 3] >= ALPHA_MIN) { data[i + 3] = a; removed++; }

      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }

    return removed;
  }

  /* ------------------------------------------------------------------ *
   * 4.6 包围盒与裁剪
   * ------------------------------------------------------------------ */

  function findBounds(data, width, height, alphaThreshold) {
    var w = width | 0, h = height | 0;
    if (w <= 0 || h <= 0) return null;

    var thr = clamp(Math.round(num(alphaThreshold, DEFAULTS.cropAlphaThreshold)), 0, 255);
    var minX = w, minY = h, maxX = -1, maxY = -1;

    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        if (data[(row + x) * 4 + 3] <= thr) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function cropBuffer(data, w, h, b) {
    var out = new Uint8ClampedArray(b.w * b.h * 4);
    var rowBytes = b.w * 4;
    for (var y = 0; y < b.h; y++) {
      var start = ((y + b.y) * w + b.x) * 4;
      out.set(data.subarray(start, start + rowBytes), y * rowBytes);
    }
    return out;
  }

  function makeBounds(raw, w, h, margin) {
    var x0 = Math.max(0, raw.x - margin);
    var y0 = Math.max(0, raw.y - margin);
    var x1 = Math.min(w - 1, raw.x + raw.w - 1 + margin);
    var y1 = Math.min(h - 1, raw.y + raw.h - 1 + margin);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /* ------------------------------------------------------------------ *
   * 主函数
   * ------------------------------------------------------------------ */

  function process(src, options) {
    if (!src || !src.data) throw new TypeError('process: 缺少像素缓冲');
    var w = src.width | 0, h = src.height | 0;
    if (w <= 0 || h <= 0) throw new RangeError('process: 图像尺寸非法');
    if (w > MAX_SIDE || h > MAX_SIDE) {
      throw new RangeError('process: 单边尺寸超过 ' + MAX_SIDE + 'px');
    }
    if (w * h > MAX_PIXELS) {
      throw new RangeError('process: 像素数超过 ' + MAX_PIXELS);
    }
    if (src.data.length < w * h * 4) {
      throw new TypeError('process: 数据长度与尺寸不匹配');
    }

    var o = normalizeOptions(options);

    // 副本：绝不就地修改输入缓冲
    var srcPixels = src.data;
    var data = new Uint8ClampedArray(w * h * 4);
    data.set(typeof srcPixels.subarray === 'function'
      ? srcPixels.subarray(0, w * h * 4)
      : srcPixels);

    var empty = false;
    var removed = 0;
    var bg = o.bgColor ? o.bgColor : estimateBackground(data, w, h, o.sampleThickness);

    if (bg) {
      var T = o.tolerance / 100 * 255;      // 归一化色差阈值
      var Tin = T * (1 - o.softness);       // 完全透明的内层阈值
      var kT = T * SQRT3;
      var kIn = Tin * SQRT3;
      var kT2 = kT * kT;
      var kIn2 = kIn * kIn;

      removed = o.connectivity === 'global'
        ? removeGlobal(data, w, h, bg[0], bg[1], bg[2], kIn2, kT2, kIn, kT)
        : removeEdge(data, w, h, bg[0], bg[1], bg[2], kIn2, kT2, kIn, kT);
    } else {
      empty = true; // 整图已透明，无背景可识别
    }

    var raw = findBounds(data, w, h, o.cropAlphaThreshold);
    var bounds;
    if (!raw) {
      // 整图被判为背景 / 指定色与图中任何像素都不匹配 → 不裁剪
      empty = true;
      bounds = { x: 0, y: 0, w: w, h: h };
    } else if (!o.crop) {
      bounds = { x: 0, y: 0, w: w, h: h };
    } else {
      bounds = makeBounds(raw, w, h, o.margin);
    }

    return {
      data: data,
      width: w,
      height: h,
      bounds: bounds,
      cropped: o.crop ? cropBuffer(data, w, h, bounds) : null,
      bgColor: bg,
      removed: removed,
      empty: empty
    };
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  return {
    process: process,
    estimateBackground: estimateBackground,
    findBounds: findBounds,
    colorDistance: colorDistance,
    DEFAULTS: DEFAULTS,
    ALPHA_MIN: ALPHA_MIN,
    REFINE_LIMIT: REFINE_LIMIT,
    MAX_PIXELS: MAX_PIXELS,
    MAX_SIDE: MAX_SIDE
  };
});
