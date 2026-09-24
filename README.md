# CardKit · 照片 EXIF 卡片生成器

把照片做成带相机参数的「摄影卡片」——自动读取 EXIF，套上衬底、圆角、投影，导出干净的 PNG。

**纯前端、纯本地处理，照片不上传。**

![示例](docs/demo.webp)

## 特性

- **自动读 EXIF**：机型、焦距、光圈、快门、ISO，一键填入；数值格式兼容分数/数组/对象/字符串
- **4 种卡片模板**：模糊衬底 / 纯色衬底 / 衬底面板 / 透明悬浮
- **真高斯投影**：三层模糊投影，角度、强度、柔化可调，按四周空隙自动封顶防裁断
- **比例与尺寸可控**：自适应 / 4:3 / 1:1 / 3:4，1200 / 2400px（2x）
- **批量处理**：多选导入，可「按各图 EXIF」批量导出 ZIP
- **HEIC / HEIF** 自动转码
- **亮 / 暗双主题**，记忆用户选择
- **保存到指定文件夹**（Chromium 系浏览器）

## 在线使用

已部署在 GitHub Pages，打开即用：

**https://Abner-er.github.io/cardkit-web/**

也可以下载本仓库，直接双击 `index.html`。

## 本地运行

无需构建、无需安装依赖。

```bash
# 方式一：直接打开
start index.html

# 方式二：起个静态服务（推荐）
# 保存到文件夹 / HEIC 等能力依赖 secure context，localhost 算安全上下文
python -m http.server 8080
# 然后打开 http://localhost:8080
```

## 浏览器支持

| 能力 | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| 生成与导出 PNG/ZIP | ✅ | ✅ | ✅ |
| 保存到文件夹 | ✅（需 HTTPS 或 localhost） | ❌ 回退为下载 | ❌ 回退为下载 |
| HEIC 解码 | ✅ | ✅ | ✅ |

> 「保存到文件夹」依赖 File System Access API，目前仅 Chromium 系支持；其他浏览器会自动回退为「下载」。

## 项目结构

```
index.html          界面与布局
app.js              全部逻辑：导入 / EXIF / Canvas 渲染 / 导出 / 保存
style.css           亮暗双主题样式
manifest.json       PWA 清单
lib/                本地化的第三方库（无 CDN 依赖）
  exifr.min.js      EXIF 解析
  jszip.min.js      ZIP 打包
  heic2any.min.js   HEIC 解码
_test_clearall.js   清除逻辑的回归测试（Node 桩件）
testdata/           测试照片
docs/               文档配图
```

## 测试

```bash
node _test_clearall.js
```

## 关于 Android / iOS 原生版

`app.js` 中保留了 Capacitor 的原生保存分支：写入「文件/CardKit」目录并调起系统分享。若要用 Capacitor 打包成 App，需在 Capacitor 工程中补上原生运行时（`capacitor.js`），纯网页部署不包含该文件。

## License

[MIT](LICENSE)
