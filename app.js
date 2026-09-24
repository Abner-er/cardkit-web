/* CardKit — 纯本地 EXIF 卡片生成器 (Canvas 渲染, 无构建) */
"use strict";
const $ = (s) => document.querySelector(s);
const state = {
  photos: [], active: 0,
  tpl: "blur",            // blur | solid | none | backing
  solidColor: "#101820",
  backingColor: "#F7F6F2",
  inset: 48,              // 衬底面板: 照片内嵌留白 (px @1200)
  shadowOn: true,
  shadowStrength: 1,      // 0..1
  shadowAngle: 90,       // 度, 90=正下方(光源在上), 0=右, 180=左, 270=上
  shadowSoft: 1,         // 0.5..2 模糊倍数
  margin: 80,            // 外框边距 (px @1200), 四边等宽 (blur/solid/none)
  radius: 30,            // 圆角大小 (px @1200), 卡片外轮廓; 其余按比例联动
  aspect: "auto",        // auto | 4:3 | 1:1 | 3:4
  outW: 1200,
  previewBg: "checker",
};
const el = {
  t1: $("#t1"), t2: $("#t2"), exifState: $("#exifState"), status: $("#status"),
  preview: $("#preview"), thumbs: $("#thumbs"), dropzone: $("#dropzone"),
  solidRow: $("#solidRow"), backingRow: $("#backingRow"), marginRow: $("#marginRow"), radiusRow: $("#radiusRow"), file: $("#file"),
};
const CANVAS_REF_W = 1200; // 参考宽度, 所有几何按 S = W/1200 缩放
/* 透明悬浮的专属默认: 外框边距 26 / 圆角 50 (其余模板保持 80 / 30) */
const NONE_DEFAULTS = { margin: 26, radius: 50 };
let userTouchedMargin = false, userTouchedRadius = false; // 用户手动调过则锁定, 切模板不再重置

