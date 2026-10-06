# 五子棋项目交接手册：从零启动

更新日期：2026-10-06
项目目录：D:\小游戏\五子棋
本手册替代旧版按日期堆叠的长交接日志。历史记录与当前代码不一致时，以当前代码、测试和重新核验的线上状态为准。

## 接手时先做

1. 确认工作区是五子棋项目，不要误改同级的 D:\小游戏\大富翁。
2. 在项目根目录运行 git status --short --branch、git log -1 --oneline；保留已有的 .codex-diagnostics/，不要运行 git clean，也不要使用 git add .。
3. 阅读本手册、README.md、README.en.md 和本轮相关源文件。开始操作前重新检查设备、版本、分支和线上状态；下面记录的设备与部署状态会过期。
4. 不读取、复制、输出或提交真实密钥、用户密码、聊天内容、账号数据。生产数据库只在用户明确要求并确认查询范围时读取。
5. 用户偏好：中文优先，英文 README 也要维护；UI 沿用“晴空浮岛、草坪棋盘”风格；功能修复完成后会期待相关网页、单文件和 Android 产物同步。只提交本任务涉及的明确文件。

## 项目概况

中文优先的五子棋游戏，提供本地人机对弈、残局远征、好友/在线对局、账号与社交，以及官网、Android APK 和离线单文件版。网页在线功能调用 Cloudflare API；本地 Node 服务只托管静态文件，不会启动本地账号或 D1 后端。

- 源码仓库：https://github.com/xnnb04664-afk/gomoku
- 官网：https://gomoku-home.pages.dev/
- 官网游戏页：https://gomoku-home.pages.dev/play/
- API Pages：https://gomoku-api.pages.dev/
- Worker：gomoku-backend；D1：gomoku-db
- README 说明目前没有 LICENSE 文件；不要仅凭仓库可访问就假定可以复用代码或资源。

## 从空环境运行网页

安装 Git、Node.js 和 npm 后，在 PowerShell 中：

~~~powershell
git clone https://github.com/xnnb04664-afk/gomoku.git
Set-Location gomoku
npm ci
node server.js
~~~

打开 http://localhost:3000。服务默认只监听 127.0.0.1；端口可用 GOMOKU_PORT 指定。也可以运行根目录的 启动游戏服务.bat，它会打开浏览器并启动服务。

纯离线单文件版是 五子棋大师_单文件版.html，可直接在浏览器打开；不需要 Node 服务或网络资源。

## 代码地图

| 路径 | 用途 |
| --- | --- |
| index.html、js/、img/ | 网页游戏源代码与静态资源；改动首先落在这里 |
| backend/worker.js | Cloudflare API、账号/社交/聊天、房间路由及 Durable Object 实现 |
| migrations/ | D1 SQL 迁移；Worker 也有幂等建表逻辑，改表前需检查两处 |
| android_src/ | Android WebView 容器、Java 源码、Manifest 和资源镜像 |
| build_apk.js | 同步 Android 资源、构建并使用正式签名密钥签 APK |
| bundle_single_file.js | 生成根目录离线单文件 HTML |
| build_official_site.js | 同步官网游戏资源并更新版本信息 |
| official-site/ | 官网首页、帮助、隐私、独立社交页和 Pages Worker |
| official-site/play/ | 从根目录生成的游戏副本，已加入 .gitignore；不要手工改 |
| pages_build/、wrangler.toml | gomoku-api Pages Worker 部署配置和生成产物 |
| wrangler.worker.toml | gomoku-backend Worker、D1 和 Durable Object 配置 |
| tests/ | Node 单元测试、Python/Playwright 浏览器与 Android 冒烟测试 |
| 五子棋.apk | Android 构建产物；包名 com.gomoku.master |
| 五子棋大师_单文件版.html | 离线交付产物 |

好友私聊修复提交 e5296d8：js/social.js 由 WebSocket 事件触发增量拉取，并每 4 秒轮询兜底；请求中的事件会排队重试，消息合并去重，保留个人清空位置。backend/worker.js 的 /api/messages 支持 after 游标。js/social.min.js、Android 资源和官网副本必须从源重新生成，不要只改压缩副本。

## 安装测试依赖与验证

Node 依赖由 package-lock.json 锁定。仓库没有 Python requirements 文件；浏览器测试需要 Playwright 和 Chromium：

~~~powershell
python -m pip install playwright
python -m playwright install chromium
~~~

