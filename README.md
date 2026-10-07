# LG-TVbox

运行在 LG webOS 电视上的 TVBox 风格影视客户端：输入 TVBox 订阅地址后即可浏览分类、聚合搜索、选集播放。
内置 drpy2 爬虫引擎，JS 爬虫源无需额外服务器即可在电视上运行。

> A TVBox-style video client for LG webOS TVs. Add a TVBox subscription URL to browse, search and play.
> CMS (type 0/1), T4 (type 4) and drpy2 JS spider (type 3) sites are supported; drpy2 spiders run in a
> built-in engine inside the app's webOS JS service, so no external server is needed.

**免责声明**：本项目只是一个播放器，不内置、不提供任何影视内容或订阅源。请自行选择合法合规的订阅源，
因使用第三方订阅源产生的一切问题由使用者自行承担。

## 功能

- **订阅源**：标准 TVBox JSON 配置（兼容注释/尾逗号、Base64、"图片**Base64" 伪装、多仓 `urls`/`storeHouse`），可添加多个订阅并切换
- **站点**：支持 `type 0`（XML CMS）、`type 1`（JSON CMS，如苹果CMS）、`type 4`（远程接口），以及 `type 3` 中的 **drpy2 JS 爬虫**（电视内置引擎运行）
- **浏览**：分类列表、自动翻页；**聚合搜索**：并发搜索订阅中所有可搜索站点，结果边搜边显示
- **播放**：多线路/选集、断点续播、自动下一集、`parses` 中 type 1（JSON）解析接口
- **遥控器**：方向键空间导航，支持 Magic Remote 指针、媒体键（播放/暂停/快进/快退）

> `csp_` 开头的 Java 爬虫（jar 包是 Android 字节码）无法在电视上运行，会被跳过。

## 目录

```
app/                 webOS 网页应用（打包内容）
  appinfo.json
  index.html  css/  js/
    http.js          网络请求（XHR → 失败时回退到 JS 服务）
    config.js        订阅解析
    source.js        站点接口适配 / 播放地址解析
    nav.js           遥控器焦点导航
    views/           各页面
services/            webOS JS 服务：请求代理 + 内置爬虫引擎（engine/worker 文件由构建生成）
service-src/         内置爬虫引擎源码
  engine.js          引擎入口：爬虫线程池
  spider-worker.js   爬虫线程：每个站点一个 vm 沙箱
  fetch-worker.js    请求线程：配合 Atomics.wait 实现 drpy 需要的同步请求
  lib/runtime.js     drpy2 运行时：ES 模块改写、宿主函数 req/local/joinUrl
  lib/htmlparser.js  pdfh/pdfa/pd（jsoup 规则语法）
  lib/jinja.js       cheerio.jinja2 模板
  vendor/            drpy2.min.js、模板.js、gbk.js 内置副本（引擎的远程依赖失效时使用）
dev-server.js        电脑调试服务器（静态文件 + /proxy + /spider）
scripts/             测试脚本：订阅解析、网页解析、真实订阅冒烟测试
```

## 电脑上调试

```bash
npm install
npm run dev          # 打开 http://127.0.0.1:8080
npm test             # 订阅解析 / 网页解析 / 模板测试
npm run smoke -- <订阅地址> [站点数] [搜索词]   # 用真实订阅测试 drpy 站点
```

键盘：方向键导航，Enter 确认，Esc / Backspace 返回。

## 安装到电视

### 方式一：webOS Dev Manager（推荐，图形界面）

1. 电视上从 LG Content Store 安装 **Developer Mode** 应用，登录 [LG 开发者账号](https://webostv.developer.lge.com)，打开 Dev Mode Status 和 Key Server
2. 电脑上安装 [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop)，按提示添加电视（填写 IP 和 Passphrase）
3. 构建安装包 `npm install && npm run package`（或从 Releases 下载 `.ipk`），在 Dev Manager 中点 **Install** 选择 `dist/com.lgwebos.tvbox_1.0.0_all.ipk`

### 方式二：命令行

1. 电视上从 LG Content Store 安装 **Developer Mode** 应用，登录 LG 开发者账号，打开 Dev Mode 和 Key Server
2. 添加设备（按提示填写电视 IP 和 Passphrase）：
   ```bash
   npx ares-setup-device        # 添加名为 tv 的设备
   npx ares-novacom --device tv --getkey
   ```
3. 打包、安装、启动：
   ```bash
   npm run deploy               # = package + install-tv + launch
   ```
4. 远程调试：`npm run inspect`

> 开发者模式每 50 小时需要在 Developer Mode 应用里续期一次。已 root 的电视也可以通过 Homebrew Channel 安装 `dist/*.ipk`。

## 使用

1. 首次打开 → 设置 → 输入订阅地址（按确认键调出软键盘）→ 添加订阅
2. 首页右上角可切换站点；左侧分类焦点停留会自动加载
3. 播放时：OK 暂停、←/→ 快退快进（长按加速）、↑/↓ 打开选集/线路面板、返回键退出

## 内置爬虫引擎（drpy2）

订阅中 `api` 指向 `drpy2.min.js` 的 type 3 站点由电视上的 JS 服务直接运行，无需服务器：

- 需要 **webOS TV 22 及以上**（服务端 Node 12+，2026 款为 Node 20）；旧电视上这些站点会提示不支持
- 引擎在 Node 中以 vm 沙箱运行 drpy2，模拟安卓 TVBox 提供的 `req`、`pdfh/pdfa/pd`、`local`、`cheerio`、`CryptoJS` 等
- 规则返回"需要解析"时，会先从播放页提取视频地址，再尝试订阅里的 JSON 解析接口
- 不支持：需要网页嗅探的线路、官方平台（爱奇艺/腾讯等）地址、需要特殊请求头才能播放的视频
- 很多公开规则对应的网站已失效或加了人机验证，这类站点会加载失败，属于规则本身的问题

## 使用 Python/PHP 爬虫源（drpy-node，可选）

drpy2 以外的爬虫（Python、PHP 等）可以在局域网里一台常开的设备（电脑 / NAS / 软路由，Docker 亦可）上运行
[drpy-node](https://github.com/woshishiq1/drpys)。它在服务端执行 drpy(JS) / hipy(Python) / PHP / catvod 等爬虫源，
并以 T4（type 4）接口对外提供，本应用直接支持。

1. 按 drpy-node 文档部署（需 Node.js 18–22），默认端口 5757，记下访问密码 `pwd`
2. 电视上：设置 → 爬虫服务器 → 填写 `http://电脑IP:5757` 和密码 → 添加
3. 应用会加载 `http://电脑IP:5757/config/1?healthy=1&pwd=…` 作为订阅源，其中的 T4 站点即可浏览、搜索、播放

不能支持的：`csp_` 开头的 **Java 爬虫**（jar 包是 Android dex 字节码，只能在安卓设备上运行）。

## 说明

- 网络：电视上先直接请求，若被 CORS 拦截会自动改走随包安装的 JS 服务（设置页可重置）
- 播放依赖电视自带解码器（m3u8/mp4 均可）；需要特定 Referer/UA 的视频地址可能无法播放
- 应用只是播放器，不提供任何内容，请自行选择合法的订阅源
- 输入长订阅地址时，可用手机 **LG ThinQ** App 的遥控器键盘直接粘贴

## 许可证

本项目代码使用 [MIT](LICENSE) 许可证。`service-src/vendor/` 下的第三方文件使用其各自的许可证（LGPL-3.0），
详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