/* ================= 图片导入 ================= */
function blobToImage(blob) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode fail: " + blob.name));
    i.src = URL.createObjectURL(blob);
  });
}
function makeThumb(img) {
  const c = document.createElement("canvas");
  const s = Math.min(160 / img.width, 160 / img.height);
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

async function loadFiles(files) {
  let added = 0;
  for (const f of files) {
    let blob = f;
    if (/\.heic|\.heif$/i.test(f.name) || /^image\/(heic|heif)$/i.test(f.type)) {
      try { blob = await heic2any({ blob: f, pixelRatio: 1, quality: 0.9 }); }
      catch { el.status.textContent = `HEIC 转码失败: ${f.name}`; continue; }
    }
    let img;
    try {
      img = await createImageBitmap(blob, { imageOrientation: "from-image" })
        .catch(() => blobToImage(blob));
    } catch { el.status.textContent = `无法解码: ${f.name}`; continue; }
    const photo = {
      name: f.name.replace(/\.[^.]+$/, ""),
      img,
      w: img.width, h: img.height,
      thumb: makeThumb(img),
      exif: null,
    };
    try {
      const ex = (await exifr.parse(await blob.arrayBuffer())) || {};
      // 分数值兼容: 数值 / [n,d] / {"0":n,"1":d} / Rational{numerator,denominator} / "n/d"
      const rat = (v) => {
        if (v == null) return NaN;
        if (typeof v === "number") return v;
        if (Array.isArray(v)) return v[1] ? v[0] / v[1] : v[0];
        if (typeof v === "object") {
          if (v.numerator != null && v.denominator != null)
            return v.denominator ? v.numerator / v.denominator : v.numerator;
          if (v["0"] != null) return v["1"] ? v["0"] / v["1"] : v["0"];
          return NaN;
        }
        if (typeof v === "string" && v.includes("/")) {
          const [a, b] = v.split("/").map(Number);
          return b ? a / b : a;
        }
        return +v;
      };
      const pick = (camel, ...Pascal) => {
        for (const k of [camel, ...Pascal]) if (ex[k] != null) return ex[k];
        return null;
      };
      const t1 = [pick("make", "Make"), pick("model", "Model")]
        .filter(Boolean).map(String).join(" ").trim() || null;
      const p = [];
      const fl = rat(pick("focalLen35ef", "FocalLen35ef", "focalLength35ef", "FocalLength35ef")
        ?? pick("focalLength", "FocalLength"));
      if (isFinite(fl) && fl >= 1) p.push(`${Math.round(fl)}mm`);
      const fn = rat(pick("fNumber", "FNumber"));
      if (isFinite(fn) && fn > 0) p.push(`f/${fn.toFixed(1)}`);
      const et = rat(pick("exposureTime", "ExposureTime"));
      if (isFinite(et) && et > 0) p.push(et >= 1 ? `${et}s` : `1/${Math.round(1 / et)}s`);
      let isoRaw = pick("iso", "ISO", "ispeedRatings", "ISOSpeedRat");
      if (Array.isArray(isoRaw)) isoRaw = isoRaw[0];
      if (isFinite(+isoRaw) && +isoRaw > 0) p.push(`ISO${Math.round(+isoRaw)}`);
      photo.exif = { t1, t2: p.length ? p.join("  ") : null, raw: ex };
    } catch { /* 无 EXIF 留空 */ }
    state.photos.push(photo);
    added++;
  }
  if (added) state.active = state.photos.length - 1;
  renderThumbs();
  selectActive();
}

function renderThumbs() {
  el.thumbs.innerHTML = "";
  const clr = $("#clearAll");
  clr.hidden = state.photos.length === 0;
  clr.textContent = state.photos.length > 1 ? `🗑 清除全部（${state.photos.length}）` : "🗑 清除全部";
  state.photos.forEach((ph, i) => {
    const d = document.createElement("div");
    d.className = "thumb" + (i === state.active ? " on" : "");
    d.title = ph.name + (ph.exif?.t2 ? `\n${ph.exif.t2}` : "");
    const im = document.createElement("img");
    im.src = ph.thumb;
    d.appendChild(im);
    const x = document.createElement("button");
    x.className = "thumb-x";
    x.textContent = "×";
    x.title = "移除此照片";
    x.onclick = (e) => { e.stopPropagation(); removePhoto(i); };
    d.appendChild(x);
    d.onclick = () => { state.active = i; renderThumbs(); selectActive(); };
    el.thumbs.appendChild(d);
  });
  el.dropzone.classList.toggle("compact", state.photos.length > 0);
  setPreviewEmpty();
}

function removePhoto(i) {
  state.photos.splice(i, 1);
  if (state.active >= state.photos.length) state.active = state.photos.length - 1;
  else if (i < state.active) state.active--;
  if (state.photos.length === 0) {
    state.active = 0;
    el.t1.value = ""; el.t2.value = "";
    el.exifState.textContent = "EXIF 缺失（可手填）";
    const c = el.preview;
    c.width = 600; c.height = 400;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }
  renderThumbs();
  selectActive();
}

function clearAll() {
  state.photos = [];
  state.active = 0;
  el.t1.value = ""; el.t2.value = "";
  el.exifState.textContent = "EXIF 缺失（可手填）";
  const c = el.preview;
  c.width = 600; c.height = 400;
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  renderThumbs();
  selectActive();
}

function selectActive() {
  const ph = state.photos[state.active];
  if (!ph) return;
  const has = !!(ph.exif?.t1 || ph.exif?.t2);
  el.t1.value = ph.exif?.t1 || "";
  el.t2.value = ph.exif?.t2 || "";
  el.exifState.textContent = has ? "✓ EXIF 已读取" : "EXIF 缺失（可手填）";
  drawPreview();
}

function photosRatio(i) {
  const ph = state.photos[i];
  return ph ? ph.h / ph.w : 2 / 3;
}
function hasText() { return !!(el.t1.value.trim() || el.t2.value.trim()); }

/* ================= 卡片几何 ================= */
function backingGeo(W, S, idx) {
  const gT = 32 * S, gS = 44 * S, gB = 60 * S;   // 面板四周留白(容纳投影)
  const inset = state.inset * S;
  const ratio = photosRatio(idx);
  const hasT = hasText();
  const pad2 = 30 * S, textH = 100 * S;
  const swMax = W - 2 * gS - 2 * inset;
  let H, panelH, px, py, sw, sh;
  if (state.aspect === "auto") {
    sw = swMax; sh = sw * ratio;
    panelH = inset + sh + (hasT ? pad2 + textH : inset);
    H = gT + panelH + gB;
    px = gS + inset; py = gT + inset;
  } else {
    H = Math.round(W / +state.aspect);
    panelH = H - gT - gB;
    const photoSpace = panelH - 2 * inset - (hasT ? pad2 + textH : 0);
    sw = swMax; sh = sw * ratio;
    if (sh > photoSpace) { sh = Math.max(1 * S, photoSpace); sw = sh / ratio; }
    px = (W - sw) / 2;
    py = gT + inset + (photoSpace - sh) / 2;
  }
  const textCY = py + sh + pad2 + textH / 2;
  return { gT, gS, gB, H, panelH, px, py, sw, sh, textCY };
}

function cardH(W, S, idx) {
  if (state.tpl === "backing") return backingGeo(W, S, idx).H;
  const m = state.margin * S;
  const phh = (W - 2 * m) * photosRatio(idx);
  const footerH = hasText() ? 150 * S : m; // 无文字时底部=边距, 四边等宽
  if (state.aspect === "auto") return Math.round(m + phh + footerH);
  return Math.round(W / +state.aspect);
}

/* ================= 卡片渲染 ================= */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function photoRect(W, H, S, idx) {
  const m = state.margin * S;
  let sw = W - 2 * m, sh = sw * photosRatio(idx);
  let sx = m, sy = m;
  if (state.aspect !== "auto") {
    const footerH = hasText() ? 150 * S : 40 * S;
    const avail = H - m - footerH;
    if (sh > avail) { sh = avail; sw = sh / photosRatio(idx); }
    sx = (W - sw) / 2;
    sy = m + (avail - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

/* 真高斯投影层: 独立画布 + blur(sigma), 三层渐次(近/中/远)。
   受 state.shadowOn/strength/angle/soft 驱动。每层 sigma 按四周可用空间封顶,
   保证不被画布边缘裁断(消除"黑边"), 高斯衰减使圆角边缘平滑。
   angle 约定: 90=投影正下方(光源在上), 0=右, 180=左, 270=上。
   Safari 无 ctx.filter 时降级 shadowBlur。 */
function drawShadow(ctx, W, H, shape, S, gaps) {
  if (!state.shadowOn || state.shadowStrength <= 0) return;
  const rad = state.shadowAngle * Math.PI / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const base = [
    [3 * S, 8 * S, 0.22],
    [10 * S, 22 * S, 0.15],
    [22 * S, 40 * S, 0.10],
  ];
  const sc = document.createElement("canvas");
  sc.width = W; sc.height = H;
  const g = sc.getContext("2d");
  const useFilter = "filter" in g;
  for (const [d, blBase, a0] of base) {
    const ox = dx * d, oy = dy * d;
    const a = a0 * state.shadowStrength;
    if (a < 0.004) continue;
    const availT = gaps.top + oy, availB = gaps.bot - oy;
    const availL = gaps.side + ox, availR = gaps.side - ox;
    const b = Math.max(2 * S, Math.min(blBase * state.shadowSoft, availT / 3, availB / 3, availL / 3, availR / 3));
    if (useFilter) {
      g.save();
      g.filter = `blur(${b}px)`;
      g.globalAlpha = a;
      g.fillStyle = "#000";
      rr(g, shape.x + ox, shape.y + oy, shape.w, shape.h, shape.r);
      g.fill();
      g.restore();
    } else {
      g.save();
      g.shadowColor = `rgba(0,0,0,${a})`;
      g.shadowOffsetX = ox;
      g.shadowOffsetY = oy;
      g.shadowBlur = b;
      g.fillStyle = "#000";
      rr(g, shape.x, shape.y, shape.w, shape.h, shape.r);
      g.fill();
      g.restore();
    }
  }
  ctx.drawImage(sc, 0, 0);
}

function renderBacking(ctx, W, S, idx) {
  const g = backingGeo(W, S, idx);
  const img = state.photos[idx].img;
  ctx.clearRect(0, 0, W, g.H);
  const outer = state.tpl === "backing" ? state.radius * S : state.radius * 0.73 * S;
  const shape = { x: 0, y: 0, w: W, h: g.H, r: outer };
  /* 1. 整卡外轮廓高斯投影 (圆角, 与背景层裁切一致) */
  drawShadow(ctx, W, g.H, shape, S,
    { top: g.gT - 2, side: g.gS - 2, bot: g.gB - 2 });
  /* 2. 面板(衬底) */
  ctx.fillStyle = state.backingColor;
  rr(ctx, g.gS, g.gT, W - 2 * g.gS, g.panelH, state.radius * 0.87 * S);
  ctx.fill();
  /* 3. 整卡圆角裁切 (导出 PNG 四角透明) */
  ctx.save();
  rr(ctx, 0, 0, W, g.H, outer);
  ctx.clip();
  /* 4. 内嵌照片 (圆角裁切) */
  ctx.save();
  rr(ctx, g.px, g.py, g.sw, g.sh, state.radius * 0.47 * S);
  ctx.clip();
  ctx.drawImage(img, g.px, g.py, g.sw, g.sh);
  ctx.restore();
  /* 5. 底部文字 (面板内) */
  if (hasText()) {
    const light = lum(state.backingColor) > 0.6;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const both = !!(el.t1.value.trim() && el.t2.value.trim());
    ctx.font = `700 ${Math.round(34 * S)}px Arial, "Helvetica Neue", sans-serif`;
    ctx.fillStyle = light ? "#1f1f1f" : "#ffffff";
    if (!light) { ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 6 * S; ctx.shadowOffsetY = 1 * S; }
    ctx.fillText(el.t1.value.trim() || el.t2.value.trim(), W / 2, both ? g.textCY - 14 * S : g.textCY);
    if (both) {
      ctx.font = `${Math.round(21 * S)}px Arial, "Helvetica Neue", sans-serif`;
      ctx.fillStyle = light ? "#5a5a5a" : "rgba(255,255,255,0.92)";
      ctx.fillText(el.t2.value, W / 2, g.textCY + 18 * S);
    }
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }
  ctx.restore(); /* 整卡圆角裁切 */
}

/* 仅预览: 虚线外框提示 — 标注当前卡片边界 (none=整卡轮廓, 其余=照片矩形)。
   只画在预览 canvas 上, 导出走默认路径, 不会出现在 PNG/ZIP 中。 */
function drawBoundaryHint(ctx, W, H, S, idx, g) {
  let x, y, w, h, r;
  if (state.tpl === "backing" && g) {
    // 衬底面板: 提示面板矩形
    x = g.gS; y = g.gT; w = W - 2 * g.gS; h = g.panelH; r = state.radius * 0.87 * S;
  } else if (state.tpl === "none") {
    x = 0; y = 0; w = W; h = H; r = state.radius * S;
  } else {
    ({ sx: x, sy: y, sw: w, sh: h } = photoRect(W, H, S, idx));
    r = state.radius * 0.73 * S;
  }
  ctx.save();
  ctx.strokeStyle = "#635bff";
  ctx.lineWidth = Math.max(1, 2 * S);
  ctx.setLineDash([7 * S, 5 * S]);
  rr(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

function renderCard(ctx, W, S, idx, preview) {
  const ph = state.photos[idx];
  if (!ph) return;
  if (state.tpl === "backing") {
    renderBacking(ctx, W, S, idx);
    if (preview) {
      const g = backingGeo(W, S, idx);
      drawBoundaryHint(ctx, W, g.H, S, idx, g);
    }
    return;
  }
  const H = cardH(W, S, idx);
  const { sx, sy, sw, sh } = photoRect(W, H, S, idx);
  const img = ph.img;

  /* 1. 背景层 (整卡圆角裁切: 导出 PNG 四角透明, 呈圆角卡片观感) */
  ctx.clearRect(0, 0, W, H);
  const outer = state.radius * S;
  if (state.tpl === "blur") {
    ctx.save();
    rr(ctx, 0, 0, W, H, outer);
    ctx.clip();
    ctx.filter = `blur(${Math.round(42 * S)}px) brightness(0.55) saturate(1.3)`;
    const cover = Math.max(W / img.width, H / img.height) * 1.06;
    const cw = img.width * cover, ch = img.height * cover;
    ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
    ctx.filter = "none";
    const vg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.72);
    vg.addColorStop(0.55, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (state.tpl === "solid") {
    ctx.save();
    rr(ctx, 0, 0, W, H, outer);
    ctx.clip();
    ctx.fillStyle = state.solidColor;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  // tpl === "none": 保持全透明

  /* 2. 高斯投影 (独立画布 blur, 按四周空隙封顶防裁断) */
  const r = state.radius * 0.73 * S;
  drawShadow(ctx, W, H,
    { x: sx, y: sy, w: sw, h: sh, r },
    S, { top: sy, side: sx, bot: H - (sy + sh) });

  /* 3. 照片 (圆角裁切) */
  ctx.save();
  rr(ctx, sx, sy, sw, sh, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh);
  ctx.restore();

  /* 4. 底部文字 */
  if (hasText()) {
    const footerH = hasText() ? 150 * S : 40 * S;
    if (state.tpl === "blur") {
      ctx.save();
      rr(ctx, 0, 0, W, H, outer);
      ctx.clip();
      const g = ctx.createLinearGradient(0, H - footerH, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = g;
      ctx.fillRect(0, H - footerH, W, footerH);
      ctx.restore();
    }
    const lightBg = state.tpl === "none" ||
      (state.tpl === "solid" && lum(state.solidColor) > 0.6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const both = !!(el.t1.value.trim() && el.t2.value.trim());
    const cy = H - footerH / 2;
    ctx.font = `700 ${Math.round(38 * S)}px Arial, "Helvetica Neue", sans-serif`;
    if (!lightBg) { ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowOffsetY = 2 * S; ctx.shadowBlur = 8 * S; }
    ctx.fillStyle = lightBg ? "#1f1f1f" : "#ffffff";
    ctx.fillText(el.t1.value.trim() || el.t2.value.trim(), W / 2, both ? cy - 16 * S : cy);
    if (both) {
      ctx.font = `${Math.round(23 * S)}px Arial, "Helvetica Neue", sans-serif`;
      ctx.fillStyle = lightBg ? "#5a5a5a" : "rgba(255,255,255,0.92)";
      ctx.fillText(el.t2.value, W / 2, cy + 20 * S);
    }
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }
  if (preview) drawBoundaryHint(ctx, W, H, S, idx);
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/* ================= 预览 & 导出 ================= */
function setPreviewEmpty() {
  const empty = state.photos.length === 0;
  document.getElementById("previewWrap").dataset.empty = empty ? "1" : "0";
}
function drawPreview() {
  const idx = state.active;
  if (!state.photos[idx]) return;
  setPreviewEmpty();
  const W = 600, S = W / CANVAS_REF_W;
  const c = el.preview;
  c.width = W;
  c.height = cardH(W, S, idx);
  renderCard(c.getContext("2d"), W, S, idx, true);
  const wrap = $("#previewWrap");
  wrap.dataset.bg = state.previewBg === "checker" ? "checker"
    : state.previewBg === "#ffffff" ? "white" : "dark";
}

function renderOffscreen(outW, idx) {
  const S = outW / CANVAS_REF_W;
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = cardH(outW, S, idx);
  renderCard(c.getContext("2d"), outW, S, idx);
  return c;
}

function downloadPng(idx) {
  const c = renderOffscreen(state.outW, idx);
  const a = document.createElement("a");
  a.download = `${state.photos[idx].name}_card.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}

/* ================= 保存到选定文件夹 (File System Access API) ================= */
/* 浏览器无法读取上传文件的绝对路径, 但用户选一次文件夹后即可直接写入。
   handle 存在内存中, 刷新页面后需重新选择 (浏览器安全限制, 无法持久化)。 */
const fsSupport = !!(window.showDirectoryPicker && window.isSecureContext);
let saveDirHandle = null; // FileSystemDirectoryHandle

async function pickSaveDir() {
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  saveDirHandle = dir;
  return dir;
}
async function saveToDir(blob, filename) {
  // 1) 已有文件夹 handle: 验证权限后直接写
  if (saveDirHandle) {
    let perm = await saveDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      perm = await saveDirHandle.requestPermission({ mode: "readwrite" });
    }
    if (perm === "granted") {
      const fh = await saveDirHandle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return saveDirHandle.name;
    }
  }
  // 2) 无 handle 或权限被拒: 弹出文件夹选择 (仅 Chrome/Edge 等支持)
  if (fsSupport) {
    const dir = await pickSaveDir();
    const fh = await dir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return dir.name;
  }
  // 3) 不支持 API: 回退下载
  return null;
}

/* ================= 安卓原生保存 (Capacitor) ================= */
const isNative = !!(window.Capacitor && Capacitor.isNativePlatform());
function nativePlugins() {
  return { fs: Capacitor.Plugins.Filesystem, share: Capacitor.Plugins.Share };
}
function blobToB64(blob) {
  // 整段一次 btoa：分块单独 btoa 拼接会在块边界多塞 padding，native 解码会截断。
  // 分块只用于避免单次 String.fromCharCode 栈溢出。
  return blob.arrayBuffer().then(buf => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    return btoa(bin);
  });
}
async function nativeSave(blob, filename) {
  const { fs, share } = nativePlugins();
  // 写共享 DOCUMENTS 前申请运行时权限（manifest 已声明 READ/WRITE_EXTERNAL_STORAGE）
  try {
    const perm = await fs.requestPermissions();
    if (perm.publicStorage === "denied") {
      const p = await fs.requestPermissions();
      if (p.publicStorage === "denied") {
        const err = new Error("存储权限被拒绝，无法保存到共享目录");
        err.diag = { stage: "permission" };
        throw err;
      }
    }
  } catch (e) {
    if (e && e.diag) throw e;
    // requestPermissions 不可用时（旧版本）继续尝试写盘
  }
  const dir = "DOCUMENTS", path = `CardKit/${filename}`, expected = blob.size;
  const b64 = await blobToB64(blob);
  const diag = { expected, got: -1, ok: false, attempts: 0, stage: "write", uri: null };
  nativeSave.lastDiag = diag;
  for (let attempt = 1; attempt <= 3; attempt++) {
    diag.attempts = attempt; diag.stage = "write";
    // encoding 省略 → IONFilesystemLib 默认二进制模式，把 base64 data 解码后写盘
    await fs.writeFile({ path, data: b64, directory: dir, recursive: true });
    diag.stage = "readback";
    const meta = await fs.stat({ path, directory: dir });
    diag.got = meta.size;
    // 校验：文件存在 + 非空即可
    if (meta.size > 0) { diag.ok = true; break; }
  }
  if (!diag.ok) { const err = new Error(`保存校验失败@${diag.stage}: 文件不存在或为空 (尝试${diag.attempts}次)`); err.diag = diag; throw err; }
  diag.stage = "copy";
  const ur = await fs.getUri({ path, directory: dir });
  diag.uri = ur.uri;
  if (!diag.uri || !diag.uri.startsWith("file://")) {
    const err = new Error(`getUri 返回无效 URI: ${diag.uri}`); err.diag = diag; throw err;
  }
  diag.stage = "share";
  try { await share.share({ title: filename, files: [diag.uri] }); } catch (e) {}
  diag.stage = "done";
  return diag.uri;
}

async function exportZip() {
  if (!state.photos.length) return;
  const zip = new JSZip();
  const usePerExif = $("#batchExif").checked;
  const saved = [el.t1.value, el.t2.value];
  for (let i = 0; i < state.photos.length; i++) {
    const ph = state.photos[i];
    const t1v = usePerExif ? (ph.textOverride?.t1 ?? ph.exif?.t1 ?? "") : el.t1.value;
    const t2v = usePerExif ? (ph.textOverride?.t2 ?? ph.exif?.t2 ?? "") : el.t2.value;
    el.t1.value = t1v; el.t2.value = t2v;
    el.status.textContent = `导出 ${i + 1}/${state.photos.length}: ${ph.name}`;
    await new Promise(r => setTimeout(r, 30));
    const c = renderOffscreen(state.outW, i);
    const buf = await new Promise(r => c.toBlob(r, "image/png"));
    zip.file(`${ph.name}_card.png`, buf);
  }
  [el.t1, el.t2].forEach((e, j) => (e.value = saved[j]));
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.download = "cardkit_export.zip";
  a.href = URL.createObjectURL(blob);
  a.click();
  el.status.textContent = `ZIP 已导出 ${state.photos.length} 张`;
}

/* ================= 事件绑定 ================= */
/* "📁 保存到文件夹"按钮: 浏览器支持 File System Access API 时显示 */
const saveDirBtn = document.getElementById("saveDirBtn");
if (saveDirBtn && fsSupport) {
  saveDirBtn.hidden = false;
  const refreshDirLabel = () => {
    saveDirBtn.textContent = saveDirHandle ? `📁 ${saveDirHandle.name}` : "📁 保存到文件夹";
  };
  refreshDirLabel();
  saveDirBtn.onclick = async () => {
    try {
      const dir = await pickSaveDir();
      refreshDirLabel();
      el.status.className = "ok";
      el.status.textContent = `✓ 已选定「${dir.name}」文件夹，导出将写入该目录`;
    } catch (e) {
      if (e && e.name !== "AbortError") {
        el.status.className = "err";
        el.status.textContent = "选择文件夹失败：" + e.message;
      }
    }
  };
}
$("#pickBtn").onclick = () => el.file.click();
$("#clearAll").onclick = clearAll;
el.file.onchange = () => { loadFiles([...el.file.files]); el.file.value = ""; };
el.dropzone.ondragover = (e) => { e.preventDefault(); el.dropzone.classList.add("dragover"); };
el.dropzone.ondragleave = () => el.dropzone.classList.remove("dragover");
el.dropzone.ondrop = (e) => {
  e.preventDefault(); el.dropzone.classList.remove("dragover");
  loadFiles([...e.dataTransfer.files]);
};
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if ([...e.dataTransfer.files].length && e.target.closest("#left")) loadFiles([...e.dataTransfer.files]);
});

document.querySelectorAll('input[name="tpl"]').forEach(r =>
  r.onchange = (e) => {
    state.tpl = e.target.value;
    el.solidRow.hidden = state.tpl !== "solid";
    el.backingRow.hidden = state.tpl !== "backing";
    el.marginRow.hidden = state.tpl === "backing"; // 衬底面板用"照片留白"控制等宽边框
    applyTplDefaults(); // 切模板时套该模板专属默认 (仅当用户没手动调过)
    drawPreview();
  });
$("#solidColor").oninput = (e) => { state.solidColor = e.target.value; drawPreview(); };
$("#backingColor").oninput = (e) => { state.backingColor = e.target.value; drawPreview(); };
$("#inset").oninput = (e) => { state.inset = +e.target.value; $("#insetVal").textContent = e.target.value + "px"; drawPreview(); };
$("#margin").oninput = (e) => { state.margin = +e.target.value; userTouchedMargin = true; $("#marginVal").textContent = e.target.value + "px"; drawPreview(); };
$("#radius").oninput = (e) => { state.radius = +e.target.value; userTouchedRadius = true; $("#radiusVal").textContent = e.target.value + "px"; drawPreview(); };
/* 切到各模板时, 若用户尚未手动调过边距/圆角, 套用该模板专属默认 (透明悬浮=26/50, 其余=80/30) */
function applyTplDefaults() {
  const isNone = state.tpl === "none";
  if (!userTouchedMargin) {
    state.margin = isNone ? NONE_DEFAULTS.margin : 80;
    const m = $("#margin"); m.value = state.margin; $("#marginVal").textContent = state.margin + "px";
  }
  if (!userTouchedRadius) {
    state.radius = isNone ? NONE_DEFAULTS.radius : 30;
    const r = $("#radius"); r.value = state.radius; $("#radiusVal").textContent = state.radius + "px";
  }
}
document.querySelectorAll('input[name="asp"]').forEach(r =>
  r.onchange = (e) => { state.aspect = e.target.value; drawPreview(); });
document.querySelectorAll('input[name="wid"]').forEach(r =>
  r.onchange = (e) => { state.outW = +e.target.value; });
document.querySelectorAll('input[name="pvb"]').forEach(r =>
  r.onchange = (e) => { state.previewBg = e.target.value; drawPreview(); });
el.t1.oninput = drawPreview;
el.t2.oninput = drawPreview;

/* ---------- 主题切换 (亮/暗, 记忆选择) ---------- */
(function () {
  const btn = $("#themeToggle");
  const root = document.documentElement;
  function label() {
    const dark = root.dataset.theme === "dark";
    btn.innerHTML = `<span class="ic">${dark ? "☀" : "☾"}</span>${dark ? "亮色" : "暗色"}`;
  }
  label();
  btn.onclick = () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("cardkit-theme", root.dataset.theme);
    label();
    drawPreview();
  };
  /* 系统主题变化时, 若用户未手动选择则跟随 */
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("cardkit-theme")) {
      root.dataset.theme = e.matches ? "dark" : "light";
      label();
    }
  });
})();

$("#shadowOn").onchange = (e) => { state.shadowOn = e.target.checked; drawPreview(); };
$("#shadowStrength").oninput = (e) => { state.shadowStrength = +e.target.value / 100; $("#strengthVal").textContent = e.target.value + "%"; drawPreview(); };
$("#shadowAngle").oninput = (e) => {
  state.shadowAngle = +e.target.value;
  $("#angleVal").textContent = e.target.value + "°";
  drawPreview();
};
$("#shadowSoft").oninput = (e) => { state.shadowSoft = +e.target.value / 100; $("#softVal").textContent = e.target.value + "%"; drawPreview(); };

$("#exifFill").onclick = () => {
  const ph = state.photos[state.active];
  if (!ph) return;
  el.t1.value = ph?.exif?.t1 || "";
  el.t2.value = ph?.exif?.t2 || "";
  // 记到该图的 textOverride, 让 ZIP 批量导出"按各图 EXIF"时能取到; 被"清空所有图片文字"移除
  ph.textOverride = { t1: el.t1.value, t2: el.t2.value };
  el.exifState.textContent = ph?.exif?.t1 || ph?.exif?.t2 ? "✓ 已填入 EXIF" : "该照片无 EXIF";
  drawPreview();
};
$("#clearText").onclick = () => { el.t1.value = ""; el.t2.value = ""; el.exifState.textContent = ""; drawPreview(); };
/* 清空所有图片文字: 把当前手填框清空, 并移除所有照片已缓存的文字覆盖, 让每张图回退到各自的 EXIF/无文字 */
$("#clearAllText").onclick = () => {
  state.photos.forEach(ph => { delete ph.textOverride; });
  el.t1.value = ""; el.t2.value = ""; el.exifState.textContent = "";
  el.status.className = "ok";
  el.status.textContent = "✓ 已清空所有图片文字";
  drawPreview();
};
$("#export").onclick = async () => {
  if (!state.photos.length) return (el.status.textContent = "先导入照片");
  if (isNative) {
    el.status.textContent = "正在导出…";
    const c = renderOffscreen(state.outW, state.active);
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    try {
      const uri = await nativeSave(blob, `${state.photos[state.active].name}_card.png`);
      el.status.className = "ok";
      el.status.textContent = "✓ 已保存到 文件/CardKit";
    } catch (e) {
      el.status.className = "err";
      el.status.textContent = "保存失败：" + (e.message || "未知错误");
    }
    return;
  }
  const c = renderOffscreen(state.outW, state.active);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  const name = `${state.photos[state.active].name}_card.png`;
  try {
    const dir = await saveToDir(blob, name);
    if (dir) {
      el.status.className = "ok";
      el.status.textContent = `✓ 已保存到 ${dir} 文件夹`;
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // 用户取消选择
  }
  downloadPng(state.active);
  el.status.className = "ok";
  el.status.textContent = "✓ PNG 已导出" + (fsSupport ? "（点「📁 保存到文件夹」可写入指定目录）" : "");
};
$("#exportZip").onclick = async () => {
  if (!state.photos.length) return (el.status.textContent = "先导入照片");
  // 构建 ZIP (web / 原生通用)
  const zip = new JSZip();
  const usePerExif = $("#batchExif").checked;
  const saved = [el.t1.value, el.t2.value];
  for (let i = 0; i < state.photos.length; i++) {
    const ph = state.photos[i];
    const t1v = usePerExif ? (ph.textOverride?.t1 ?? ph.exif?.t1 ?? "") : el.t1.value;
    const t2v = usePerExif ? (ph.textOverride?.t2 ?? ph.exif?.t2 ?? "") : el.t2.value;
    el.t1.value = t1v; el.t2.value = t2v;
    el.status.textContent = `导出 ${i + 1}/${state.photos.length}: ${ph.name}`;
    await new Promise(r => setTimeout(r, 30));
    const c = renderOffscreen(state.outW, i);
    const buf = await new Promise(r => c.toBlob(r, "image/png"));
    zip.file(`${ph.name}_card.png`, buf);
  }
  [el.t1, el.t2].forEach((e, j) => (e.value = saved[j]));
  const blob = await zip.generateAsync({ type: "blob" });
  if (isNative) {
    try {
      const uri = await nativeSave(blob, "cardkit_export.zip");
      el.status.className = "ok";
      el.status.textContent = "✓ ZIP 已保存到 文件/CardKit";
    } catch (e) {
      el.status.className = "err";
      el.status.textContent = "ZIP 保存失败：" + (e.message || "未知错误");
    }
    return;
  }
  try {
    const dir = await saveToDir(blob, "cardkit_export.zip");
    if (dir) {
      el.status.className = "ok";
      el.status.textContent = `✓ ZIP 已保存到 ${dir} 文件夹`;
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // 用户取消选择
  }
  exportZip();
  el.status.className = "ok";
  el.status.textContent = "✓ ZIP 已导出" + (fsSupport ? "（点「📁 保存到文件夹」可写入指定目录）" : "");
};
