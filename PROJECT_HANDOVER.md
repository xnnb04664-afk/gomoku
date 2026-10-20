# 五子棋项目交接手册：从零启动

2026-10-20 当前正式发布：[v1.0.152 / Android Build 153](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.152)，发行提交 `c326c8a722e9decdb9588007ab98587637146f5a`。新增 Android 匹配通知桥接；`js/app.js` 以独立 `MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 153` 门槛确保旧 APK 先完整更新。Build 151 的原生 AI 门槛继续保留。APK 3,895,695 bytes，SHA-256 `afd4e2b327c112444dbc83086b2c9af91139939b043973e7d35a3f9cc9a939a0`；单文件 HTML 13,087,777 bytes，SHA-256 `84d6e55e92d8a246ae445e2345ead3147d719a3a5e16706cf829aa8ccce385dd`；官网游戏 JS SHA-256 `1a279ad22994c3db6bbc67bc4bcd4b0b48e932693f622f38b7dc2766f4e1a164`。GitHub Release、gomoku-home `master` Pages、官网版本接口/实际 APK/游戏 JS 与 ECS 匿名版本及摘要均核验一致。APK 正式签名证书 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`、v1/v2/v3 验签和 16 KiB 对齐通过；匹配状态回归、重连/relay 回归、通知 JVM 冒烟及 360/390 浏览器证据见 `.codex-diagnostics/online-activity-20261020/verification-report.md`。没有 ADB 设备，未做真机安装或系统通知栏验收；匹配 API 使用浏览器路由模拟，未验证 ECS 实际房间接口。

**2026-10-20 本地匹配状态与 Android 通知候选（已发布）：**页面行为与浏览器证据见上方正式版说明和 `.codex-diagnostics/online-activity-20261020/verification-report.md`；该候选之后按 `1.0.152 / Build 153` 正式发版，候选阶段 APK 摘要 `214f778e381652f0c5c065ee7e02e1b0882baa21d4d0d1203d9dccc96849ca03` 属于未升版的旧构建，不是正式发行 APK。正式构建加入 Build 153 通知门槛，当前发版 APK 摘要见本手册顶部。

本次计时（UTC）：固定入口 `release_official.js` 从 10:03:25.504 到 10:08:46.950，共 321.446 秒（5 分 21.446 秒），含首次验收失败和恢复。内层 `publish.js` 阶段 84.037 秒：前端压缩 3.64 秒、单文件打包 0.27 秒、APK 构建签名 18.88 秒、显式暂存 0.77 秒、本地提交 0.45 秒、推送 10.02 秒、Release 附件准备/查找/下载/差分/上传合计约 47.77 秒；官网 Pages 部署 58.344 秒。首次线上检查 30.123 秒：GitHub API 请求以 EOF 失败，官网 APK 与 JS 请求超时。首次失败后到恢复检查开始间隔 142.012 秒，包含诊断、阶段播报、恢复命令准备等，未单独细分，不计入上传耗时。按原 run 恢复后的五项验收约 6.13 秒并全通过，未重复部署、提交、升版或发版。签名检查 0.60 秒；版本/指纹准备、入口完整性检查等见 run 记录。命令启动前的门槛测试、源码审阅和准备，以及文档收尾未单独计时。发布说明已单独更正；本次打包的 `version.json` 更新文案仍沿用 v1.0.151 代理优先说明，下一版应先修复 `publish.js` 中固定更新文案生成逻辑，不要为此改写本版 APK/HTML 已验收摘要。详细阶段和错误见 `.codex-diagnostics/official-release/2026-10-20T10-03-25-504Z-12864-7ff260/run.json` 与 `report.md`。无 ADB 设备，未实机安装；ECS 实际匹配房间及 Android 通知栏未验收。

历史本地候选（2026-10-20，现由上方 v1.0.152 正式版替代）：当时版本为 v1.0.150 / Android Build 151，候选 APK SHA-256 `0ae63d49ba5bc63da19f6c42a55d2eedf2f3da06361bc25142e9c91c8d609a52`，已包含版本查询代理优先修复，但此摘要未作为正式版本发布。

历史已发布正式版本（2026-10-20）：[v1.0.150 / Android Build 151](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.150)，GitHub 发行提交 `4bb9ac8b20011329f7c460fd246b00acf1186cc0`。发布 APK 为 3,887,503 bytes，SHA-256 `92829d06916885bded4824792e45e1b421a90b8527e2fff004020fb01eb2b5c1`；GitHub Release 附件摘要与当时本地 APK、HTML 一致，HTML SHA-256 为 `3cb2565a79ad5e0b4eb644542066db6a306ae413e15c182ab4a036c5628710b7`。证书 SHA-256 为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`，v1/v2/v3 验签和 16 KiB `zipalign` 检查通过。棋盘对局画面按石框轮廓裁切；Build 151 加入 PackageInstaller Session。现有 Build 150 及更早版本需先正常覆盖安装完整 APK 才能获取新原生代码；之后 Android 12（API 31）及以上在系统允许时请求免确认自更新，系统策略仍可能要求确认。JVM 自更新冒烟和 APK 版本门槛回归通过，但没有真实手机安装验收。Cloudflare Pages `gomoku-home` 的 `master` 部署已完成：`/api/site-version` 返回 v1.0.150 / Build 151，`/download/apk` 实际下载摘要与本地一致，`/play/js/app.min.js` 与本地一致（SHA-256 `e11b78839fd1c3437047c8e58c060dabed59d97bd29b742209351806b45eb391`）。ECS 匿名 `/gomoku-api/api/version` 返回 `v1.0.150` 和同一 APK 摘要；无需重启 ECS。

