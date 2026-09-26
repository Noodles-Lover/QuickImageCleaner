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
   * I18N —— 界面文案（zh / en），语言偏好存 localStorage
   * ================================================================== */

  var LANG_KEY = 'qic.lang';
  var LANG = (function () {
    var saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* 隐私模式下不可用 */ }
    if (saved === 'zh' || saved === 'en') return saved;
    return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
  })();

  var I18N = {
    zh: {
      docTitle: 'QuickImageCleaner · 背景透明化与最小尺寸裁剪',
      sub: '背景透明化 · 最小尺寸裁剪',
      pasteT: '从剪贴板粘贴图片', paste: '粘贴', open: '打开图片',
      gBg: '背景', gSep: '分离', gCrop: '裁剪', gBatch: '批量', gTips: '提示',
      bgColor: '背景色', pickT: '从图上拾取', pick: '拾取', autoDetect: '自动检测背景色',
      tolerance: '敏感度', softness: '边缘羽化',
      softnessHint: '占敏感度区间的比例，产生半透明过渡带',
      globalMode: '全图移除同色',
      globalModeHint: '关闭时只移除与四边连通的区域，保护主体内部同色像素',
      cropToContent: '裁剪到最小尺寸', margin: '外边距',
      alphaThreshold: '判定阈值', alphaThresholdHint: 'alpha 高于该值的像素才计入包围盒',
      pickFolder: '选择文件夹',
      batchDirInfo: '仅处理文件夹第一层，忽略子文件夹与非图片',
      batchChosen: '已选 {d} · {n} 张图片',
      readOnly: ' · 只有读取权限，将逐个下载',
      keepOriginal: '创建副本', overwrite: '原地覆盖',
      hintCopy: '原图另存为 原名-original，处理结果占用原文件名（原名.png）',
      hintOverwrite: '处理结果占用原文件名（原名.png），原图不保留且无法从本工具恢复',
      start: '开始处理', stop: '停止',
      tip1: '背景为纯色或近似纯色时效果最佳',
      tip2: '主体内部有与背景同色的区域时，保持「全图移除同色」关闭',
      tip3: '导出始终按原始分辨率重新计算',
      showOriginalT: '绕过处理，直接显示输入', showOriginal: '显示原图',
      previewQuality: '预览精度',
      qualityFast: '快速（降采样至 1100px）', qualityPrecise: '精确（原分辨率）',
      exportCut: '导出 PNG（裁剪后）', exportFull: '导出 PNG（原尺寸）',
      zoomOutT: '缩小', zoomInT: '放大', zoom100T: '按原始像素显示',
      zoomFitT: '适应窗口', zoomFit: '适应',
      resetT: '把这一张恢复为打开文件夹时的默认参数', reset: '恢复默认',
      exitBatch: '退出批量', prev: '上一张', next: '下一张', inc: '增加', dec: '减少',
      dzTitle: '拖入图片', dzSub: '或点击选择文件 · PNG / JPG / WebP / BMP / GIF',
      dzPaste: '粘贴', dzSolid: '纯色背景效果最佳', dzLocal: '全程本地处理，不上传',
      stSource: '原尺寸', stBg: '背景色', stOut: '输出尺寸', stTime: '处理耗时', stRemoved: '已移除',
      notDetected: '未识别', emptyFlag: '整图判为背景', cancel: '取消', unknown: '未知错误',
      errDecode: '图片解码失败', errSize: '无法读取图片尺寸',
      errSide: '单边尺寸超过 {n}px 上限',
      errPixels: '图片过大（{n} 像素），上限 {max}',
      errPixelsRead: '无法读取像素数据：{m}',
      errNotImage: '不是图片文件：{n}', errLoad: '图片载入失败',
      errClipboard: '当前环境不支持读取剪贴板，请直接按 Ctrl+V',
      errClipboardFail: '读取剪贴板失败，请直接按 Ctrl+V',
      clipboardEmpty: '剪贴板中没有图片',
      errDetect: '背景检测失败：{m}',
      detectNone: '未识别到背景色（整图可能已透明），已保留当前设定',
      errFolder: '选择文件夹失败：{m}',
      noFsApi: '当前浏览器不支持文件夹写入，请使用 Chrome 或 Edge',
      noImages: '文件夹内没有可处理的图片',
      errItem: '载入 {n} 失败：{m}', errProcess: '处理失败：{m}', errExport: '导出失败：{m}',
      exported: '已导出 {n}（{w}×{h}）', errPng: 'PNG 编码失败',
      batchChip: '批量 · {d} · {n} 张',
      batchDone: '批量完成 {d} / {t}', batchFail: '，失败 {f}', batchStopped: '已手动停止',
      cfTitle: '确认原地覆盖',
      cfLine1: '将处理 {n} 张图片，并写回文件夹「{d}」。',
      cfLine2: '处理结果占用原文件名（原名.png），全部原图都将被改写或删除。',
      cfLine3: '如需保留原图，请改用「创建副本」。',
      cfWarn: '覆盖后原图无法从本工具恢复：操作不可撤销，请先备份重要图片。',
      cfOk: '确认覆盖', ok: '确认', done: '完成', errCtx: '无法创建 2D 上下文'
    },
    en: {
      docTitle: 'QuickImageCleaner · Transparent background & auto crop',
      sub: 'Background removal · Auto crop',
      pasteT: 'Paste from clipboard', paste: 'Paste', open: 'Open image',
      gBg: 'Background', gSep: 'Separate', gCrop: 'Crop', gBatch: 'Batch', gTips: 'Tips',
      bgColor: 'Background color', pickT: 'Pick a color from the image', pick: 'Pick',
      autoDetect: 'Auto-detect background',
      tolerance: 'Tolerance', softness: 'Edge feathering',
      softnessHint: 'Share of the tolerance range that becomes a soft transition',
      globalMode: 'Remove matching color everywhere',
      globalModeHint: 'Off: only regions connected to the borders are cleared, protecting same-colored areas inside the subject',
      cropToContent: 'Crop to content', margin: 'Margin',
      alphaThreshold: 'Alpha threshold', alphaThresholdHint: 'Pixels with alpha above this count toward the crop box',
      pickFolder: 'Choose folder',
      batchDirInfo: 'Only the top level is processed; subfolders and non-images are skipped',
      batchChosen: 'Selected {d} · {n} images',
      readOnly: ' · read-only, files will be downloaded instead',
      keepOriginal: 'Keep original', overwrite: 'Overwrite',
      hintCopy: 'Originals are kept as name-original; results take the original file names (name.png)',
      hintOverwrite: 'Results take the original file names (name.png); originals are not kept and cannot be restored by this tool',
      start: 'Start', stop: 'Stop',
      tip1: 'Works best on solid or near-solid backgrounds',
      tip2: 'Keep "remove matching color everywhere" off if the subject contains the background color',
      tip3: 'Export always re-runs at full resolution',
      showOriginalT: 'Show the input without processing', showOriginal: 'Original',
      previewQuality: 'Preview quality',
      qualityFast: 'Fast (downscaled to 1100 px)', qualityPrecise: 'Precise (full resolution)',
      exportCut: 'Export PNG (cropped)', exportFull: 'Export PNG (full size)',
      zoomOutT: 'Zoom out', zoomInT: 'Zoom in', zoom100T: 'Actual pixels',
      zoomFitT: 'Fit to window', zoomFit: 'Fit',
      resetT: 'Reset this image to the defaults from when the folder was opened', reset: 'Reset',
      exitBatch: 'Exit batch', prev: 'Previous', next: 'Next', inc: 'Increase', dec: 'Decrease',
      dzTitle: 'Drop an image', dzSub: 'or click to browse · PNG / JPG / WebP / BMP / GIF',
      dzPaste: 'to paste', dzSolid: 'Best with solid backgrounds', dzLocal: 'Processed locally, never uploaded',
      stSource: 'Source', stBg: 'Background', stOut: 'Output', stTime: 'Time', stRemoved: 'Removed',
      notDetected: 'Not detected', emptyFlag: 'Whole image is background', cancel: 'Cancel', unknown: 'Unknown error',
      errDecode: 'Failed to decode the image', errSize: 'Could not read the image size',
      errSide: 'A side exceeds the {n}px limit',
      errPixels: 'Image too large ({n} pixels), limit is {max}',
      errPixelsRead: 'Could not read pixel data: {m}',
      errNotImage: 'Not an image file: {n}', errLoad: 'Failed to load the image',
      errClipboard: 'Clipboard reading is not supported here, press Ctrl+V instead',
      errClipboardFail: 'Failed to read the clipboard, press Ctrl+V instead',
      clipboardEmpty: 'No image in the clipboard',
      errDetect: 'Background detection failed: {m}',
      detectNone: 'No background color detected (the image may be fully transparent); current setting kept',
      errFolder: 'Could not open the folder: {m}',
      noFsApi: 'This browser cannot write to folders, use Chrome or Edge',
      noImages: 'No processable images in this folder',
      errItem: 'Failed to load {n}: {m}', errProcess: 'Processing failed: {m}', errExport: 'Export failed: {m}',
      exported: 'Exported {n} ({w}×{h})', errPng: 'PNG encoding failed',
      batchChip: 'Batch · {d} · {n} images',
      batchDone: 'Done {d} / {t}', batchFail: ', {f} failed', batchStopped: 'Stopped manually',
      cfTitle: 'Confirm overwrite',
      cfLine1: 'Will process {n} images and write them back to "{d}".',
      cfLine2: 'Results take the original file names (name.png); every original will be overwritten or deleted.',
      cfLine3: 'To keep originals, use "Keep original" instead.',
      cfWarn: 'Overwritten originals cannot be restored by this tool: the operation is irreversible. Back up important images first.',
      cfOk: 'Overwrite', ok: 'OK', done: 'Done', errCtx: 'Could not create a 2D context'
    }
  };

  function t(key, vars) {
    var table = I18N[LANG] || I18N.zh;
    var s = table[key] !== undefined ? table[key] : I18N.zh[key];
    if (s === undefined) return key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split('{' + k + '}').join(String(vars[k]));
        }
      }
    }
    return s;
  }

  function applyI18n() {
    document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
    document.title = t('docTitle');
    var i, nodes;
    nodes = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    nodes = document.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('title', t(nodes[i].getAttribute('data-i18n-title')));
    }
    nodes = document.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('aria-label', t(nodes[i].getAttribute('data-i18n-aria')));
    }
    nodes = document.querySelectorAll('#langSwitch button');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('is-active', nodes[i].getAttribute('data-lang') === LANG);
    }
  }

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

  /** 含点的扩展名，如 ".jpg"；无扩展名返回空串 */
  function extOf(name) {
    var m = /\.[^.]+$/.exec(String(name || ''));
    return m ? m[0] : '';
  }

  /** 输出文件名：与单图导出按钮保持同一套命名约定 */
  function derivedName(name, cropOn) {
    return baseName(name) + (cropOn ? '-cut.png' : '-nobg.png');
  }

  /** 出厂默认参数（不含背景色：背景色一律逐图自动检测） */
  function defaultParams() {
    var d = BGCore.DEFAULTS;
    return {
      bgColor: null,
      tolerance: d.tolerance,
      softness: d.softness,
      connectivity: d.connectivity,
      crop: d.crop,
      margin: d.margin,
      cropAlphaThreshold: d.cropAlphaThreshold
    };
  }

  /** 统一「裁剪开 → 取裁剪缓冲，裁剪关 → 取全图」的取值逻辑 */
  function pickOutput(result, cropOn) {
    return cropOn
      ? { pixels: result.cropped, w: result.bounds.w, h: result.bounds.h }
      : { pixels: result.data, w: result.width, h: result.height };
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
   * ConfirmDialog —— 模态确认（Esc/点遮罩取消，Enter 确认）
   * ================================================================== */

  class ConfirmDialog {
    constructor() {
      this.box = $('confirmBox');
      this.titleEl = $('confirmTitle');
      this.textEl = $('confirmText');
      this.okEl = $('confirmOk');
      this._resolve = null;

      var self = this;
      this.okEl.addEventListener('click', function () { self._done(true); });
      $('confirmCancel').addEventListener('click', function () { self._done(false); });
      this.box.addEventListener('click', function (e) {
        if (e.target === self.box) self._done(false);
      });
      document.addEventListener('keydown', function (e) {
        if (self.box.hidden) return;
        if (e.key === 'Escape') self._done(false);
        else if (e.key === 'Enter') self._done(true);
      });
    }

    /** @param {{title:string, lines:string[], warn?:string, okText:string}} o */
    ask(o) {
      this.titleEl.textContent = o.title || '';
      this.textEl.textContent = '';
      (o.lines || []).forEach(function (line) {
        var div = document.createElement('div');
        div.textContent = line;
        this.textEl.appendChild(div);
      }, this);
      if (o.warn) {
        var warn = document.createElement('strong');
        warn.className = 'modal-warn';
        warn.textContent = o.warn;
        this.textEl.appendChild(warn);
      }
      this.okEl.textContent = o.okText || t('ok');
      this.box.hidden = false;
      return new Promise(function (resolve) { self._resolve = resolve; });
    }

    _done(v) {
      if (this.box.hidden) return;
      this.box.hidden = true;
      var r = this._resolve;
      this._resolve = null;
      if (r) r(v);
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
      if (!w || !h) throw new Error(t('errSize'));
      if (w > BGCore.MAX_SIDE || h > BGCore.MAX_SIDE) {
        throw new Error(t('errSide', { n: BGCore.MAX_SIDE }));
      }
      if (w * h > BGCore.MAX_PIXELS) {
        throw new Error(t('errPixels', { n: group(w * h), max: group(BGCore.MAX_PIXELS) }));
      }
      try {
        var raster = SourceImage.rasterize(raw, w, h);
        if (typeof raw.close === 'function') raw.close();
        return new SourceImage(file.name, raster.imageData, raster.canvas);
      } catch (e) {
        throw new Error(t('errPixelsRead', { m: e && e.message ? e.message : t('unknown') }));
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
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(t('errDecode'))); };
        img.src = url;
      });
    }

    static rasterize(source, w, h) {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error(t('errCtx'));
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
      this.PAIRS = [
        ['tolerance', 'valTolerance'],
        ['softness', 'valSoftness'],
        ['margin', 'valMargin'],
        ['threshold', 'valThreshold']
      ];
      this._bind();
      this._sync();
    }

    _bind() {
      var self = this;
      var pairs = this.PAIRS;

      pairs.forEach(function (pair) {
        var slider = self.el[pair[0]];
        var num = self.el[pair[1]];

        slider.addEventListener('input', function () {
          self._syncPair(slider, num);
          self._emit();
        });

        // 数字框：精确输入 / 上下键微调
        num.addEventListener('input', function () {
          if (num.value === '') return;                 // 清空待输入，失焦时归位
          var v = Number(num.value);
          if (!isFinite(v)) return;
          slider.value = clamp(Math.round(v), +slider.min, +slider.max);
          self._paintSlider(slider);
          self._emit();
        });
        num.addEventListener('blur', function () { self._syncPair(slider, num); });
      });

      ['globalMode', 'crop', 'showOriginal'].forEach(function (k) {
        self.el[k].addEventListener('change', function () { self._sync(); self._emit(); });
      });

      this.el.bgColor.addEventListener('input', function () {
        self.el.bgHex.textContent = self.el.bgColor.value.toUpperCase();
        self._emit();
      });

      this.el.quality.addEventListener('change', function () { self._emit(); });

      // 步进按钮：单击微调，按住连续增减
      Array.prototype.forEach.call(document.querySelectorAll('.stp'), function (btn) {
        btn.addEventListener('pointerdown', function (e) {
          e.preventDefault();   // 不抢焦点，滑块键盘状态保持
          self._startStep(btn);
        });
      });
    }

    _startStep(btn) {
      var self = this;
      var numId = btn.getAttribute('data-step');
      var dir = +btn.getAttribute('data-dir');
      var pair = null;
      this.PAIRS.forEach(function (p) { if (p[1] === numId) pair = p; });
      if (!pair) return;

      self._stepOnce(pair, dir);
      var timer = setTimeout(function tick() {
        self._stepOnce(pair, dir);
        timer = setTimeout(tick, 60);
      }, 380);

      var stop = function () {
        clearTimeout(timer);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    }

    _stepOnce(pair, dir) {
      var slider = this.el[pair[0]];
      if (slider.disabled) return;
      var step = +slider.step || 1;
      slider.value = clamp(+slider.value + dir * step, +slider.min, +slider.max);
      this._syncPair(slider, this.el[pair[1]]);
      this._emit();
    }

    _paintSlider(input) {
      var min = +input.min, max = +input.max;
      var pct = max === min ? 0 : (+input.value - min) / (max - min) * 100;
      input.style.setProperty('--fill', pct + '%');
    }

    /** 滑块 → 数字框 + 填充色，唯一同步点（applyParams / 切图 / 恢复默认都经过这里） */
    _syncPair(slider, num) {
      num.value = slider.value;
      num.disabled = slider.disabled;
      this._paintSlider(slider);
    }

    /** 控件之间的联动状态（禁用/文案） */
    _sync() {
      var e = this.el;
      e.margin.disabled = !e.crop.checked;
      e.threshold.disabled = !e.crop.checked;
      var self = this;
      this.PAIRS.forEach(function (pair) {
        self._syncPair(e[pair[0]], e[pair[1]]);
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

    /** 用一组参数值反向驱动控件（批量模式下用于切换到某一张图的参数） */
    applyParams(p) {
      var e = this.el;
      if (p.bgColor) e.bgColor.value = rgbToHex(p.bgColor).toLowerCase();
      e.tolerance.value = p.tolerance;
      e.softness.value = Math.round(p.softness * 100);
      e.globalMode.checked = p.connectivity === 'global';
      e.crop.checked = p.crop;
      e.margin.value = p.margin;
      e.threshold.value = p.cropAlphaThreshold;
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
        this.el.bg.textContent = t('notDetected');
        this.el.swatch.style.background = 'transparent';
      }
      this.el.out.textContent = s.outW + ' × ' + s.outH;
      this.el.time.textContent = s.ms < 1 ? '<1 ms' : Math.round(s.ms) + ' ms';
      this.el.removed.textContent = group(s.removed);
      this._flag(s.empty ? t('emptyFlag') : null);
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
    static async encode(pixels, w, h) {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.putImageData(makeImageData(ctx, pixels, w, h), 0, 0);

      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) {
          b ? resolve(b) : reject(new Error(t('errPng')));
        }, 'image/png');
      });
    }

    static async download(pixels, w, h, filename) {
      var blob = await Exporter.encode(pixels, w, h);
      Exporter.downloadBlob(blob, filename);
    }

    static downloadBlob(blob, filename) {
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
   * Batch —— 目录句柄的枚举 / 权限 / 写入（仅 Chrome / Edge）
   * ================================================================== */

  class Batch {
    static supported() {
      return typeof window.showDirectoryPicker === 'function';
    }

    static async pickDirectory() {
      return await window.showDirectoryPicker({ mode: 'readwrite' });
    }

    static async ensureWritePermission(dir) {
      var opts = { mode: 'readwrite' };
      try {
        if (dir.queryPermission && (await dir.queryPermission(opts)) === 'granted') return true;
        if (dir.requestPermission) return (await dir.requestPermission(opts)) === 'granted';
      } catch (e) { /* 继续按已有权限尝试 */ }
      return true;
    }

    /** 仅第一层的图片文件，子文件夹与非图片一律忽略 */
    static async listImages(dir) {
      var out = [];
      var iter = typeof dir.values === 'function' ? dir.values() : dir.entries();
      for await (var entry of iter) {
        if (!entry || entry.kind !== 'file') continue;
        if (!IMAGE_EXT.test(entry.name)) continue;
        out.push(entry);
      }
      return out;
    }

    static async writeBytes(fileHandle, blob) {
      var stream = await fileHandle.createWritable();
      await stream.write(blob);
      await stream.close();
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
      this.panel = new ControlPanel(() => this._onPanelChange());
      this.confirm = new ConfirmDialog();

      this.source = null;
      this._lastDraw = null;
      this._timer = 0;
      this._busy = false;

      // 批量工作台：mode 决定预览与参数归属
      this.mode = 'single';
      this.batch = null;

      // 预览缩放：1 = 适应窗口，>1 放大，<1 缩小
      this.zoom = 1;

      applyI18n();
      this._bindShell();
    }

    /** 切换语言：静态文案重刷 + 动态文案（提示/状态/按钮）重算 */
    setLang(lang) {
      if (lang !== 'zh' && lang !== 'en') return;
      LANG = lang;
      try { localStorage.setItem(LANG_KEY, LANG); } catch (e) { /* 隐私模式下不可用 */ }
      applyI18n();
      this._syncBatchHint();
      this._refreshLangTexts();
    }

    _refreshLangTexts() {
      if (this.batch) {
        $('batchDirInfo').textContent = t('batchChosen',
          { d: this.batch.dir.name, n: this.batch.items.length }) +
          (this.batch.writable ? '' : t('readOnly'));
      }
      if (this._activeSource()) {
        this.renderNow();
      } else {
        this.status.reset();
      }
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

      // 语言切换
      Array.prototype.forEach.call(document.querySelectorAll('#langSwitch button'), function (btn) {
        btn.addEventListener('click', function () { self.setLang(btn.getAttribute('data-lang')); });
      });

      ['dragenter', 'dragover'].forEach(function (type) {
        viewport.addEventListener(type, function (e) {
          e.preventDefault();
          viewport.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend'].forEach(function (type) {
        viewport.addEventListener(type, function () { viewport.classList.remove('is-dragover'); });
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

      $('btnPickDir').addEventListener('click', function () { self.pickBatchFolder(); });
      $('batchMode').addEventListener('change', function () { self._syncBatchHint(); });
      $('btnBatchRun').addEventListener('click', function () { self.runBatch(); });
      $('btnBatchPrev').addEventListener('click', function () { self.stepBatch(-1); });
      $('btnBatchNext').addEventListener('click', function () { self.stepBatch(1); });
      $('btnBatchReset').addEventListener('click', function () { self.resetCurrentItem(); });
      $('btnBatchExit').addEventListener('click', function () { self._exitBatch(); });

      document.addEventListener('keydown', function (e) {
        if (self.mode !== 'batch') return;
        var t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;   // 滑块自身要用方向键
        if (e.key === 'ArrowLeft') { e.preventDefault(); self.stepBatch(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); self.stepBatch(1); }
      });

      // 缩放：滚轮直接缩放（以光标为锚点），放大后可拖拽平移
      $('canvasArea').addEventListener('wheel', function (e) {
        e.preventDefault();
        self._zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      }, { passive: false });
      $('canvasArea').addEventListener('pointerdown', function (e) {
        self._beginPan(e);
      });
      $('btnZoomIn').addEventListener('click', function () { self._zoomStep(1.25); });
      $('btnZoomOut').addEventListener('click', function () { self._zoomStep(1 / 1.25); });
      $('btnZoomFit').addEventListener('click', function () { self._zoomFit(); });
      $('btnZoom100').addEventListener('click', function () { self._zoom100(); });

      self._syncBatchHint();

      var resizeTimer = 0;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (self._lastDraw) {
            self.renderer.draw(self._lastDraw.imageData, self._lastDraw.cropRect);
            self._applyZoom(self._activeSource());
          }
        }, 120);
      });
    }

    /* ---------- 载入 ---------- */

    async loadFile(file) {
      if (!file) return;
      if (this._busy) return;   // 批量/导出进行中不接受新图，所有载入入口都经过这里
      if (this.mode === 'batch') this._exitBatch();
      if (!/^image\//i.test(file.type) && !IMAGE_EXT.test(file.name || '')) {
        this.notifier.show(t('errNotImage', { n: file.name || t('unknown') }));
        return;
      }
      try {
        var src = await SourceImage.load(file);
        this.setSource(src);
      } catch (e) {
        this.notifier.show(e && e.message ? e.message : t('errLoad'));
      }
    }

    async pasteFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        this.notifier.show(t('errClipboard'));
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
        this.notifier.show(t('clipboardEmpty'));
      } catch (e) {
        this.notifier.show(t('errClipboardFail'));
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

      // 载入即回到默认参数（背景色由自动检测填充），缩放复位
      this.zoom = 1;
      this.panel.applyParams(defaultParams());
      this.autoDetect();
      this.renderNow();
    }

    /** 一次性动作：沿四边采样估计背景色，直接填进背景色控件 */
    autoDetect() {
      var src = this._activeSource();
      if (!src) return;
      var bg;
      try {
        bg = BGCore.estimateBackground(src.imageData.data, src.width, src.height, 2);
      } catch (e) {
        this.notifier.show(t('errDetect', { m: e && e.message ? e.message : t('unknown') }));
        return;
      }
      if (!bg) {
        this.notifier.show(t('detectNone'));
        return;
      }
      this.panel.setBgColor(bg);
      if (this.mode === 'batch' && this._currentItem()) {
        this._currentItem().params = this.panel.params();
      }
    }

    /* ---------- 预览 ---------- */

    /** 面板任何变化都先落到当前归属（单图 / 批量当前张），再排程重绘 */
    _onPanelChange() {
      if (this.mode === 'batch' && this._currentItem()) {
        this._currentItem().params = this.panel.params();
      }
      this.scheduleRender();
    }

    scheduleRender() {
      clearTimeout(this._timer);
      var self = this;
      this._timer = setTimeout(function () { self.renderNow(); }, THROTTLE_MS);
    }

    renderNow() {
      var src = this.mode === 'batch' ? this._currentSource() : this.source;
      if (!src || this._busy) return;

      var params = this.panel.params();
      var work = this.previewSource.get(src, this.panel.el.quality.value === 'precise');

      if (this.panel.el.showOriginal.checked) {
        this._lastDraw = { imageData: work.imageData, cropRect: null };
        this.renderer.draw(work.imageData, null);
        this._applyZoom(src);
        this.status.update({
          srcW: src.width, srcH: src.height,
          bg: null, outW: src.width, outH: src.height,
          ms: 0, removed: 0, empty: false
        });
        return;
      }

      var t0 = performance.now();
      var result;
      try {
        result = BGCore.process(work.imageData, params);
      } catch (e) {
        this.notifier.show(t('errProcess', { m: e && e.message ? e.message : t('unknown') }));
        return;
      }
      var ms = performance.now() - t0;

      var inv = 1 / work.scale;
      var cropRect = params.crop ? result.bounds : null;
      this._lastDraw = { imageData: { data: result.data, width: result.width, height: result.height }, cropRect: cropRect };
      this.renderer.draw(this._lastDraw.imageData, cropRect);
      this._applyZoom(src);

      this.status.update({
        srcW: src.width,
        srcH: src.height,
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
      if (this._panSuppressedClick) { this._panSuppressedClick = false; return; }
      var src = this._activeSource();
      if (!this.renderer.picking || !src) return;
      var unit = this.renderer.toUnit(e.clientX, e.clientY);
      if (!unit) return;

      var x = clamp(Math.floor(unit.u * src.width), 0, src.width - 1);
      var y = clamp(Math.floor(unit.v * src.height), 0, src.height - 1);
      var i = (y * src.width + x) * 4;
      var d = src.imageData.data;

      this.panel.setBgColor([d[i], d[i + 1], d[i + 2]]);
      if (this.mode === 'batch' && this._currentItem()) {
        this._currentItem().params = this.panel.params();
      }
      this.renderer.picking = false;
      $('btnPick').classList.remove('is-active');
      this.renderNow();
    }

    /* ---------- 导出（始终按原始分辨率重算） ---------- */

    async renderPNG(kind) {
      if (!this.source || this._busy || this.mode === 'batch') return;
      this._setBusy(true);
      try {
        await nextFrame();
        await nextFrame();

        var params = this.panel.params();
        // 唯一入口：与预览共用 params，只覆盖 crop
        var cropOn = kind === 'cut';
        var options = Object.assign({}, params, { crop: cropOn });
        var result = BGCore.process(this.source.imageData, options);
        var out = pickOutput(result, cropOn);

        var name = derivedName(this.source.name, cropOn);
        await Exporter.download(out.pixels, out.w, out.h, name);
        this.notifier.show(t('exported', { n: name, w: out.w, h: out.h }), 2600);
      } catch (e) {
        this.notifier.show(t('errExport', { m: e && e.message ? e.message : t('unknown') }));
      } finally {
        this._setBusy(false);
      }
    }

    /* ---------- 批量 ---------- */

    _syncBatchHint() {
      var overwrite = $('batchMode').querySelector('input:checked').value === 'overwrite';
      $('batchHint').textContent = t(overwrite ? 'hintOverwrite' : 'hintCopy');
    }

    /* ---------- 缩放（仅显示尺寸，不参与处理） ---------- */

    /** 适应窗口的显示比例：小图不放大（上限 1:1），大图等比缩小 */
    _fitScale(src) {
      var area = $('canvasArea');
      var availW = Math.max(1, area.clientWidth - 4);
      var availH = Math.max(1, area.clientHeight - 4);
      return Math.min(availW / src.width, availH / src.height, 1);
    }

    _applyZoom(src) {
      var pill = $('zoomPill');
      if (!src) { pill.hidden = true; return; }
      pill.hidden = false;

      var canvas = this.renderer.canvas;
      var scale = this.zoom === 1 ? this._fitScale(src) : this._fitScale(src) * this.zoom;
      canvas.style.width = Math.max(1, Math.round(src.width * scale)) + 'px';
      canvas.style.height = Math.max(1, Math.round(src.height * scale)) + 'px';
      $('zoomVal').textContent = Math.round(scale * 100) + '%';

      var area = $('canvasArea');
      area.classList.toggle('can-pan',
        area.scrollWidth > area.clientWidth || area.scrollHeight > area.clientHeight);
    }

    _zoomStep(factor) {
      var src = this._activeSource();
      if (!src) return;
      this.zoom = clamp(this.zoom * factor, 0.25, 8);
      this._applyZoom(src);
    }

    /** 以屏幕上某点为锚点缩放：该点下的图像内容保持不动 */
    _zoomAt(clientX, clientY, factor) {
      var src = this._activeSource();
      if (!src) return;

      var area = $('canvasArea');
      var canvas = this.renderer.canvas;
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) { this._zoomStep(factor); return; }

      var px = (clientX - rect.left) / rect.width;
      var py = (clientY - rect.top) / rect.height;

      this.zoom = clamp(this.zoom * factor, 0.25, 8);
      this._applyZoom(src);

      var after = canvas.getBoundingClientRect();
      area.scrollLeft += (after.left + px * after.width) - clientX;
      area.scrollTop += (after.top + py * after.height) - clientY;
    }

    /** 放大后拖拽平移；位移超过阈值才算拖拽，避免影响「拾取」的点击 */
    _beginPan(e) {
      var area = $('canvasArea');
      if (e.button !== 0) return;
      if (area.scrollWidth <= area.clientWidth && area.scrollHeight <= area.clientHeight) return;

      var sx = e.clientX, sy = e.clientY;
      var sl = area.scrollLeft, st = area.scrollTop;
      var moved = false;
      var self = this;

      var onMove = function (ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        if (!moved) { moved = true; area.classList.add('is-panning'); }
        area.scrollLeft = sl - dx;
        area.scrollTop = st - dy;
      };
      var onUp = function () {
        area.classList.remove('is-panning');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) self._panSuppressedClick = true;   // 拖拽后不触发拾取
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    _zoomFit() {
      this.zoom = 1;
      this._applyZoom(this._activeSource());
    }

    _zoom100() {
      var src = this._activeSource();
      if (!src) return;
      var fit = this._fitScale(src);
      this.zoom = clamp(fit > 0 ? 1 / fit : 1, 0.25, 8);
      this._applyZoom(src);
    }

    /* ---------- 批量工作台 ---------- */

    _activeSource() {
      return this.mode === 'batch' ? this._currentSource() : this.source;
    }

    _currentItem() {
      return this.batch && this.batch.items[this.batch.index];
    }

    _currentSource() {
      return this.batch && this.batch.index >= 0 ? this.batch.items[this.batch.index].source : null;
    }

    async pickBatchFolder() {
      if (this._busy) return;
      if (!Batch.supported()) {
        this.notifier.show(t('noFsApi'));
        return;
      }
      try {
        var dir = await Batch.pickDirectory();
        if (!dir) return;
        var writable = await Batch.ensureWritePermission(dir);
        var handles = await Batch.listImages(dir);
        if (!handles.length) {
          this.notifier.show(t('noImages'));
          return;
        }

        // 每张图独立参数：默认取出厂默认，背景色逐张自动检测（null = 处理时检测）
        var snapshot = defaultParams();
        this.batch = {
          dir: dir,
          writable: writable,
          snapshot: snapshot,
          items: handles.map(function (h) {
            return { handle: h, name: h.name, source: null, params: null };
          }),
          index: -1
        };

        $('batchDirInfo').textContent = t('batchChosen', { d: dir.name, n: handles.length }) +
          (writable ? '' : t('readOnly'));
        this._enterBatch();
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 用户取消
        this.notifier.show(t('errFolder', { m: e && e.message ? e.message : t('unknown') }));
      }
    }

    _enterBatch() {
      this.mode = 'batch';
      this._setBatchUI(true);
      this.showBatchItem(0);
    }

    _exitBatch() {
      this.mode = 'single';
      this.zoom = 1;
      if (this.batch) this.batch.items.forEach(function (it) { it.source = null; });
      this._setBatchUI(false);
      this._applyZoom(null);
      this.renderNow();
    }

    _setBatchUI(on) {
      $('batchNav').hidden = !on;
      $('btnExportCut').disabled = on || this._busy || !this.source;
      $('btnExportFull').disabled = on || this._busy || !this.source;
      $('btnBatchRun').disabled = on ? false : !(this.batch && this.batch.items.length);
      $('btnPick').disabled = on ? false : !this.source;
      $('btnAutoDetect').disabled = on ? false : !this.source;

      if (on) {
        $('dropzone').hidden = true;
        $('canvasShell').hidden = false;
        $('fileChip').textContent = t('batchChip',
          { d: this.batch.dir.name, n: this.batch.items.length });
        $('fileChip').hidden = false;
      } else if (!this.source) {
        $('dropzone').hidden = false;
        $('canvasShell').hidden = true;
        $('fileChip').hidden = true;
        $('btnBatchRun').disabled = true;
      }
      $('btnBatchRun').textContent = (this._busy && this.mode === 'batch') ? t('stop') : t('start');
    }

    /** 切换到某一张：解码 → 未检测过背景色则检测 → 把该张参数装进面板 → 绘制 */
    async showBatchItem(i) {
      var b = this.batch;
      if (!b || i < 0 || i >= b.items.length) return;
      b.index = i;
      var item = b.items[i];

      this.previewSource.invalidate();   // 同尺寸图片会命中旧缓存，必须失效
      this.renderer.picking = false;
      this.zoom = 1;                     // 换图复位缩放
      $('btnPick').classList.remove('is-active');

      this._paintBatchNav();
      if (!item.source) {
        try {
          item.source = await SourceImage.load(await item.handle.getFile());
        } catch (e) {
          this.notifier.show(t('errItem', { n: item.name, m: e && e.message ? e.message : t('unknown') }));
        }
      }
      if (this.mode !== 'batch' || b.index !== i) return;   // 期间已切走

      if (!item.params) item.params = Object.assign({}, b.snapshot, { bgColor: null });
      if (!item.params.bgColor && item.source) {
        try {
          var d = item.source.imageData.data;
          var bg = BGCore.estimateBackground(d, item.source.width, item.source.height, 2);
          if (bg) item.params.bgColor = bg;
        } catch (e) { /* 检测失败则留空，处理时按无背景处理 */ }
      }

      this.panel.applyParams(item.params);
      this.renderNow();
    }

    stepBatch(delta) {
      if (this.mode !== 'batch') return;
      var i = this.batch.index + delta;
      if (i < 0 || i >= this.batch.items.length) return;
      this.showBatchItem(i);
    }

    _paintBatchNav() {
      var b = this.batch;
      $('batchCounter').textContent = (b.index + 1) + ' / ' + b.items.length;
      $('batchName').textContent = b.items[b.index] ? b.items[b.index].name : '';
      $('btnBatchPrev').disabled = b.index <= 0;
      $('btnBatchNext').disabled = b.index >= b.items.length - 1;
    }

    resetCurrentItem() {
      var item = this._currentItem();
      if (!item) return;
      item.params = Object.assign({}, this.batch.snapshot, { bgColor: null });
      this.showBatchItem(this.batch.index);
    }

    async runBatch() {
      // 运行中再次点击 = 停止
      if (this._busy) { this._batchAbort = true; return; }
      if (this.mode !== 'batch' || !this.batch) return;
      if (!$('confirmBox').hidden) return;   // 确认框已打开，避免重复触发

      var items = this.batch.items;
      var overwrite = $('batchMode').querySelector('input:checked').value === 'overwrite';

      if (overwrite) {
        var ok = await this.confirm.ask({
          title: t('cfTitle'),
          lines: [
            t('cfLine1', { n: items.length, d: this.batch.dir.name }),
            t('cfLine2'),
            t('cfLine3')
          ],
          warn: t('cfWarn'),
          okText: t('cfOk')
        });
        if (!ok) return;
      }

      this._batchAbort = false;
      this._setBusy(true);
      $('btnPickDir').disabled = true;
      $('btnBatchRun').textContent = t('stop');
      $('batchProgress').hidden = false;

      var done = 0, fail = 0, notes = [];
      var self = this;

      for (var i = 0; i < items.length; i++) {
        if (this._batchAbort) { notes.push(t('batchStopped')); break; }
        var item = items[i];
        self._paintBatchProgress(i, items.length, item.name);
        try {
          var file = await item.handle.getFile();
          var src = await SourceImage.load(file);
          // bgColor 为 null = 该张从未预览过，由核心自行检测背景色
          var params = item.params || Object.assign({}, this.batch.snapshot, { bgColor: null });
          var result = BGCore.process(src.imageData, params);
          var out = pickOutput(result, params.crop);
          var blob = await Exporter.encode(out.pixels, out.w, out.h);
          await self._saveBatchFile(item.handle, file, blob, overwrite);
          done++;
        } catch (e) {
          fail++;
          if (notes.length < 3) {
            notes.push(t('errItem', { n: item.name, m: e && e.message ? e.message : t('unknown') }));
          }
        }
      }

      this._paintBatchProgress(items.length, items.length, t('done'));
      $('btnBatchRun').textContent = t('start');
      $('btnPickDir').disabled = false;
      this._setBusy(false);
      this.renderNow();

      var msg = t('batchDone', { d: done, t: items.length });
      if (fail) msg += t('batchFail', { f: fail });
      if (notes.length) msg += ' · ' + notes.join(' / ');
      this.notifier.show(msg, notes.length ? 7000 : 3200);
    }

    /**
     * 落盘入口：两种模式都是「处理结果占用原文件名（原名.png）」，
     * 差别只在是否先把原图另存为 原名-original<原扩展名>。
     * @param {Blob} sourceBytes 原图字节，用于副本模式备份
     */
    async _saveBatchFile(fileHandle, sourceBytes, blob, overwrite) {
      var name = fileHandle.name;
      var base = baseName(name);
      var isPng = /\.png$/i.test(name);

      if (!this.batch.writable) {
        Exporter.downloadBlob(blob, base + '.png');
        return;
      }

      // 副本模式：原图另存为 原名-original，保留原件可回溯
      if (!overwrite) {
        var backup = await this.batch.dir.getFileHandle(
          base + '-original' + extOf(name), { create: true });
        await Batch.writeBytes(backup, sourceBytes);
      }

      if (isPng) {
        await Batch.writeBytes(fileHandle, blob);
        return;
      }
      var target = await this.batch.dir.getFileHandle(base + '.png', { create: true });
      await Batch.writeBytes(target, blob);
      await this.batch.dir.removeEntry(name);
    }

    _paintBatchProgress(done, total, label) {
      $('bpFill').style.width = total ? Math.round(done / total * 100) + '%' : '0%';
      $('bpText').textContent = done + ' / ' + total + ' · ' + label;
    }

    _setBusy(v) {
      this._busy = v;
      document.body.style.cursor = v ? 'progress' : '';
      var inBatch = this.mode === 'batch';
      $('btnExportCut').disabled = v || inBatch || !this.source;
      $('btnExportFull').disabled = v || inBatch || !this.source;
      $('btnOpen').disabled = v;
      $('btnPickDir').disabled = v;
      if (this.mode === 'batch') $('btnBatchRun').disabled = false;   // 运行中作为「停止」
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    window.__app = new App();
  });
})();
