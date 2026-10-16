# 五子棋项目交接手册：从零启动

更新日期：2026-10-16
项目目录：D:\小游戏\五子棋
本手册替代旧版按日期堆叠的长交接日志。历史记录与当前代码不一致时，以当前代码、测试和重新核验的线上状态为准。

## 接手时先做

1. 确认工作区是五子棋项目，不要误改同级的 D:\小游戏\大富翁。
2. 在项目根目录运行 git status --short --branch、git log -1 --oneline；保留已有的 .codex-diagnostics/，不要运行 git clean，也不要使用 git add .。
3. 阅读本手册、README.md、README.en.md 和本轮相关源文件。开始操作前重新检查设备、版本、分支和线上状态；下面记录的设备与部署状态会过期。
4. 不读取、复制、输出或提交真实密钥、用户密码、聊天内容、账号数据。生产数据库只在用户明确要求并确认查询范围时读取。
5. 用户偏好：中文优先，英文 README 也要维护；UI 沿用“晴空浮岛、草坪棋盘”风格；功能修复完成后会期待相关网页、单文件和 Android 产物同步。只提交本任务涉及的明确文件。

## 项目概况

中文优先的标准五子棋游戏，游戏首页直接提供 AI 对战、在线匹配、跟好友玩三个入口；好友、棋谱、我的仍是独立页面。项目还提供账号与社交、官网、Android APK 和离线单文件版。游戏 API 和房间中继默认只连接 ECS；Cloudflare 游戏 API/中继应急开关默认关闭，更新下载仍保留 Cloudflare 最后应急出口。仓库里的本地 Node 服务仍只托管静态文件。

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
| index.html、js/、img/ | 网页游戏源代码与静态资源；改动首先落在这里。真实棋局与首页预览共用 js/app.js 的 Canvas 绘制器和 img/game/sky-board-cloudstone.webp；四页大厅使用 img/game/sky-island-lobby-background.webp 与 img/game/sky-cloudstone-panel-texture.webp；img/startup/ 提供“棋岛苏醒”启动底图，网页与 Android 在实际棋台上绘制网格和落子，img/game/sky-island-match-background.png 提供对局云海背景 |
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

- `js/ecs-config.js` 是 ECS API 地址与应急开关的唯一前端配置。当前 `enableCloudflareEmergencyApi` 为 `false`，游戏数据与房间中继只连 ECS；修改后运行 `npm run build:app`、`node bundle_single_file.js`、`node build_apk.js` 和 `npm run build:official-site`，不要手改压缩或生成文件。
- ECS 是游戏业务数据的唯一日常来源。只有运维明确把 `enableCloudflareEmergencyApi` 改成 `true` 并重新发布客户端后，游戏 API/房间中继才会尝试 Cloudflare。ECS 与 Cloudflare 使用独立数据库，房间中继也各自保存在进程内存；应急切换前必须确认数据和房间迁移策略，不能假定两边状态自动同步。写请求不会跨库重放。
- ECS 运行 Node 22 的单实例服务，只绑定回环地址；由受控反向代理提供 HTTPS 和 WebSocket。当前 `/healthz` 只检查 SQLite，不能证明公网 WebSocket 升级链路正常；发布验收还需独立连通实际房间中继。SQLite 主库、系统服务配置、代理配置和备份位置属于运维信息，应从服务器现状或私有运维记录读取，不写入公开交接文档。
- Cloudflare D1 与 ECS SQLite 相互独立。当前客户端不会把游戏 API 请求自动切到 Cloudflare；不要据此假定两边数据会自动同步。
- 在线房间和实时社交连接由单个 Node 进程内存承载，进程重启会断开现有 WebSocket；不要横向启动第二个实例。更新检查优先读取多个 GitHub 反向代理节点的公开 Release，下载失败后再走 ECS 短时票据更新服务，Cloudflare Pages/Worker 只作为最后应急出口。APK/HTML 下载按 Release SHA-256 校验；Android 还核对原签名证书。
- Android 网页热更新先尝试按本机当前生效 HTML 的 SHA-256 精确匹配 GitHub HTML 增量包；网页端校验补丁 SHA、基线 SHA、生成文件 SHA 和启动引导，原生桥只负责写入已验证的完整 HTML。设备不支持 `DecompressionStream`、基线不匹配或补丁失败时回退完整 HTML，最后再走完整 APK 安装。增量包只覆盖单文件 HTML 热更新，APK 本身仍为完整包。旧客户端首次升级到带增量能力的网页时仍需完整 HTML 一次；之后无需先装新 APK，发布脚本会按上一版 GitHub HTML 自动生成补丁，补丁过大或基线不可取时跳过。
- ECS/Cloudflare 的票据式完整 HTML 回退上限为 20 MiB，APK 上限为 50 MiB。生产单文件 HTML 约 12 MiB，不能再用 8 MiB 限额，否则 GitHub 多代理全部不可用时 ECS 完整热更新会返回 413。

