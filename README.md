# rebook-web

基于 `rebook` demo 完整能力构建的 React 19 Web 阅读器。

## 技术栈

- React 19
- TypeScript 7.0.2
- Tailwind CSS 4
- Vite 6
- rebook 本地依赖

页面布局、工具栏、面板、表单、AI Chat composer 和扩展市场界面均使用
Tailwind utilities。`src/index.css` 仅保留 Tailwind 入口、主题变量，以及
rebook/Markdown 动态生成节点所需的选择器样式。

## 功能

- EPUB、MOBI/AZW3、FB2、CBZ、PDF 阅读
- 目录、全文搜索、阅读主题、分页/滚动布局
- AI Chat、图片附件、书籍引用和 Story Memory 工具
- 普通 AI 翻译与 rebook-service 专业翻译
- TTS 和调试能力
- 内置扩展安装/启用与远程扩展市场目录
- 桌面三栏布局和移动端抽屉交互

## 开发

```bash
npm install
npm run dev
```

默认开发地址为 `http://127.0.0.1:3132/`。

也可以通过 `book` 查询参数加载可访问的电子书 URL：

```text
http://127.0.0.1:3132/?book=/path/to/book.epub
```

AI Chat、翻译和 Story Memory 的 API、模型与服务地址在设置面板中配置。

## 校验

```bash
npm run typecheck
npm run build
```

## 发布

项目与 `mishu-pc` 一样采用本机构建后同步静态目录的方式，不通过
`docker-compose` 发布：

```bash
npm run deploy
```

默认发布到 `/home/data/www/read.rethinkos.com`，对应站点
`https://read.rethinkos.com/`。可通过环境变量覆盖目录或 npm registry：

```bash
PUBLISH_DIR=/path/to/site NPM_CONFIG_REGISTRY=https://registry.npmjs.org npm run deploy
```

专业翻译、Story Memory 和上传功能默认使用
`https://read.rethinkos.com/api`。部署时可通过 Vite 构建变量覆盖：

```bash
VITE_REBOOK_SERVICE_URL=https://your-rebook-service.example.com npm run deploy
```

`rebook-service` 已经使用 `/api` 路由前缀，不需要修改后端。前端同时兼容
`https://example.com` 和 `https://example.com/api` 两种配置形式。

入口 Nginx 需要为 `read.rethinkos.com` 单独配置站点：

- `/api/` 原样代理到 `rebook-service` 的 `100.109.172.125:8083`
- 其余请求代理到静态站点 `100.109.172.125:1080/www/$host$request_uri`
- 复用已包含 `read.rethinkos.com` SAN 的 `rethinkos.com` HTTPS 证书

可参考 [deploy/nginx/read.rethinkos.com.conf](deploy/nginx/read.rethinkos.com.conf)。