快速源码/后端/Android 资源回归：

~~~powershell
node --check js/social.js
node --check backend/worker.js
node tests/social_worker_unit.js
node tests/worker_unit.js
node tests/auth_refresh_unit.js
node tests/turn_worker_unit.js
python tests/apk_asset_manifest_smoke.py
python tests/android_splash_smoke.py
git diff --check
~~~

好友聊天浏览器冒烟：先在一个终端运行 node server.js，再在另一个终端运行：

~~~powershell
python tests/social_frontend_smoke.py
~~~

官网静态页冒烟：先在一个终端运行：

~~~powershell
python -m http.server 4173 --bind 127.0.0.1 --directory official-site
~~~

再在另一个终端运行 python tests/official_site_smoke.py。浏览器测试使用模拟 API 数据，不代表生产真账号端到端测试。未登录时 /api/messages 返回 401 是预期鉴权行为。

## 同步网页、单文件和 Android 产物

更改游戏源代码后，在项目根目录运行：

~~~powershell
npm ci
npm run build:app
node bundle_single_file.js
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
node build_apk.js
npm run build:official-site
~~~

- build:app 使用 Terser 生成压缩 JS；build_apk.js 自身也会执行 build:app 并同步 android_src/assets。
- node build_apk.js --sync-only 只同步资源，不会生成 APK。
- APK 构建机需要 JDK（当前已验证 JDK 17）、Android SDK Platform 35、Build Tools 35.0.0、Platform Tools/adb。优先使用 ASCII SDK 路径 D:\Android\Sdk，避开 AAPT2 的中文路径兼容问题。
- 更新游戏版号时同步 version.json、AndroidManifest.xml 和 JS 当前版本。node publish.js --help 会显示说明；该脚本会构建、改版本、提交并推送，还会创建或上传 GitHub Release。只有用户明确要求正式发版时才运行。
- official-site/play/ 是忽略的构建产物，不要手改或强行纳入 Git。构建后再部署。

## Android 签名、ADB 安装与回退

包名是 com.gomoku.master。MainActivity 校验 APK 正式证书，因此必须复用原签名；换密钥会导致覆盖安装失败或启动安全检查失败。keystore 在仓库外的 %USERPROFILE%\Documents\GomokuSecrets\release.keystore，密码 DPAPI 文件在同目录 keystore-password.dpapi。

全新 Windows 用户没有密码时，先由维护者安全提供原 keystore，再运行以下命令录入密码：

~~~powershell
powershell -ExecutionPolicy Bypass -File .\setup_gomoku_secret.ps1 -Type Signing
~~~

该脚本只录入加密密码，不会生成或迁移正式 keystore。不要生成替代密钥，也不要把 keystore、密码或 DPAPI 文件放进 Git。证书不匹配时停止，不要卸载旧应用。

安装前确认目标设备和现有版本：

~~~powershell
adb devices -l
adb shell dumpsys package com.gomoku.master
apksigner verify --verbose --print-certs .\五子棋.apk
adb install -r .\五子棋.apk
adb shell monkey -p com.gomoku.master 1
~~~

若 APK versionCode 小于已安装版本，普通覆盖会报 INSTALL_FAILED_VERSION_DOWNGRADE。先确认签名相同并备份设备现有 APK；只有确实需要安装较低版本且用户已要求安装时，才用系统提示的保留数据命令：

~~~powershell
adb shell cmd package uninstall -k com.gomoku.master
adb install .\五子棋.apk
~~~

不要用不带 -k 的卸载命令。安装后用 dumpsys package、pidof 和实际屏幕检查版本、进程和首页，确认没有停在启动页。

### 本次设备操作（2026-10-06）

当时连接着一台 Android 设备。项目 APK 的 v1/v2/v3 签名有效，且与原安装包证书相同。手机原装 v1.0.127 / code 128，仓库 APK 是 v1.0.126 / code 127，因此通过 pm uninstall -k 保留数据后安装。新包启动成功，前台为 com.gomoku.master/.MainActivity，首页截图确认已加载。旧 APK 回退备份在 %TEMP%\gomoku-before-adb-install-20261006.apk。后续接手必须重新运行 adb devices -l 并检查版本，不能假设设备状态没变。

## Cloudflare 结构与发布