### ECS WebRTC STUN/TURN

- 在线对局的 ICE 配置由 `js/online.js` 从 ECS `/api/rtc/ice-servers` 获取；公网路径为 `/gomoku-api/api/rtc/ice-servers`。服务端签发短时 TURN 凭据，客户端只在内存中缓存，不写入房间消息、URL、源码或日志。ICE 获取失败时只回退到 ECS 自有 STUN；不使用 Cloudflare、QQ 或 Syncthing 的 STUN/TURN 服务。`js/voice.js` 与保留兼容的 `js/p2p-network.js` 也使用 ECS ICE 地址。
- WebRTC 会尝试建立客户端直连；网络不允许直连时可通过 ECS TURN 中继。ECS WebSocket 房间中继仍负责信令和可靠兜底，因此 ICE/TURN 不可用时不应被描述为“房间服务整体不可用”。
- Coturn、TURN 凭据签发服务及端口范围、配置文件和受限备份记录见本机私有运维文档 `D:\服务器\游戏ECS-TURN说明.md`。密钥、真实运行配置和生产备份不得复制到仓库或公开文档。
- 2026-10-16 已验证 ECS ICE 接口返回 ECS STUN 和 UDP/TCP TURN 配置、预检响应及 ECS 本机 STUN 映射；当前电脑到 ECS 的 TCP STUN Binding 成功。当前电脑的公网 UDP 探测未到达 ECS 网卡，尚未完成两台外部设备的 TURN 数据中继验收，因此不能据此确认所有网络下 P2P/TURN 已通。
- 客户端源文件和 Android 资源副本已改为 ECS ICE；本次未构建、发布或安装客户端。已安装旧版本可能仍使用旧 ICE 配置，需升级后才会应用此次客户端改动。

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
- 单文件版和 Android 入口共用“晴空棋岛”开场：云海晨光底图、实战同款云石棋台、15×15 对齐网格和黑白棋子逐步摆成爱心。网页尊重减少动态效果设置并可轻触继续；Android 12+ 系统启动主题使用匹配的云海浅色与爱心棋子图标，原生 Canvas 动画约 3.6 秒后才允许随网页首绘关闭。慢启动时保留画面并显示等待提示，不按固定计时器露出灰底。
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
- 当前客户端的更新顺序固定为 GitHub 反向代理节点 → ECS 更新服务 → Cloudflare Pages/Worker 最后应急备用。Android 原生桥默认更新来源也是 ECS。ECS 的 `UPDATE_TICKET_SECRET` 由受限运行配置提供；公开 GitHub Release 不需要仓库读取令牌。更新来源必须与签发短时票据的来源一致，不能把一处服务的票据发给另一处服务。

## 线上状态核验

线上服务状态会随部署和配置变化。每次更新都要从服务器读取当前服务与反向代理配置、先完成受限备份，再用健康检查和 SQLite 完整性检查验收。数据库内容、账号统计、主机地址、备份路径和密钥不应复制到公开文档或 GitHub。源码或构建成功不等于 ECS 已更新，也不等于真实客户端验收通过。
## Git 与提交边界

当前已发布业务基线是 master 上的 `2d91794`（v1.0.134 / Android Build 135）。本次交接文档和 ECS 服务模板的发布后更正应单独提交，不要混入其他工作区文件。

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

## 2026-10-16 v1.0.134 发布与验收

已发布 **v1.0.134（Android Build 135）**。GitHub Release `v1.0.134` 和 ECS 均已更新；GitHub master 发布提交为 `2d9179429549fcb0ad572022d808d0bfa0b5d2bf`。Release 提供 APK、网页包和小型 HTML 差分包。APK SHA-256：`10275aceae0ef8d8b99ac83d730c5e5f37db0909250186df1ea178e67960d019`。

- **GitHub 与 APK：**Release 标签指向上述发布提交；`com.gomoku.master` 的 `versionName=1.0.134`、`versionCode=135`。正式签名 v1/v2/v3 验证通过，与上一版签名一致；Release APK 与本地 APK 的 SHA-256 一致。覆盖安装使用 `adb install -r`，未清除 MuMu 应用数据。
- **ECS：**服务由 `gomoku-ecs` 用户运行，`/opt/gomoku/current` 指向版本化发布目录，Node 使用 `/opt/gomoku/runtime/node-v22.23.3/bin/node`。本轮更新了 `backend/ecs-host/server.mjs`；ECS 健康检查和公网 `/api/version` 均返回 HTTP 200/v1.0.134，SQLite `integrity_check` 为 `ok`。部署前 SQLite、运行配置及旧服务文件已在 ECS 权限受限目录备份，旧版本仍保留。私有双账号允许名单数量、顺序和唯一性已用不回显账号名的方式核对。
- **MuMu：**已安装并启动 Build 135。冷启动连续画面确认云海启动页先显示空棋盘与少量棋子，再逐步摆出爱心，随后进入首页；首页爱心棋盘完整显示。验收设备是 MuMu 模拟器，不代表实体手机验收。
- **联机边界：**本轮验证了 ECS 健康状态和版本接口，但未做两名真实账号的完整 WebSocket 对局/互相离房端到端验收，也未重新验证双账号登录。不要将服务可用或客户端可启动描述为这些场景已通过。
- **备用服务：**Cloudflare 未部署、未读写数据，仍只作为故障时备用。