历史本地候选（2026-10-20，已由上方 v1.0.150 / Build 151 正式版替代，未作为正式 Release 发布）：v1.0.149 / Build 150 候选 APK SHA-256 为 `e6f08d062ac6568784f6b14a4440637e1b907e488d1b2efd31b84aa7e30a975f`，包含 PackageInstaller Session 实现；此摘要仅用于区分历史候选与当前正式 APK。

历史棋盘裁切候选快照（2026-10-20，已由 v1.0.150 / Build 151 正式版替代）：对局棋台在 Canvas 绘制时按原图石框轮廓裁切，去除框外云朵、方块白边及青色杂边；首页与启动动画保留原素材，网格与落子几何不变。图片工具候选仍有杂点，未接入项目。网页、单文件、Android 资源与当时本地 APK 已同步，版本号为 1.0.149 / Build 150。该快照 APK SHA-256 为 `49948a353811980a1cd698a5aa6298706b73359d8178a74f08b09d09496ba2d7`。360/390/412/1366 宽度浏览器检查及角落/中心落子通过，APK 正式签名和 16 KiB 对齐校验通过；无 ADB 设备，未做手机验收。证据在 `.codex-diagnostics/board-cutout-20261020/`，原已发布 APK 与棋盘素材已留存于该目录。旧诊断脚本依赖启动网格逐帧重绘，已不适用于缓存绘制；当时只在诊断副本中移除这项无关断言，对局几何/实际点击断言保留。

此前静默安装调研记录（已由上方本轮实现取代）：当时 Android 安装流程使用 ACTION_VIEW，自动下载/校验后仍需确认。Android API 31+ 的 PackageInstaller 可在满足自更新、target SDK 等条件且声明 UPDATE_PACKAGES_WITHOUT_USER_ACTION 时请求免确认安装，仍必须处理 STATUS_PENDING_USER_ACTION。当时仅答复能力与现状，尚未改安装流程。

此前已发布 [v1.0.149 / Build 150](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.149)：原生库去除未用代码和符号元数据，保留四种 ABI、O3 与匹配符号副本；启动页去除冗余备用海报/底色绘制。APK 约 3.70 MiB，较此前减少 7.6%。旧 Build 148 及更早即使更新了网页，也会被引导安装完整 APK。GitHub 附件及 ECS 版本接口摘要一致，无需重启 ECS。签名及针对性检查通过，无设备实测；发行提交与最终摘要见 `APK_OPTIMIZATION_20261020.md`。

更新日期：2026-10-20

最新本地候选：棋盘边框与首页预览、预言命中回合、人机随机黑白已调整；卡牌按用户最后确认保持默认展开。手机对局按参考图放大，保留上下金边；启动棋子取消贴图淡入，首页/网页启动/原生启动统一为 13 黑、13 白。行为、验证边界及当前交付摘要见 `BOARD_TURN_FIXES_20261019.md`；此前性能报告内摘要是更早候选。尚未安装真机或发布线上。

