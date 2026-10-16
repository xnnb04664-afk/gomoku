# 五子棋项目交接手册：从零启动

更新日期：2026-10-15
项目目录：D:\小游戏\五子棋
本手册替代旧版按日期堆叠的长交接日志。历史记录与当前代码不一致时，以当前代码、测试和重新核验的线上状态为准。

## 接手时先做

1. 确认工作区是五子棋项目，不要误改同级的 D:\小游戏\大富翁。
2. 在项目根目录运行 git status --short --branch、git log -1 --oneline；保留已有的 .codex-diagnostics/，不要运行 git clean，也不要使用 git add .。
3. 阅读本手册、README.md、README.en.md 和本轮相关源文件。开始操作前重新检查设备、版本、分支和线上状态；下面记录的设备与部署状态会过期。
4. 不读取、复制、输出或提交真实密钥、用户密码、聊天内容、账号数据。生产数据库只在用户明确要求并确认查询范围时读取。
5. 用户偏好：中文优先，英文 README 也要维护；UI 沿用“晴空浮岛、草坪棋盘”风格；功能修复完成后会期待相关网页、单文件和 Android 产物同步。只提交本任务涉及的明确文件。

## 项目概况

中文优先的标准五子棋游戏，游戏首页直接提供 AI 对战、在线匹配、跟好友玩三个入口；好友、棋谱、我的仍是独立页面。项目还提供账号与社交、官网、Android APK 和离线单文件版。游戏 API 现在优先连接 ECS；Cloudflare Worker、Pages 和 D1 保留为客户端故障回退。仓库里的本地 Node 服务仍只托管静态文件。

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
| index.html、js/、img/ | 网页游戏源代码与静态资源；改动首先落在这里。真实棋局与首页预览共用 js/app.js 的 Canvas 绘制器和 img/game/sky-board-cloudstone.webp；四页大厅使用 img/game/sky-island-lobby-background.webp 与 img/game/sky-cloudstone-panel-texture.webp；img/startup/ 提供四帧启动画面，img/game/sky-island-match-background.png 提供对局云海背景 |
| backend/worker.js | Cloudflare API、账号/社交/聊天、房间路由及 Durable Object 实现 |
| backend/ecs-host/ | 在 Node ECS 上运行同一 Worker 的 SQLite、WebSocket 与内存 Durable Object 适配层 |
| js/ecs-config.js | ECS 公共 API 地址；需随网页、单文件和 Android 构建同步 |
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

## 当前玩法与已退役模块

- 游戏页首页只显示 AI 对战、匹配对决、跟好友玩三个标准五子棋入口；底部游戏、好友、棋谱、我的四页保持独立。
- 好友页的“创建好友房间/加入房间”使用全屏棋友专房界面，不切回棋盘、不透出棋盘背景；入口状态在 `js/sky-hub.js`，房间码/加入页逻辑在 `js/online.js`，布局在 `js/sky-island.css`。修改后仍从源文件同步 Android、单文件和官网游戏副本。
- 好友列表头像与情侣徽章由服务端返回的头像标识和关系类型驱动；不按账号名硬编码。
- 游戏、好友、棋谱、我的四页保持各自独立入口与原功能，统一使用 ImageGen 浮岛背景和云石卡片材质。实际对局与首页预览共用 `js/app.js` 的 `drawHandmadeGrassBoard()`、`drawThemedStone()`；`window.GomokuBoardPreview` 将同一 Canvas 绘制器用于 `js/sky-hub.js` 的首页预览。`img/game/sky-board-cloudstone.webp` 提供金边云石棋台底图，Canvas 继续实时绘制与落子位置对齐的 15×15 网格、星位和黑白棋子；`body.sky-game-open` 使用 `img/game/sky-island-match-background.png` 作为对局专属云海浮岛背景。
- 背景音乐在 `js/app.js` 用 Web Audio 按晴空浮岛云海主题合成：D 大调五声音阶、舒缓和弦与轻回响，无鼓点；与落子/提示音效分开设置，默认开启低音量，首次触摸后解锁播放，页面隐藏或 Android `onPause()` 时暂停，回前台时按开关状态恢复。入口在“我的 → 设置”和游戏功能区“⚙ 设置”；Android 生命周期通知由 `MainActivity.notifyWebMusicLifecycle()` 发给网页。
- 残局远征和实验十字棋已于 2026-10-14 从当前产品入口、运行时加载器、APK/单文件构建和官网文案中移除。旧模块、专用测试和截图已移出当前项目并归档到本机回收目录。
- 未清理手机或浏览器里的远征进度/棋局存档。旧版更新兼容 meta 暂留在网页和单文件输出中；新版本更新校验不再要求 48 关。

