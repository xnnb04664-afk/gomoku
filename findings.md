# Findings

## Local code

- `index.html` 的当前主联机流程使用 MQTT 房间信道；`js/network.js` 是独立的 PeerJS DataChannel 管理器，但主页面未直接使用它。
- 当前版本已具备 MQTT 多节点连接兜底。
- P2P 需要信令服务器完成握手；仅配置 STUN 无法覆盖中国移动网络、对称 NAT 和受限网络。

## Intended design

- 连接顺序：PeerJS/WebRTC 直连 → TURN 中继 → MQTT 中继。
- 维持现有消息格式，减少棋局、聊天、悔棋等功能改动。