启动流畅度后续优化：网页缓存静态网格，退出后释放缓存；Android 后台准备纹理，首页衔接改为 180 ms 淡出并延后释放图片。已新增缓存与原生淡出生命周期测试；实际设备帧率尚未验证，细节同上。
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
| android_src/ | Android WebView 容器、Java 桥接、`cpp/gomoku_ai.cpp` NDK 搜索引擎、Manifest 和资源镜像 |
| build_apk.js | 按 APK 运行资源清单同步资源，使用 NDK 编译并打包 Android 原生 AI，再用正式签名密钥签 APK；Android 图片资源有独立的 WebP 优化副本 |
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
- 好友头像打开棋友资料卡，显示公开昵称/短 ID、在线状态、积分、官方累计胜场/总局/胜率与亲密度。对局记录展示好友已保存的全部模式，包含 AI、人机匹配、好友联机与双人同屏；接口要求双方仍为好友且未互相拉黑，仅返回模式、胜负、服务端保存时间、对手昵称和手数，不返回棋谱走子、棋盘快照或内部 UID。逐条记录来自玩家端保存的个人历史，不能视作服务端验证的天梯结算；累计天梯战绩仍以 `users` 表为准。记录以 20 条游标分页。`friend_match_history` 只留小型摘要并长期保留，完整棋谱仍按旧策略只保留最近 30 局；已被旧版裁掉的资料无法恢复。正式账号对局在用户确认保存后先进入本地上传队列，使用稳定 `clientRecordId` 和服务端回执幂等；网络失败后按退避时间重试，回到前台或网络恢复时唤醒队列。好友资料卡打开且处于前台时每 15 秒轮询一次，回到前台、网络恢复和手动刷新也会立即拉取；这是轮询刷新，不是推送，实际延迟还受网络与系统定时器调度影响。
- `migrations/0006_friend_match_history.sql` 创建轻量好友对局摘要表、索引、将现有可用记录回填并为新记录设插入触发器；`migrations/0007_game_history_client_record_id.sql` 为客户端上传记录添加稳定幂等 ID 与永久回执；`backend/worker.js` 启动时也会幂等建表、回填及建触发器，覆盖 ECS SQLite。清空或删除玩家的云端棋谱时同步删除对应好友摘要。上线 D1 前按顺序应用迁移，ECS 可由 Worker 初始化补表。
- 游戏、好友、棋谱、我的四页保持各自独立入口与原功能，统一使用 ImageGen 浮岛背景和云石卡片材质。实际对局与首页预览共用 `js/app.js` 的 `drawHandmadeGrassBoard()`、`drawThemedStone()`；`window.GomokuBoardPreview` 将同一 Canvas 绘制器用于 `js/sky-hub.js` 的首页预览。`img/game/sky-board-cloudstone.webp` 提供金边云石棋台底图，Canvas 继续实时绘制与落子位置对齐的 15×15 网格、星位和黑白棋子；`body.sky-game-open` 使用 `img/game/sky-island-match-background.png` 作为对局专属云海浮岛背景。
- 背景音乐在 `js/app.js` 用 Web Audio 按晴空浮岛云海主题合成：D 大调五声音阶、舒缓和弦与轻回响，无鼓点；与落子/提示音效分开设置，默认开启，背景音乐默认音量 100%、对局音效默认音量 80%，已保存的个人音量设置继续优先生效。首次触摸后解锁播放，页面隐藏或 Android `onPause()` 时立即静音、停止独立音频并暂停 AudioContext；Android 等网页处理暂停通知后再暂停 WebView/timers，回前台后按开关状态恢复。入口在“我的 → 设置”和游戏功能区“⚙ 设置”；Android 生命周期通知由 `MainActivity.notifyWebMusicLifecycle()` 发给网页。
- 残局远征和实验十字棋已于 2026-10-14 从当前产品入口、运行时加载器、APK/单文件构建和官网文案中移除。旧模块、专用测试和截图已移出当前项目并归档到本机回收目录。
- 未清理手机或浏览器里的远征进度/棋局存档。旧版更新兼容 meta 暂留在网页和单文件输出中；新版本更新校验不再要求 48 关。

## ECS 主后端与 Cloudflare 备用

- `js/ecs-config.js` 是 ECS API 地址与应急开关的唯一前端配置。当前 `enableCloudflareEmergencyApi` 为 `false`，游戏数据与房间中继只连 ECS；修改后运行 `npm run build:app`、`node bundle_single_file.js`、`node build_apk.js` 和 `npm run build:official-site`，不要手改压缩或生成文件。
- ECS 是游戏业务数据的唯一日常来源。只有运维明确把 `enableCloudflareEmergencyApi` 改成 `true` 并重新发布客户端后，游戏 API/房间中继才会尝试 Cloudflare。ECS 与 Cloudflare 使用独立数据库，房间中继也各自保存在进程内存；应急切换前必须确认数据和房间迁移策略，不能假定两边状态自动同步。写请求不会跨库重放。
- ECS 运行 Node 22 的单实例服务，只绑定回环地址；由受控反向代理提供 HTTPS 和 WebSocket。当前 `/healthz` 只检查 SQLite，不能证明公网 WebSocket 升级链路正常；发布验收还需独立连通实际房间中继。SQLite 主库、系统服务配置、代理配置和备份位置属于运维信息，应从服务器现状或私有运维记录读取，不写入公开交接文档。
- Cloudflare D1 与 ECS SQLite 相互独立。当前客户端不会把游戏 API 请求自动切到 Cloudflare；不要据此假定两边数据会自动同步。
- 在线房间和实时社交连接由单个 Node 进程内存承载，进程重启会断开现有 WebSocket；不要横向启动第二个实例。更新检查优先读取多个 GitHub 反向代理节点的公开 Release，下载失败后再走 ECS 短时票据更新服务，Cloudflare Pages/Worker 只作为最后应急出口。APK/HTML 下载按 Release SHA-256 校验；Android 还核对原签名证书。
- Android 网页热更新先尝试按本机当前生效 HTML 的 SHA-256 精确匹配 GitHub HTML 增量包；网页端校验补丁 SHA、基线 SHA、生成文件 SHA 和启动引导，原生桥只负责写入已验证的完整 HTML。设备不支持 `DecompressionStream`、基线不匹配或补丁失败时回退完整 HTML。完整 APK 另行更新 Android 启动器图标与原生 Java 组件，网页热更新不会替换这些 APK 资源。
- 新版原生桥通过 `AndroidNativeApp.getAppVersionCode()` 报告已安装 APK Build。游戏会把已安装 Build 与图标/原生桥最低 Build 比较；旧桥缺少该方法也视为需完整 APK。网页内容可先小流量更新；更新后的页面会提示用户再点“我的 → 检查更新”，安装按钮会直接走已校验的完整 APK，不会再次走网页热更新。`js/app.js` 中的 `MINIMUM_APK_BUILD_FOR_CURRENT_ICON` 只在重绘 Android 图标时提高；`MINIMUM_APK_BUILD_FOR_NATIVE_VERSION_CHECK` 只在原生版本查询协议改变时提高。APK 覆盖安装使用相同正式签名并保留应用数据。
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
- 单文件版和 Android 入口共用“晴空棋岛”开场：云海晨光底图、实战同款云石棋台、15×15 对齐网格先以空棋盘展示，再由黑白棋子逐步摆成中空爱心。网页尊重减少动态效果设置并可轻触继续；Android 12+ 系统启动主题先显示空棋台，WebView 完成一次性初始化后再启动约 3.6 秒的原生落子动画。Android 把静态云海/标题/棋台网格与动态棋子拆成独立图层，动画期间只刷新棋子层，避免反复重绘整屏；图片仍在后台解码，失败时保留空棋台预览；切到后台会暂停动画，恢复时接续播放。慢启动时保留画面并显示等待提示，不按固定计时器露出灰底。
- APK 构建机需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Platform Tools/adb 和 Android NDK r27c；NDK 默认从 `ANDROID_SDK_ROOT/ndk` 自动发现，也可用 `ANDROID_NDK_HOME` 指定。构建脚本用 NDK Clang 编译 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` 四种 ABI，并打包 16 KB ELF 页面兼容的 `libgomoku_ai.so`。优先使用 ASCII SDK 路径 D:\Android\Sdk，避开 AAPT2 的中文路径兼容问题。网页热更新不会替换 Android 原生库，AI 原生代码改动必须完整重建 APK。
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

本地版本、Git 提交与线上发布状态应分别核对。2026-10-19 本地 HEAD 对齐至 `e59b4a9`，`version.json` 为 `1.0.147` / Android Build 148，包含棋盘放大、预言换手、人机随机黑白与 C++ NDK 原生搜索等优化；正式发版通过 publish.js 发布 GitHub Release。交接文档修订应单独提交；生产私有配置和账号数据不得进入仓库。

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
- APK 构建版本为 `1.0.135` / `versionCode=136`；正式签名验证通过 v1、v2、v3，证书 SHA-256 为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`，与 v1.0.134 安装包一致。签名构建本身不代表真机或 MuMu 安装验收。
- **发布核验：**GitHub Release `v1.0.135` 已发布，源提交为 `ad878921b9cab28191a21622c206cb8299439067`。APK SHA-256 为 `7da8716a87743a04b2d766c20fe4c9c9f0d4bbb170c1908b9fde28375ed93289`，单文件 HTML SHA-256 为 `714c36d29ba5d039b3b56ae4471ebce5991216d0d124a3fc67af55ef011f726f`，增量包 328,511 bytes。ECS `/api/version` 已返回 v1.0.135 且哈希与 Release 一致，`/healthz` 为 HTTP 200；这是现有 ECS API 动态读取最新 GitHub Release，本轮未部署 Worker 或改数据库。MuMu/真机未安装本版，Cloudflare 未部署。

