# 审查发现

## 当前项目形态

- 前端是静态 HTML/JS，包含 PeerJS WebRTC P2P，失败时回退到公开 MQTT Broker。
- 云端后端是 Cloudflare Worker `gomoku-backend`，绑定 D1 `gomoku-db`；本地还有一个 Node 静态文件服务器。
- 已发现在线 API 地址写死在前端：`https://gomoku-backend.xnnb04664.workers.dev`。
- 资源枚举结果（来自此前只读 Cloudflare 查询）：1 个 zone、2 个 Worker、1 个 D1、1 个 KV（`VPN`），无 Pages 项目；R2 返回 403。

## 初步关注点

- Worker CORS 当前疑似允许任意来源（需结合完整代码确认）。
- 用户登录令牌存入浏览器 `localStorage`，需评估 XSS/令牌生命周期风险。
- 对局通信使用公开 MQTT Broker，需确认 topic 随机性、消息认证和隐私边界。

## 已确认的高风险点

- `.cloudflare_config.json` 明文保存 Cloudflare 部署令牌；该文件当前位于项目目录，需确认是否被 Git 跟踪，并立即轮换已暴露令牌。
- `backend/worker.js` 将用户会话 token 原文存入 D1，并在 JSON 响应中返回；前端再写入 `localStorage`。
- `/api/report_game` 只验证 uid + token + 15 秒间隔，客户端可自行提交 `isWin`，没有服务端对局状态、对手确认或签名回放校验。
- `uid` 使用 `Math.random()` 生成 6 位字符串，理论上会碰撞；注册未见重试/唯一冲突处理。
- 登录和找回密码按账号累计失败次数，但未见 IP/设备级限速；`/api/auth/get_security_q` 对不存在账号返回不同消息，存在账号枚举风险。
- Worker 在每次请求中执行建表/逐列迁移检查，增加请求延迟，并可能产生并发迁移竞态。
- CORS 为 `*`，同时允许 `Authorization`；对公开读取接口方便，但对带身份的跨域 API 边界较宽。
- P2P 信令和兜底数据使用公开 MQTT 主题，房间码仅 6 位；消息没有额外鉴权/加密，知道房间码即可尝试订阅/注入。

## 测试结果

- `check_inline_syntax.js` 当前复跑通过：6 个 HTML 文件的内联脚本语法检查通过。
- 本地浏览器页面可加载，标题、PeerJS、MQTT 和联机按钮存在。
- 现有联机冒烟测试第一次遇到 Windows GBK 输出表情导致的 `UnicodeEncodeError`，改用 UTF-8 后继续执行。
- 浏览器曾报告 `Unexpected token '}'` 与 `openOnlineModal is not defined`；需用带 URL/行号的自定义监听复现确认是否为缓存或动态脚本问题。
- 现有测试访问两个公开 MQTT Broker 时均被当前沙箱拦截，不能作为线上可用性结论。
