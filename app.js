/*
 * app.js — QuickImageCleaner 应用层
 *
 * 依赖：bg-core.js（BGCore）
 * 约束：传统 script 标签加载，file:// 下可直接运行，不使用 ES module。
 *
 * 分层：
 *   Notifier       —— 提示
 *   SourceImage    —— 图片解码与栅格化
 *   PreviewSource  —— 预览用降采样缓存
 *   Renderer       —— canvas 绘制与命中测试
 *   ControlPanel   —— DOM 控件 → 参数对象
 *   StatusBar      —— 状态读数
 *   Exporter       —— PNG 编码与下载
 *   App            —— 编排（唯一入口：_process / renderPNG）
 */
(function () {
  'use strict';

  var PREVIEW_MAX_SIDE = 1100;
  var THROTTLE_MS = 70;
  var IMAGE_EXT = /\.(png|jpe?g|jfif|webp|bmp|gif|avif)$/i;

  /* ================================================================== *
   * 工具
   * ================================================================== */

  function $(id) { return document.getElementById(id); }

  function group(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [255, 255, 255];
    var v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (c) {
      return ('0' + clamp(Math.round(c), 0, 255).toString(16)).slice(-2);
    }).join('').toUpperCase();
  }

  function baseName(name) {
    return String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
  }

  function makeImageData(ctx, data, w, h) {
    if (typeof ImageData === 'function') {
      try { return new ImageData(data, w, h); } catch (e) { /* 回退 */ }
    }
    var img = ctx.createImageData(w, h);
    img.data.set(data);
    return img;
  }

  /** 裁剪框描边跟随主题色，避免样式与 CSS 变量两处各写一份 */
  var _accent = null;
  function accent() {
    if (_accent === null) {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--accent');
      _accent = (v && v.trim()) || '#b45309';
    }
    return _accent;
  }

  function nextFrame() {
    return new Promise(function (res) { requestAnimationFrame(function () { res(); }); });
  }

  /* ================================================================== *
   * Notifier
   * ================================================================== */

  class Notifier {
    constructor(el) {
      this.el = el;
      this._timer = 0;
    }
    show(msg, ms) {
      if (!this.el) return;
      this.el.textContent = msg;
      this.el.hidden = false;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => { this.el.hidden = true; }, ms || 4200);
    }
  }

  /* ================================================================== *
   * SourceImage —— 解码 + 栅格化，持有不可变的原始像素
   * ================================================================== */

  class SourceImage {
    constructor(name, imageData, canvas) {
      this.name = name;
      this.imageData = imageData;
      this.canvas = canvas;
      this.width = imageData.width;
      this.height = imageData.height;
    }

    static async load(file) {
      var raw = await SourceImage.decode(file);
      var w = raw.width || raw.naturalWidth || 0;
      var h = raw.height || raw.naturalHeight || 0;
      if (!w || !h) throw new Error('无法读取图片尺寸');
      if (w > BGCore.MAX_SIDE || h > BGCore.MAX_SIDE) {
        throw new Error('单边尺寸超过 ' + BGCore.MAX_SIDE + 'px 上限');
      }
      if (w * h > BGCore.MAX_PIXELS) {
        throw new Error('图片过大（' + group(w * h) + ' 像素），上限 ' + group(BGCore.MAX_PIXELS));
      }
      try {
        var raster = SourceImage.rasterize(raw, w, h);
        if (typeof raw.close === 'function') raw.close();
        return new SourceImage(file.name, raster.imageData, raster.canvas);
      } catch (e) {
        throw new Error('无法读取像素数据：' + (e && e.message ? e.message : '未知错误'));
      }
    }

    static async decode(file) {
      if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(file); } catch (e) { /* 回退到 Image */ }
      }
      return await new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
        img.src = url;
      });
    }

    static rasterize(source, w, h) {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('无法创建 2D 上下文');
      ctx.drawImage(source, 0, 0, w, h);
      return { imageData: ctx.getImageData(0, 0, w, h), canvas: canvas };
    }
  }

  /* ================================================================== *
   * PreviewSource —— 预览降采样（带缓存）
   * ================================================================== */

  class PreviewSource {
    constructor(maxSide) {
      this.maxSide = maxSide;
      this._key = '';
      this._value = null;
    }

    /** @returns {{imageData: ImageData, scale: number}} */
    get(source, precise) {
      var w = source.width, h = source.height;
      if (precise || Math.max(w, h) <= this.maxSide) {
        return { imageData: source.imageData, scale: 1 };
      }
      var key = w + 'x' + h;
      if (this._key === key && this._value) return this._value;

      var scale = this.maxSide / Math.max(w, h);
      var dw = Math.max(1, Math.round(w * scale));
      var dh = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source.canvas, 0, 0, w, h, 0, 0, dw, dh);

      this._key = key;
      this._value = { imageData: ctx.getImageData(0, 0, dw, dh), scale: dw / w };
      return this._value;
    }

    invalidate() { this._key = ''; this._value = null; }
  }

  /* ================================================================== *
   * Renderer —— canvas 绘制、裁剪框叠加、坐标命中测试
   * ================================================================== */

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this._picking = false;
    }

    get picking() { return this._picking; }
    set picking(v) {
      this._picking = !!v;
      this.canvas.classList.toggle('is-picking', this._picking);
    }

    draw(imageData, cropRect) {
      var c = this.canvas;
      if (c.width !== imageData.width || c.height !== imageData.height) {
        c.width = imageData.width;
        c.height = imageData.height;
      }
      this.ctx.clearRect(0, 0, c.width, c.height);
      this.ctx.putImageData(makeImageData(this.ctx, imageData.data, imageData.width, imageData.height), 0, 0);
      if (cropRect) this._drawCropFrame(cropRect);
    }

    /** 角标式裁剪框；线宽按显示缩放比补偿，保证视觉粗细一致 */
    _drawCropFrame(r) {
      var c = this.canvas;
      var displayW = c.clientWidth || c.width;
      var k = c.width / displayW;
      var len = Math.max(10, 16 * k);
      var ctx = this.ctx;

      ctx.save();
      ctx.strokeStyle = accent();
      ctx.lineWidth = Math.max(1, k);
      ctx.setLineDash([5 * k, 4 * k]);
      ctx.strokeRect(r.x + 0.5 * k, r.y + 0.5 * k, r.w - k, r.h - k);
      ctx.setLineDash([]);

      ctx.lineWidth = Math.max(1.5, 2 * k);
      var corners = [
        [r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1],
        [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]
      ];
      for (var i = 0; i < corners.length; i++) {
        var p = corners[i];
        ctx.beginPath();
        ctx.moveTo(p[0] + p[2] * len, p[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.lineTo(p[0], p[1] + p[3] * len);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** 客户端坐标 → 图像归一化坐标（0..1） */
    toUnit(clientX, clientY) {
      var r = this.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        u: clamp((clientX - r.left) / r.width, 0, 1),
        v: clamp((clientY - r.top) / r.height, 0, 1)
      };
    }
  }

  /* ================================================================== *
   * ControlPanel —— DOM 控件与参数对象之间的唯一映射
   * ================================================================== */

  class ControlPanel {
    constructor(onChange) {
      this.el = {
        bgColor: $('bgColor'),
        bgHex: $('bgHex'),
        tolerance: $('tolerance'),
        valTolerance: $('valTolerance'),
        softness: $('softness'),
        valSoftness: $('valSoftness'),
        globalMode: $('globalMode'),
        crop: $('crop'),
        margin: $('margin'),
        valMargin: $('valMargin'),
        threshold: $('threshold'),
        valThreshold: $('valThreshold'),
        showOriginal: $('showOriginal'),
        quality: $('quality')
      };
      this.onChange = onChange;
      this._bind();
      this._sync();
    }

    _bind() {
      var self = this;
      var sliders = [
        ['tolerance', 'valTolerance'],
        ['softness', 'valSoftness'],
        ['margin', 'valMargin'],
        ['threshold', 'valThreshold']
      ];
      sliders.forEach(function (pair) {
        var input = self.el[pair[0]];
        input.addEventListener('input', function () {
          self._paintSlider(input);
          self.el[pair[1]].textContent = input.value;
          self._emit();
        });
      });

      ['globalMode', 'crop', 'showOriginal'].forEach(function (k) {
        self.el[k].addEventListener('change', function () { self._sync(); self._emit(); });
      });

      this.el.bgColor.addEventListener('input', function () {
        self.el.bgHex.textContent = self.el.bgColor.value.toUpperCase();
        self._emit();
      });

      this.el.quality.addEventListener('change', function () { self._emit(); });
    }

    _paintSlider(input) {
      var min = +input.min, max = +input.max;
      var pct = max === min ? 0 : (+input.value - min) / (max - min) * 100;
      input.style.setProperty('--fill', pct + '%');
    }

    /** 控件之间的联动状态（禁用/文案） */
    _sync() {
      var e = this.el;
      e.margin.disabled = !e.crop.checked;
      e.threshold.disabled = !e.crop.checked;
      [e.tolerance, e.softness, e.margin, e.threshold].forEach(function (s) {
        var min = +s.min, max = +s.max;
        s.style.setProperty('--fill', ((+s.value - min) / (max - min) * 100) + '%');
      });
      e.bgHex.textContent = e.bgColor.value.toUpperCase();
    }

    _emit() { if (this.onChange) this.onChange(); }

    /** @returns {object} BGCore.process 的 options */
    params() {
      var e = this.el;
      return {
        bgColor: hexToRgb(e.bgColor.value),
        tolerance: +e.tolerance.value,
        softness: +e.softness.value / 100,
        connectivity: e.globalMode.checked ? 'global' : 'edge',
        crop: e.crop.checked,
        margin: +e.margin.value,
        cropAlphaThreshold: +e.threshold.value
      };
    }

    /** 把检测/拾取到的颜色写进输入控件（背景色始终为显式值） */
    setBgColor(rgb) {
      this.el.bgColor.value = rgbToHex(rgb).toLowerCase();
      this._sync();
    }
  }

  /* ================================================================== *
   * StatusBar
   * ================================================================== */

  class StatusBar {
    constructor() {
      this.el = {
        size: $('stSize'),
        bg: $('stBg'),
        swatch: $('stSwatch'),
        out: $('stOut'),
        time: $('stTime'),
        removed: $('stRemoved')
      };
    }

    reset() {
      this.el.size.textContent = '—';
      this.el.bg.textContent = '—';
      this.el.swatch.style.background = 'transparent';
      this.el.out.textContent = '—';
      this.el.time.textContent = '—';
      this.el.removed.textContent = '—';
    }

    update(s) {
      this.el.size.textContent = s.srcW + ' × ' + s.srcH;
      if (s.bg) {
        this.el.bg.textContent = rgbToHex(s.bg);
        this.el.swatch.style.background = rgbToHex(s.bg);
      } else {
        this.el.bg.textContent = '未识别';
        this.el.swatch.style.background = 'transparent';
      }
      this.el.out.textContent = s.outW + ' × ' + s.outH;
      this.el.time.textContent = s.ms < 1 ? '<1 ms' : Math.round(s.ms) + ' ms';
      this.el.removed.textContent = group(s.removed);
      this._flag(s.empty ? '整图判为背景' : null);
    }

    _flag(text) {
      var host = this.el.removed.parentNode;
      var old = host.querySelector('.empty-flag');
      if (old) old.remove();
      if (!text) return;
      var el = document.createElement('span');
      el.className = 'empty-flag';
      el.textContent = text;
      host.appendChild(el);
    }
  }

  /* ================================================================== *
   * Exporter
   * ================================================================== */

  class Exporter {
    static async save(pixels, w, h, filename) {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.putImageData(makeImageData(ctx, pixels, w, h), 0, 0);

      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) {
          b ? resolve(b) : reject(new Error('PNG 编码失败'));
        }, 'image/png');
      });

      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }

  /* ================================================================== *
   * App —— 编排层
   * ================================================================== */

  class App {
    constructor() {
      this.notifier = new Notifier($('toast'));
      this.previewSource = new PreviewSource(PREVIEW_MAX_SIDE);
      this.renderer = new Renderer($('preview'));
      this.status = new StatusBar();
      this.panel = new ControlPanel(() => this.scheduleRender());

      this.source = null;
      this._lastDraw = null;
      this._timer = 0;
      this._busy = false;

      this._bindShell();
    }

    /* ---------- 外壳事件 ---------- */

    _bindShell() {
      var self = this;
      var viewport = $('viewport');

      $('btnOpen').addEventListener('click', function () { $('fileInput').click(); });
      $('fileInput').addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (f) self.loadFile(f);
        e.target.value = '';
      });

      $('dropzone').addEventListener('click', function () { $('fileInput').click(); });

      ['dragenter', 'dragover'].forEach(function (t) {
        viewport.addEventListener(t, function (e) {
          e.preventDefault();
          viewport.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend'].forEach(function (t) {
        viewport.addEventListener(t, function () { viewport.classList.remove('is-dragover'); });
      });
      viewport.addEventListener('drop', function (e) {
        e.preventDefault();
        viewport.classList.remove('is-dragover');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) self.loadFile(f);
      });
      // 阻止拖到窗口其它位置时浏览器直接打开图片
      window.addEventListener('dragover', function (e) { e.preventDefault(); });
      window.addEventListener('drop', function (e) { e.preventDefault(); });

      document.addEventListener('paste', function (e) {
        var files = e.clipboardData && e.clipboardData.files;
        if (files && files.length) {
          e.preventDefault();
          self.loadFile(files[0]);
        }
      });
      $('btnPaste').addEventListener('click', function () { self.pasteFromClipboard(); });

      $('btnPick').addEventListener('click', function () { self.togglePick(); });
      $('btnAutoDetect').addEventListener('click', function () { self.autoDetect(); });
      $('preview').addEventListener('click', function (e) { self.handleCanvasClick(e); });

      $('btnExportCut').addEventListener('click', function () { self.renderPNG('cut'); });
      $('btnExportFull').addEventListener('click', function () { self.renderPNG('full'); });

      var resizeTimer = 0;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (self._lastDraw) self.renderer.draw(self._lastDraw.imageData, self._lastDraw.cropRect);
        }, 120);
      });
    }

    /* ---------- 载入 ---------- */

    async loadFile(file) {
      if (!file) return;
      if (!/^image\//i.test(file.type) && !IMAGE_EXT.test(file.name || '')) {
        this.notifier.show('不是图片文件：' + (file.name || '未知'));
        return;
      }
      try {
        var src = await SourceImage.load(file);
        this.setSource(src);
      } catch (e) {
        this.notifier.show(e && e.message ? e.message : '图片载入失败');
      }
    }

    async pasteFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        this.notifier.show('当前环境不支持读取剪贴板，请直接按 Ctrl+V');
        return;
      }
      try {
        var items = await navigator.clipboard.read();
        for (var i = 0; i < items.length; i++) {
          var types = items[i].types || [];
          for (var j = 0; j < types.length; j++) {
            if (!/^image\//.test(types[j])) continue;
            var blob = await items[i].getType(types[j]);
            var file = new File([blob], 'clipboard.png', { type: types[j] });
            await this.loadFile(file);
            return;
          }
        }
        this.notifier.show('剪贴板中没有图片');
      } catch (e) {
        this.notifier.show('读取剪贴板失败，请直接按 Ctrl+V');
      }
    }

    setSource(src) {
      this.source = src;
      this.previewSource.invalidate();
      this.renderer.picking = false;
      $('btnPick').classList.remove('is-active');

      $('fileChip').textContent = src.name + ' · ' + src.width + '×' + src.height;
      $('fileChip').hidden = false;
      $('dropzone').hidden = true;
      $('canvasShell').hidden = false;
      $('btnExportCut').disabled = false;
      $('btnExportFull').disabled = false;
      $('btnPick').disabled = false;
      $('btnAutoDetect').disabled = false;

      // 载入即检测一次并填充背景色（取代原先常开的「自动检测」模式）
      this.autoDetect();
      this.renderNow();
    }

    /** 一次性动作：沿四边采样估计背景色，直接填进背景色控件 */
    autoDetect() {
      if (!this.source) return;
      var src = this.source;
      var bg;
      try {
        bg = BGCore.estimateBackground(src.imageData.data, src.width, src.height, 2);
      } catch (e) {
        this.notifier.show('背景检测失败：' + (e && e.message ? e.message : '未知错误'));
        return;
      }
      if (!bg) {
        this.notifier.show('未识别到背景色（整图可能已透明），已保留当前设定');
        return;
      }
      this.panel.setBgColor(bg);
    }

    /* ---------- 预览 ---------- */

    scheduleRender() {
      clearTimeout(this._timer);
      var self = this;
      this._timer = setTimeout(function () { self.renderNow(); }, THROTTLE_MS);
    }

    renderNow() {
      if (!this.source || this._busy) return;

      var params = this.panel.params();
      var work = this.previewSource.get(this.source, this.panel.el.quality.value === 'precise');

      if (this.panel.el.showOriginal.checked) {
        this._lastDraw = { imageData: work.imageData, cropRect: null };
        this.renderer.draw(work.imageData, null);
        this.status.update({
          srcW: this.source.width, srcH: this.source.height,
          bg: null, outW: this.source.width, outH: this.source.height,
          ms: 0, removed: 0, empty: false
        });
        return;
      }

      var t0 = performance.now();
      var result;
      try {
        result = BGCore.process(work.imageData, params);
      } catch (e) {
        this.notifier.show('处理失败：' + (e && e.message ? e.message : '未知错误'));
        return;
      }
      var ms = performance.now() - t0;

      var inv = 1 / work.scale;
      var cropRect = params.crop ? result.bounds : null;
      this._lastDraw = { imageData: { data: result.data, width: result.width, height: result.height }, cropRect: cropRect };
      this.renderer.draw(this._lastDraw.imageData, cropRect);

      this.status.update({
        srcW: this.source.width,
        srcH: this.source.height,
        bg: result.bgColor,
        outW: Math.round(result.bounds.w * inv),
        outH: Math.round(result.bounds.h * inv),
        ms: ms,
        removed: Math.round(result.removed * inv * inv),
        empty: result.empty
      });
    }

    /* ---------- 拾取 ---------- */

    togglePick() {
      var on = !this.renderer.picking;
      this.renderer.picking = on;
      $('btnPick').classList.toggle('is-active', on);
    }

    handleCanvasClick(e) {
      if (!this.renderer.picking || !this.source) return;
      var unit = this.renderer.toUnit(e.clientX, e.clientY);
      if (!unit) return;

      var x = clamp(Math.floor(unit.u * this.source.width), 0, this.source.width - 1);
      var y = clamp(Math.floor(unit.v * this.source.height), 0, this.source.height - 1);
      var i = (y * this.source.width + x) * 4;
      var d = this.source.imageData.data;

      this.panel.setBgColor([d[i], d[i + 1], d[i + 2]]);
      this.renderer.picking = false;
      $('btnPick').classList.remove('is-active');
      this.renderNow();
    }

    /* ---------- 导出（始终按原始分辨率重算） ---------- */

    async renderPNG(kind) {
      if (!this.source || this._busy) return;
      this._setBusy(true);
      try {
        await nextFrame();
        await nextFrame();

        var params = this.panel.params();
        // 唯一入口：与预览共用 params，只覆盖 crop
        var options = Object.assign({}, params, { crop: kind === 'cut' });
        var result = BGCore.process(this.source.imageData, options);

        var name = baseName(this.source.name) + (kind === 'cut' ? '-cut.png' : '-nobg.png');
        if (kind === 'cut') {
          await Exporter.save(result.cropped, result.bounds.w, result.bounds.h, name);
        } else {
          await Exporter.save(result.data, result.width, result.height, name);
        }
        this.notifier.show('已导出 ' + name + '（' + (kind === 'cut'
          ? result.bounds.w + '×' + result.bounds.h
          : result.width + '×' + result.height) + '）', 2600);
      } catch (e) {
        this.notifier.show('导出失败：' + (e && e.message ? e.message : '未知错误'));
      } finally {
        this._setBusy(false);
      }
    }

    _setBusy(v) {
      this._busy = v;
      document.body.style.cursor = v ? 'progress' : '';
      $('btnExportCut').disabled = v || !this.source;
      $('btnExportFull').disabled = v || !this.source;
      $('btnOpen').disabled = v;
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    window.__app = new App();
  });
})();