## v1.0.136 启动画面

- Android 12+ 系统启动图标使用动画矢量棋盘：第一帧是空的 15×15 棋盘，黑白棋子逐步落成爱心；Activity 初始化期间循环播放，避免动画结束后停在静态爱心图上。
- 原生 `GomokuSplashView` 随 Activity 首帧接管，继续从空棋盘逐步显现网格和爱心棋子，再进入首页。动画资源位于 `android_src/res/animator/` 与 `android_src/res/drawable/`；系统主题配置在 `android_src/res/values/styles.xml`。
- **构建与验证：**`python tests/android_splash_smoke.py` 通过，全部 Android 资源 XML 可解析，`node --check js/app.js` 通过。APK 为 `1.0.136` / `versionCode=137`，正式签名 v1/v2/v3 验证通过；证书 SHA-256 为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`，与 v1.0.135 相同。APK SHA-256 为 `46f0b28551ad241a3356bdee2c64bcf135765b1d57382ae61a83e5753a0846a0`，单文件 HTML SHA-256 为 `78df73cf65f446c0f51b3e3763d7db15b2e8ea571bd8925ee1dec6540019305e`。从 v1.0.135（基础 HTML SHA-256 `714c36d29ba5d039b3b56ae4471ebce5991216d0d124a3fc67af55ef011f726f`）生成的 HTML 增量包为 84,406 bytes。MuMu Android 15 覆盖安装成功，`firstInstallTime=2026-09-16 13:22:58` 未变；从模拟器拉取已安装 APK 后 SHA-256 与本次候选包完全一致。冷启动画面从无棋子的棋盘开始，随后逐步落子成爱心，再衔接游戏首页。此项是 MuMu 模拟器验收，不代表额外真机验收。
- 本版只更新客户端启动画面和版本资源；未改 ECS 后端、数据库或 Cloudflare 备用配置。
- **发布记录：**启动动画合并于 [PR #2](https://github.com/xnnb04664-afk/gomoku/pull/2)，验收信息修订于 [PR #3](https://github.com/xnnb04664-afk/gomoku/pull/3)。GitHub [Release v1.0.136](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.136) 指向提交 `4d8132387322eaabde649333b6bf33b359e05ad6`；ECS `/healthz` 返回 HTTP 200，`/api/version` 已读到 v1.0.136，APK 与 HTML 哈希匹配 Release。ECS 动态读取 GitHub 最新 Release，本次没有部署后端或改数据库。

## 2026-10-17 v1.0.137 全面审查与发布

- 使用 ImageGen 按晴空棋岛主题重新绘制应用图标，源图为 `design_assets/gomoku-app-icon-master.png`；发布脚本会一并提交官网 favicon，Android 各密度图标和状态栏通知图标已更新。
- 修复棋局检查点恢复时技能状态丢失、房间票据允许错误账号接管房主、长好友账号名被截断、更新下载 Range 响应以及 GitHub 更新节点串行等待等问题；Wrangler 开发依赖升级后，`npm audit` 和 `npm audit --omit=dev` 均为 0 vulnerabilities。
- 相关验证通过：后端 Worker/社交单元测试、更新清单竞速回归、棋局技能检查点浏览器冒烟、在线匹配/重连/传输及回放测试、AI 强度与性能测试、Android 启动画面/通知图标/生命周期/资源清单测试、完整 APK 与单文件构建。测试模拟没有替代真实双账号联网验收。
- GitHub Release `v1.0.137` 指向 master 提交 `89323163fc2dedd19566a70362d5d258d87b63dc`，提供 APK、完整 HTML 与 307,262-byte HTML 增量包。APK `versionName=1.0.137` / `versionCode=138`；v1/v2/v3 签名验证通过，证书 SHA-256 为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。APK SHA-256：`b773b1907f14c0e940d27a4e74a0438b152186075679f54e03e6c15ae478e0c6`；单文件 HTML SHA-256：`69ef98d41ff546ea230fb0eda039dd2969bfd2e69bd679c9d8411586d5e63910`。
- ECS 已切换到版本化 v1.0.137 Worker；部署前 SQLite 与服务配置已在服务器受限目录备份，部署后 SQLite `integrity_check=ok`，本机与公网 `/healthz` 均 HTTP 200，公网 `/api/version` 返回 v1.0.137。旧版本目录保留用于回滚。Cloudflare 未部署、未读写数据。
- ADB 模拟器 `emulator-5554` 使用保留数据的 `adb install -r` 更新到 Build 138；`MainActivity` 已启动。未执行清除数据或卸载。真实两账号匹配、聊天、离房与重连流程未在本轮生产环境执行。

## 2026-10-17 v1.0.138 好友音效与匹配状态修复

- 好友邀请、好友申请和私聊消息加入主题提示音，沿用游戏音效开关与音量；私聊通知增加节流。退出房间后重新进入匹配页会清除残留匹配标识与浮条。
- 发布脚本静态语法与凭据安全门禁通过。APK 为 `versionName=1.0.138` / `versionCode=139`，v1/v2/v3 签名验证通过，证书 SHA-256 与 v1.0.137 一致：`9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。APK SHA-256：`1cdd456b9acceb7bb56e8f6dc659f1823862760786a60c086f7138f4ff53ca91`；单文件 HTML SHA-256：`9804fc8e57a9300926a81e7e5da5807447952f411aab05f91485a61897997175`。Release 附带从 v1.0.137 基线生成的 92,959-byte HTML 增量包。
- GitHub [Release v1.0.138](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.138) 指向 master 发布提交 `0dd16435b6d14ee0d3b3a4cb7d0d33a46e0516cd`。ECS 公网 `/api/version` 返回 v1.0.138 且 APK 摘要匹配 Release，`/healthz` 为 HTTP 200、SQLite 状态正常；该更新接口动态读取最新 GitHub Release，因此本次无需重启 ECS 或修改数据库。Cloudflare 未部署。
- MuMu `emulator-5554` 通过 `adb install -r` 更新到 Build 139，应用数据保留，`MainActivity` 已启动。未单独运行完整行为回归套件；该模拟器检查不代表真实双账号联机验收。