- **公开登录 ID 与固定头像：**后端按运行时 `PRIVATE_GAME_USERNAMES` 顺序映射公开 ID：第一个允许账号对应 `lza` 和男头像，第二个对应 `qsq` 和女头像。别名登录不区分大小写，也可用于好友查找/申请与密码找回；认证资料返回公开 ID 后，客户端锁定对应头像。数据库数字 UID 仍作为好友、房间、棋谱及统计关系键，不迁移主键。本轮已核对 ECS 私密运行配置的两项数量、顺序和唯一性；今后每次部署仍需重新核对。不要把真实账号名写入源码、文档、测试样例或 GitHub。
- **资料离线保存：**服务器请求失败时昵称/头像只保存在本机；提示要求联网后重新打开资料页并再次保存，不承诺自动同步。云端资料是否成功以接口响应为准。
- **主动离房通知：**`backend/worker.js` 是 ECS 使用的 Worker 源码，`pages_build/_worker.js` 是 Cloudflare 备用副本。离房消息由当前房间会话转发，WebSocket 关闭时发送带会话 ID 的主动离房标记；客户端校验角色与会话后直接通知对局层，避免投递到旧版 v3 临时订阅。客户端先于房主连接时，服务端会在会话号就绪后补发 `relay_ready`。这些更改需部署 ECS 后端并升级客户端才会影响线上房间；Cloudflare 副本只在切换备用环境时单独更新。
- **进行中棋局：**AI/双人同屏棋局按账号 UID 写入本地 `localStorage` 检查点；首页有“进行中的对局”卡片，可恢复棋盘、落子历史、回合及已用卡牌。联机对局快照按账号保存在本机，杀后台后保留到主动离房或棋局结束，不因保存时间过长自动清除；恢复时还原本地棋盘并尝试重连 ECS 房间。ECS 房间状态当前由单个 Node 进程内存承载，进程重启后本机棋盘仍可查看/恢复，但不能保证重连到原对手或继续同步。
- **后续验收：**如需进一步确认联机，安排维护时段并由两名账号持有者验证登录头像、好友/房间双向消息、双方离房、重连与棋局恢复。不要在公开记录里写真实账号名、生产统计或服务器备份位置。

## v1.0.135 Android 登录保持改动

- Android WebView 的账号凭证保存在应用本机 `localStorage`，并由原生 `SharedPreferences` 保存一份恢复副本；登录不依赖 Cookie。`gomoku_user_auth_updated_at` 与原生 `authUpdatedAt` 记录凭证更新时间。启动时若 WebView 来源变化（例如本地服务端口切换）留下了完整但较旧的凭证，会恢复更新时间较新的原生会话；主动退出同步清除该时间戳。
- 本次只改客户端登录恢复与版本信息；不包含 `auth_sessions` 多设备会话服务端实验，也未部署 ECS 或 Cloudflare。该服务端候选仍需修复旧令牌重复迁移、并发验证轮换与单设备注销，再通过隔离 SQLite/D1 验证后才可部署。
- APK 构建版本为 `1.0.135` / `versionCode=136`；正式签名验证通过 v1、v2、v3，证书 SHA-256 为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5`，与 v1.0.134 安装包一致。签名构建本身不代表真机或 MuMu 安装验收。
- **发布核验：**GitHub Release `v1.0.135` 已发布，源提交为 `ad878921b9cab28191a21622c206cb8299439067`。APK SHA-256 为 `7da8716a87743a04b2d766c20fe4c9c9f0d4bbb170c1908b9fde28375ed93289`，单文件 HTML SHA-256 为 `714c36d29ba5d039b3b56ae4471ebce5991216d0d124a3fc67af55ef011f726f`，增量包 328,511 bytes。ECS `/api/version` 已返回 v1.0.135 且哈希与 Release 一致，`/healthz` 为 HTTP 200；这是现有 ECS API 动态读取最新 GitHub Release，本轮未部署 Worker 或改数据库。MuMu/真机未安装本版，Cloudflare 未部署。