## ECS 主后端与 Cloudflare 备用

- `js/ecs-config.js` 是 ECS API 地址的唯一前端配置。修改后运行 `npm run build:app`、`node bundle_single_file.js`、`node build_apk.js` 和 `npm run build:official-site`，不要手改压缩或生成文件。
- 公共只读 GET/HEAD/OPTIONS 请求先走 ECS，失败时可回退到 Cloudflare Pages/Worker。社交、私聊、世界频道、排行、战绩和金币等账号/数据库状态读取固定走 ECS，避免从未同步的 Cloudflare 数据库读到旧状态；写请求固定发往一个后端，ECS 超时或返回 5xx 时不会把同一写操作重放到独立数据库，客户端会提示提交状态未知。好友与世界频道 WebSocket 使用发出票据的同一后端地址；房间中继两端固定按 ECS 优先、Cloudflare 备用的同一顺序查找房间，但备用端不能接续另一端的内存房间状态。
- ECS 运行 Node 22 的单实例服务，只绑定回环地址；由受控反向代理提供 HTTPS 和 WebSocket。当前 `/healthz` 只检查 SQLite，不能证明公网 WebSocket 升级链路正常；发布验收还需独立连通实际房间中继。SQLite 主库、系统服务配置、代理配置和备份位置属于运维信息，应从服务器现状或私有运维记录读取，不写入公开交接文档。
- Cloudflare 数据库与 ECS SQLite 相互独立。客户端不会把 ECS 写入请求回放到 Cloudflare；不要据此假定两边数据会自动同步。
- 在线房间和实时社交连接由单个 Node 进程内存承载，进程重启会断开现有 WebSocket；不要横向启动第二个实例。更新检查优先读取多个 GitHub 反向代理节点的公开 Release，下载失败后再走 ECS 短时票据更新服务，Cloudflare Pages/Worker 只作为最后应急出口。APK/HTML 下载按 Release SHA-256 校验；Android 还核对原签名证书。
## 账号访问边界

- 生产环境启用 `PRIVATE_GAME_MODE=1`，允许名单只从 ECS 运行时环境变量 `PRIVATE_GAME_USERNAMES` 读取；缺失时 fail closed。账号名不得写入源码、文档、测试样例或 GitHub。
- 游客注册、改名等公开账号入口关闭。需要保留的好友关系和专属亲密度由服务端按私有运行配置初始化，前端只读取 API 返回的通用关系元数据。
- 房间 WebSocket 先通过账号凭证申请 30 秒一次性票据；票据绑定账号、房间码、角色、会话和房主入房票。
- 生产数据库、账号统计、聊天记录、运行时允许名单和备份均属于私有数据。ECS 操作前先将 SQLite 备份到权限受限的服务器备份目录；不要把数据库、导出、账号数或本机备份路径放进 Git。
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
- 单文件版和 Android 入口共用 img/startup/ 四帧开屏；网页可跳过动画，Android 原生开屏最短展示 1.2 秒后随页面首绘关闭。
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

### 设备验收状态