## 2026-10-17 Android 原生人机决策

- Android 端 `js/app.js` 的统一 `smartAiMove()` 优先调用 `AndroidNativeApp.requestNativeAiMove()`；Java 通过有界后台线程返回坐标，网页仍经 `makeMove()` 更新棋盘、技能、棋谱与存档。`android_src/src/com/gomoku/master/NativeGomokuAI.java` 已移植 `js/ai_fast.js` 大师路径：3^11 局部棋型统计、战术与开局候选扩展、10 ply 强制威胁证明、最多 12 层迭代加深、Alpha-Beta、双 Zobrist 校验的置换表、killer/history 着法排序和战术叶评估；共享 1.1 秒截止时间，只有安静局面连续三层稳定在同一主着法时才提前返回，战术局面继续搜索，只有完成的迭代才更新最终着法。棋盘维护半径 2/3 的邻子计数，胜点检查直接按四方向扫描；置换表按请求代际复用，减少每步扫描和分配。原生结果把实际深度、节点数、耗时回传到 `gomokuLastAiStats`。当前 Android 人机固定使用自由五子棋（`enableFoul:false`），卡牌禁点仍在候选和威胁搜索中生效。悔棋、重开和进入复盘会使旧请求失效，响应坐标也会重新验证，异常时回退到 JavaScript Worker。构建 APK 才会更新原生引擎，网页热更新不会替换 Java 类。
- 该 Java 引擎不是 JavaScript 大师引擎的完整威胁搜索移植，棋力可能有差异；目标设备上的实际落子耗时和棋力仍需观察。Android 需要重建完整 APK 才包含原生类，不能只靠 HTML 热更新。

