# Bug 修复与性能审查候选（2026-11-08）

这是 v1.0.154 发布前的本地候选记录。正式 APK 与线上验收结果见 [项目交接手册](PROJECT_HANDOVER.md)。

## 已确认的修复

- **联机恢复：**完整保留上轮 `js/online.js` / `index.html` 会话修复，处理断连恢复、pending join 退出和旧异步状态；本轮 `js/online.js` 在准备加入房间时取消旧 AI 任务。`js/app.js` 则在普通离房前通知语音模块停止会话；没有改后端。
- **语音生命周期：**`js/voice.js` 修复 hello 互答风暴、客方先开时的协商会话不一致、权限/SDP/ICE 迟到回调、重复申请媒体和离房后仍占用麦克风；权限策略禁用时显示明确环境提示。hello 双端 VM 场景从 40 轮未收敛、至少 82 条消息，收敛到 2 轮 4 条。未降低网络重试或媒体质量。
- **社交切号：**`js/social.js` 修复旧账号好友列表请求阻止新账号刷新，以及旧 ticket 在切号后仍创建 WebSocket。源 fixture 基线 B 好友请求为 0、创建旧/新 socket 共 2 个；候选 B 请求为 1、仅创建当前账号 socket 1 个。

## 性能与验证证据

- 冷启动 profile 仅作基线：4× CPU 限速、390×844 viewport，首绘 211.8 ms、棋盘 ready 3327 ms、交互标记 3730 ms；交互时间包含既有约 3.6 秒启动动画。采样条目的 `self_ms` 由样本数乘 0.1 ms 估算，不是精确 CPU 耗时。本轮没有据此声称启动提速，也没有改动画或画质。
- **AI 旧任务排队 A/B：**同一六子局面在生产 `resetBoardOnly()` 搜索中取消并重发同位置 Worker 请求。桌面 Windows UA、3200 ms 预算时，第二次等待 6330→3229 ms（49%）；移动 Android UA 仿真、1800 ms 预算时 3525→1827 ms（48.2%）。两端选择均为 (6,6)，最终深度分别为 6/5；旧请求立即标记过期，空闲重开保留 Worker。每场景单次对照，不是中位数；移动数据来自桌面 Chromium UA 仿真，不是真机。本轮未改变搜索预算、评分/排序或剪枝，因此只说明过期任务不再排队，不说明普通单次思考或 FPS 提速。取消 token 贯穿原生/Worker/资源 fallback，并隔离旧 Worker 回调、悔棋/重开恢复与入房取消。数据见 `core-ai-worker-reset-ab.json` 和原始输出 `core-ai-worker-reset-ab.log`。
- 社交新竞态专项回归通过；`tests/social_frontend_smoke.py` 源码模式通过 19 项检查、0 page errors（82 API calls，17.42 秒）。详情与输出见 `.codex-diagnostics/audit-performance-20261108/lifecycle-report.md` 和 `lifecycle-social-*.log`。
- 语音 VM 生命周期回归 12/12；现有 voice smoke 与双端浏览器 RTC 场景通过。双端使用 Chromium 原生 `RTCPeerConnection` 和虚拟音频采集，信令 API/房间中继为本地 mock；先后启用、反向方向、重启与离房均通过，双方零 console/page errors。证据：`.codex-diagnostics/audit-performance-20261108/online-audit-report.md`、`voice-dual-peer-browser-smoke.json`、`online-voice-after.log`。
- 后端 `worker`、`social worker` 和 match SQLite 三项既有回归通过；本轮后端源码未改。日志：`.codex-diagnostics/audit-performance-20261108/backend-worker-unit.log`、`backend-social-worker-unit.log`、`backend-match-sqlite.log`。
- 8 项 Node 回归通过，覆盖更新、版本、预言、鉴权、联机一致性/终局/活动和语音；日志见 `.codex-diagnostics/audit-performance-20261108/regression-*.log`。
- AI 取消/懒 fallback/旧 Worker/入房专项 smoke 通过，AI strength 17 项通过，AI hot-path 23,832 行检查通过；AI 颜色 metadata 修正已完成，不影响性能 A/B 数字。详情见 `core-audit-report.md` 与同目录 `core-ai-*-smoke.log`。
- 生成后组合验收 6 项均 exit 0：canvas frame、AI Worker（入口与 HTTP 单文件）、social frontend（默认真实 `social.min.js`）、online match race、game checkpoint skills、replay；另有独立 file:// 单文件离线回归 exit 0。结果见 `validation-browser-tests.json` 与 `validation-browser-logs/`。离线场景确认启动跳过、进入棋盘和落子后 history=1；网络请求均被拦截且没有完成请求，page errors 和非预期 console errors 均为空。唯一资源错误来自预期主动拦截的 `/api/network/probe`。

## 交付边界

- 当前候选源码冻结：`js/app.js` `32F05FD4D0A0847A6FF564DC6712A73BB7EA2DC554163AE1A4C42F8BD5804420`；`js/online.js` `FD521A28EDC9308A8F129EE1C50857AE34809CA6755AB7CD6D815A612B87D6B4`；`js/social.js` `8F2CD9EF6D4002E9CF4E7924D88FAC5BFCD70A7071768EC55C8CDFE598B4B689`；`js/voice.js` `32277514AB65712DD1529FBB7E2A957A082819932264136AAF77E02926D02621`。本地生成资源 fingerprint `41c2770a077b4332db6cfbed5336fa6a9eafffda38417217c5025a7388ffb619` 已核对一致；压缩只执行一次，单文件构建和 Android 资源 `--sync-only` 复用了同一输入，官网资源指纹保持不变。未改 `RELEASE_NOTES` 或版本。
- 版本仍为 v1.0.153 / Android Build 154；未发布、未完整重建 APK。Android 当前未声明 RECORD_AUDIO 且拒绝网页媒体权限；本轮只检查并提示环境不可用，没有实现或宣称 Android 语音支持。
- 未做真实账号、生产房间/数据库、真机麦克风/语音质量或实体 Android 验收。双端语音浏览器验收使用虚拟采集设备与 mock 信令/中继。
- 本轮临时审计 HTTP 服务已停止，检查端口无遗留监听。
