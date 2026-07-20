<h1 align="center">rebook-web</h1>

<p align="center">
  一款高性能、AI 原生、本地优先的 Web 电子书阅读器，基于
  <a href="https://github.com/L-Chris/rebook">rebook</a> 构建。
</p>

<p align="center">
  <strong>⚡ 高性能 · 🤖 AI 阅读 · 🌐 智能翻译 · ☁️ 云端同步</strong>
</p>

<p align="center">
  无需安装，打开浏览器即可建立自己的数字书架；既可以完全离线阅读，
  也可以按需连接 AI 和 WebDAV。
</p>

<p align="center">
  <a href="https://read.rethinkos.com/"><strong>在线体验</strong></a>
  ·
  <a href="https://github.com/L-Chris/rebook/issues">反馈问题</a>
</p>

<p align="center">
  <a href="https://linux.do" aria-label="LINUX DO">
    <img src="https://img.shields.io/badge/LINUX-DO-FFB003.svg" alt="LINUX DO">
  </a>
</p>

## ✨ 特性

1. **⚡ 高性能阅读体验**
   - 基于独立的 [rebook](https://github.com/L-Chris/rebook) 阅读内核
   - 针对翻页、重排、缩放和浏览器窗口变化持续优化
   - 支持分页、滚动、单页和双页等阅读布局

2. **🤖 深度 AI 阅读**
   - 提供 `/summary`、`/search`、`/rewrite`、`/extract` 等快捷命令
   - 可以引用当前章节或指定书籍内容，并附加图片一起提问
   - AI 回答支持可点击的原文引用，可直接定位到对应段落

3. **🌐 双模式智能翻译**
   - 支持浏览器内置翻译，浏览器支持时无需配置 API
   - 支持自定义 AI 翻译服务
   - 可选择双语对照或替换原文，并支持翻译目录

4. **☁️ 可选的云端书架**
   - 不登录也能导入和阅读，书籍默认保存在当前浏览器
   - 登录后可连接坚果云、Nextcloud 等 WebDAV 服务
   - 自动同步本地书籍，在不同设备间继续阅读

5. **📚 完整的阅读工具**
   - 本地书架、书籍搜索、目录导航、全文搜索和断点续读
   - 自定义字体、字号、主题和页面布局
   - 支持文字朗读、阅读进度记录与多种封面提取方式

6. **🧩 可扩展、跨设备**
   - 内置扩展商店，可按需启用翻译、AI 对话和朗读能力
   - 桌面端三栏布局与移动端抽屉交互
   - 支持 Light / Dark 主题和简体中文 / English 界面

## 📖 支持格式

| 格式 | 支持情况 |
| --- | --- |
| EPUB | 支持 |
| MOBI / AZW3 | 支持 |
| FB2 | 支持 |
| PDF | 支持 |
| CBZ | 支持 |

## 🚀 本地运行

需要 Node.js 和 npm：

```bash
npm install
npm run dev
```

默认开发地址为 `http://127.0.0.1:3132/`。

## 🛠️ 构建

```bash
npm run build
```

## 🔗 相关项目

- [rebook](https://github.com/L-Chris/rebook)：跨平台电子书解析与阅读内核
- [rebook-service](https://github.com/L-Chris/rebook-service)：账号、云端书架与可选 AI 服务