## 2026-10-17 v1.0.140 Android AI 发布

- GitHub [Release v1.0.140](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.140) 指向发布提交 `8e7ae044a9d0ab2fc2122b95fb1dc06bceacb7ab`，发布版本为 `versionName=1.0.140` / `versionCode=141`。Release 提供正式签名 APK、单文件 HTML 和 62,139-byte HTML 增量包；APK SHA-256 为 `870e4d9f84848fe83e1e6f77f15b1a75f5739728b23b96bd708415ce5f5c779c`，HTML SHA-256 为 `fd0167a5e3df450b37bf3dde6fe5a3d0e78aabf88a5ffa3dd88e6b2d5951167d`。
- `publish.js` 的静态语法/凭据门禁、单文件构建、Android Java/Dex 构建和 APK v1/v2/v3 签名核验通过。ECS `/healthz` 与 `/api/version` 均为 HTTP 200；版本接口已动态读到 `v1.0.140`，返回的 APK 摘要与 GitHub Release 一致。ECS 版本服务会读取 GitHub 最新 Release，本次无需部署 Worker 或触碰数据库。Cloudflare 未部署。
- 本次只发布已提交的 AI 主线代码，未把原工作区未提交的社交、后端实验和资源改动带入 Release。MuMu 本轮未覆盖安装；没有运行真实对局计时或棋力回归，因此 1.1 秒是搜索预算上限，不是实测落子时长。

## 2026-10-18 Android 原生人机搜索分配优化

- `NativeGomokuAI` 将候选落点双方的六项棋型计数压入一个整数，避免候选生成阶段为每一方创建临时 `Pattern` 对象；递归搜索直接返回分数，并由搜索上下文传递超时状态，减少逐节点结果对象及置换表命中时无用的着法对象。评分、候选范围、Alpha-Beta/威胁搜索规则和 1.1 秒搜索预算保持不变。
- 基于 JDK 17 的 Windows 主机对照中，50 个随机棋盘的 22,500 组落点/颜色棋型计数与评分逐项一致。固定局面在相同预算下的落子、评分和完成深度一致。线程分配计数从约 4.84 KB/节点降至约 2.49 KB/节点（约减少 49%）；节点吞吐有计时波动，不能据此承诺设备端延迟会同比下降。
- 本次仅做源码优化与主机验证，尚未在 MuMu/真机验证。改动需要完整重建 APK 才会进入 Android 安装包；网页热更新不会更新原生 Java AI。

## 2026-10-18 后台音频生命周期修复

- 页面进入后台时立即静音 Web Audio 输出和独立爆炸音频，并暂停 AudioContext；返回前台时恢复音效与音乐。Android 等网页完成生命周期处理回调后再暂停 WebView 和定时器，并保留有界兜底。
- 需要构建并安装新 APK 才能验证 Android 原生生命周期路径；发布构建本身不代表已在 MuMu 或真机完成后台/前台验收。

## 2026-10-18 v1.0.145 好友悔棋与对局记录修复发布

- 修复人机和好友对局的悔棋同步、离线棋谱待上传队列幂等重试、好友对局记录读取，并移除“移星换斗”卡及更换虚空陨石音效。另包含好友消息红点居中、切后台停止音频、退出匹配清理等本轮已合并改动。
- GitHub [Release v1.0.145](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.145) 指向提交 `7074af79688cf489204ea25121c003bd0b73177d`，版本为 `versionName=1.0.145` / `versionCode=146`。Release 含 APK（3,436,650 bytes）、单文件 HTML（13,058,865 bytes）和 183,576-byte HTML 增量包。APK SHA-256：`0b88298ca41ef43a81a2f4ae26512f3505cc2e2f114329d7602799fd554591dc`；HTML SHA-256：`fa50f4c68ae256bd70170eb48f26113d923e11fa21d0488d784974eb2835def5`。本地 APK、HTML 摘要与 Release 附件一致。
- ECS 已部署到 `/opt/gomoku/releases/20261018-v1.0.145-7074af7`。部署前备份 SQLite 数据库、运行配置和旧 Worker；旧版 `/opt/gomoku/releases/20261018-v1.0.144-friend-history-404` 保留用于回滚。服务重启后 `/healthz` 返回 `200`、`/api/version` 返回 `v1.0.145`；对局记录接口初始化新增的幂等字段、回执表和触发器，SQLite `quick_check=ok`。部署前无活动房间连接。
- Cloudflare 未部署或读写，继续保留为 ECS 故障时的备用环境。当前记录仅确认发布和 ECS 健康状态，不代表本次重新完成 MuMu 或真机安装验收。

## 2026-10-18 v1.0.146 品牌统一与官网发布

