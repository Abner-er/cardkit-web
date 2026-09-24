/* Node 桩测试: 加载真实 app.js, 验证 clearAll 链路 */
const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");

const made = [];
function stubEl(id) {
  made.push(id);
  return {
    id, value: "", textContent: "", className: "", hidden: false, innerHTML: "",
    onclick: null, oninput: null, onchange: null, ondragover: null, ondragleave: null, ondrop: null,
    style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild() {}, addEventListener() {},
    getContext: () => new Proxy({}, { get: (t, p) => {
      if (p === "measureText") return () => ({ width: 0 });
      if (p === "filter" || p === "font" || p === "fillStyle" || p === "strokeStyle" || p === "textAlign") return "";
      if (p === "globalAlpha" || p === "shadowBlur" || p === "lineWidth") return 1;
      if (typeof p === "string" && p.startsWith("create")) return () => new Proxy({}, { get: () => () => null });
      if (typeof p === "string" && p !== "then") return () => {}; // 任何方法调用 (clearRect/drawImage/...)
      return undefined;
    }, set: () => true }),
    width: 600, height: 400,
  };
}

const named = {};
function Q(sel) {
  const key = sel.replace(/^#/, "");
  if (!named[key]) named[key] = stubEl(key);
  return named[key];
}
// 预建常用元素
["t1","t2","exifState","status","preview","thumbs","dropzone","solidRow","backingRow","marginRow","radiusRow","file","pickBtn","clearAll","export","exportZip","saveDirBtn","themeToggle","insetVal","marginVal","radiusVal","strengthVal","angleVal","softVal","inset","margin","radius","solidColor","backingColor","shadowOn","shadowStrength","shadowAngle","shadowSoft","exifFill","clearText","dropzone"].forEach(k => named[k] = stubEl(k));

global.document = {
  querySelector: (s) => Q(s),
  getElementById: (id) => { if (!named[id]) named[id] = stubEl(id); return named[id]; },
  querySelectorAll: () => { const a = []; a.forEach = Array.prototype.forEach; return a; },
  createElement: (t) => stubEl("dyn:" + t),
  addEventListener() {},
  documentElement: { dataset: {} },
};
global.window = {
  addEventListener() {},
  showDirectoryPicker: null,
  isSecureContext: true,
  location: { href: "http://localhost:8123/" },
};
global.matchMedia = () => ({ matches: false, addEventListener() {} });
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.Image = class { set src(v) {} };
global.createImageBitmap = async () => ({ close() {}, width: 100, height: 100, convertToBlob: async () => new Blob() });
global.Blob = class { constructor(p, o) { this.size = (p && p[0] && p[0].length) || 0; this.type = o && o.type || ""; } };
global.self = global;
global.navigator = { userAgent: "node", language: "zh-CN" };
global.requestAnimationFrame = () => 0;

// ========== 验证 (eval 内执行, 可访问 const state/renderThumbs) ==========
const checks = `
const clr = document.getElementById("clearAll");
clr.hidden = true; // 模拟 index.html hidden 属性
console.log("== 初始(无照片) ==");
console.log("hidden =", clr.hidden, "| text =", JSON.stringify(clr.textContent));
if (clr.hidden !== true) throw new Error("初始应 hidden=true");

state.photos.push({ name: "a.jpg", thumb: "", exif: null, img: {} }, { name: "b.jpg", thumb: "", exif: null, img: {} });
state.active = 0;
renderThumbs();
console.log("== 2张照片后 ==");
console.log("hidden =", clr.hidden, "| text =", JSON.stringify(clr.textContent));
if (clr.hidden !== false || clr.textContent !== "🗑 清除全部（2）") throw new Error("两照片时按钮文案/可见性不对");

clr.onclick();
console.log("== 点击 clearAll 后 ==");
console.log("photos =", state.photos.length, "| active =", state.active, "| hidden =", clr.hidden, "| text =", JSON.stringify(clr.textContent), "| t1 =", JSON.stringify(document.getElementById("t1").value));
if (state.photos.length !== 0 || state.active !== 0 || clr.hidden !== true || document.getElementById("t1").value !== "") throw new Error("clearAll 未清空状态");

state.photos.push({ name: "c.jpg", thumb: "", exif: null, img: {} });
renderThumbs();
console.log("== 1张照片 ==");
console.log("hidden =", clr.hidden, "| text =", JSON.stringify(clr.textContent));
if (clr.textContent !== "🗑 清除全部") throw new Error("单张照片文案应无计数");
clr.onclick();
if (state.photos.length !== 0) throw new Error("单张场景未清空");

console.log("ALL PASS ✔");
`;
eval(src + "\n" + checks);