过去的 ADB 安装记录只代表当时的设备状态，不作为当前版本或存档状态。安装前重新运行 `adb devices -l`、检查已安装版本和签名；保留数据覆盖安装后，再从实际设备核对版本、启动页和功能。不要用旧截图、旧安装日志或测试启动替代当前设备检查。
## Cloudflare 备用环境

- `wrangler.worker.toml`、`wrangler.toml`、`deploy_worker.js` 和 `pages_build` 用于 Cloudflare API 备用环境；`official-site/_worker.js` 是独立的官网目标。
- Cloudflare 部署脚本不会更新 ECS。本次 ECS 发布不要运行 Wrangler，也不要迁移、重置或写入 Cloudflare 数据库。
- Cloudflare 账号配置、令牌和更新服务密钥只存放在运维者管理的本机或云端 Secret 中。不要把凭据写入前端、Git、日志或交接文档。
- `backup_d1.js` 只用于 Cloudflare D1 备用环境。ECS 发布前要单独备份 ECS SQLite 和运行配置；任何生产数据库备份均留在受限服务器目录。
- 当前客户端的更新顺序固定为 GitHub 反向代理节点 → ECS 更新服务 → Cloudflare Pages/Worker 应急备用。ECS 的 `UPDATE_TICKET_SECRET` 由受限运行配置提供；公开 GitHub Release 不需要仓库读取令牌。更新来源必须与签发短时票据的来源一致，不能把一处服务的票据发给另一处服务。

## 线上状态核验

线上服务状态会随部署和配置变化。每次更新都要从服务器读取当前服务与反向代理配置、先完成受限备份，再用健康检查和 SQLite 完整性检查验收。数据库内容、账号统计、主机地址、备份路径和密钥不应复制到公开文档或 GitHub。源码或构建成功不等于 ECS 已更新，也不等于真实客户端验收通过。
## Git 与提交边界

最近业务代码基线是 master 上的 e5296d8（好友私聊实时刷新修复）。当时 tracked 工作区干净；已有未跟踪 .codex-diagnostics/，它是本地诊断资料，保留且不提交。当前手册修改需单独检查和提交，不要把其他文件一起带上。

提交前运行 git diff --check、git status --short、git diff -- PROJECT_HANDOVER.md。只按文件名暂存，例如 git add -- PROJECT_HANDOVER.md。需要推送或部署时先核实目标分支和项目；正式发版、Cloudflare Worker/Pages 或生产 D1 的改动应处于用户明确授权范围内。

## 下一位 AI 的标准开工顺序

1. 从项目根目录确认分支和未提交文件，先保护用户已有改动。
2. 重新核实版号、生成产物、ADB 设备和线上部署；不要把本手册中的快照当作现状。
3. 先定位唯一真实源码，再同步相应产物；不要只编辑 min.js、APK 内 assets 或 official-site/play。
4. 运行与改动相关的单元、浏览器和 Android 测试，区分模拟回归与生产真账号验证。
5. 完成后清楚说明现象、根因、改动、验证结果和部署边界。

## 2026-10-16 最新验收补记

- ECS 更新前需重新探测服务健康状态、备份 SQLite 与当前 Worker；本轮更新后记录实际提交 SHA 和健康检查结果。生产数据库备份只留在 ECS 权限受限目录，不记录备份文件名或生产账号统计到公开文档。
- AI 对手使用 `img/game/ai-opponent-avatars.webp` 的原创灵兽头像；对局与棋谱共用映射，旧 AI 棋谱若保存了玩家头像路径则换用 AI 头像。单文件版内嵌图集，APK 清单显式包含图集。
- 2026-10-16 复盘修复：从结算页进入逐手回放，退出时恢复终局状态；复盘不绘制终局五连光效、技能提示标记和临时 VFX。星轨按真实落子与技能记录生成可点击节点；不伪造“转折手/失误手”。切换人机的提示使用当前 AI 灵兽头像。
- APK 正式签名、版本和 MuMu 安装状态需每次现场复核；上次构建/安装记录不能代替本轮设备验收。