- 产品显示名统一为“五子棋云屿晴光”，覆盖 Android 桌面名与启动页、游戏大厅、好友通知、离线单文件版、README 和官网首页/帮助/隐私/好友页。官网首页加入对应的 WebSite 结构化数据；canonical、OG URL、robots 与 sitemap 仍指向当前可访问的 `gomoku-home.pages.dev`。
- GitHub [Release v1.0.146](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.146) 指向提交 `86983e8cc78623ba45d993491c2680dbeac5b629`，APK 为 `versionName=1.0.146` / `versionCode=147`。Release 含 APK（3,436,650 bytes）、单文件 HTML（13,059,577 bytes）和 166,343-byte HTML 增量包。APK SHA-256：`11aa313370a23cf4004724ecc5213ee6009cc0916cf00df193e680ca17a545a9`；HTML SHA-256：`0f7e9723909e6eedf3aea7773560a16bdd8c830291361c29e6b2194fd09338d5`。APK 正式签名证书 SHA-256 仍为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。
- 官方站 Pages 已部署到 `gomoku-home` 的 `master` Production，部署提交为 `86983e8`。首页、帮助、好友、游戏页、robots、sitemap 与 `/api/site-version` 实际访问均返回 HTTP 200；版本接口返回 `v1.0.146` / Build 147。Wrangler 打印部署完成，但本机命令最后返回非零退出码；Cloudflare 部署记录和生产站点请求均确认发布已生效。
- ECS `/api/version` 已动态返回 `v1.0.146`，APK 与 HTML SHA-256 均匹配 Release；因此无需重启 ECS、改数据库或部署游戏 Worker。本轮只部署官方站 Pages，不部署 Cloudflare 游戏 API/中继 Worker。
- 当前本机检查中，备案域名 `xnxy99.cn` 尚未通过 HTTPS 验证，因此官网 canonical 继续使用 `gomoku-home.pages.dev`；域名 DNS 与证书稳定后再切换。APK 完成签名与包版本核验，但本轮未安装到 MuMu 或真机。

## 2026-10-19 Android 人机搜索迁移到 C++ NDK

- `android_src/cpp/gomoku_ai.cpp` 是 Android 人机搜索的 C++ NDK 主实现。Java `NativeGomokuAI` 每次决策通过单次 JNI 调用传棋盘和禁点，返回落点、评分、完成深度与节点数；原 Java 搜索保留为本机库加载或调用失败时的兼容回退，网页 Worker 仍是上层回退。棋盘状态、技能处理、落子动画和棋谱仍由网页逻辑负责。
- C++ 实现沿用现有大师搜索策略：3^11 局部棋型统计、战术和开局候选、10 ply 强制威胁证明、最多 12 层迭代加深、Alpha-Beta、双 Zobrist 校验置换表、killer/history 着法排序、战术叶评估与 1.1 秒搜索预算。预算是搜索上限，不代表所有设备的实际响应时长；JNI 返回完成深度和节点数，Java 桥接另外记录本次决策总耗时，供后续实机测量。
- `build_apk.js` 在完整 APK 构建时调用 SDK 内的 NDK Clang 编译四种 ABI，将 `.so` 加入 APK；`--sync-only` 不编译原生库。用户收到新 C++ 引擎必须安装完整 APK，更新网页文件或单文件版不会更新 JNI/C++ 实现。
- 2026-10-19 本地完整 APK 构建成功，当前 `五子棋.apk` 已包含四种 ABI 的 `libgomoku_ai.so`（arm64-v8a、armeabi-v7a、x86、x86_64）。这证明原生库已进入本地 APK；尚未在 MuMu/真机确认实际决策走 C++ 路径，也未测量设备落子耗时或做棋力对照。Java 和网页 Worker 回退仍然存在。

## 2026-10-19 手机棋台放大与 v1.0.147 本地构建

- 当前 `version.json` 为 `1.0.147` / `versionCode=148`。手机对局画布占满可用屏幕宽度，仍使用原有云石棋台素材并整体放大（`PHONE_BOARD_ZOOM=1.51`，垂直偏移 `0.063`）；外围素材随画布裁切。手机网格在画布内缩进 `3.5%`，网格、星位、棋子和触摸命中共用棋盘坐标。桌面网页使用较大的对局画布；Android 保留触控优先的手机布局。实现位置：`js/app.js`、`js/sky-island.css`。
- 本地构建产物：根目录 APK `五子棋.apk`（4,194,703 bytes，SHA-256 `F79FC0166EFE89D7CC7B352A844B3577ECE64B867E725F30F6A46DC54980F9B5`），单文件版 `五子棋大师_单文件版.html`（13,069,341 bytes，SHA-256 `C29BEA7A9D7A5DC8B964F41A528B97593C5E32F9A6C24B6777DED7BDD5E3D62E`）；`official-site/play/index.html` 已由构建脚本生成。APK 静态检查确认四种 ABI 原生库均在包内。
- 本地构建不等于设备验收：当前没有 MuMu/真机安装和界面实测，也没有双端联网验收。此工作区快照未执行 GitHub 发布或 ECS 部署；不要把本地版本号或 APK 当作线上已更新。
- **交接时工作区快照（2026-10-19）：**分支 `master`，HEAD `6b4db60`，相对 `origin/master` 落后 2 个提交；存在多处既有未提交源码、Android、后端、官网和生成物改动，`PROJECT_HANDOVER.md` 在本次更新前也已处于修改状态。接手先重新运行 `git status --short --branch` 和 `git diff`，逐项识别来源；不要 `git clean`、整批暂存或直接覆盖/重建用户产物。官网 `official-site/play/` 是构建产物，不要手改。只有确认文件无用时才按项目要求移入 `D:\回收站`。