- wrangler.worker.toml：Worker gomoku-backend，D1 binding DB 指向 gomoku-db；Durable Objects 是 GOMOKU_ROOMS/GomokuRoom 和 GOMOKU_SOCIAL/SocialHub，迁移标签 v1、v2。
- wrangler.toml：Pages 项目 gomoku-api，产物目录 pages_build，绑定同一 D1 和 Worker Durable Objects。
- official-site/_worker.js：官网 Worker；它与 API Pages 和 backend Worker 是不同部署目标。

API Worker 与 API Pages 部署前先 dry-run：

~~~powershell
npx wrangler deploy --config wrangler.worker.toml --dry-run
~~~

node deploy_worker.js 是生产部署：部署 gomoku-backend，把 backend/worker.js 同步为 pages_build/_worker.js，再部署 gomoku-api 的 main 分支；不会部署官网。生产 D1 有变更时先备份，并核对 Wrangler 当前账户与项目。

官网构建和生产部署：

~~~powershell
npm run build:official-site
npx wrangler pages deploy official-site --project-name gomoku-home --branch master --commit-dirty=true
~~~

官网与 API 是不同项目，不能把 API 部署当成官网部署。部署后检查正式域名和最新 deployment source，不能只凭上传成功声称线上修复有效。

### 云端凭据和数据

- .cloudflare_config.json 被 Git 忽略，存放 accountId、d1DatabaseId、scriptName 等配置字段；部署 Token 从环境变量或仓库外 DPAPI 文件 cloudflare-api-token.dpapi 加载。
- 首次配置本机 Cloudflare Token 可运行 powershell -ExecutionPolicy Bypass -File .\setup_gomoku_secret.ps1 -Type Cloudflare。新机器仍需维护者授权的本地配置和权限；克隆仓库无法取得凭据。
- 更新服务依赖 Cloudflare Secret GITHUB_READ_TOKEN；UPDATE_TICKET_SECRET 可独立配置，缺省时代码回退到 GITHUB_READ_TOKEN。不要把任何密钥放进前端、Git 或本手册。
- 生产 D1 保存账号、好友和聊天等数据。改表前阅读 backup_d1.js，检查 migrations/ 与 Worker 初始化逻辑并完成备份；不要为调试打印玩家表或聊天正文。

## 最近核对过的线上状态

以下是 2026-10-06 快照，继续工作时必须重新查询：

- gomoku-home 最新 Production 来自 master / e5296d8；稳定站和 /play/ 返回正常，线上 js/social.min.js 与本地生成文件 SHA-256 一致。
- gomoku-api 最新 Production 来自 main / e5296d8；gomoku-backend Worker 已部署支持好友聊天增量游标的代码。
- 已知待修：线上 https://gomoku-api.pages.dev/api/version 返回 HTTP 503，错误为“私有仓库版本读取失败 (401)”。GitHub Releases 请求收到 401；没有读取 Secret 值，不能推断令牌内容。官网静态 /api/site-version 曾返回 200，但 APK/HTML 下载代理需要先获取短时票据，因此不能把静态版本接口正常说成下载链路正常。私下修复并验证 GITHUB_READ_TOKEN 后，还要分别验 /api/version 与官网 APK/HTML 下载。
- 未授权请求 /api/messages 返回 401 属于预期访问控制，不代表私聊接口异常。

## Git 与提交边界

最近业务代码基线是 master 上的 e5296d8（好友私聊实时刷新修复）。当时 tracked 工作区干净；已有未跟踪 .codex-diagnostics/，它是本地诊断资料，保留且不提交。当前手册修改需单独检查和提交，不要把其他文件一起带上。

提交前运行 git diff --check、git status --short、git diff -- PROJECT_HANDOVER.md。只按文件名暂存，例如 git add -- PROJECT_HANDOVER.md。需要推送或部署时先核实目标分支和项目；正式发版、Cloudflare Worker/Pages 或生产 D1 的改动应处于用户明确授权范围内。

## 下一位 AI 的标准开工顺序

1. 从项目根目录确认分支和未提交文件，先保护用户已有改动。
2. 重新核实版号、生成产物、ADB 设备和线上部署；不要把本手册中的快照当作现状。
3. 先定位唯一真实源码，再同步相应产物；不要只编辑 min.js、APK 内 assets 或 official-site/play。
4. 运行与改动相关的单元、浏览器和 Android 测试，区分模拟回归与生产真账号验证。
5. 完成后清楚说明现象、根因、改动、验证结果和部署边界。