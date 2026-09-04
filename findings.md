# 管理员工具升级发现

- 当前工具文件为 `admin.js`，通过 Cloudflare D1 REST API 执行管理操作。
- 现有命令：`users`、`user`、`set-pwd`、`sql`。
- `users` 当前查询并显示 `avatar`、`security_q`，输出容易过宽并被终端截断。
- `user` 当前使用 `SELECT *`，会显示 `password_hash` 前缀和完整 `salt`，不应继续输出。
- `set-pwd` 当前使用旧版 SHA-256 + salt + pepper，并把新密码直接打印出来；服务器已支持 PBKDF2，并保留旧 SHA-256 登录兼容升级逻辑。
- `sql` 当前可以直接执行任意 SQL，存在误写风险。
- `.cloudflare_config.json` 是本地未跟踪配置，管理员工具需要继续读取它，但不能把 token 输出到日志或提交到仓库。

## AI 升级发现

- 主网页 `index.html` 内嵌了 AI，当前 `smartAiMove` 固定让 AI 执白；它依赖 10 步 VCF、6 步 VCT 和 3 层 Alpha-Beta。
- 当前内嵌 Alpha-Beta 的叶节点主要按位置权重评估，没有完整棋型评估和置换表；VCT 只检查少量防守点，不能稳定覆盖全部强制应手。
- `js/ai.js` 和 `android_src/assets/js/ai.js` 是旧版模块，主网页未加载它们；Android `index.html` 与主网页同源，单文件版由 `bundle_single_file.js` 从主网页生成。
- AI 引擎需要继续支持 `enableFoul` 和技能触发的 `forbiddenPoints`，并限制搜索时间，避免移动端卡顿。

## AI 升级结果

- `js/ai.js` 已改为统一大师级引擎：棋型评估、直接胜负判断、双重威胁检测、Alpha-Beta、迭代加深、候选点排序、置换表和单步时间预算。
- 主页面通过 `window.GomokuAI` 接入新引擎；`android_src/assets` 与单文件版已同步生成。
- 已保留禁止落点参数，并在引擎内部避免明显黑棋禁手点；空棋盘优先落中心。
- 通过 Node 棋力用例、HTML 脚本语法检查，以及主页面/单文件版 Playwright 实际落子测试。
- v1.0.86 / Build 87 已完成 APK 与单文件构建，GitHub `master` 已推送，Release 已上传 `gomoku.apk` 与 `gomoku.html`，Cloudflare Worker 与 Pages 已部署。
- 发布脚本、`version.json`、Worker 与 Pages Worker 的 AI 更新文案已同步为实际新引擎能力。

## Android 首屏启动优化

- 原因确认：`MainActivity` 先显示蓝色 WebView 背景，页面 head 同步加载 PeerJS、MQTT、音频 Base64、头像 Base64 和 AI，冷启动首屏被大量非必要资源阻塞。
- 处理结果：网络库、音频和头像改为 `defer`；账号会话、头像初始化和历史统计移到首帧后；单文件版的非首屏内联资源也延迟执行；Android 关闭不必要的离屏预栅格化并降低蓝屏视觉等待感。
- 验证结果：主页面和单文件版均能正常加载，新 AI 可用且实际应手；本地 Playwright 测得 DOMContentLoaded 约 495～581ms。
- 注意：这次优化尚未进入已安装的 v1.0.86 APK，必须下一次打包安装后才会在手机生效。