## 2026-10-19 本地审查修复候选

- 后续审查修复了旧登录凭据迁移/轮换、并发验证返回旧令牌、终局房间重连、退出后的异步重连接管、半开中继失效、重开事务防重入，以及 Android 启动图片失败时无法自动退出等问题；细节和验证边界见 `REVIEW_20261019.md`。
- 登录回归现在用内存 SQLite 执行真实 SQL，覆盖并发、撤销、跨设备和旧凭据不可复活。新增终局重连与半开连接回归；Android 启动与 AI 路由测试已适配当前实现。
- 本轮保留 `1.0.147 / Build 148` 版号，重新同步本地 APK、单文件 HTML 和官网游戏副本，因此上节记录的构建摘要属于修复前产物。当前摘要以审查记录为准；没有执行设备安装、GitHub 发布或 ECS/Cloudflare 部署。

## 2026-10-19 人机计算效率优化候选

- 后续已优化 C++ 增量棋型、棋线评分缓存和候选容器，加入进入人机后的串行预热、Java 回退大表惰性初始化，并移除普通人机回合固定 80 ms 等待。搜索预算、评分、候选范围和深度保留。
- 主机 `-O3` 固定工作量对照为约 1.98 倍计算速度，22 个局面/526 个状态快照及固定深度结果一致；这不是手机端落子延迟或全局棋力保证。验证细节、复现方法和最新本地产物摘要以 `AI_PERFORMANCE_20261019.md` 为准，`REVIEW_20261019.md` 的产物摘要属于性能优化前候选。
- 新桥回传引擎标记 `cpp`/`java`，网页统计另含 `worker`/`js-fallback`/`native-unknown`，可读取 `window.gomokuLastAiStats` 的 `engine`、`searchMs`、`queueMs` 和 `roundTripMs` 区分实际搜索路径和等待。旧桥仍兼容。
- 已重新生成正式签名本地 APK（仍为 Build 148）、单文件和官网副本；没有安装设备或发布线上。需要完整 APK 才能交付原生优化，不能只做网页热更新。

## 2026-10-19 恢复 Android 原生底包版本校验与完整 APK 更新引导

- 修复了在网页热更新检查中未核验 Android 原生底包版本（`MainActivity.getAppVersionCode()`）导致原生 C++ AI 引擎与启动纹理无法自动提示覆盖安装的问题。
- 设定原生底包门槛 `MINIMUM_APK_BUILD_FOR_NATIVE_AI_ENGINE = 148`；当 Android 原生底包 Build < 148 时：
  - 检查更新弹窗与角标明确提示“需要安装完整 APK”（📦），并详细说明数据与存档会完整保留。
  - “小流量免安装更新”自动切换为直接下载并调用系统安装器覆盖安装完整 APK，避免在底层缺失 C++ 原生库的情况下重复应用网页热更新。
- 新增单元回归测试 `tests/apk_version_check_regression.js`，已注册到 `publish.js`。

## 本机正式发布入口

在仓库根目录运行 `node release_official.js`。入口先运行 `publish.js` 完成现有本地校验、构建、Git 推送和 GitHub Release；它会为该子进程明确设置 `GOMOKU_DEPLOY_CLOUDFLARE=0`、`GOMOKU_SKIP_VERSION_BUMP=0`、`GOMOKU_ALLOW_RELEASE_OVERWRITE=0`，随后只部署 Cloudflare Pages 项目 `gomoku-home` 的 `master` 分支。

Pages 成功后，入口并行读取 GitHub Release 附件 digest、官网 `/api/site-version`、`/download/apk` 实际文件及 `/play/js/app.min.js` 字节。全部通过时会立即输出 `LIVE_VERIFIED`、tag、Build 和下载地址；随后生成 `report.md`。每阶段的开始、结束、耗时和退出码，以及发布快照和验收 JSON，保存在 `.codex-diagnostics/official-release/<run-id>/`。匿名 HTTP 请求使用 Mozilla User-Agent 和明确超时；ECS 接口仅在标准 HTTPS 证书校验下完成时纳入验收，否则报告未自动验收边界。若从 `ANDROID_SDK_ROOT`/`ANDROID_HOME` 和 `PATH` 能安全定位 Android SDK 工具，会校验 APK 的签名证书 SHA-256 是否为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`，并检查 16 KiB 对齐；工具不可用时报告会明确写明未检查，不会将其表述为通过。

若 Pages 部署或线上验收失败，但 `publish.js` 已成功，可用 `node release_official.js --resume ".codex-diagnostics/official-release/<run-id>"` 继续。恢复目录必须是项目内该诊断目录的直接子目录；入口会核对 `version.json`、APK、单文件 HTML 及整个 `official-site/` 目录指纹，只有与成功 publish 时完全一致才会跳过 publish。之前 Pages 部署失败时会重试部署；之前 Pages 已成功但线上验收失败时，只重试验收，不重复部署。`publish.js` 失败或快照未能保存的 run 不能恢复；先检查该目录、Git 分支及 GitHub Release，人工确认当前版本后再决定下一步，入口不会自动重跑或再次递增版本。`node release_official.js --help` 只显示用法，不触碰发布环境。
