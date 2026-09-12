/**
 * 🎮 五子棋 Cloudflare Worker 专属高安全对战与账号中枢 (Security Hardened v4.0)
 * 🛡️ 全面防御黑客攻击矩阵：
 * 1. 【文件上传/XSS防御】头像严格正则白名单，彻底封杀 SVG/脚本，限死 14KB
 * 2. 【安全找回密码】密保答案 SHA-256 加盐哈希，答错 3 次锁定 10 分钟
 * 3. 【防暴力破解】连续输错密码 5 次强制冷冻锁定 5 分钟
 * 4. 【防冒名改分】对局上报强制校验 192-bit 安全 Token 身份凭证
 * 5. 【防脚本刷分】对局上报强制 15 秒物理结算冷却
 * 6. 【防 SQL 注入】所有查询全部采用参数化绑定（Prepared Statements）
 */

let isDbInitialized = false;
let dbInitializationPromise = null;
let cachedLeaderboard = null;
let lastLeaderboardTime = 0;
let leaderboardQueryPromise = null;
let lastMatchQueueCleanupAt = 0;
let privateReleaseCache = null;
let privateReleasePromise = null;
const PASSWORD_PBKDF2_ITERATIONS = 100000;
const LEADERBOARD_CACHE_TTL_MS = 15000;
const MAX_LEADERBOARD_AVATAR_CHARS = 300;
const PRIVATE_RELEASE_CACHE_TTL_MS = 30000;
const GITHUB_REQUEST_TIMEOUT_MS = 8000;
const MAX_JSON_BODY_BYTES = 512 * 1024;
const MAX_UPDATE_ASSET_BYTES = 8 * 1024 * 1024;
const AUTH_SESSION_TTL_MS = 365 * 24 * 3600 * 1000;
const REFRESH_TOKEN_BYTES = 32;

// 私有仓库更新中转：GitHub 凭据只通过 Worker Secret 注入，绝不下发到客户端。
const UPDATE_REPOSITORY = 'xnnb04664-afk/gomoku';
const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const UPDATE_TICKET_TTL_SECONDS = 90;
const UPDATE_CLIENT_HEADER = 'X-Gomoku-Client';
const UPDATE_CLIENT_VALUE = 'gomoku-app-client-v2';
const UPDATE_TICKET_HEADER = 'X-Gomoku-Update-Ticket';
const TURN_CREDENTIAL_TTL_SECONDS = 3600;
const TURN_REQUEST_TIMEOUT_MS = 7000;
const TURN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const TURN_RATE_LIMIT_MAX_REQUESTS = 30;
const TURN_API_ORIGIN = 'https://rtc.live.cloudflare.com';
const turnRateLimitBuckets = new Map();
const ROOM_RELAY_MAX_PAYLOAD_BYTES = 64 * 1024;
const ROOM_RELAY_MAX_MESSAGES_PER_SECOND = 120;
const ROOM_RELAY_BOOTSTRAP_QUEUE_LIMIT = 4;
const SOCIAL_TICKET_TTL_MS = 60 * 1000;
const SOCIAL_INVITE_TTL_MS = 2 * 60 * 1000;
const SOCIAL_MAX_FRIENDS = 200;
const SOCIAL_MAX_MESSAGE_CHARS = 500;
const SOCIAL_MAX_PAGE_SIZE = 50;
// 社交轻量经济数据：签到奖励只作为可消费的客户端展示余额，不影响积分榜。
// 上限和增量都在服务端固定，客户端不能提交金币数量或签到日期。
const CHECKIN_BASE_COINS = 10;
const CHECKIN_STREAK_BONUS = 2;
const CHECKIN_STREAK_CAP = 7;
const SOCIAL_AFFINITY_MAX_POINTS = 10000;
// 付费货币只保留服务端账本模型。当前没有接入支付渠道，因此默认关闭；
// 只有部署到明确的沙盒环境时才允许创建 sandbox_pending 订单，任何模式都
// 不会因为客户端请求直接增加 diamonds。正式支付回调接入前不要新增“模拟到账”接口。
const PREMIUM_CURRENCY = 'diamonds';
const PREMIUM_DEFAULT_PAYMENT_MODE = 'disabled';
const PREMIUM_PRODUCTS = Object.freeze([
  Object.freeze({ id: 'diamonds_60', diamonds: 60, priceCents: 600, name: '60 钻石' }),
  Object.freeze({ id: 'diamonds_300', diamonds: 300, priceCents: 3000, name: '300 钻石' }),
  Object.freeze({ id: 'diamonds_680', diamonds: 680, priceCents: 6800, name: '680 钻石' })
]);
const GAME_LAYOUT_DEFAULT_ORDER = Object.freeze([
  'friends', 'recent', 'rank', 'bag', 'tasks', 'achievements', 'activity', 'settings'
]);
const socialRateLimitBuckets = new Map();

// 官网与游戏 API 分属不同的 Cloudflare Pages 项目。只信任官网项目的
// 稳定域名及其部署预览域，避免把 CORS/WebSocket 房间中继开放给任意站点。
function isTrustedOfficialSiteOrigin(origin) {
  try {
    const parsed = new URL(String(origin || ''));
    // Origin is a serialized origin, never a URL with a path/query/fragment.
    // Requiring the canonical serialization also rejects hand-crafted values
    // such as `https://gomoku-home.pages.dev/evil`.
    if (parsed.origin !== String(origin) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    return parsed.hostname === 'gomoku-home.pages.dev' || parsed.hostname.endsWith('.gomoku-home.pages.dev');
  } catch (_) {
    return false;
  }
}

// Browser clients are either the official site, the API's own origin, or a
// local/native build. Native WebViews commonly send `Origin: null` (and some
// older clients omit Origin entirely), so those values remain intentionally
// compatible. This helper is shared by HTTP and WebSocket entry points.
function isAllowedClientOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const parsed = new URL(String(origin));
    if (parsed.origin !== String(origin)) return false;
    const local = parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
    return local || origin === 'https://gomoku-api.pages.dev' || isTrustedOfficialSiteOrigin(origin);
  } catch (_) {
    return false;
  }
}

function roomRelayByteLength(value) {
  try {
    return new TextEncoder().encode(String(value)).byteLength;
  } catch (_) {
    return String(value).length;
  }
}

function roomRelaySafeId(value, maxLength = 96) {
  const text = String(value || '');
  return text.length > 0 && text.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}

// 自有房间中继：只承担可靠信令/兜底转发，棋局仍由双方 P2P 优先传输，
// 房主作为当前回合状态的权威端。Durable Object 让同一房间的两条 WebSocket
// 始终落到同一个有序实例，避免公共 MQTT 节点不可用或跨节点串房。
export class GomokuRoom {
  constructor(state) {
    this.state = state;
    this.roomCode = '';
    this.roomSessionId = '';
    this.joinTicket = '';
    this.host = null;
    this.client = null;
    this.pendingBootstrap = [];
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomCode = String(url.searchParams.get('room') || '');
    const role = String(url.searchParams.get('role') || '');
    const requestedSessionId = String(url.searchParams.get('session') || '');
    const requestedJoinTicket = String(url.searchParams.get('ticket') || '');
    if (!/^\d{6}$/.test(roomCode) || !['host', 'client'].includes(role)) {
      return new Response('Invalid room relay parameters', { status: 400 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (role === 'host' && (!roomRelaySafeId(requestedSessionId) || !roomRelaySafeId(requestedJoinTicket))) {
      return new Response('Host session credentials required', { status: 401 });
    }
    if (requestedSessionId && !roomRelaySafeId(requestedSessionId)) {
      return new Response('Invalid room session', { status: 400 });
    }

    if (!this.roomCode) this.roomCode = roomCode;
    if (this.roomCode !== roomCode) return new Response('Room mismatch', { status: 409 });

    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];
    serverSocket.accept();

    const connection = {
      socket: serverSocket,
      role,
      sessionId: requestedSessionId,
      joinTicket: requestedJoinTicket,
      messageCount: 0,
      messageWindowAt: Date.now(),
      closed: false
    };

    if (role === 'host') {
      const sameHost = this.host && this.host.sessionId === requestedSessionId && this.joinTicket === requestedJoinTicket;
      if (this.host && !sameHost) {
        // 同一短房间码重新开局时，旧房间的客方也必须一起失效，防止旧局报文串入。
        this._closeConnection(this.host, false);
        this._closeConnection(this.client, true);
        this.host = null;
        this.client = null;
        this.pendingBootstrap = [];
      } else if (this.host) {
        this._closeConnection(this.host, false);
        this.host = null;
      }
      this.roomSessionId = requestedSessionId;
      this.joinTicket = requestedJoinTicket;
      this.host = connection;
    } else {
      if (this.client) {
        const sameClientSession = !requestedSessionId || !this.client.sessionId || this.client.sessionId === requestedSessionId;
        this._closeConnection(this.client, false);
        this.client = null;
        if (!sameClientSession) this.pendingBootstrap = [];
      }
      connection.sessionId = this.roomSessionId || requestedSessionId;
      this.client = connection;
    }

    const onMessage = event => this._onMessage(connection, event.data);
    const onClose = () => this._onClose(connection);
    const onError = () => this._onClose(connection);
    serverSocket.addEventListener('message', onMessage);
    serverSocket.addEventListener('close', onClose);
    serverSocket.addEventListener('error', onError);
    connection.cleanup = () => {
      try { serverSocket.removeEventListener('message', onMessage); } catch (_) {}
      try { serverSocket.removeEventListener('close', onClose); } catch (_) {}
      try { serverSocket.removeEventListener('error', onError); } catch (_) {}
    };

    this._send(connection, {
      type: 'relay_ready',
      role,
      room: this.roomCode,
      sessionId: this.roomSessionId || requestedSessionId
    });
    if (role === 'host') this._flushBootstrapQueue();
    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  _send(connection, payload) {
    if (!connection || connection.closed || !connection.socket) return false;
    try {
      connection.socket.send(JSON.stringify(payload));
      return true;
    } catch (_) {
      this._onClose(connection);
      return false;
    }
  }

  _closeConnection(connection, notifyPeer = true) {
    if (!connection || connection.closed) return;
    connection.closed = true;
    if (typeof connection.cleanup === 'function') connection.cleanup();
    if (notifyPeer) {
      const peer = connection.role === 'host' ? this.client : this.host;
      this._send(peer, { type: 'relay_peer_left', role: connection.role });
    }
    try { connection.socket.close(1000, 'room connection replaced'); } catch (_) {}
  }

  _onClose(connection) {
    if (!connection || connection.closed) return;
    connection.closed = true;
    if (typeof connection.cleanup === 'function') connection.cleanup();
    if (this.host === connection) this.host = null;
    if (this.client === connection) this.client = null;
    const peer = connection.role === 'host' ? this.client : this.host;
    this._send(peer, { type: 'relay_peer_left', role: connection.role });
  }

  _consumeBudget(connection) {
    const now = Date.now();
    if (now - connection.messageWindowAt >= 1000) {
      connection.messageWindowAt = now;
      connection.messageCount = 0;
    }
    connection.messageCount += 1;
    if (connection.messageCount > ROOM_RELAY_MAX_MESSAGES_PER_SECOND) {
      this._closeConnection(connection, true);
      return false;
    }
    return true;
  }

  _topicDirectionAllowed(connection, topic, payloadObject) {
    const v3Root = `gomoku/v3/${this.roomCode}/`;
    const v4Root = this.roomSessionId ? `gomoku/v4/${this.roomCode}/${this.roomSessionId}/` : '';
    const outboundTopic = connection.role === 'host' ? `${v3Root}h2c` : `${v3Root}c2h`;
    const secureOutboundTopic = connection.role === 'host' ? `${v4Root}h2c` : `${v4Root}c2h`;
    const signalTopic = v4Root ? `${v4Root}p2p_speed_sig` : '';
    const isBootstrap = topic === outboundTopic;
    const isSecureData = topic === secureOutboundTopic;
    const isSecureSignal = topic === signalTopic;
    if (!isBootstrap && !isSecureData && !isSecureSignal) return false;

    if (isBootstrap) {
      const allowedBootstrapTypes = connection.role === 'client'
        ? new Set(['join_request', 'join_ready', 'reconnect_handshake'])
        : new Set(['join_accepted', 'join_confirmed', 'room_full']);
      if (!allowedBootstrapTypes.has(payloadObject?.type)) return false;
      if (payloadObject.sessionId && payloadObject.sessionId !== this.roomSessionId) return false;
      if (payloadObject.joinTicket && payloadObject.joinTicket !== this.joinTicket) return false;
      return true;
    }

    if (isSecureSignal) {
      // P2P 信令里的 sessionId 是 WebRTC offer/answer 的 p2p 会话 ID，
      // 与房间业务 envelope 的 room sessionId 不同；hello 初始包可以没有它。
      return payloadObject.sender === connection.role &&
        (!payloadObject.sessionId || roomRelaySafeId(payloadObject.sessionId));
    }
    if (payloadObject.sessionId !== this.roomSessionId) return false;
    // v4 业务通道只服务新客户端，必须由服务端确认发送角色；缺少角色的
    // 旧格式只能留在 v3 bootstrap 兼容通道，不能直接注入正式对局消息。
    return payloadObject.senderRole === connection.role;
  }

  _forward(connection, topic, payload) {
    const peer = connection.role === 'host' ? this.client : this.host;
    if (peer && !peer.closed) {
      this._send(peer, { type: 'message', topic, payload });
      return true;
    }
    return false;
  }

  _flushBootstrapQueue() {
    if (!this.host || this.host.closed || !this.pendingBootstrap.length) return;
    const pending = this.pendingBootstrap.splice(0, ROOM_RELAY_BOOTSTRAP_QUEUE_LIMIT);
    for (const item of pending) this._send(this.host, { type: 'message', topic: item.topic, payload: item.payload });
  }

  _onMessage(connection, rawMessage) {
    if (!this._consumeBudget(connection)) return;
    const raw = typeof rawMessage === 'string' ? rawMessage : '';
    if (!raw || roomRelayByteLength(raw) > ROOM_RELAY_MAX_PAYLOAD_BYTES) return;
    let message;
    try { message = JSON.parse(raw); } catch (_) { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'subscribe') return;
    if (message.type !== 'publish' || typeof message.topic !== 'string' || message.topic.length > 256) return;
    const topic = message.topic;
    const payload = typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload ?? '');
    if (roomRelayByteLength(payload) > ROOM_RELAY_MAX_PAYLOAD_BYTES) return;
    let payloadObject;
    try { payloadObject = JSON.parse(payload); } catch (_) { return; }
    if (!payloadObject || typeof payloadObject !== 'object' || Array.isArray(payloadObject)) return;
    if (!this._topicDirectionAllowed(connection, topic, payloadObject)) return;

    const forwarded = this._forward(connection, topic, payload);
    if (!forwarded && connection.role === 'client' && topic === `gomoku/v3/${this.roomCode}/c2h` &&
        payloadObject.type === 'join_request') {
      this.pendingBootstrap.push({ topic, payload });
      while (this.pendingBootstrap.length > ROOM_RELAY_BOOTSTRAP_QUEUE_LIMIT) this.pendingBootstrap.shift();
    }
  }
}

// 好友在线状态与实时事件独立于棋局房间。永久关系和消息仍以 D1 为准；
// Durable Object 只保留当前 WebSocket，并把“有新状态”推给账号的所有设备。
export class SocialHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.fallbackSockets = new Set();
  }

  _sockets() {
    if (typeof this.state.getWebSockets === 'function') return this.state.getWebSockets();
    return Array.from(this.fallbackSockets);
  }

  _sendAll(payload) {
    const text = JSON.stringify(payload);
    let sent = 0;
    for (const socket of this._sockets()) {
      try { socket.send(text); sent += 1; } catch (_) { this.fallbackSockets.delete(socket); }
    }
    return sent;
  }

  async _broadcastPresence(uid, online) {
    if (!this.env?.DB || !this.env?.GOMOKU_SOCIAL) return;
    try {
      const setting = await this.env.DB.prepare('SELECT presence_hidden FROM user_social_settings WHERE uid = ?').bind(uid).first();
      // 没有设置记录时采用数据库列的默认语义：在线状态可见。不能把
      // undefined 转成 NaN 后误判为隐身，否则新账号永远只广播“离线”。
      const visibleOnline = online && Number(setting?.presence_hidden || 0) === 0;
      const now = Date.now();
      // 在线快照落在 D1，好友列表一次 JOIN 即可返回 200 位好友状态，避免
      // 单次请求扇出访问最多 200 个 Durable Object 并触发子请求额度上限。
      await this.env.DB.prepare(`
        INSERT INTO user_social_settings (uid, presence_online, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET presence_online = excluded.presence_online, updated_at = excluded.updated_at
      `).bind(uid, online ? 1 : 0, now).run();
      const rows = await this.env.DB.prepare(`
        SELECT CASE WHEN user_a_uid = ? THEN user_b_uid ELSE user_a_uid END AS friend_uid
        FROM friendships WHERE user_a_uid = ? OR user_b_uid = ? LIMIT ${SOCIAL_MAX_FRIENDS}
      `).bind(uid, uid, uid).all();
      await Promise.all((rows.results || []).map(async row => {
        const friendUid = String(row.friend_uid || '');
        if (!friendUid) return;
        const id = this.env.GOMOKU_SOCIAL.idFromName(`social:${friendUid}`);
        await this.env.GOMOKU_SOCIAL.get(id).fetch('https://social.internal/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gomoku-Social-Uid': friendUid },
          body: JSON.stringify({ kind: 'presence', uid, online: visibleOnline, at: now })
        });
      }));
    } catch (_) {}
  }

  async fetch(request) {
    const url = new URL(request.url);
    const uid = String(request.headers.get('X-Gomoku-Social-Uid') || '').trim();
    if (!uid || uid.length > 64) return new Response('Unauthorized', { status: 401 });

    const requestOrigin = request.headers.get('Origin') || '';
    if (!isAllowedClientOrigin(requestOrigin)) {
      return new Response('Untrusted origin', { status: 403 });
    }

    if (url.pathname === '/presence') {
      return Response.json({ online: this._sockets().length > 0 });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      let event = null;
      try { event = await request.json(); } catch (_) {}
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return new Response('Invalid event', { status: 400 });
      }
      const sent = this._sendAll({ type: 'social_event', event });
      return Response.json({ ok: true, sent });
    }

    if (url.pathname !== '/socket' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (typeof this.state.acceptWebSocket === 'function') {
      this.state.acceptWebSocket(server, [uid]);
    } else {
      server.accept();
      this.fallbackSockets.add(server);
      const remove = () => {
        this.fallbackSockets.delete(server);
        if (this.fallbackSockets.size === 0) void this._broadcastPresence(uid, false);
      };
      server.addEventListener('close', remove);
      server.addEventListener('error', remove);
      server.addEventListener('message', event => this._handleSocketMessage(server, event.data));
    }
    try { server.send(JSON.stringify({ type: 'social_ready', uid })); } catch (_) {}
    this.state.waitUntil(this._broadcastPresence(uid, true));
    return new Response(null, { status: 101, webSocket: client });
  }

  _handleSocketMessage(socket, raw) {
    let message = null;
    try { message = JSON.parse(typeof raw === 'string' ? raw : ''); } catch (_) {}
    if (message?.type === 'ping') {
      try { socket.send(JSON.stringify({ type: 'pong', sentAt: Number(message.sentAt) || Date.now() })); } catch (_) {}
    }
  }

  webSocketMessage(socket, raw) {
    this._handleSocketMessage(socket, raw);
  }

  _handleSocketGone(socket) {
    try {
      const tags = typeof this.state.getTags === 'function' ? this.state.getTags(socket) : [];
      const uid = String(tags?.[0] || '');
      const remaining = this._sockets().filter(candidate => candidate !== socket && candidate?.readyState !== 3).length;
      if (uid && remaining === 0) this.state.waitUntil(this._broadcastPresence(uid, false));
    } catch (_) {}
  }

  webSocketClose(socket) {
    this._handleSocketGone(socket);
  }
  webSocketError(socket) {
    this._handleSocketGone(socket);
    try { socket.close(1011, 'WebSocket error'); } catch (_) {}
  }
}

export default {
    async fetch(request, env) {
      const url = new URL(request.url);

      const corsHeaders = {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gomoku-Client, X-Gomoku-Update-Ticket',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=()',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'X-Permitted-Cross-Domain-Policies': 'none',
    };

    // 允许本地开发/Android 内嵌 localhost 与无 Origin 请求；拒绝任意第三方网页跨站调用。
    const requestOrigin = request.headers.get('Origin') || '';
    const originAllowed = isAllowedClientOrigin(requestOrigin);
    if (requestOrigin === 'null' || !requestOrigin) {
      corsHeaders['Access-Control-Allow-Origin'] = '*';
    } else if (originAllowed) {
      corsHeaders['Access-Control-Allow-Origin'] = requestOrigin;
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });

    // Authenticated API calls are bearer-token based, but an untrusted web page
    // must not be able to submit a simple cross-site request and mutate state.
    // CORS alone is not a CSRF boundary: browsers still send a request when the
    // response is not readable. Keep the explicit null/no-Origin allowance for
    // Android WebView, local file builds and native clients, while rejecting any
    // other web origin before it reaches a handler.
    if (url.pathname.startsWith('/api/') && requestOrigin && requestOrigin !== 'null' && !originAllowed) {
      return json({ code: 403, msg: '请求来源不受信任' }, 403);
    }

    if (url.pathname === '/api/network/probe' && request.method === 'GET') {
      return json({
        code: 0,
        data: {
          schema: 1,
          endpoint: url.hostname.includes('workers.dev') ? 'worker' : 'pages',
          colo: String(request.cf?.colo || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12),
          serverTime: Date.now()
        }
      });
    }

    // 自有 Durable Object 房间中继优先于公共 MQTT。它只转发经过房间/角色/会话
    // 校验的消息，不保存密码、账号或棋局历史；P2P 成功后大部分棋局流量仍不经过这里。
    if (url.pathname === '/api/room/socket') {
      if (request.method !== 'GET') return json({ code: 405, msg: '仅支持 WebSocket GET' }, 405);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return json({ code: 426, msg: '需要 WebSocket 升级' }, 426);
      }
      if (requestOrigin && requestOrigin !== 'null' && !originAllowed) {
        return json({ code: 403, msg: '房间中继来源不受信任' }, 403);
      }
      if (!env.GOMOKU_ROOMS) return json({ code: 503, msg: '房间中继尚未部署' }, 503);
      const roomCode = String(url.searchParams.get('room') || '');
      if (!/^\d{6}$/.test(roomCode)) return json({ code: 400, msg: '房间码无效' }, 400);
      const roomId = env.GOMOKU_ROOMS.idFromName(`gomoku-room:${roomCode}`);
      return env.GOMOKU_ROOMS.get(roomId).fetch(request);
    }

    const publicServerError = (label, error) => {
      if (error && error.code === 'PAYLOAD_TOO_LARGE') {
        return json({ code: 413, msg: '请求数据过大' }, 413);
      }
      console.error(`[${label}]`, error?.stack || error?.message || error);
      return json({ code: 1, msg: `${label}，请稍后重试` }, 500);
    };

    // 同时限制 Content-Length 与分块请求的实际大小，避免大包绕过请求头限制。
    const readJsonBody = async (request) => {
      const declaredLength = Number(request.headers.get('content-length') || 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
        const error = new Error('request body too large');
        error.code = 'PAYLOAD_TOO_LARGE';
        throw error;
      }
      if (!request.body) return {};

      const reader = request.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (!part.value) continue;
        total += part.value.byteLength;
        if (total > MAX_JSON_BODY_BYTES) {
          try { await reader.cancel(); } catch (_) {}
          const error = new Error('request body too large');
          error.code = 'PAYLOAD_TOO_LARGE';
          throw error;
        }
        chunks.push(part.value);
      }

      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const raw = new TextDecoder().decode(bytes).trim();
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    };

    const fetchWithTimeout = async (resource, init = {}, timeoutMs = GITHUB_REQUEST_TIMEOUT_MS) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(resource, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    const leaderboardJson = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30'
      }
    });

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 512 * 1024) {
      return json({ code: 413, msg: '请求数据过大' }, 413);
    }

    // ── 🛡️ 安全工具箱 ─────────────────────────────────────
    function generateSecureHex(len = 24) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function generateRoomCode() {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      return String(100000 + (bytes[0] % 900000));
    }

    async function hashWithSalt(text, salt) {
      const enc = new TextEncoder();
      const combined = enc.encode(`${text}__GOMOKU_PEPPER_2026__${salt}`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 所有账号统一使用 PBKDF2；Cloudflare Workers 的 WebCrypto 运行时最多接受 100000 次迭代。
    async function hashPassword(text, salt) {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(text),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(`GOMOKU_PASSWORD_${salt}`), iterations: PASSWORD_PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key,
        256
      );
      return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function sanitizeText(str, maxLen = 12) {
      if (!str || typeof str !== 'string') return '';
      return str.trim().replace(/[<>'"`&]/g, '').slice(0, maxLen);
    }

    // 🛡️ 头像极严格安全校验与清洗（彻底粉碎任意文件上传漏洞与 SVG XSS）
    
    const RANDOM_AVATARS = ['🐱', '🐶', '🐼', '🦁', '🦊', '🐯', '🐰', '🐸', '🦄', '🌸', '👦', '👧', '🧙‍♂️', '🥷', '✨', '🐾', '🐻', '🐨', '🤖', '👑'];
    const NAME_PREFIXES = ['逍遥', '灵动', '疾风', '星月', '青云', '竹林', '傲雪', '听雨', '落樱', '幻影', '天元', '破晓', '悠然', '春风', '弈心', '无痕'];
    const NAME_SUFFIXES = ['棋仙', '弈客', '少侠', '神算', '隐士', '先锋', '棋圣', '奇才', '萌客', '棋王', '行者', '剑客'];

    function generateRandomNickname() {
      const pre = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
      const suf = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
      const num = Math.floor(10 + Math.random() * 90);
      return pre + suf + '_' + num;
    }

    function generateRandomAvatar() {
      return RANDOM_AVATARS[Math.floor(Math.random() * RANDOM_AVATARS.length)];
    }

    function sanitizeAvatar(avatar) {
      if (!avatar || typeof avatar !== 'string') return '👦';
      if (avatar === 'anime_boy' || avatar === 'img/avatar_boy.png') return 'anime_boy';
      if (avatar === 'anime_girl' || avatar === 'img/avatar_girl.png') return 'anime_girl';
      if (avatar.length <= 4) return avatar;
      if (avatar.startsWith('data:image/') && avatar.includes(';base64,') && avatar.length <= 12000) return avatar;
      if ((avatar.startsWith('http://') || avatar.startsWith('https://')) && avatar.length <= 300) return avatar;
      return '👦';
    }

    function compactAvatar(avatar) {
      const safe = sanitizeAvatar(avatar);
      return safe.startsWith('data:image/') ? '👦' : safe;
    }

    // 版本检查与更新下载不依赖 D1。将它们从数据库冷启动/迁移路径隔离，
    // 避免数据库抖动把“检查更新”一起拖到超时；账号/对局接口仍按原路径初始化 D1。
    const isUpdateRoute = url.pathname === '/api/version' ||
      url.pathname === '/api/update/apk' || url.pathname === '/api/update/html';
    const isRtcIceServersRoute = url.pathname === '/api/rtc/ice-servers';

    // ── 数据库自动安全升级迁移 ─────────────────────────────
    if (env.DB && !isDbInitialized && !isUpdateRoute && !isRtcIceServersRoute) {
      if (!dbInitializationPromise) {
        dbInitializationPromise = (async () => {
          try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL,
            mode TEXT NOT NULL,
            is_win INTEGER NOT NULL,
            is_draw INTEGER NOT NULL DEFAULT 0,
            winner_color INTEGER NOT NULL,
            my_color INTEGER NOT NULL,
            opp_name TEXT,
            opp_avatar TEXT,
            moves_count INTEGER DEFAULT 0,
            moves_data TEXT,
            board_data TEXT,
            time TEXT,
            date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        // 兼容已存在的 D1：为旧版 game_history 增加和棋标记，不影响历史记录。
        try { await env.DB.prepare(`ALTER TABLE game_history ADD COLUMN is_draw INTEGER NOT NULL DEFAULT 0`).run(); } catch(e) {}
        try {
          await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_game_history_uid ON game_history(uid)`).run();
        } catch(e) {}

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS users (
            uid TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password_hash TEXT,
            salt TEXT,
            password_algo TEXT DEFAULT 'pbkdf2',
            security_q TEXT,
            security_a_hash TEXT,
            security_salt TEXT,
            failed_reset_count INTEGER DEFAULT 0,
            reset_locked_until INTEGER DEFAULT 0,
            token TEXT,
            token_expires_at INTEGER DEFAULT 0,
            refresh_token_hash TEXT,
            refresh_token_expires_at INTEGER DEFAULT 0,
            failed_login_count INTEGER DEFAULT 0,
            locked_until INTEGER DEFAULT 0,
            nickname TEXT,
            avatar TEXT DEFAULT '👦',
            score INTEGER DEFAULT 1000,
            wins INTEGER DEFAULT 0,
            total_games INTEGER DEFAULT 0,
            last_game_at INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        const cols = [
          'password_hash TEXT', 'salt TEXT', 'password_algo TEXT DEFAULT \'pbkdf2\'', 'token TEXT', 'token_expires_at INTEGER DEFAULT 0',
          'refresh_token_hash TEXT', 'refresh_token_expires_at INTEGER DEFAULT 0',
          'failed_login_count INTEGER DEFAULT 0', 'locked_until INTEGER DEFAULT 0', 'last_game_at INTEGER DEFAULT 0',
          'security_q TEXT', 'security_a_hash TEXT', 'security_salt TEXT',
          'failed_reset_count INTEGER DEFAULT 0', 'reset_locked_until INTEGER DEFAULT 0'
        ];
        for (const col of cols) {
          try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run(); } catch(e){}
        }

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS match_queue (
            uid TEXT PRIMARY KEY,
            nickname TEXT,
            avatar TEXT,
            score INTEGER DEFAULT 1000,
            status TEXT DEFAULT 'waiting',
            matched_with TEXT,
            matched_color TEXT,
            matched_nickname TEXT,
            matched_avatar TEXT,
            matched_score INTEGER,
            room_code TEXT,
            match_id TEXT,
            updated_at INTEGER
          )
        `).run();
        // 兼容旧版 D1：仅在列确实缺失时补上本次匹配请求标识，避免每次冷启动都重复尝试 ALTER。
        try {
          const queueSchema = await env.DB.prepare('PRAGMA table_info(match_queue)').all();
          const hasMatchId = Array.isArray(queueSchema?.results) && queueSchema.results.some(column => column?.name === 'match_id');
          if (!hasMatchId) await env.DB.prepare(`ALTER TABLE match_queue ADD COLUMN match_id TEXT`).run();
        } catch(e) {}
        // 匹配查询始终按状态和心跳时间过滤；索引可显著降低用户量增长后的撮合扫描成本。
        try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_match_queue_status_updated ON match_queue(status, updated_at)`).run(); } catch(e) {}
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ip_register_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ip_register_log_ip_time ON ip_register_log(ip, created_at)`).run();

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT,
            nickname TEXT,
            feedback_type TEXT,
            content TEXT NOT NULL,
            contact TEXT,
            client_version TEXT,
            user_agent TEXT,
            ip TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS friend_requests (
            id TEXT PRIMARY KEY,
            pair_key TEXT,
            sender_uid TEXT NOT NULL,
            receiver_uid TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `).run();
        try { await env.DB.prepare(`ALTER TABLE friend_requests ADD COLUMN pair_key TEXT`).run(); } catch (_) {}
        // 兼容曾经已创建但尚无 pair_key 的预发布数据库。先回填并收敛同一
        // 用户对的重复待处理记录，再建立部分唯一索引，避免迁移中途失败。
        await env.DB.prepare(`
          UPDATE friend_requests
          SET pair_key = CASE
            WHEN sender_uid < receiver_uid THEN sender_uid || ':' || receiver_uid
            ELSE receiver_uid || ':' || sender_uid
          END
          WHERE pair_key IS NULL OR pair_key = ''
        `).run();
        await env.DB.prepare(`
          UPDATE friend_requests SET status = 'cancelled', updated_at = ?
          WHERE status = 'pending' AND pair_key IS NOT NULL AND rowid NOT IN (
            SELECT MIN(rowid) FROM friend_requests
            WHERE status = 'pending' AND pair_key IS NOT NULL GROUP BY pair_key
          )
        `).bind(Date.now()).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status ON friend_requests(receiver_uid, status, updated_at DESC)`).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_status ON friend_requests(sender_uid, status, updated_at DESC)`).run();
        await env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_pair ON friend_requests(pair_key) WHERE status = 'pending' AND pair_key IS NOT NULL`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS friendships (
            user_a_uid TEXT NOT NULL,
            user_b_uid TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_a_uid, user_b_uid)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b_uid, created_at DESC)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS user_blocks (
            blocker_uid TEXT NOT NULL,
            blocked_uid TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (blocker_uid, blocked_uid)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_uid)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pair_key TEXT NOT NULL,
            sender_uid TEXT NOT NULL,
            receiver_uid TEXT NOT NULL,
            client_message_id TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(sender_uid, client_message_id)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_private_messages_pair_id ON private_messages(pair_key, id DESC)`).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_private_messages_receiver_id ON private_messages(receiver_uid, id DESC)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS message_state (
            uid TEXT NOT NULL,
            pair_key TEXT NOT NULL,
            last_read_id INTEGER NOT NULL DEFAULT 0,
            cleared_before_id INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (uid, pair_key)
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS recent_opponents (
            uid TEXT NOT NULL,
            opponent_uid TEXT NOT NULL,
            games_count INTEGER NOT NULL DEFAULT 1,
            last_played_at INTEGER NOT NULL,
            PRIMARY KEY (uid, opponent_uid)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recent_opponents_uid_time ON recent_opponents(uid, last_played_at DESC)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS recent_opponent_reports (
            reporter_uid TEXT NOT NULL,
            opponent_uid TEXT NOT NULL,
            reported_at INTEGER NOT NULL,
            PRIMARY KEY (reporter_uid, opponent_uid)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recent_opponent_reports_time ON recent_opponent_reports(reported_at)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS user_social_settings (
            uid TEXT PRIMARY KEY,
            presence_hidden INTEGER NOT NULL DEFAULT 0,
            presence_online INTEGER NOT NULL DEFAULT 0,
            metrics_enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
          )
        `).run();
        try { await env.DB.prepare(`ALTER TABLE user_social_settings ADD COLUMN presence_online INTEGER NOT NULL DEFAULT 0`).run(); } catch (_) {}
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS social_socket_tickets (
            ticket_hash TEXT PRIMARY KEY,
            uid TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_social_tickets_expiry ON social_socket_tickets(expires_at)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS game_invites (
            id TEXT PRIMARY KEY,
            sender_uid TEXT NOT NULL,
            receiver_uid TEXT NOT NULL,
            room_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_game_invites_receiver_status ON game_invites(receiver_uid, status, expires_at DESC)`).run();
        // 轻量签到奖励与好友亲密度使用独立表，避免改写 users 主表并兼容已有 D1。
        // 这三张表会在首次请求时自动 IF NOT EXISTS 创建；正式发布前仍应先备份 D1。
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS user_wallets (
            uid TEXT PRIMARY KEY,
            coins INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS daily_checkins (
            uid TEXT PRIMARY KEY,
            checkin_day TEXT NOT NULL,
            streak INTEGER NOT NULL DEFAULT 1,
            total_days INTEGER NOT NULL DEFAULT 1,
            last_reward INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_checkins_day ON daily_checkins(checkin_day)`).run();
        // 每日唯一领取记录用于抵御并发重复签到；daily_checkins 只保存当前汇总状态。
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS daily_checkin_claims (
            uid TEXT NOT NULL,
            checkin_day TEXT NOT NULL,
            reward INTEGER NOT NULL DEFAULT 0,
            claim_nonce TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            PRIMARY KEY (uid, checkin_day)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_checkin_claims_day ON daily_checkin_claims(checkin_day)`).run();
        // 领取请求使用随机 nonce 作为本次批处理的写入闸门；兼容旧表时默认空串不会放行新请求。
        try { await env.DB.prepare(`ALTER TABLE daily_checkin_claims ADD COLUMN claim_nonce TEXT NOT NULL DEFAULT ''`).run(); } catch (_) {}
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS social_affinity (
            pair_key TEXT PRIMARY KEY,
            user_a_uid TEXT NOT NULL,
            user_b_uid TEXT NOT NULL,
            points INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_social_affinity_users ON social_affinity(user_a_uid, user_b_uid)`).run();
        // 付费货币与订单只做不可伪造的服务端账本骨架。当前支付模式为
        // disabled（生产默认）或 sandbox；没有支付回调时绝不写入 diamonds。
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS premium_wallets (
            uid TEXT PRIMARY KEY,
            diamonds INTEGER NOT NULL DEFAULT 0 CHECK (diamonds >= 0),
            purchased_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (purchased_diamonds >= 0),
            updated_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS premium_orders (
            id TEXT PRIMARY KEY,
            uid TEXT NOT NULL,
            product_id TEXT NOT NULL,
            diamonds INTEGER NOT NULL CHECK (diamonds > 0),
            price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
            currency TEXT NOT NULL DEFAULT 'CNY',
            payment_mode TEXT NOT NULL DEFAULT 'disabled',
            status TEXT NOT NULL DEFAULT 'disabled',
            client_order_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (uid, client_order_id)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_premium_orders_uid_time ON premium_orders(uid, created_at DESC)`).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_premium_orders_status_time ON premium_orders(status, updated_at DESC)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS premium_ledger (
            id TEXT PRIMARY KEY,
            uid TEXT NOT NULL,
            order_id TEXT,
            currency TEXT NOT NULL DEFAULT 'diamonds',
            delta INTEGER NOT NULL,
            balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
            reason TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE (order_id)
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_premium_ledger_uid_time ON premium_ledger(uid, created_at DESC)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS user_game_layouts (
            uid TEXT PRIMARY KEY,
            button_order TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS metrics_daily (
            day TEXT NOT NULL,
            client_version TEXT NOT NULL,
            platform TEXT NOT NULL,
            metric TEXT NOT NULL,
            bucket TEXT NOT NULL,
            endpoint TEXT NOT NULL DEFAULT '',
            route TEXT NOT NULL DEFAULT '',
            sample_count INTEGER NOT NULL DEFAULT 0,
            value_sum REAL NOT NULL DEFAULT 0,
            value_min REAL,
            value_max REAL,
            PRIMARY KEY (day, client_version, platform, metric, bucket, endpoint, route)
          )
        `).run();
            try {
              await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at)`).run();
            } catch(e) {}
            // 榜单按积分/胜场排序；只在 Worker 实例首次需要数据库时创建一次。
            await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_score_wins_uid ON users(score DESC, wins DESC, uid ASC)`).run();
            await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)`).run();
            isDbInitialized = true;
          } catch (e) {
            dbInitializationPromise = null;
            console.warn('DB check error:', e.message);
          }
        })();
      }
      await dbInitializationPromise;
    }

    const githubHeaders = (token, accept = 'application/vnd.github+json') => ({
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'gomoku-update-proxy'
    });

    const getLatestPrivateRelease = async () => {
      const token = String(env.GITHUB_READ_TOKEN || '').trim();
      if (!token) return { error: '更新服务尚未配置私有仓库凭据' };

      const now = Date.now();
      if (privateReleaseCache && now - privateReleaseCache.fetchedAt < PRIVATE_RELEASE_CACHE_TTL_MS) {
        return { token, release: privateReleaseCache.release };
      }

      // 同一个 Worker 实例内的并发版本请求共用一次 GitHub 请求，避免冷启动时请求风暴。
      if (!privateReleasePromise) {
        privateReleasePromise = (async () => {
          try {
            const response = await fetchWithTimeout(`${GITHUB_API_ORIGIN}/repos/${UPDATE_REPOSITORY}/releases/latest`, {
              headers: githubHeaders(token)
            });
            if (!response.ok) {
              console.warn(`[update proxy] GitHub latest release returned HTTP ${response.status}`);
              return { error: `私有仓库版本读取失败 (${response.status})` };
            }
            const release = await response.json();
            if (!release || typeof release !== 'object') {
              return { error: '私有仓库版本响应无效' };
            }
            privateReleaseCache = { release, fetchedAt: Date.now() };
            return { release };
          } catch (error) {
            const message = error?.name === 'AbortError'
              ? '私有仓库版本读取超时，请稍后重试'
              : '私有仓库版本读取失败，请稍后重试';
            console.error('[update proxy] GitHub latest release request failed:', error?.message || error);
            return { error: message };
          } finally {
            privateReleasePromise = null;
          }
        })();
      }

      const result = await privateReleasePromise;
      return result.error ? result : { token, release: result.release };
    };

    const getPrivateReleaseAsset = async (assetType) => {
      const latest = await getLatestPrivateRelease();
      if (latest.error) return latest;
      const assets = Array.isArray(latest.release.assets) ? latest.release.assets : [];
      const expectedName = assetType === 'apk' ? 'gomoku.apk' : 'gomoku.html';
      const asset = assets.find(item => item.name === expectedName);
      if (!asset || !asset.url) return { error: `最新 Release 中没有可用的 ${assetType.toUpperCase()} 文件` };
      try {
        const assetUrl = new URL(asset.url);
        const expectedPathPrefix = `/repos/${UPDATE_REPOSITORY}/releases/assets/`;
        if (assetUrl.origin !== GITHUB_API_ORIGIN || !assetUrl.pathname.startsWith(expectedPathPrefix)) {
          return { error: '最新 Release 文件地址不受信任' };
        }
      } catch (_) {
        return { error: '最新 Release 文件地址无效' };
      }
      return { token: latest.token, release: latest.release, asset };
    };

    // 更新票据只在请求头中传输，不放入 URL，避免被浏览器历史、代理或日志长期记录。
    // UPDATE_TICKET_SECRET 可单独配置；未配置时暂时回退到已有 GitHub Secret，便于平滑迁移。
    const getUpdateTicketSecret = () => String(env.UPDATE_TICKET_SECRET || env.GITHUB_READ_TOKEN || '').trim();

    const base64UrlEncode = (bytes) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };

    const base64UrlDecode = (value) => {
      const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
      if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error('invalid base64url');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const binary = atob(padded);
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    };

    const issueUpdateTicket = async (assetType, releaseTag) => {
      const secret = getUpdateTicketSecret();
      if (!secret) return '';
      const issuedAt = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        asset: assetType,
        release: releaseTag,
        iat: issuedAt,
        exp: issuedAt + UPDATE_TICKET_TTL_SECONDS,
        nonce: generateSecureHex(12)
      });
      const encodedPayload = base64UrlEncode(new TextEncoder().encode(payload));
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
      return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
    };

    const verifyUpdateTicket = async (assetType) => {
      if (request.headers.get(UPDATE_CLIENT_HEADER) !== UPDATE_CLIENT_VALUE) return null;
      const rawTicket = String(request.headers.get(UPDATE_TICKET_HEADER) || '').trim();
      if (rawTicket.length < 20 || rawTicket.length > 4096) return null;
      const parts = rawTicket.split('.');
      if (parts.length !== 2) return null;
      try {
        const payloadBytes = base64UrlDecode(parts[0]);
        const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
        const now = Math.floor(Date.now() / 1000);
        if (!payload || payload.asset !== assetType || typeof payload.release !== 'string' ||
            !/^v\d+\.\d+\.\d+$/.test(payload.release) ||
            !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
            payload.exp < now || payload.exp - payload.iat > UPDATE_TICKET_TTL_SECONDS ||
            payload.iat > now + 30) return null;
        const secret = getUpdateTicketSecret();
        if (!secret) return null;
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify']
        );
        const valid = await crypto.subtle.verify(
          'HMAC',
          key,
          base64UrlDecode(parts[1]),
          new TextEncoder().encode(parts[0])
        );
        return valid ? payload : null;
      } catch (_) {
        return null;
      }
    };

    const streamPrivateReleaseAsset = async (assetType, ticketPayload = null) => {
      const result = await getPrivateReleaseAsset(assetType);
      if (result.error) return json({ code: 503, msg: result.error }, 503);
      const releaseTag = String(result.release?.tag_name || '').trim();
      if (ticketPayload && ticketPayload.release !== releaseTag) {
        return json({ code: 401, msg: '更新票据已过期，请重新检查更新' }, 401);
      }

      const assetResponse = await fetchWithTimeout(result.asset.url, {
        headers: githubHeaders(result.token, 'application/octet-stream')
      }, 20000);
      if (!assetResponse.ok || !assetResponse.body) {
        return json({ code: 502, msg: `更新文件读取失败 (${assetResponse.status})` }, 502);
      }
      const declaredAssetSize = Number(assetResponse.headers.get('content-length') || 0);
      if (Number.isFinite(declaredAssetSize) && declaredAssetSize > MAX_UPDATE_ASSET_BYTES) {
        return json({ code: 413, msg: '更新文件超过允许大小' }, 413);
      }

      const headers = new Headers(corsHeaders);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Content-Type', assetType === 'apk' ? 'application/vnd.android.package-archive' : 'text/html; charset=utf-8');
      headers.set('Content-Disposition', `attachment; filename="${assetType === 'apk' ? 'gomoku.apk' : 'gomoku.html'}"`);
      const contentLength = assetResponse.headers.get('content-length');
      if (contentLength) headers.set('Content-Length', contentLength);
      return new Response(assetResponse.body, { status: 200, headers });
    };

    // 版本检测与文件下载统一从 Worker 出口完成，客户端不再直连私有仓库。
    if (url.pathname === "/api/version" && request.method !== 'GET') {
      return json({ code: 405, msg: '仅支持 GET 请求' }, 405);
    }
    if ((url.pathname === "/api/update/apk" || url.pathname === "/api/update/html") && request.method !== 'GET') {
      return json({ code: 405, msg: '仅支持 GET 请求' }, 405);
    }
    if (url.pathname === "/api/version") {
      const latest = await getLatestPrivateRelease();
      if (latest.error) return json({ code: 503, msg: latest.error }, 503);
      const releaseTag = String(latest.release.tag_name || '').trim();
      if (!releaseTag) return json({ code: 502, msg: '私有仓库最新 Release 缺少版本号' }, 502);
      const releaseAssets = Array.isArray(latest.release.assets) ? latest.release.assets : [];
      const assetDigest = (name) => {
        const digest = String(releaseAssets.find(item => item.name === name)?.digest || '').trim();
        return /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice(7).toLowerCase() : '';
      };
      const [apkTicket, htmlTicket] = await Promise.all([
        issueUpdateTicket('apk', releaseTag),
        issueUpdateTicket('html', releaseTag)
      ]);
      return json({
        code: 0,
        tag: releaseTag,
        updateLog: latest.release.body || '五子棋版本更新与稳定性优化',
        apkPath: '/api/update/apk',
        htmlPath: '/api/update/html',
        apkTicket,
        htmlTicket,
        apkSha256: assetDigest('gomoku.apk'),
        htmlSha256: assetDigest('gomoku.html'),
        officialSignatureSha256: "9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e"
      });
    }
    if (url.pathname === "/api/update/apk" || url.pathname === "/api/update/html") {
      const assetType = url.pathname === "/api/update/apk" ? 'apk' : 'html';
      const ticketPayload = await verifyUpdateTicket(assetType);
      // 安全默认：未配置开关时也必须校验短时票据；只有明确写入 0 才允许兼容调试模式。
      const ticketProtectionEnabled = String(env.UPDATE_TICKET_ENFORCED || '1').trim() !== '0';
      if (ticketProtectionEnabled && !ticketPayload) {
        return json({ code: 401, msg: '更新下载需要应用内短时授权' }, 401);
      }
      return streamPrivateReleaseAsset(assetType, ticketPayload);
    }

    // ── WebRTC TURN 临时凭据 ─────────────────────────────────────────────
    // 长期 TURN Key 只保存在 Worker/Pages Secret 中；客户端只会拿到短时
    // username/credential，避免把可长期签发凭据写进网页或 APK。
    if (isRtcIceServersRoute) {
      if (request.method !== 'GET') {
        return json({ code: 405, msg: '仅支持 GET 请求' }, 405);
      }

      const turnKeyId = String(env.TURN_KEY_ID || '').trim();
      const turnKeyApiToken = String(env.TURN_KEY_API_TOKEN || '').trim();
      if (!turnKeyId || !turnKeyApiToken) {
        return json({ code: 503, msg: 'TURN 服务尚未配置' }, 503);
      }

      // TURN 出口按 IP 做轻量限频，避免公开客户端被脚本大量签发凭据。
      // 这是边缘实例级保护，生产环境仍依赖 Cloudflare 账户侧用量监控。
      const clientIp = String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64);
      const now = Date.now();
      const previousBucket = turnRateLimitBuckets.get(clientIp);
      const bucket = previousBucket && now - previousBucket.startedAt < TURN_RATE_LIMIT_WINDOW_MS
        ? previousBucket
        : { startedAt: now, count: 0 };
      bucket.count += 1;
      turnRateLimitBuckets.set(clientIp, bucket);
      if (bucket.count > TURN_RATE_LIMIT_MAX_REQUESTS) {
        return json({ code: 429, msg: 'TURN 请求过于频繁，请稍后重试' }, 429);
      }
      if (turnRateLimitBuckets.size > 2048) {
        for (const [key, value] of turnRateLimitBuckets.entries()) {
          if (now - value.startedAt >= TURN_RATE_LIMIT_WINDOW_MS) turnRateLimitBuckets.delete(key);
        }
      }

      const turnEndpointBase = `${TURN_API_ORIGIN}/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials`;
      try {
        const turnAttempts = [];
        const requestTurnCredentials = async (path) => {
          const response = await fetchWithTimeout(`${turnEndpointBase}/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${turnKeyApiToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS })
          }, TURN_REQUEST_TIMEOUT_MS);
          let payload = null;
          try { payload = await response.json(); } catch (_) {}
          const errorCodes = Array.isArray(payload?.errors)
            ? payload.errors.map((item) => item && item.code != null ? String(item.code) : '').filter(Boolean).slice(0, 4)
            : [];
          turnAttempts.push({ path, status: response.status, errorCodes });
          return { response, payload };
        };

        // Cloudflare 文档当前推荐 generate-ice-servers；兼容仍返回旧路径的
        // Realtime 账号，避免同一套 TURN Key 因 API 路径版本差异直接失效。
        let turnAttempt = await requestTurnCredentials('generate-ice-servers');
        let turnResponse = turnAttempt.response;
        let turnPayload = turnAttempt.payload;
        if (turnResponse.status === 404) {
          turnAttempt = await requestTurnCredentials('generate');
          turnResponse = turnAttempt.response;
          turnPayload = turnAttempt.payload;
        }
        const iceServers = Array.isArray(turnPayload?.iceServers) ? turnPayload.iceServers : [];
        if (!turnResponse.ok || !iceServers.length) {
          console.warn('[TURN] credential generation failed:', JSON.stringify(turnAttempts));
          return json({ code: 502, msg: 'TURN 临时凭据生成失败' }, 502);
        }

        // Cloudflare 返回的 53 端口是备用探测地址，浏览器通常会等待超时；
        // 保留标准 UDP/TCP/TLS 端口，缩短 ICE 收敛时间。
        const usableIceServers = iceServers.map((server) => {
          if (!server || typeof server !== 'object') return null;
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          const filteredUrls = urls.filter((value) => {
            if (typeof value !== 'string' || !value) return false;
            return !/:(?:53)(?:[/?]|$)/.test(value);
          });
          if (!filteredUrls.length) return null;
          const normalized = { urls: filteredUrls };
          if (typeof server.username === 'string' && server.username) normalized.username = server.username;
          if (typeof server.credential === 'string' && server.credential) normalized.credential = server.credential;
          return normalized;
        }).filter(Boolean);

        if (!usableIceServers.length) {
          return json({ code: 502, msg: 'TURN 返回了不可用的 ICE 配置' }, 502);
        }
        return json({
          code: 0,
          data: {
            iceServers: usableIceServers,
            expiresAt: now + TURN_CREDENTIAL_TTL_SECONDS * 1000
          }
        });
      } catch (error) {
        console.warn('[TURN] credential request failed:', error?.message || error);
        return json({ code: 502, msg: 'TURN 服务暂时不可用' }, 502);
      }
    }

    // 🛡️ 终极安全第一网关：全量强制校验客户端专属安全暗号，阻断一切外部未授权访问！
    const isDocNav = request.headers.get("sec-fetch-dest") === "document" || request.headers.get("sec-fetch-mode") === "navigate";
    if (url.pathname === "/" || url.pathname === "/index.html" || isDocNav) {
      return new Response('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body style="font-family:sans-serif;text-align:center;padding:120px 20px;"><h1>404 Not Found</h1><p>The requested resource was not found on this server.</p><hr/><div style="color:#888;font-size:12px;">nginx</div></body></html>', {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    function getRequestToken(request, body = {}) {
      const authorization = request.headers.get('Authorization') || '';
      const candidate = /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, '').trim()
        : (typeof body.token === 'string' ? body.token.trim() : '');
      // Session tokens are currently 48 hex chars. Keep a larger compatibility
      // ceiling for legacy sessions, but never pass unbounded attacker input to
      // D1 or to downstream logging/error paths.
      return candidate.length <= 256 ? candidate : '';
    }

    async function requireUser(uid, token) {
      const cleanUid = String(uid || '').trim();
      const cleanToken = String(token || '').trim();
      if (!env.DB) return { response: json({ code: 1, msg: '数据库未连接' }, 500) };
      if (!cleanUid || !cleanToken) return { response: json({ code: 401, msg: '未授权：缺少身份凭证' }, 401) };

      const user = await env.DB.prepare(`
        SELECT uid, username, nickname, avatar, score, wins, total_games, token, token_expires_at
        FROM users WHERE uid = ? AND token = ?
      `).bind(cleanUid, cleanToken).first();
      if (!user) return { response: json({ code: 403, msg: '未授权：Token 无效' }, 403) };
      if (user.token_expires_at && Number(user.token_expires_at) <= Date.now()) {
        return { response: json({ code: 401, msg: '登录凭证已过期，请重新登录' }, 401) };
      }
      return { user };
    }

    async function requireMatchIdentity(uid, token) {
      const cleanUid = String(uid || '').trim();
      // 全服匹配和积分结算必须绑定正式账号；游客只允许使用 P2P 房间。
      // 不能接受客户端自造 guest_* 身份，否则任何人都可以占用撮合队列并污染匹配状态。
      if (cleanUid.startsWith('guest_')) {
        return { response: json({ code: 401, msg: '全服匹配需要先登录正式账号' }, 401) };
      }
      const auth = await requireUser(cleanUid, token);
      return auth.response ? auth : { uid: cleanUid, user: auth.user };
    }

    const socialPairKey = (left, right) => [String(left), String(right)].sort().join(':');
    const socialPair = (left, right) => [String(left), String(right)].sort();

    function consumeSocialRate(uid, action, limit, windowMs) {
      const key = `${String(uid)}:${action}`;
      const now = Date.now();
      let bucket = socialRateLimitBuckets.get(key);
      if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
      bucket.count += 1;
      socialRateLimitBuckets.set(key, bucket);
      if (socialRateLimitBuckets.size > 3000) {
        for (const [entryKey, entry] of socialRateLimitBuckets) {
          if (now - entry.startedAt > Math.max(windowMs, 3600000)) socialRateLimitBuckets.delete(entryKey);
        }
      }
      return bucket.count <= limit;
    }

    // Account-scoped limits stop one user from spamming; an IP-scoped ceiling
    // prevents a farm of short-lived accounts from bypassing the same social
    // endpoint. Cloudflare supplies CF-Connecting-IP at the edge. Local/native
    // callers without that header keep the account-only behavior for offline
    // development and Android WebView compatibility.
    function consumeSocialRequestRate(uid, action, limit, windowMs, ipLimit = Math.max(limit * 4, 60)) {
      const ip = String(request.headers.get('CF-Connecting-IP') || '').trim().slice(0, 64);
      if (ip && !consumeSocialRate(`ip:${ip}`, `social:${action}`, ipLimit, windowMs)) return false;
      return consumeSocialRate(uid, action, limit, windowMs);
    }

    async function requireRegisteredUser(uid, token) {
      const auth = await requireUser(uid, token);
      if (auth.response) return auth;
      if (!auth.user.username) return { response: json({ code: 403, msg: '好友功能仅供正式账号使用' }, 403) };
      return auth;
    }

    async function areFriends(left, right) {
      const [a, b] = socialPair(left, right);
      return Boolean(await env.DB.prepare('SELECT 1 AS ok FROM friendships WHERE user_a_uid = ? AND user_b_uid = ?').bind(a, b).first());
    }

    async function isBlockedEitherWay(left, right) {
      return Boolean(await env.DB.prepare(`
        SELECT 1 AS ok FROM user_blocks
        WHERE (blocker_uid = ? AND blocked_uid = ?) OR (blocker_uid = ? AND blocked_uid = ?)
        LIMIT 1
      `).bind(left, right, right, left).first());
    }

    async function friendCount(uid) {
      const row = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM friendships WHERE user_a_uid = ? OR user_b_uid = ?').bind(uid, uid).first();
      return Number(row?.cnt) || 0;
    }

    async function notifySocialUser(uid, event) {
      if (!env.GOMOKU_SOCIAL || !uid) return false;
      try {
        const id = env.GOMOKU_SOCIAL.idFromName(`social:${uid}`);
        const response = await env.GOMOKU_SOCIAL.get(id).fetch('https://social.internal/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gomoku-Social-Uid': String(uid) },
          body: JSON.stringify(event)
        });
        return response.ok;
      } catch (_) {
        return false;
      }
    }

    async function notifySocialFriends(uid, event) {
      const rows = await env.DB.prepare(`
        SELECT CASE WHEN user_a_uid = ? THEN user_b_uid ELSE user_a_uid END AS friend_uid
        FROM friendships WHERE user_a_uid = ? OR user_b_uid = ? LIMIT ${SOCIAL_MAX_FRIENDS}
      `).bind(uid, uid, uid).all();
      await Promise.all((rows.results || []).map(row => notifySocialUser(row.friend_uid, event)));
    }

    async function socialPresence(uid) {
      if (!env.GOMOKU_SOCIAL || !uid) return false;
      try {
        const id = env.GOMOKU_SOCIAL.idFromName(`social:${uid}`);
        const response = await env.GOMOKU_SOCIAL.get(id).fetch('https://social.internal/presence', {
          headers: { 'X-Gomoku-Social-Uid': String(uid) }
        });
        const data = response.ok ? await response.json() : null;
        return data?.online === true;
      } catch (_) {
        return false;
      }
    }

    async function acceptPendingFriendRequest(requestId, receiverUid, senderUid, now) {
      const [a, b] = socialPair(receiverUid, senderUid);
      const results = await env.DB.batch([
        env.DB.prepare(`
          INSERT OR IGNORE INTO friendships (user_a_uid, user_b_uid, created_at)
          SELECT ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM friend_requests WHERE id = ? AND receiver_uid = ? AND status = 'pending'
          )
        `).bind(a, b, now, requestId, receiverUid),
        env.DB.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ? AND receiver_uid = ? AND status = 'pending'`).bind(now, requestId, receiverUid)
      ]);
      return Number(results?.[1]?.meta?.changes) > 0;
    }

    async function getSocialAuthFromBody(body) {
      const uid = typeof body?.uid === 'string' ? body.uid.trim() : '';
      return requireRegisteredUser(uid, getRequestToken(request, body || {}));
    }

    // ── 轻量经济与亲密关系 ─────────────────────────────────
    // 日期统一按北京时间结算，客户端不能提交日期或奖励数值。
    const beijingDay = (timestamp = Date.now()) => new Date(Number(timestamp) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const previousBeijingDay = (day) => {
      const parsed = new Date(`${String(day)}T00:00:00Z`);
      return new Date(parsed.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    };
    const readEconomySummary = async (uid) => {
      const day = beijingDay();
      const [wallet, checkin, friendRows, premiumWallet] = await Promise.all([
        env.DB.prepare('SELECT coins FROM user_wallets WHERE uid = ?').bind(uid).first(),
        env.DB.prepare('SELECT checkin_day, streak, total_days, last_reward FROM daily_checkins WHERE uid = ?').bind(uid).first(),
        env.DB.prepare(`
          SELECT
            CASE WHEN f.user_a_uid = ? THEN f.user_b_uid ELSE f.user_a_uid END AS friend_uid,
            u.username, u.nickname, u.avatar,
            COALESCE(a.points, 0) AS affinity_points
          FROM friendships f
          JOIN users u ON u.uid = CASE WHEN f.user_a_uid = ? THEN f.user_b_uid ELSE f.user_a_uid END
          LEFT JOIN social_affinity a ON a.pair_key = CASE
            WHEN f.user_a_uid < f.user_b_uid THEN f.user_a_uid || ':' || f.user_b_uid
            ELSE f.user_b_uid || ':' || f.user_a_uid
          END
          WHERE (f.user_a_uid = ? OR f.user_b_uid = ?)
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
              WHERE (b.blocker_uid = ? AND b.blocked_uid = u.uid)
                 OR (b.blocker_uid = u.uid AND b.blocked_uid = ?)
            )
          ORDER BY affinity_points DESC, u.username ASC
          LIMIT ${SOCIAL_MAX_FRIENDS}
        `).bind(uid, uid, uid, uid, uid, uid).all(),
        env.DB.prepare('SELECT diamonds, purchased_diamonds FROM premium_wallets WHERE uid = ?').bind(uid).first()
      ]);
      const row = checkin || {};
      return {
        coins: Math.max(0, Number(wallet?.coins) || 0),
        diamonds: Math.max(0, Number(premiumWallet?.diamonds) || 0),
        purchasedDiamonds: Math.max(0, Number(premiumWallet?.purchased_diamonds) || 0),
        checkinDay: String(row.checkin_day || ''),
        checkedIn: String(row.checkin_day || '') === day,
        streak: Math.max(0, Number(row.streak) || 0),
        totalDays: Math.max(0, Number(row.total_days) || 0),
        lastReward: Math.max(0, Number(row.last_reward) || 0),
        day,
        affinity: (friendRows.results || []).map(friend => ({
          uid: String(friend.friend_uid || ''),
          username: String(friend.username || ''),
          nickname: String(friend.nickname || friend.username || '棋友').slice(0, 32),
          avatar: compactAvatar(friend.avatar),
          points: Math.min(SOCIAL_AFFINITY_MAX_POINTS, Math.max(0, Number(friend.affinity_points) || 0)),
          level: Math.min(100, 1 + Math.floor(Math.max(0, Number(friend.affinity_points) || 0) / 100))
        }))
      };
    };

    // 充值商品是服务端固定目录，客户端只能提交 productId 与幂等键，
    // 不能提交钻石数量、价格、货币或“已支付”状态。正式支付渠道接入前，
    // disabled 是唯一默认模式；sandbox 只允许创建待支付订单，也不会到账。
    const premiumPaymentMode = () => {
      const configured = String(env.PREMIUM_PAYMENT_MODE || '').trim().toLowerCase();
      return configured === 'sandbox' ? 'sandbox' : PREMIUM_DEFAULT_PAYMENT_MODE;
    };
    const premiumProduct = productId => PREMIUM_PRODUCTS.find(product => product.id === String(productId || '')) || null;
    const premiumOrderView = order => order ? ({
      id: String(order.id || ''),
      uid: String(order.uid || ''),
      productId: String(order.product_id || ''),
      diamonds: Math.max(0, Number(order.diamonds) || 0),
      priceCents: Math.max(0, Number(order.price_cents) || 0),
      currency: String(order.currency || 'CNY'),
      paymentMode: String(order.payment_mode || PREMIUM_DEFAULT_PAYMENT_MODE),
      status: String(order.status || 'disabled'),
      clientOrderId: String(order.client_order_id || ''),
      createdAt: Number(order.created_at) || 0,
      updatedAt: Number(order.updated_at) || 0
    }) : null;
    const readPremiumWallet = async uid => {
      const row = await env.DB.prepare('SELECT diamonds, purchased_diamonds FROM premium_wallets WHERE uid = ?').bind(uid).first();
      return {
        currency: PREMIUM_CURRENCY,
        diamonds: Math.max(0, Number(row?.diamonds) || 0),
        purchasedDiamonds: Math.max(0, Number(row?.purchased_diamonds) || 0)
      };
    };
    const normalizeGameLayoutOrder = value => {
      let candidates = value;
      if (typeof candidates === 'string') {
        try { candidates = JSON.parse(candidates); } catch (_) { candidates = []; }
      }
      if (!Array.isArray(candidates)) candidates = [];
      const result = [];
      const seen = new Set();
      for (const item of candidates.slice(0, 64)) {
        const id = typeof item === 'string' ? item.trim() : '';
        if (GAME_LAYOUT_DEFAULT_ORDER.includes(id) && !seen.has(id)) {
          seen.add(id);
          result.push(id);
        }
      }
      for (const id of GAME_LAYOUT_DEFAULT_ORDER) if (!seen.has(id)) result.push(id);
      return result;
    };
    const storedGameLayoutOrder = row => normalizeGameLayoutOrder(row?.button_order || []);

    if (url.pathname === '/api/economy/catalog' && request.method === 'GET') {
      const paymentMode = premiumPaymentMode();
      return json({ code: 0, data: {
        currency: PREMIUM_CURRENCY,
        paymentMode,
        canCreateOrder: paymentMode === 'sandbox',
        canCredit: false,
        products: PREMIUM_PRODUCTS.map(product => ({
          id: product.id,
          name: product.name,
          diamonds: product.diamonds,
          priceCents: product.priceCents,
          currency: 'CNY'
        }))
      }});
    }

    if (url.pathname === '/api/economy/wallet' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(uid, 'premium-wallet', 60, 60000, 240)) return json({ code: 429, msg: '账户余额读取过于频繁' }, 429);
      return json({ code: 0, data: await readPremiumWallet(uid) });
    }

    if (url.pathname === '/api/economy/orders' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      if (!consumeSocialRequestRate(uid, 'premium-order', 8, 10 * 60 * 1000, 40)) return json({ code: 429, msg: '充值订单创建过于频繁' }, 429);
      const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
      const clientOrderId = typeof body.clientOrderId === 'string' ? body.clientOrderId.trim() : '';
      const product = premiumProduct(productId);
      if (!product || !/^[A-Za-z0-9_-]{8,80}$/.test(clientOrderId)) {
        return json({ code: 400, msg: '商品或订单幂等键无效' }, 400);
      }

      // 先查幂等订单。即使部署时从 sandbox 切换为 disabled，已有订单也只能
      // 查询/取消，不能因重试而重复创建或改变商品金额。
      const existing = await env.DB.prepare(`
        SELECT id, uid, product_id, diamonds, price_cents, currency, payment_mode, status,
               client_order_id, created_at, updated_at
        FROM premium_orders WHERE uid = ? AND client_order_id = ?
      `).bind(uid, clientOrderId).first();
      if (existing) {
        if (String(existing.product_id) !== product.id) return json({ code: 409, msg: '订单幂等键已用于其他商品' }, 409);
        return json({ code: 0, data: { order: premiumOrderView(existing), idempotent: true, credited: false } });
      }

      const paymentMode = premiumPaymentMode();
      if (paymentMode !== 'sandbox') {
        return json({ code: 503, msg: '充值渠道尚未开放', data: { paymentMode, credited: false } }, 503);
      }
      const now = Date.now();
      const orderId = generateSecureHex(12);
      const inserted = await env.DB.prepare(`
        INSERT OR IGNORE INTO premium_orders
          (id, uid, product_id, diamonds, price_cents, currency, payment_mode, status, client_order_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'CNY', ?, 'sandbox_pending', ?, ?, ?)
      `).bind(orderId, uid, product.id, product.diamonds, product.priceCents, paymentMode, clientOrderId, now, now).run();
      const order = await env.DB.prepare(`
        SELECT id, uid, product_id, diamonds, price_cents, currency, payment_mode, status,
               client_order_id, created_at, updated_at
        FROM premium_orders WHERE uid = ? AND client_order_id = ?
      `).bind(uid, clientOrderId).first();
      if (!order) return json({ code: 500, msg: '充值订单创建失败，请稍后重试' }, 500);
      if (String(order.product_id) !== product.id) return json({ code: 409, msg: '订单幂等键已用于其他商品' }, 409);
      // 这里没有任何 wallet/ledger 写入。sandbox 仅验证订单模型，不能伪造支付成功。
      return json({ code: 0, data: {
        order: premiumOrderView(order),
        idempotent: Number(inserted?.meta?.changes) !== 1,
        credited: false
      }});
    }

    const premiumOrderRoute = url.pathname.match(/^\/api\/economy\/orders\/([A-Fa-f0-9]{24})(?:\/(cancel))?$/);
    if (premiumOrderRoute && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(uid, 'premium-order-read', 60, 60000, 240)) return json({ code: 429, msg: '订单读取过于频繁' }, 429);
      const order = await env.DB.prepare(`
        SELECT id, uid, product_id, diamonds, price_cents, currency, payment_mode, status,
               client_order_id, created_at, updated_at
        FROM premium_orders WHERE id = ? AND uid = ?
      `).bind(premiumOrderRoute[1], uid).first();
      if (!order) return json({ code: 404, msg: '订单不存在' }, 404);
      return json({ code: 0, data: { order: premiumOrderView(order), credited: false } });
    }

    if (premiumOrderRoute && premiumOrderRoute[2] === 'cancel' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      if (!consumeSocialRequestRate(uid, 'premium-order-cancel', 30, 60000, 120)) return json({ code: 429, msg: '订单操作过于频繁' }, 429);
      const now = Date.now();
      const changed = await env.DB.prepare(`
        UPDATE premium_orders SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND uid = ? AND status IN ('pending', 'sandbox_pending')
      `).bind(now, premiumOrderRoute[1], uid).run();
      const order = await env.DB.prepare(`
        SELECT id, uid, product_id, diamonds, price_cents, currency, payment_mode, status,
               client_order_id, created_at, updated_at
        FROM premium_orders WHERE id = ? AND uid = ?
      `).bind(premiumOrderRoute[1], uid).first();
      if (!order) return json({ code: 404, msg: '订单不存在' }, 404);
      return json({ code: 0, data: { order: premiumOrderView(order), changed: Number(changed?.meta?.changes) > 0, credited: false } });
    }

    const gameLayoutRoute = url.pathname === '/api/user/game-layout' || url.pathname === '/api/game-layout';
    if (gameLayoutRoute && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(uid, 'game-layout-read', 60, 60000, 240)) return json({ code: 429, msg: '按钮布局读取过于频繁' }, 429);
      const row = await env.DB.prepare('SELECT button_order, updated_at FROM user_game_layouts WHERE uid = ?').bind(uid).first();
      return json({ code: 0, data: {
        buttonOrder: storedGameLayoutOrder(row),
        defaultOrder: [...GAME_LAYOUT_DEFAULT_ORDER],
        updatedAt: Number(row?.updated_at) || 0
      }});
    }

    if (gameLayoutRoute && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      if (!consumeSocialRequestRate(uid, 'game-layout-write', 30, 60000, 120)) return json({ code: 429, msg: '按钮布局保存过于频繁' }, 429);
      const requestedOrder = body.buttonOrder ?? body.order ?? body.layout;
      const buttonOrder = normalizeGameLayoutOrder(requestedOrder);
      const now = Date.now();
      await env.DB.prepare(`
        INSERT INTO user_game_layouts (uid, button_order, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET button_order = excluded.button_order, updated_at = excluded.updated_at
      `).bind(uid, JSON.stringify(buttonOrder), now).run();
      return json({ code: 0, data: { buttonOrder, defaultOrder: [...GAME_LAYOUT_DEFAULT_ORDER], updatedAt: now } });
    }

    if (url.pathname === '/api/economy/summary' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(uid, 'economy-summary', 60, 60000, 240)) return json({ code: 429, msg: '数据读取过于频繁' }, 429);
      return json({ code: 0, data: await readEconomySummary(uid) });
    }

    if (url.pathname === '/api/economy/checkin' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      if (!consumeSocialRequestRate(uid, 'economy-checkin', 5, 24 * 60 * 60 * 1000, 20)) return json({ code: 429, msg: '签到请求过于频繁' }, 429);
      const now = Date.now();
      const day = beijingDay(now);
      const previousDay = previousBeijingDay(day);
      const claimNonce = generateSecureHex(16);
      const current = await env.DB.prepare('SELECT checkin_day, streak, total_days FROM daily_checkins WHERE uid = ?').bind(uid).first();
      const previousStreak = current && String(current.checkin_day || '') === previousDay ? Math.max(0, Number(current.streak) || 0) : 0;
      const streak = Math.min(CHECKIN_STREAK_CAP, previousStreak + 1);
      const reward = CHECKIN_BASE_COINS + Math.min(CHECKIN_STREAK_CAP - 1, Math.max(0, streak - 1)) * CHECKIN_STREAK_BONUS;
      const results = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO daily_checkin_claims (uid, checkin_day, reward, claim_nonce, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid, day, reward, claimNonce, now),
        env.DB.prepare('INSERT OR IGNORE INTO user_wallets (uid, coins, updated_at) SELECT ?, 0, ? WHERE EXISTS (SELECT 1 FROM daily_checkin_claims WHERE uid = ? AND checkin_day = ? AND claim_nonce = ?)').bind(uid, now, uid, day, claimNonce),
        env.DB.prepare('UPDATE user_wallets SET coins = coins + ?, updated_at = ? WHERE uid = ? AND EXISTS (SELECT 1 FROM daily_checkin_claims WHERE uid = ? AND checkin_day = ? AND claim_nonce = ?)').bind(reward, now, uid, uid, day, claimNonce),
        env.DB.prepare('INSERT OR IGNORE INTO daily_checkins (uid, checkin_day, streak, total_days, last_reward, updated_at) SELECT ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM daily_checkin_claims WHERE uid = ? AND checkin_day = ? AND claim_nonce = ?)').bind(uid, day, streak, reward, now, uid, day, claimNonce),
        env.DB.prepare('UPDATE daily_checkins SET checkin_day = ?, streak = ?, total_days = total_days + 1, last_reward = ?, updated_at = ? WHERE uid = ? AND EXISTS (SELECT 1 FROM daily_checkin_claims WHERE uid = ? AND checkin_day = ? AND claim_nonce = ?)').bind(day, streak, reward, now, uid, uid, day, claimNonce)
      ]);
      const claimed = Number(results?.[0]?.meta?.changes) > 0;
      const data = await readEconomySummary(uid);
      return json({ code: 0, data: { ...data, reward: claimed ? reward : 0, alreadyCheckedIn: !claimed } });
    }

    // ── 好友、私聊、在线状态与邀战 ─────────────────────────
    if (url.pathname === '/api/friends/search' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(uid, 'search', 30, 3600000, 120)) return json({ code: 429, msg: '查找过于频繁，请稍后再试' }, 429);
      const username = String(url.searchParams.get('username') || '').trim();
      // 不静默截断搜索词：否则超长输入可能被截断成另一个真实账号，
      // 也会让客户端误以为支持模糊/前缀搜索。注册账号上限为 32 字符，
      // 搜索必须使用完整、大小写敏感的账号名。
      if (!username || username.length > 32) return json({ code: 400, msg: '请输入完整账号名（最多 32 个字符）' }, 400);
      const target = await env.DB.prepare(`
        SELECT uid, username, nickname, avatar, score FROM users
        WHERE username = ? AND username IS NOT NULL AND username != ''
      `).bind(username).first();
      if (!target || target.uid === uid || await isBlockedEitherWay(uid, target.uid)) {
        return json({ code: 404, msg: '未找到可添加的账号' }, 404);
      }
      const [a, b] = socialPair(uid, target.uid);
      const friendship = await env.DB.prepare('SELECT 1 AS ok FROM friendships WHERE user_a_uid = ? AND user_b_uid = ?').bind(a, b).first();
      const pending = await env.DB.prepare(`
        SELECT id, sender_uid, receiver_uid FROM friend_requests
        WHERE status = 'pending' AND ((sender_uid = ? AND receiver_uid = ?) OR (sender_uid = ? AND receiver_uid = ?))
        ORDER BY created_at DESC LIMIT 1
      `).bind(uid, target.uid, target.uid, uid).first();
      return json({ code: 0, data: {
        uid: target.uid,
        username: target.username,
        nickname: sanitizeText(target.nickname || target.username, 16),
        avatar: compactAvatar(target.avatar),
        score: Number(target.score) || 1000,
        relationship: friendship ? 'friend' : (pending ? (pending.sender_uid === uid ? 'outgoing' : 'incoming') : 'none'),
        requestId: pending?.id || ''
      }});
    }

    if (url.pathname === '/api/friends' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      const friendsResult = await env.DB.prepare(`
        SELECT u.uid, u.username, u.nickname, u.avatar, u.score, f.created_at,
               COALESCE(s.presence_hidden, 0) AS presence_hidden,
               COALESCE(s.presence_online, 0) AS presence_online
        FROM friendships f
        JOIN users u ON u.uid = CASE WHEN f.user_a_uid = ? THEN f.user_b_uid ELSE f.user_a_uid END
        LEFT JOIN user_social_settings s ON s.uid = u.uid
        WHERE f.user_a_uid = ? OR f.user_b_uid = ?
        ORDER BY f.created_at DESC LIMIT ${SOCIAL_MAX_FRIENDS}
      `).bind(uid, uid, uid).all();
      const requestResult = await env.DB.prepare(`
        SELECT r.id, r.sender_uid, r.receiver_uid, r.created_at,
               u.uid AS user_uid, u.username, u.nickname, u.avatar
        FROM friend_requests r
        JOIN users u ON u.uid = CASE WHEN r.sender_uid = ? THEN r.receiver_uid ELSE r.sender_uid END
        WHERE (r.sender_uid = ? OR r.receiver_uid = ?) AND r.status = 'pending'
        ORDER BY r.created_at DESC LIMIT 100
      `).bind(uid, uid, uid).all();
      const unreadResult = await env.DB.prepare(`
        SELECT m.sender_uid, COUNT(*) AS cnt
        FROM private_messages m
        LEFT JOIN message_state s ON s.uid = ? AND s.pair_key = m.pair_key
        WHERE m.receiver_uid = ? AND m.id > MAX(COALESCE(s.last_read_id, 0), COALESCE(s.cleared_before_id, 0))
        GROUP BY m.sender_uid
      `).bind(uid, uid).all();
      const now = Date.now();
      const inviteResult = await env.DB.prepare(`
        SELECT i.id, i.sender_uid, i.room_code, i.expires_at, u.username, u.nickname, u.avatar
        FROM game_invites i JOIN users u ON u.uid = i.sender_uid
        WHERE i.receiver_uid = ? AND i.status = 'pending' AND i.expires_at > ?
        ORDER BY i.created_at DESC LIMIT 20
      `).bind(uid, now).all();
      const unreadMap = new Map((unreadResult.results || []).map(row => [String(row.sender_uid), Number(row.cnt) || 0]));
      const friends = (friendsResult.results || []).map(row => ({
        uid: String(row.uid),
        username: row.username,
        nickname: sanitizeText(row.nickname || row.username, 16),
        avatar: compactAvatar(row.avatar),
        score: Number(row.score) || 1000,
        online: Number(row.presence_hidden) === 0 && Number(row.presence_online) !== 0,
        presenceHidden: Number(row.presence_hidden) !== 0,
        unread: unreadMap.get(String(row.uid)) || 0
      }));
      const requests = (requestResult.results || []).map(row => ({
        id: row.id,
        direction: row.sender_uid === uid ? 'outgoing' : 'incoming',
        uid: row.user_uid,
        username: row.username,
        nickname: sanitizeText(row.nickname || row.username, 16),
        avatar: compactAvatar(row.avatar),
        createdAt: Number(row.created_at) || 0
      }));
      const settings = await env.DB.prepare('SELECT presence_hidden, metrics_enabled FROM user_social_settings WHERE uid = ?').bind(uid).first();
      return json({ code: 0, data: {
        friends,
        requests,
        invites: (inviteResult.results || []).map(row => ({
          inviteId: row.id,
          fromUid: row.sender_uid,
          username: row.username,
          nickname: sanitizeText(row.nickname || row.username, 16),
          avatar: compactAvatar(row.avatar),
          roomCode: row.room_code,
          expiresAt: Number(row.expires_at) || 0
        })),
        // 已删除或已拉黑关系的旧消息不能让总角标永久残留，也不能旁路
        // 当前好友关系泄露对方仍在发送消息这一事实。
        unreadTotal: friends.reduce((sum, friend) => sum + friend.unread, 0),
        presenceHidden: Number(settings?.presence_hidden) !== 0,
        metricsEnabled: settings ? Number(settings.metrics_enabled) !== 0 : true
      }});
    }

    if (url.pathname === '/api/friends/requests' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      if (!consumeSocialRequestRate(uid, 'friend-request', 20, 86400000, 100)) return json({ code: 429, msg: '今日好友申请过多' }, 429);
      const targetUsername = String(body.targetUsername || '').trim().slice(0, 32);
      const target = await env.DB.prepare(`SELECT uid, username FROM users WHERE username = ? AND username IS NOT NULL AND username != ''`).bind(targetUsername).first();
      if (!target || target.uid === uid || await isBlockedEitherWay(uid, target.uid)) return json({ code: 404, msg: '未找到可添加的账号' }, 404);
      if (await areFriends(uid, target.uid)) return json({ code: 409, msg: '你们已经是好友' }, 409);
      if (await friendCount(uid) >= SOCIAL_MAX_FRIENDS || await friendCount(target.uid) >= SOCIAL_MAX_FRIENDS) return json({ code: 409, msg: '好友数量已达上限' }, 409);
      const reverse = await env.DB.prepare(`SELECT id FROM friend_requests WHERE sender_uid = ? AND receiver_uid = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).bind(target.uid, uid).first();
      const now = Date.now();
      if (reverse) {
        if (!await acceptPendingFriendRequest(reverse.id, uid, target.uid, now)) return json({ code: 409, msg: '申请状态已变化，请刷新后重试' }, 409);
        await notifySocialUser(target.uid, { kind: 'friend_accepted', fromUid: uid, at: now });
        return json({ code: 0, data: { accepted: true } });
      }
      const existing = await env.DB.prepare(`SELECT id FROM friend_requests WHERE sender_uid = ? AND receiver_uid = ? AND status = 'pending'`).bind(uid, target.uid).first();
      if (existing) return json({ code: 0, data: { requestId: existing.id, duplicate: true } });
      const id = generateSecureHex(12);
      try {
        await env.DB.prepare(`INSERT INTO friend_requests (id, pair_key, sender_uid, receiver_uid, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`).bind(id, socialPairKey(uid, target.uid), uid, target.uid, now, now).run();
      } catch (_) {
        const concurrent = await env.DB.prepare(`SELECT id, sender_uid, receiver_uid FROM friend_requests WHERE pair_key = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).bind(socialPairKey(uid, target.uid)).first();
        if (concurrent?.sender_uid === target.uid && concurrent?.receiver_uid === uid &&
            await acceptPendingFriendRequest(concurrent.id, uid, target.uid, now)) {
          await notifySocialUser(target.uid, { kind: 'friend_accepted', fromUid: uid, at: now });
          return json({ code: 0, data: { accepted: true } });
        }
        if (concurrent) return json({ code: 0, data: { requestId: concurrent.id, duplicate: true } });
        throw _;
      }
      await notifySocialUser(target.uid, { kind: 'friend_request', requestId: id, fromUid: uid, at: now });
      return json({ code: 0, data: { requestId: id } });
    }

    const friendRequestAction = url.pathname.match(/^\/api\/friends\/requests\/([A-Fa-f0-9]{24})\/(accept|reject|cancel)$/);
    if (friendRequestAction && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const [, requestId, action] = friendRequestAction;
      const record = await env.DB.prepare(`SELECT * FROM friend_requests WHERE id = ? AND status = 'pending'`).bind(requestId).first();
      if (!record) return json({ code: 404, msg: '申请不存在或已处理' }, 404);
      if (action === 'cancel' ? record.sender_uid !== uid : record.receiver_uid !== uid) return json({ code: 403, msg: '无权处理该申请' }, 403);
      const peerUid = record.sender_uid === uid ? record.receiver_uid : record.sender_uid;
      const now = Date.now();
      if (action === 'accept') {
        if (await isBlockedEitherWay(uid, peerUid)) return json({ code: 409, msg: '当前无法建立好友关系' }, 409);
        if (await friendCount(uid) >= SOCIAL_MAX_FRIENDS || await friendCount(peerUid) >= SOCIAL_MAX_FRIENDS) return json({ code: 409, msg: '好友数量已达上限' }, 409);
        if (!await acceptPendingFriendRequest(requestId, uid, peerUid, now)) return json({ code: 409, msg: '申请状态已变化，请刷新后重试' }, 409);
        await notifySocialUser(peerUid, { kind: 'friend_accepted', fromUid: uid, at: now });
      } else {
        const processed = await env.DB.prepare(`UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(action === 'cancel' ? 'cancelled' : 'rejected', now, requestId).run();
        if (!Number(processed?.meta?.changes)) return json({ code: 409, msg: '申请状态已变化，请刷新后重试' }, 409);
        await notifySocialUser(peerUid, { kind: `friend_${action}`, fromUid: uid, at: now });
      }
      return json({ code: 0 });
    }

    const friendDeleteMatch = url.pathname.match(/^\/api\/friends\/([^/]+)$/);
    if (friendDeleteMatch && request.method === 'DELETE') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const peerUid = decodeURIComponent(friendDeleteMatch[1]).slice(0, 64);
      if (!peerUid || peerUid === uid) return json({ code: 400, msg: '好友身份无效' }, 400);
      const [a, b] = socialPair(uid, peerUid);
      const now = Date.now();
      const results = await env.DB.batch([
        env.DB.prepare('DELETE FROM friendships WHERE user_a_uid = ? AND user_b_uid = ?').bind(a, b),
        env.DB.prepare(`UPDATE friend_requests SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND ((sender_uid = ? AND receiver_uid = ?) OR (sender_uid = ? AND receiver_uid = ?))`).bind(now, uid, peerUid, peerUid, uid),
        env.DB.prepare(`UPDATE game_invites SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND ((sender_uid = ? AND receiver_uid = ?) OR (sender_uid = ? AND receiver_uid = ?))`).bind(now, uid, peerUid, peerUid, uid)
      ]);
      if (Number(results?.[0]?.meta?.changes) > 0) {
        await notifySocialUser(peerUid, { kind: 'friend_removed', fromUid: uid, at: Date.now() });
      }
      return json({ code: 0 });
    }

    if (url.pathname === '/api/blocks' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      const rows = await env.DB.prepare(`
        SELECT u.uid, u.username, u.nickname, u.avatar, b.created_at
        FROM user_blocks b JOIN users u ON u.uid = b.blocked_uid
        WHERE b.blocker_uid = ? ORDER BY b.created_at DESC LIMIT 200
      `).bind(uid).all();
      return json({ code: 0, data: (rows.results || []).map(row => ({ ...row, avatar: compactAvatar(row.avatar) })) });
    }

    if (url.pathname === '/api/blocks' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      if (!consumeSocialRequestRate(uid, 'block', 60, 3600000, 240)) return json({ code: 429, msg: '黑名单操作过于频繁' }, 429);
      const targetUid = String(body.targetUid || '').trim().slice(0, 64);
      if (!targetUid || targetUid === uid) return json({ code: 400, msg: '拉黑对象无效' }, 400);
      const target = await env.DB.prepare(`SELECT uid FROM users WHERE uid = ? AND username IS NOT NULL AND username != ''`).bind(targetUid).first();
      if (!target) return json({ code: 404, msg: '账号不存在' }, 404);
      const [a, b] = socialPair(uid, targetUid);
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(`INSERT OR REPLACE INTO user_blocks (blocker_uid, blocked_uid, created_at) VALUES (?, ?, ?)`).bind(uid, targetUid, now),
        env.DB.prepare(`DELETE FROM friendships WHERE user_a_uid = ? AND user_b_uid = ?`).bind(a, b),
        env.DB.prepare(`UPDATE friend_requests SET status = 'blocked', updated_at = ? WHERE status = 'pending' AND ((sender_uid = ? AND receiver_uid = ?) OR (sender_uid = ? AND receiver_uid = ?))`).bind(now, uid, targetUid, targetUid, uid),
        env.DB.prepare(`UPDATE game_invites SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND ((sender_uid = ? AND receiver_uid = ?) OR (sender_uid = ? AND receiver_uid = ?))`).bind(now, uid, targetUid, targetUid, uid),
        env.DB.prepare(`DELETE FROM recent_opponent_reports WHERE (reporter_uid = ? AND opponent_uid = ?) OR (reporter_uid = ? AND opponent_uid = ?)`).bind(uid, targetUid, targetUid, uid),
        env.DB.prepare(`DELETE FROM recent_opponents WHERE (uid = ? AND opponent_uid = ?) OR (uid = ? AND opponent_uid = ?)`).bind(uid, targetUid, targetUid, uid)
      ]);
      await notifySocialUser(targetUid, { kind: 'relationship_changed', at: now });
      return json({ code: 0 });
    }

    if (url.pathname === '/api/blocks' && request.method === 'DELETE') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      await env.DB.prepare('DELETE FROM user_blocks WHERE blocker_uid = ? AND blocked_uid = ?').bind(auth.user.uid, String(body.targetUid || '')).run();
      return json({ code: 0 });
    }

    if (url.pathname === '/api/messages' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const friendUid = String(url.searchParams.get('friendUid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      if (!await areFriends(uid, friendUid) || await isBlockedEitherWay(uid, friendUid)) return json({ code: 403, msg: '仅好友可以查看私聊' }, 403);
      const pairKey = socialPairKey(uid, friendUid);
      const state = await env.DB.prepare('SELECT cleared_before_id FROM message_state WHERE uid = ? AND pair_key = ?').bind(uid, pairKey).first();
      const requestedBefore = Number(url.searchParams.get('before'));
      const before = Number.isSafeInteger(requestedBefore) && requestedBefore > 0 ? requestedBefore : Number.MAX_SAFE_INTEGER;
      const requestedLimit = Number(url.searchParams.get('limit'));
      const limit = Number.isSafeInteger(requestedLimit) ? Math.min(SOCIAL_MAX_PAGE_SIZE, Math.max(1, requestedLimit)) : 30;
      const rows = await env.DB.prepare(`
        SELECT id, sender_uid, receiver_uid, body, created_at FROM private_messages
        WHERE pair_key = ? AND id < ? AND id > ? ORDER BY id DESC LIMIT ?
      `).bind(pairKey, before, Number(state?.cleared_before_id) || 0, limit).all();
      return json({ code: 0, data: (rows.results || []).reverse() });
    }

    if (url.pathname === '/api/messages' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const receiverUid = String(body.receiverUid || '').trim().slice(0, 64);
      const text = String(body.text || '').trim();
      const clientMessageId = String(body.clientMessageId || '').trim();
      if (!text || Array.from(text).length > SOCIAL_MAX_MESSAGE_CHARS || !/^[A-Za-z0-9_-]{8,80}$/.test(clientMessageId)) {
        return json({ code: 400, msg: `消息内容需为 1-${SOCIAL_MAX_MESSAGE_CHARS} 个字符` }, 400);
      }
      if (!consumeSocialRequestRate(uid, 'message', 60, 60000, 600)) return json({ code: 429, msg: '消息发送过快' }, 429);
      if (!await areFriends(uid, receiverUid) || await isBlockedEitherWay(uid, receiverUid)) return json({ code: 403, msg: '仅好友可以私聊' }, 403);
      const pairKey = socialPairKey(uid, receiverUid);
      const [friendA, friendB] = socialPair(uid, receiverUid);
      const now = Date.now();
      const insertResult = await env.DB.prepare(`
        INSERT OR IGNORE INTO private_messages (pair_key, sender_uid, receiver_uid, client_message_id, body, created_at)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM friendships WHERE user_a_uid = ? AND user_b_uid = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM user_blocks
          WHERE (blocker_uid = ? AND blocked_uid = ?) OR (blocker_uid = ? AND blocked_uid = ?)
        )
      `).bind(pairKey, uid, receiverUid, clientMessageId, text, now,
        friendA, friendB, uid, receiverUid, receiverUid, uid).run();
      const message = await env.DB.prepare(`SELECT id, sender_uid, receiver_uid, body, created_at FROM private_messages WHERE sender_uid = ? AND client_message_id = ?`).bind(uid, clientMessageId).first();
      if (!message) return json({ code: 403, msg: '好友关系已变化，消息未发送' }, 403);
      // clientMessageId 对发送方全局唯一。重试若改变接收人或正文，不能把
      // 旧会话的消息当作本次成功结果返回。
      if (!message || String(message.receiver_uid) !== receiverUid || String(message.body) !== text) {
        return json({ code: 409, msg: '客户端消息 ID 已用于另一条消息' }, 409);
      }
      if (Number(insertResult?.meta?.changes) > 0) {
        // 私聊是双方明确的互动信号：只给真实好友关系增加固定 1 点，
        // 不接受客户端提交的好感度数值，也不在日志中记录消息正文。
        await env.DB.prepare(`
          INSERT INTO social_affinity (pair_key, user_a_uid, user_b_uid, points, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(pair_key) DO UPDATE SET
            points = MIN(?, social_affinity.points + 1),
            updated_at = excluded.updated_at
        `).bind(pairKey, friendA, friendB, now, SOCIAL_AFFINITY_MAX_POINTS).run();
        await notifySocialUser(receiverUid, { kind: 'message', fromUid: uid, messageId: Number(message?.id) || 0, at: now });
      }
      return json({ code: 0, data: message });
    }

    if (url.pathname === '/api/messages/read' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const friendUid = String(body.friendUid || '').trim().slice(0, 64);
      const requestedMessageId = Number(body.lastMessageId);
      const lastMessageId = Number.isSafeInteger(requestedMessageId) && requestedMessageId > 0 ? requestedMessageId : 0;
      if (!await areFriends(uid, friendUid) || await isBlockedEitherWay(uid, friendUid)) return json({ code: 403, msg: '好友关系无效' }, 403);
      const pairKey = socialPairKey(uid, friendUid);
      await env.DB.prepare(`
        INSERT INTO message_state (uid, pair_key, last_read_id, cleared_before_id) VALUES (?, ?, ?, 0)
        ON CONFLICT(uid, pair_key) DO UPDATE SET last_read_id = MAX(message_state.last_read_id, excluded.last_read_id)
      `).bind(uid, pairKey, lastMessageId).run();
      return json({ code: 0 });
    }

    if (url.pathname === '/api/messages/clear' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const friendUid = String(body.friendUid || '').trim().slice(0, 64);
      if (!await areFriends(uid, friendUid) || await isBlockedEitherWay(uid, friendUid)) return json({ code: 403, msg: '好友关系无效' }, 403);
      const pairKey = socialPairKey(uid, friendUid);
      const latest = await env.DB.prepare('SELECT MAX(id) AS max_id FROM private_messages WHERE pair_key = ?').bind(pairKey).first();
      const maxId = Number(latest?.max_id) || 0;
      await env.DB.prepare(`
        INSERT INTO message_state (uid, pair_key, last_read_id, cleared_before_id) VALUES (?, ?, ?, ?)
        ON CONFLICT(uid, pair_key) DO UPDATE SET
          last_read_id = MAX(message_state.last_read_id, excluded.last_read_id),
          cleared_before_id = MAX(message_state.cleared_before_id, excluded.cleared_before_id)
      `).bind(uid, pairKey, maxId, maxId).run();
      return json({ code: 0 });
    }

    if (url.pathname === '/api/recent-opponents' && request.method === 'GET') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      const auth = await requireRegisteredUser(uid, getRequestToken(request));
      if (auth.response) return auth.response;
      const rows = await env.DB.prepare(`
        SELECT u.uid, u.username, u.nickname, u.avatar, u.score, r.games_count, r.last_played_at
        FROM recent_opponents r JOIN users u ON u.uid = r.opponent_uid
        WHERE r.uid = ? AND NOT EXISTS (
          SELECT 1 FROM user_blocks b WHERE (b.blocker_uid = ? AND b.blocked_uid = u.uid) OR (b.blocker_uid = u.uid AND b.blocked_uid = ?)
        ) ORDER BY r.last_played_at DESC LIMIT 30
      `).bind(uid, uid, uid).all();
      return json({ code: 0, data: (rows.results || []).map(row => ({ ...row, avatar: compactAvatar(row.avatar) })) });
    }

    if (url.pathname === '/api/recent-opponents' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const opponentUid = String(body.opponentUid || '').trim().slice(0, 64);
      if (!opponentUid || opponentUid === uid) return json({ code: 400, msg: '对手身份无效' }, 400);
      if (!consumeSocialRequestRate(uid, 'recent-opponent', 60, 60000, 300)) return json({ code: 429, msg: '对手记录更新过于频繁' }, 429);
      // 单方客户端上报不能证明真实对局，也不能让 6 位 UID 被批量枚举。
      // 两个正式账号需在 10 分钟内互相上报，才把该用户对写入双方最近对手。
      const unconfirmed = () => json({ code: 0, data: { confirmed: false } });
      if (await isBlockedEitherWay(uid, opponentUid)) return unconfirmed();
      const opponent = await env.DB.prepare(`SELECT uid FROM users WHERE uid = ? AND username IS NOT NULL AND username != ''`).bind(opponentUid).first();
      if (!opponent) return unconfirmed();
      const now = Date.now();
      const cutoff = now - 10 * 60 * 1000;
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO recent_opponent_reports (reporter_uid, opponent_uid, reported_at) VALUES (?, ?, ?)
          ON CONFLICT(reporter_uid, opponent_uid) DO UPDATE SET reported_at = excluded.reported_at
        `).bind(uid, opponentUid, now),
        env.DB.prepare(`DELETE FROM recent_opponent_reports WHERE reported_at < ?`).bind(cutoff)
      ]);
      const reciprocal = await env.DB.prepare(`
        SELECT 1 AS ok FROM recent_opponent_reports
        WHERE reporter_uid = ? AND opponent_uid = ? AND reported_at >= ?
      `).bind(opponentUid, uid, cutoff).first();
      if (!reciprocal) return unconfirmed();
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO recent_opponents (uid, opponent_uid, games_count, last_played_at)
          SELECT ?, ?, 1, ? WHERE NOT EXISTS (
            SELECT 1 FROM user_blocks
            WHERE (blocker_uid = ? AND blocked_uid = ?) OR (blocker_uid = ? AND blocked_uid = ?)
          )
          ON CONFLICT(uid, opponent_uid) DO UPDATE SET games_count = recent_opponents.games_count + 1, last_played_at = excluded.last_played_at
        `).bind(uid, opponentUid, now, uid, opponentUid, opponentUid, uid),
        env.DB.prepare(`
          INSERT INTO recent_opponents (uid, opponent_uid, games_count, last_played_at)
          SELECT ?, ?, 1, ? WHERE NOT EXISTS (
            SELECT 1 FROM user_blocks
            WHERE (blocker_uid = ? AND blocked_uid = ?) OR (blocker_uid = ? AND blocked_uid = ?)
          )
          ON CONFLICT(uid, opponent_uid) DO UPDATE SET games_count = recent_opponents.games_count + 1, last_played_at = excluded.last_played_at
        `).bind(opponentUid, uid, now, uid, opponentUid, opponentUid, uid),
        env.DB.prepare(`DELETE FROM recent_opponent_reports WHERE (reporter_uid = ? AND opponent_uid = ?) OR (reporter_uid = ? AND opponent_uid = ?)`).bind(uid, opponentUid, opponentUid, uid),
        env.DB.prepare(`DELETE FROM recent_opponents WHERE uid = ? AND opponent_uid NOT IN (SELECT opponent_uid FROM recent_opponents WHERE uid = ? ORDER BY last_played_at DESC LIMIT 30)`).bind(uid, uid),
        env.DB.prepare(`DELETE FROM recent_opponents WHERE uid = ? AND opponent_uid NOT IN (SELECT opponent_uid FROM recent_opponents WHERE uid = ? ORDER BY last_played_at DESC LIMIT 30)`).bind(opponentUid, opponentUid)
      ]);
      return json({ code: 0, data: { confirmed: true } });
    }

    if (url.pathname === '/api/game-invites' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const friendUid = String(body.friendUid || '').trim().slice(0, 64);
      const roomCode = String(body.roomCode || '').trim();
      if (!/^\d{6}$/.test(roomCode)) return json({ code: 400, msg: '房间尚未准备好' }, 400);
      if (!consumeSocialRequestRate(uid, 'invite', 20, 60000, 120)) return json({ code: 429, msg: '邀战发送过快' }, 429);
      if (!await areFriends(uid, friendUid) || await isBlockedEitherWay(uid, friendUid)) return json({ code: 403, msg: '仅好友可以邀战' }, 403);
      const now = Date.now();
      const id = generateSecureHex(12);
      const [friendA, friendB] = socialPair(uid, friendUid);
      const inserted = await env.DB.prepare(`
        INSERT INTO game_invites (id, sender_uid, receiver_uid, room_code, status, created_at, expires_at, updated_at)
        SELECT ?, ?, ?, ?, 'pending', ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM friendships WHERE user_a_uid = ? AND user_b_uid = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM user_blocks
          WHERE (blocker_uid = ? AND blocked_uid = ?) OR (blocker_uid = ? AND blocked_uid = ?)
        )
      `).bind(id, uid, friendUid, roomCode, now, now + SOCIAL_INVITE_TTL_MS, now,
        friendA, friendB, uid, friendUid, friendUid, uid).run();
      if (!Number(inserted?.meta?.changes)) return json({ code: 403, msg: '好友关系已变化，邀战未发送' }, 403);
      await notifySocialUser(friendUid, { kind: 'game_invite', inviteId: id, fromUid: uid, roomCode, expiresAt: now + SOCIAL_INVITE_TTL_MS });
      return json({ code: 0, data: { inviteId: id, expiresAt: now + SOCIAL_INVITE_TTL_MS } });
    }

    const inviteAction = url.pathname.match(/^\/api\/game-invites\/([A-Fa-f0-9]{24})\/respond$/);
    if (inviteAction && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      const uid = String(auth.user.uid);
      const invite = await env.DB.prepare(`SELECT * FROM game_invites WHERE id = ? AND receiver_uid = ?`).bind(inviteAction[1], uid).first();
      if (!invite) return json({ code: 404, msg: '邀战不存在' }, 404);
      const now = Date.now();
      if (invite.status !== 'pending' || Number(invite.expires_at) <= now) {
        await env.DB.prepare(`UPDATE game_invites SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, invite.id).run();
        return json({ code: 410, msg: '邀战已失效' }, 410);
      }
      const response = ['accepted', 'rejected', 'busy'].includes(body.response) ? body.response : 'rejected';
      if (!await areFriends(uid, invite.sender_uid) || await isBlockedEitherWay(uid, invite.sender_uid)) return json({ code: 403, msg: '邀战已失效' }, 403);
      const claimed = await env.DB.prepare(`
        UPDATE game_invites SET status = ?, updated_at = ?
        WHERE id = ? AND receiver_uid = ? AND status = 'pending' AND expires_at > ?
      `).bind(response, now, invite.id, uid, now).run();
      if (!Number(claimed?.meta?.changes)) return json({ code: 410, msg: '邀战已失效' }, 410);
      await notifySocialUser(invite.sender_uid, { kind: 'game_invite_response', inviteId: invite.id, fromUid: uid, response, at: now });
      return json({ code: 0, data: { roomCode: response === 'accepted' ? invite.room_code : '' } });
    }

    if (url.pathname === '/api/social/settings' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(auth.user.uid, 'social-settings', 30, 60000, 120)) return json({ code: 429, msg: '设置更新过于频繁' }, 429);
      const hidden = body.presenceHidden === true ? 1 : 0;
      const metrics = body.metricsEnabled === false ? 0 : 1;
      await env.DB.prepare(`
        INSERT INTO user_social_settings (uid, presence_hidden, metrics_enabled, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET presence_hidden = excluded.presence_hidden, metrics_enabled = excluded.metrics_enabled, updated_at = excluded.updated_at
      `).bind(auth.user.uid, hidden, metrics, Date.now()).run();
      const visibleOnline = hidden === 0 && await socialPresence(auth.user.uid);
      await notifySocialFriends(auth.user.uid, { kind: 'presence', uid: auth.user.uid, online: visibleOnline, refresh: true, at: Date.now() });
      return json({ code: 0 });
    }

    if (url.pathname === '/api/social/socket-ticket' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const auth = await getSocialAuthFromBody(body);
      if (auth.response) return auth.response;
      if (!consumeSocialRequestRate(auth.user.uid, 'social-ticket', 60, 60000, 180)) return json({ code: 429, msg: '连接请求过于频繁' }, 429);
      const ticket = generateSecureHex(24);
      const ticketHash = await hashWithSalt(ticket, 'social-ticket');
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM social_socket_tickets WHERE expires_at <= ? OR used != 0').bind(now),
        env.DB.prepare('INSERT INTO social_socket_tickets (ticket_hash, uid, expires_at, used) VALUES (?, ?, ?, 0)').bind(ticketHash, auth.user.uid, now + SOCIAL_TICKET_TTL_MS)
      ]);
      return json({ code: 0, data: { ticket, expiresAt: now + SOCIAL_TICKET_TTL_MS } });
    }

    if (url.pathname === '/api/social/socket' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ code: 426, msg: '需要 WebSocket 升级' }, 426);
      if (!env.GOMOKU_SOCIAL) return json({ code: 503, msg: '好友实时服务尚未部署' }, 503);
      const ticket = String(url.searchParams.get('ticket') || '');
      if (!/^[A-Fa-f0-9]{48}$/.test(ticket)) return json({ code: 401, msg: '好友连接票据无效' }, 401);
      const ticketHash = await hashWithSalt(ticket, 'social-ticket');
      const now = Date.now();
      const record = await env.DB.prepare(`SELECT uid FROM social_socket_tickets WHERE ticket_hash = ? AND used = 0 AND expires_at > ?`).bind(ticketHash, now).first();
      if (!record) return json({ code: 401, msg: '好友连接票据已失效' }, 401);
      const claimed = await env.DB.prepare(`UPDATE social_socket_tickets SET used = 1 WHERE ticket_hash = ? AND used = 0 AND expires_at > ?`).bind(ticketHash, now).run();
      if (!claimed.meta?.changes) return json({ code: 401, msg: '好友连接票据已使用' }, 401);
      const id = env.GOMOKU_SOCIAL.idFromName(`social:${record.uid}`);
      const headers = new Headers(request.headers);
      headers.set('X-Gomoku-Social-Uid', String(record.uid));
      return env.GOMOKU_SOCIAL.get(id).fetch(new Request('https://social.internal/socket', { method: 'GET', headers }));
    }

    if (url.pathname === '/api/metrics' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!consumeSocialRate(ip, 'metrics', 30, 3600000)) return json({ code: 429, msg: '统计提交过于频繁' }, 429);
      const body = await readJsonBody(request);
      const samples = Array.isArray(body.samples) ? body.samples.slice(0, 20) : [];
      const rawVersion = sanitizeText(body.clientVersion || '', 20);
      const version = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,12})?$/.test(rawVersion) ? rawVersion : 'unknown';
      const rawPlatform = sanitizeText(body.platform || '', 20).toLowerCase();
      const platform = new Set(['web', 'android', 'single-file']).has(rawPlatform) ? rawPlatform : 'unknown';
      const day = new Date().toISOString().slice(0, 10);
      const statements = [];
      const timingBuckets = new Set(['fast', 'normal', 'slow', 'very_slow']);
      const allowedBucketsByMetric = new Map([
        ['fcp', timingBuckets],
        ['dcl', timingBuckets],
        ['board_ready', timingBuckets],
        ['interactive', timingBuckets],
        ['network_rtt', timingBuckets],
        ['reconnect_ms', timingBuckets],
        ['reconnect_result', new Set(['success', 'failure'])],
        ['graphics_quality', new Set(['auto', 'high', 'standard', 'smooth'])]
      ]);
      const allowedEndpoints = new Set(['', 'pages', 'worker']);
      const allowedRoutes = new Set(['', 'direct', 'turn', 'websocket']);
      for (const sample of samples) {
        const metric = sanitizeText(sample?.metric || '', 32);
        const bucket = sanitizeText(sample?.bucket || '', 24);
        const endpoint = sanitizeText(sample?.endpoint || '', 20);
        const route = sanitizeText(sample?.route || '', 20);
        const value = Number(sample?.value);
        const metricBuckets = allowedBucketsByMetric.get(metric);
        if (!metricBuckets?.has(bucket) || !allowedEndpoints.has(endpoint) || !allowedRoutes.has(route) ||
            (metric === 'graphics_quality' && value !== 1) ||
            !Number.isFinite(value) || value < 0 || value > 3600000) continue;
        statements.push(env.DB.prepare(`
          INSERT INTO metrics_daily (day, client_version, platform, metric, bucket, endpoint, route, sample_count, value_sum, value_min, value_max)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(day, client_version, platform, metric, bucket, endpoint, route) DO UPDATE SET
            sample_count = metrics_daily.sample_count + 1,
            value_sum = metrics_daily.value_sum + excluded.value_sum,
            value_min = MIN(metrics_daily.value_min, excluded.value_min),
            value_max = MAX(metrics_daily.value_max, excluded.value_max)
        `).bind(day, version, platform, metric, bucket, endpoint, route, value, value, value));
      }
      if (statements.length) await env.DB.batch(statements);
      return json({ code: 0, data: { accepted: statements.length } });
    }

    // ── 智能动态 UID 分配引擎（支持 6 位靓号到亿级自动平滑扩容） ──
async function allocateNextAvailableUid(env) {
  // 1. 优先分配 6 位普通与靓号 UID (100000 ~ 999999，容量 90 万)
  for (let i = 0; i < 10; i++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    const exist = await env.DB.prepare("SELECT uid FROM users WHERE uid = ? OR username = ?").bind(candidate, candidate).first();
    if (!exist) return candidate;
  }
  // 2. 用户量激增至百万以上时，全自动自适应扩容至 7 位、8 位、9 位乃至百亿级
  for (let digits = 7; digits <= 10; digits++) {
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    for (let i = 0; i < 6; i++) {
      const candidate = String(Math.floor(min + Math.random() * (max - min)));
      const exist = await env.DB.prepare("SELECT uid FROM users WHERE uid = ? OR username = ?").bind(candidate, candidate).first();
      if (!exist) return candidate;
    }
  }
  return String(Date.now()).slice(-8) + Math.floor(10 + Math.random() * 90);
}

    // ── 2. 游客免密快速入场（纯本地处理，绝不存入数据库，不上天梯榜） ──
    if (url.pathname === '/api/auth/guest' && request.method === 'POST') {
      try {
        const defaultName = generateRandomNickname();
        const defaultAvatar = generateRandomAvatar();
        return json({
          code: 0,
          msg: '游客身份仅本地可用，未写入数据库',
          data: {
            uid: 'guest_' + Math.floor(100000 + Math.random() * 900000),
            username: null,
            nickname: defaultName,
            avatar: defaultAvatar,
            score: 1000,
            wins: 0,
            total_games: 0,
            token: null
          }
        });
      } catch (err) {
        return publicServerError('游客创建异常', err);
      }
    }

    // ── 3. 注册正式账号 ─────────────────────────────────
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { username, password, nickname, avatar, uid, token, securityQuestion, securityAnswer } = body;

        if (!username || typeof username !== 'string' || !username.trim()) {
          return json({ code: 1, msg: '请输入有效的账号名称' });
        }
        if (username.trim().length > 32) {
          return json({ code: 1, msg: '账号名称长度最多 32 个字符' });
        }
        if (!password || typeof password !== 'string' || password.length < 6 || password.length > 32) {
          return json({ code: 1, msg: '密码长度须至少 6 位（支持 6~32 位）' });
        }

        // IP rate limit: max 3 registrations per IP per 24h
        // 只信任 Cloudflare 注入的真实来源地址；客户端可伪造 X-Forwarded-For，不能拿它做限流依据。
        const clientIp = String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64);
        try {
          const oneDayAgo = Date.now() - 86400000;
          const ipCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM ip_register_log WHERE ip = ? AND created_at > ?').bind(clientIp, oneDayAgo).first();
          if (ipCount && ipCount.cnt >= 3) {
            return json({ code: 429, msg: '⚠️ 该网络今日注册账号过多，请明天再试（每IP每天限注册3个账号）' });
          }
        } catch(e) {}

        const safeUsername = sanitizeText(username, 32);
        if (!safeUsername) {
          return json({ code: 1, msg: '账号名称包含无效字符，请重新输入' }, 400);
        }
        const safeNick = sanitizeText(nickname, 12) || safeUsername;
        const safeAvatar = sanitizeAvatar(avatar);

        const exist = await env.DB.prepare('SELECT uid FROM users WHERE username = ? OR uid = ?').bind(safeUsername, safeUsername).first();
        if (exist) {
          return json({ code: 1, msg: '该账号名称已被注册，请换一个' });
        }

        const now = Date.now();
        const expiresAt = now + 365 * 24 * 3600 * 1000;
        const salt = generateSecureHex(16);
        const passwordHash = await hashPassword(password, salt);
        const newToken = generateSecureHex(24);
        const newRefreshToken = generateSecureHex(REFRESH_TOKEN_BYTES);

        const safeQ = sanitizeText(securityQuestion, 60) || '你最喜欢的人是谁？';
        const cleanAnswer = (securityAnswer && typeof securityAnswer === 'string') ? securityAnswer.trim().toLowerCase() : '';
        const secSalt = generateSecureHex(16);
        const secAnswerHash = cleanAnswer ? await hashWithSalt(cleanAnswer, secSalt) : null;

        if (uid && token) {
          const guest = await env.DB.prepare('SELECT uid, username FROM users WHERE uid = ? AND token = ?').bind(String(uid), String(token)).first();
          if (guest && !guest.username) {
            const guestRefreshTokenHash = await hashWithSalt(newRefreshToken, String(uid));
            await env.DB.prepare(`
              UPDATE users
              SET username = ?, password_hash = ?, salt = ?, password_algo = 'pbkdf2', token = ?, token_expires_at = ?,
                  refresh_token_hash = ?, refresh_token_expires_at = ?,
                  security_q = ?, security_a_hash = ?, security_salt = ?,
                  failed_login_count = 0, locked_until = 0, nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
              WHERE uid = ?
            `).bind(safeUsername, passwordHash, salt, newToken, expiresAt, guestRefreshTokenHash, expiresAt, safeQ, secAnswerHash, secSalt, safeNick, safeAvatar, uid).run();

            try { await env.DB.prepare('INSERT INTO ip_register_log (ip, created_at) VALUES (?, ?)').bind(clientIp, Date.now()).run(); } catch(e){}
            const updated = await env.DB.prepare('SELECT uid, username, nickname, avatar, score, wins, total_games, token, security_q FROM users WHERE uid = ?').bind(uid).first();
            cachedLeaderboard = null;
            lastLeaderboardTime = 0;
            return json({ code: 0, msg: '账号绑定升级成功！', data: { ...updated, token: newToken, refreshToken: newRefreshToken } });
          }
        }

        const newUid = await allocateNextAvailableUid(env);
        const finalRefreshTokenHash = await hashWithSalt(newRefreshToken, newUid);
        await env.DB.prepare(`
          INSERT INTO users (uid, username, password_hash, salt, password_algo, token, token_expires_at, refresh_token_hash, refresh_token_expires_at, security_q, security_a_hash, security_salt, failed_login_count, locked_until, nickname, avatar, score, wins, total_games)
          VALUES (?, ?, ?, ?, 'pbkdf2', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1000, 0, 0)
        `).bind(newUid, safeUsername, passwordHash, salt, newToken, expiresAt, finalRefreshTokenHash, expiresAt, safeQ, secAnswerHash, secSalt, safeNick, safeAvatar).run();

        try { await env.DB.prepare('INSERT INTO ip_register_log (ip, created_at) VALUES (?, ?)').bind(clientIp, Date.now()).run(); } catch(e){}
        const created = await env.DB.prepare('SELECT uid, username, nickname, avatar, score, wins, total_games, token, security_q FROM users WHERE uid = ?').bind(newUid).first();
        cachedLeaderboard = null;
        lastLeaderboardTime = 0;
        return json({ code: 0, msg: '注册成功并已自动登录！', data: { ...created, token: newToken, refreshToken: newRefreshToken } });
      } catch (err) {
        return publicServerError('注册异常', err);
      }
    }

    // ── 3.5 用户资料更新（昵称即账号名，改昵称即改账号名） ───────
    if (url.pathname === '/api/user/update_profile' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid, token, nickname, avatar } = body;
        if (!uid) return json({ code: 1, msg: '缺少 uid' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const user = auth.user;

        const safeNick = nickname ? sanitizeText(nickname, 16) : null;
        const safeAvatar = avatar ? sanitizeAvatar(avatar) : null;

        if (safeNick) {
          // 检查该账号名/昵称是否已被其他注册用户占用
          const exist = await env.DB.prepare('SELECT uid FROM users WHERE (username = ? OR nickname = ?) AND uid != ?').bind(safeNick, safeNick, String(uid)).first();
          if (exist) {
            return json({ code: 1, msg: '该账号名称已被其他玩家占用，请换一个' });
          }
        }

        // 🌟 核心：昵称即账号名，改昵称就是改账号名！同时更新 username 与 nickname
        if (safeNick && safeAvatar) {
          await env.DB.prepare('UPDATE users SET username = ?, nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?').bind(safeNick, safeNick, safeAvatar, String(uid)).run();
        } else if (safeNick) {
          await env.DB.prepare('UPDATE users SET username = ?, nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?').bind(safeNick, safeNick, String(uid)).run();
        } else if (safeAvatar) {
          await env.DB.prepare('UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?').bind(safeAvatar, String(uid)).run();
        }

        cachedLeaderboard = null;
        lastLeaderboardTime = 0;
        const finalName = safeNick || user.username || user.nickname;
        return json({
          code: 0,
          msg: '账号与昵称已成功同步更新！',
          data: {
            uid: String(uid),
            username: finalName,
            nickname: finalName,
            avatar: safeAvatar || sanitizeAvatar(user.avatar)
          }
        });
      } catch (err) {
        return publicServerError('资料更新异常', err);
      }
    }

    // ── 3.8 永久登录态验证与自动续期 (1年超长无感免登) ────────
    if (url.pathname === "/api/auth/verify_session" && request.method === "POST") {
      if (!env.DB) return json({ code: 1, msg: "数据库未连接" }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid, token } = body;
        if (!uid) return json({ code: 1, msg: "缺少 uid" });

        const user = await env.DB.prepare(
          "SELECT uid, username, nickname, avatar, score, wins, total_games, token, token_expires_at, refresh_token_hash, refresh_token_expires_at, security_q FROM users WHERE uid = ?"
        ).bind(String(uid)).first();

        if (!user) {
          return json({ code: 1, msg: "用户不存在" });
        }

        const now = Date.now();
        const oneYear = AUTH_SESSION_TTL_MS;

        // 如果用户已绑定了正式账号名
        if (user.username) {
          if (token && user.token && token === user.token && (!user.token_expires_at || user.token_expires_at > now)) {
            const freshToken = user.token || generateSecureHex(24);
            const freshRefreshToken = generateSecureHex(REFRESH_TOKEN_BYTES);
            const freshRefreshTokenHash = await hashWithSalt(freshRefreshToken, String(user.uid));
            const expiresAt = now + oneYear;
            await env.DB.prepare("UPDATE users SET token = ?, token_expires_at = ?, refresh_token_hash = ?, refresh_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?").bind(freshToken, expiresAt, freshRefreshTokenHash, expiresAt, user.uid).run();

            return json({
              code: 0,
              msg: "正式账号凭证有效",
              data: {
                uid: user.uid,
                username: user.username,
                nickname: user.nickname,
                avatar: sanitizeAvatar(user.avatar),
                score: user.score,
                wins: user.wins,
                total_games: user.total_games,
                security_q: user.security_q,
                token: freshToken,
                refreshToken: freshRefreshToken
              }
            });
          }
          return json({ code: 2, msg: "凭证已失效，需输入密码登录" });
        } else {
          // 兼容历史上曾写入 D1 的游客账号，但不再允许无凭证续期。
          if (!token || !user.token || token !== user.token || (user.token_expires_at && user.token_expires_at <= now)) {
            return json({ code: 401, msg: "游客凭证已失效" }, 401);
          }
          const freshToken = user.token;
          const expiresAt = now + oneYear;
          await env.DB.prepare("UPDATE users SET token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?").bind(freshToken, expiresAt, user.uid).run();
          return json({
            code: 0,
            msg: "游客凭证有效",
            data: {
              uid: user.uid,
              username: null,
              nickname: user.nickname,
              avatar: sanitizeAvatar(user.avatar),
              score: user.score,
              wins: user.wins,
              total_games: user.total_games,
              token: freshToken
            }
          });
        }
      } catch (err) {
        return publicServerError('会话验证异常', err);
      }
    }

    // ── 3.9 Refresh Token 无感换发（更新/重启后无需再次输入密码） ───
    if (url.pathname === "/api/auth/refresh_session" && request.method === "POST") {
      if (!env.DB) return json({ code: 1, msg: "数据库未连接" }, 500);
      try {
        const body = await readJsonBody(request);
        const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
        const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
        if (!uid || uid.length > 64 || !/^[0-9a-f]{64}$/i.test(refreshToken)) {
          return json({ code: 2, msg: "登录凭证已失效，请重新登录" }, 401);
        }

        const user = await env.DB.prepare(
          "SELECT uid, username, nickname, avatar, score, wins, total_games, security_q, refresh_token_hash, refresh_token_expires_at FROM users WHERE uid = ? AND username IS NOT NULL AND username != ?"
        ).bind(uid, '').first();
        const now = Date.now();
        if (!user || !user.refresh_token_hash || !user.refresh_token_expires_at || Number(user.refresh_token_expires_at) <= now) {
          return json({ code: 2, msg: "登录凭证已失效，请重新登录" }, 401);
        }

        const calculatedHash = await hashWithSalt(refreshToken, String(user.uid));
        if (calculatedHash !== user.refresh_token_hash) {
          return json({ code: 2, msg: "登录凭证已失效，请重新登录" }, 401);
        }

        const freshToken = generateSecureHex(24);
        const freshRefreshToken = generateSecureHex(REFRESH_TOKEN_BYTES);
        const freshRefreshTokenHash = await hashWithSalt(freshRefreshToken, String(user.uid));
        const expiresAt = now + AUTH_SESSION_TTL_MS;
        await env.DB.prepare(
          "UPDATE users SET token = ?, token_expires_at = ?, refresh_token_hash = ?, refresh_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?"
        ).bind(freshToken, expiresAt, freshRefreshTokenHash, expiresAt, user.uid).run();

        return json({
          code: 0,
          msg: "登录状态已自动续期",
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: sanitizeAvatar(user.avatar),
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            security_q: user.security_q,
            token: freshToken,
            refreshToken: freshRefreshToken
          }
        });
      } catch (err) {
        return publicServerError('会话续期异常', err);
      }
    }

    // ── 4. 账号登录（5 次错误锁定 5 分钟时间限制） ───────
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { username, password } = await readJsonBody(request);
        if (typeof username !== 'string' || typeof password !== 'string' ||
            !username.trim() || username.trim().length > 32 || password.length < 6 || password.length > 32) {
          return json({ code: 1, msg: '账号或密码格式不正确' }, 400);
        }

        const now = Date.now();
        const loginName = username.trim();
        const user = await env.DB.prepare('SELECT * FROM users WHERE (username = ? OR uid = ? OR nickname = ?)').bind(loginName, loginName, loginName).first();
        if (!user) {
          return json({ code: 1, msg: '账号或密码不正确' });
        }

        if (user.locked_until && user.locked_until > now) {
          const remain = Math.ceil((user.locked_until - now) / 1000);
          return json({ code: 429, msg: `密码输错过多，账号保护性锁定中！请在 ${remain} 秒后再试` });
        }

        const calcHash = await hashPassword(password, user.salt);
        if (calcHash !== user.password_hash) {
          const newFailCount = (user.failed_login_count || 0) + 1;
          if (newFailCount >= 5) {
            const lockTime = now + 5 * 60 * 1000;
            await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE uid = ?').bind(newFailCount, lockTime, user.uid).run();
            return json({ code: 429, msg: '密码连续错误满 5 次！为防止被盗，账号已被锁定 5 分钟' });
          } else {
            await env.DB.prepare('UPDATE users SET failed_login_count = ? WHERE uid = ?').bind(newFailCount, user.uid).run();
            return json({ code: 1, msg: `账号或密码错误（连续错误 5 次锁定，还可尝试 ${5 - newFailCount} 次）` });
          }
        }

        const freshToken = generateSecureHex(24);
        const freshRefreshToken = generateSecureHex(REFRESH_TOKEN_BYTES);
        const freshRefreshTokenHash = await hashWithSalt(freshRefreshToken, String(user.uid));
        const expiresAt = now + AUTH_SESSION_TTL_MS;
        await env.DB.prepare(`
          UPDATE users
          SET failed_login_count = 0, locked_until = 0, password_hash = ?, salt = ?, password_algo = 'pbkdf2',
              token = ?, token_expires_at = ?, refresh_token_hash = ?, refresh_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(calcHash, user.salt, freshToken, expiresAt, freshRefreshTokenHash, expiresAt, user.uid).run();

        return json({
          code: 0,
          msg: '登录成功！',
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: sanitizeAvatar(user.avatar),
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            security_q: user.security_q,
            token: freshToken,
            refreshToken: freshRefreshToken
          }
        });
      } catch (err) {
        return publicServerError('登录异常', err);
      }
    }

    // ── 5. 已登录账号修改密码（当前密码 + 有效 Token） ─────────────
    if (url.pathname === '/api/auth/change_password' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

        if (!uid || !token || !currentPassword || !newPassword) {
          return json({ code: 1, msg: '请完整填写当前密码和新密码' });
        }
        if (uid.length > 64 || token.length > 256) {
          return json({ code: 1, msg: '登录凭证格式不正确' });
        }
        if (newPassword.length < 6 || newPassword.length > 32) {
          return json({ code: 1, msg: '新密码长度须至少 6 位（支持 6~32 位）' });
        }
        if (currentPassword.length > 32) {
          return json({ code: 1, msg: '当前密码不正确' });
        }
        if (currentPassword === newPassword) {
          return json({ code: 1, msg: '新密码不能与当前密码相同' });
        }

        const user = await env.DB.prepare(
          'SELECT uid, username, nickname, avatar, password_hash, salt, token_expires_at, failed_login_count, locked_until, score, wins, total_games, security_q FROM users WHERE uid = ? AND token = ? AND username IS NOT NULL AND username != ?'
        ).bind(uid, token, '').first();
        if (!user) {
          return json({ code: 401, msg: '登录状态已失效，请重新登录' }, 401);
        }

        const now = Date.now();
        if (user.token_expires_at && user.token_expires_at <= now) {
          return json({ code: 401, msg: '登录凭证已过期，请重新登录' }, 401);
        }
        if (user.locked_until && user.locked_until > now) {
          const remain = Math.ceil((user.locked_until - now) / 1000);
          return json({ code: 429, msg: `密码输错过多，账号保护性锁定中！请在 ${remain} 秒后再试` }, 429);
        }

        const currentHash = await hashPassword(currentPassword, user.salt);
        if (currentHash !== user.password_hash) {
          const newFailCount = (user.failed_login_count || 0) + 1;
          if (newFailCount >= 5) {
            const lockTime = now + 5 * 60 * 1000;
            await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE uid = ?').bind(newFailCount, lockTime, user.uid).run();
            return json({ code: 429, msg: '当前密码连续错误满 5 次！账号已锁定 5 分钟' }, 429);
          }
          await env.DB.prepare('UPDATE users SET failed_login_count = ? WHERE uid = ?').bind(newFailCount, user.uid).run();
          return json({ code: 1, msg: `当前密码不正确（还可尝试 ${5 - newFailCount} 次）` });
        }

        const newSalt = generateSecureHex(16);
        const newPasswordHash = await hashPassword(newPassword, newSalt);
        const freshToken = generateSecureHex(24);
        const freshRefreshToken = generateSecureHex(REFRESH_TOKEN_BYTES);
        const freshRefreshTokenHash = await hashWithSalt(freshRefreshToken, String(user.uid));
        const expiresAt = now + AUTH_SESSION_TTL_MS;
        await env.DB.prepare(`
          UPDATE users
          SET password_hash = ?, salt = ?, password_algo = 'pbkdf2',
              token = ?, token_expires_at = ?, refresh_token_hash = ?, refresh_token_expires_at = ?, failed_login_count = 0, locked_until = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(newPasswordHash, newSalt, freshToken, expiresAt, freshRefreshTokenHash, expiresAt, user.uid).run();

        return json({
          code: 0,
          msg: '密码修改成功！已刷新登录凭证',
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: sanitizeAvatar(user.avatar),
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            security_q: user.security_q,
            token: freshToken,
            refreshToken: freshRefreshToken
          }
        });
      } catch (err) {
        return publicServerError('修改密码异常', err);
      }
    }

    // ── 6. 安全找回密码：第一步（根据账号获取密保问题） ─
    if (url.pathname === '/api/auth/get_security_q' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { username } = await readJsonBody(request);
        if (!username) return json({ code: 1, msg: '请输入要找回的账号' });

        const user = await env.DB.prepare('SELECT uid, username, security_q, reset_locked_until FROM users WHERE (username = ? OR uid = ?)').bind(String(username).trim(), String(username).trim()).first();
        if (!user) {
          return json({ code: 1, msg: '该账号不存在' });
        }

        const now = Date.now();
        if (user.reset_locked_until && user.reset_locked_until > now) {
          const remain = Math.ceil((user.reset_locked_until - now) / 1000);
          return json({ code: 429, msg: `密保回答错误过多，找回功能锁定中！请在 ${remain} 秒后再试` });
        }

        if (!user.security_q) {
          return json({ code: 1, msg: '该账号未设置密保问题，请联系管理员' });
        }

        return json({ code: 0, data: { username: user.username, question: user.security_q } });
      } catch (err) {
        return publicServerError('查询密保异常', err);
      }
    }

    // ── 6. 安全找回密码：第二步（核对密保重置新密码） ───
    if (url.pathname === '/api/auth/reset_password' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { username, securityAnswer, newPassword } = await readJsonBody(request);
        if (!username || !securityAnswer || !newPassword) {
          return json({ code: 1, msg: '请完整填写账号、密保答案与新密码' });
        }
        if (newPassword.length < 6 || newPassword.length > 32) {
          return json({ code: 1, msg: '新密码长度须至少 6 位（支持 6~32 位）' });
        }

        const now = Date.now();
        const user = await env.DB.prepare('SELECT * FROM users WHERE (username = ? OR uid = ?)').bind(String(username).trim(), String(username).trim()).first();
        if (!user) return json({ code: 1, msg: '账号不存在' });

        if (user.reset_locked_until && user.reset_locked_until > now) {
          const remain = Math.ceil((user.reset_locked_until - now) / 1000);
          return json({ code: 429, msg: `找回功能冷却锁定中，请在 ${remain} 秒后再试` });
        }

        const cleanAnswer = securityAnswer.trim().toLowerCase();
        const calcAnswerHash = await hashWithSalt(cleanAnswer, user.security_salt);

        if (calcAnswerHash !== user.security_a_hash) {
          const newFail = (user.failed_reset_count || 0) + 1;
          if (newFail >= 3) {
            const lockUntil = now + 10 * 60 * 1000;
            await env.DB.prepare('UPDATE users SET failed_reset_count = ?, reset_locked_until = ? WHERE uid = ?').bind(newFail, lockUntil, user.uid).run();
            return json({ code: 429, msg: '密保连续答错已满 3 次！为防破解，找回密码功能已锁定 10 分钟' });
          } else {
            await env.DB.prepare('UPDATE users SET failed_reset_count = ? WHERE uid = ?').bind(newFail, user.uid).run();
            return json({ code: 1, msg: `密保答案不正确（还可尝试 ${3 - newFail} 次）` });
          }
        }

        const newSalt = generateSecureHex(16);
        const newPwdHash = await hashPassword(newPassword, newSalt);
        const newToken = generateSecureHex(24);
        const newRefreshToken = generateSecureHex(REFRESH_TOKEN_BYTES);
        const newRefreshTokenHash = await hashWithSalt(newRefreshToken, String(user.uid));
        const expiresAt = now + AUTH_SESSION_TTL_MS;

        await env.DB.prepare(`
          UPDATE users
          SET password_hash = ?, salt = ?, password_algo = 'pbkdf2', token = ?, token_expires_at = ?,
              refresh_token_hash = ?, refresh_token_expires_at = ?,
              failed_reset_count = 0, reset_locked_until = 0,
              failed_login_count = 0, locked_until = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(newPwdHash, newSalt, newToken, expiresAt, newRefreshTokenHash, expiresAt, user.uid).run();

        return json({
          code: 0,
          msg: '密码重置成功！已自动登录',
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: sanitizeAvatar(user.avatar),
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            token: newToken,
            refreshToken: newRefreshToken
          }
        });
      } catch (err) {
        return publicServerError('重置密码异常', err);
      }
    }

    

    // ══════════════════════════════════════════════════════
    // 📜 历史对局战报与全盘谱录云端存取系统 (Cloudflare D1 驱动)
    // ══════════════════════════════════════════════════════

    // 1. 上报并云端持久化单局战报（包含全盘走法谱与终局状态）
    if (url.pathname === '/api/history/record' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid, mode, isWin, isDraw, winnerColor, myColor, oppName, oppAvatar, moves, movesData, boardData, time, date } = body;
        if (!uid) return json({ code: 1, msg: '缺少用户 UID' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const cleanUid = auth.user.uid;
        const movesJson = typeof movesData === 'string' ? movesData : JSON.stringify(movesData || []);
        const boardJson = typeof boardData === 'string' ? boardData : JSON.stringify(boardData || []);
        if (movesJson.length > 120000 || boardJson.length > 120000) {
          return json({ code: 413, msg: '棋谱数据过大' }, 413);
        }
        const cleanWinnerColor = winnerColor === 0 ? 0 : (Number(winnerColor) === 2 ? 2 : 1);

        await env.DB.prepare(`
          INSERT INTO game_history (
            uid, mode, is_win, is_draw, winner_color, my_color, opp_name, opp_avatar, moves_count, moves_data, board_data, time, date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          cleanUid,
          String(mode || 'ai'),
          isWin ? 1 : 0,
          isDraw === true ? 1 : 0,
          cleanWinnerColor,
          parseInt(myColor || 1, 10),
          String(oppName || '对手').slice(0, 32),
          String(oppAvatar || '🤖').slice(0, 100),
          parseInt(moves || 0, 10),
          movesJson,
          boardJson,
          String(time || '').slice(0, 20),
          String(date || '').slice(0, 20)
        ).run();

        // 仅保留该用户最新 30 局，自动裁剪超额历史
        try {
          await env.DB.prepare(`
            DELETE FROM game_history
            WHERE uid = ? AND id NOT IN (
              SELECT id FROM game_history WHERE uid = ? ORDER BY id DESC LIMIT 30
            )
          `).bind(cleanUid, cleanUid).run();
        } catch(_) {}

        return json({ code: 0, msg: '对局历史战报与棋局谱已成功同步至云端！' });
      } catch (err) {
        return publicServerError('云端同步战绩异常', err);
      }
    }

    // 2. 查询用户云端历史对局战报列表（支持换机/重装后一键恢复）
    if (url.pathname === '/api/history/list' && request.method === 'GET') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const uid = url.searchParams.get('uid');
        if (!uid) return json({ code: 1, msg: '缺少用户 UID' });

        const auth = await requireUser(uid, getRequestToken(request));
        if (auth.response) return auth.response;

        const rows = await env.DB.prepare(`
          SELECT id, uid, mode, is_win as isWin, is_draw as isDraw, winner_color as winnerColor, my_color as myColor,
                 opp_name as oppName, opp_avatar as oppAvatar, moves_count as moves,
                 moves_data as movesData, board_data as boardData, time, date, created_at
          FROM game_history
          WHERE uid = ?
          ORDER BY id DESC
          LIMIT 30
        `).bind(auth.user.uid).all();

        const list = (rows.results || []).map(r => ({
          ...r,
          isWin: r.isWin === 1,
          isDraw: r.isDraw === 1,
          movesData: (() => {
            try { return JSON.parse(r.movesData); } catch(e) { return []; }
          })(),
          boardData: (() => {
            try { return JSON.parse(r.boardData); } catch(e) { return null; }
          })()
        }));

        return json({ code: 0, data: list });
      } catch (err) {
        return publicServerError('查询云端历史战绩异常', err);
      }
    }

    // 3. 清空用户云端全部历史对局战报（保证本地删除与云端100%双向同步）
    if (url.pathname === '/api/history/clear' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid } = body;
        if (!uid) return json({ code: 1, msg: '缺少用户 UID' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        await env.DB.prepare('DELETE FROM game_history WHERE uid = ?').bind(auth.user.uid).run();
        return json({ code: 0, msg: '云端历史战报已彻底同步清空！' });
      } catch (err) {
        return publicServerError('清空云端战绩异常', err);
      }
    }

    // 4. 删除指定单条云端历史对局战报
    if (url.pathname === '/api/history/delete' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid, id } = body;
        if (!uid || !id) return json({ code: 1, msg: '缺少参数' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        await env.DB.prepare('DELETE FROM game_history WHERE uid = ? AND id = ?').bind(auth.user.uid, parseInt(id, 10)).run();
        return json({ code: 0, msg: '该条云端战绩已同步删除！' });
      } catch (err) {
        return publicServerError('删除云端战绩异常', err);
      }
    }


    // ══════════════════════════════════════════════════════
    // ⚡ 全服实时快速匹配系统 (Cloudflare D1 驱动)
    // ══════════════════════════════════════════════════════

    // 1. 加入匹配队列
    if (url.pathname === '/api/match/join' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid, nickname, avatar } = body;
        if (!uid) return json({ code: 1, msg: '缺少用户信息' });

        const auth = await requireMatchIdentity(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const matchUid = auth.uid;

        const now = Date.now();
        const safeNick = sanitizeText(nickname, 12) || '棋士';
        const safeAvatar = sanitizeAvatar(avatar);
        const safeScore = auth.user ? Math.max(0, Number(auth.user.score) || 1000) : 1000;
        const matchId = typeof body.matchId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.matchId.trim())
          ? body.matchId.trim()
          : '';

        // 清理超时等待记录；匹配成功但客户端没及时消费的旧记录也一并清掉。
        // 清理动作限频，避免每个 join 都额外产生一次 D1 写入争用；查询本身仍由 updated_at 条件兜底。
        if (now - lastMatchQueueCleanupAt >= 30000) {
          lastMatchQueueCleanupAt = now;
          try {
            await env.DB.prepare(`
              DELETE FROM match_queue
              WHERE (status = "waiting" AND updated_at < ?)
                 OR (status = "matched" AND updated_at < ?)
            `).bind(now - 25000, now - 120000).run();
          } catch (cleanupError) {
            lastMatchQueueCleanupAt = 0;
            console.warn('[match] 清理超时队列失败:', cleanupError?.message || cleanupError);
          }
        }

        const formatMatched = (record) => ({
          code: 0,
          status: 'matched',
          matchId: String(record.match_id || ''),
          role: record.matched_color === 'black' ? 'host' : 'client',
          color: record.matched_color,
          roomCode: record.room_code,
          opponent: {
            uid: record.matched_with,
            nickname: sanitizeText(record.matched_nickname, 12) || '好友',
            avatar: compactAvatar(record.matched_avatar),
            score: Number.isFinite(Number(record.matched_score)) ? Number(record.matched_score) : 1000
          }
        });
        // 同一匹配请求允许幂等重试：若响应在弱网中丢失，客户端再次 join 仍能拿回原房间；
        // 新的 matchId 则主动淘汰该 UID 的旧残留结果，避免下一局重复返回上一场。
        const existingBeforeMatch = await env.DB.prepare('SELECT * FROM match_queue WHERE uid = ?').bind(matchUid).first();
        if (existingBeforeMatch?.status === 'matched') {
          const sameRequest = !matchId || existingBeforeMatch.match_id === matchId;
          if (sameRequest) return json(formatMatched(existingBeforeMatch));
          await env.DB.prepare('DELETE FROM match_queue WHERE uid = ? AND status = "matched"').bind(matchUid).run();
        }

        // 寻找正在等待的真人对手 (非自己)
        const opponent = await env.DB.prepare(
          'SELECT * FROM match_queue WHERE status = "waiting" AND uid != ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 1'
        ).bind(matchUid, now - 20000).first();

        let claimedOpponent = false;
        if (opponent) {
          // 只有仍处于 waiting 且未超时的记录才能被领取，避免两个请求同时匹配到同一个人。
          const roomCode = generateRoomCode();
          const claim = await env.DB.prepare(`
            UPDATE match_queue
            SET status = 'matched', matched_with = ?, matched_color = 'black',
                matched_nickname = ?, matched_avatar = ?, matched_score = ?,
                room_code = ?, updated_at = ?
            WHERE uid = ? AND status = 'waiting' AND updated_at > ?
          `).bind(matchUid, safeNick, safeAvatar, safeScore, roomCode, now, opponent.uid, now - 20000).run();
          claimedOpponent = Number(claim.meta?.changes || 0) === 1;

          if (claimedOpponent) {
            // 当前玩家若已被另一请求匹配，不覆盖已有对局；否则写入白方记录。
            await env.DB.prepare(`
              INSERT INTO match_queue (uid, nickname, avatar, score, status, matched_with, matched_color, matched_nickname, matched_avatar, matched_score, room_code, match_id, updated_at)
              VALUES (?, ?, ?, ?, 'matched', ?, 'white', ?, ?, ?, ?, ?, ?)
              ON CONFLICT(uid) DO UPDATE SET
                status = 'matched', matched_with = excluded.matched_with, matched_color = 'white',
                matched_nickname = excluded.matched_nickname, matched_avatar = excluded.matched_avatar,
                matched_score = excluded.matched_score, room_code = excluded.room_code,
                match_id = excluded.match_id, updated_at = excluded.updated_at
              WHERE match_queue.status != 'matched'
            `).bind(matchUid, safeNick, safeAvatar, safeScore, opponent.uid, opponent.nickname, compactAvatar(opponent.avatar), opponent.score, roomCode, matchId, now).run();

            const current = await env.DB.prepare('SELECT * FROM match_queue WHERE uid = ?').bind(matchUid).first();
            if (current?.status === 'matched' && (!matchId || current.match_id === matchId)) {
              return json(formatMatched(current));
            }
          }
        }

        // 抢占失败时可能已经被其他请求匹配；先读取现状，绝不把已匹配记录重置为 waiting。
        const existing = await env.DB.prepare('SELECT * FROM match_queue WHERE uid = ?').bind(matchUid).first();
        if (existing?.status === 'matched' && (!matchId || existing.match_id === matchId)) {
          return json(formatMatched(existing));
        }

        // 暂无可领取的等待对手，将自己放入队列；ON CONFLICT 条件防止覆盖并发产生的 matched 状态。
        await env.DB.prepare(`
          INSERT INTO match_queue (uid, nickname, avatar, score, status, matched_with, matched_color, matched_nickname, matched_avatar, matched_score, room_code, match_id, updated_at)
          VALUES (?, ?, ?, ?, 'waiting', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET
            nickname = excluded.nickname, avatar = excluded.avatar, score = excluded.score,
            status = 'waiting', matched_with = NULL, matched_color = NULL, matched_nickname = NULL,
            matched_avatar = NULL, matched_score = NULL, room_code = NULL,
            match_id = excluded.match_id, updated_at = excluded.updated_at
            WHERE match_queue.status != 'matched'
        `).bind(matchUid, safeNick, safeAvatar, safeScore, matchId, now).run();

        const finalRecord = await env.DB.prepare('SELECT * FROM match_queue WHERE uid = ?').bind(matchUid).first();
        if (finalRecord?.status === 'matched' && (!matchId || finalRecord.match_id === matchId)) {
          return json(formatMatched(finalRecord));
        }
        return json({ code: 0, status: 'waiting' });
      } catch (err) {
        return publicServerError('匹配服务异常', err);
      }
    }

    // 2. 轮询匹配结果
    if (url.pathname === '/api/match/poll' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid, token } = body;
        const requestedMatchId = typeof body.matchId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.matchId.trim())
          ? body.matchId.trim()
          : '';
        if (!uid) return json({ code: 1, msg: '缺少 uid' });

        const auth = await requireMatchIdentity(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const matchUid = auth.uid;

        const now = Date.now();
        const record = await env.DB.prepare('SELECT * FROM match_queue WHERE uid = ?').bind(matchUid).first();
        if (!record) {
          return json({ code: 0, status: 'cancelled' });
        }

        if (record.status === 'matched') {
          // 轮询结果允许幂等重试；只有相同 matchId 才能消费本次结果，避免网络丢包后变成“对方断开”。
          if (requestedMatchId && record.match_id !== requestedMatchId) {
            return json({ code: 0, status: 'cancelled' });
          }
          return json({
            code: 0,
            status: 'matched',
            matchId: String(record.match_id || ''),
            role: record.matched_color === 'black' ? 'host' : 'client',
            color: record.matched_color,
            roomCode: record.room_code,
            opponent: {
              uid: record.matched_with,
              nickname: record.matched_nickname,
              avatar: compactAvatar(record.matched_avatar),
              score: record.matched_score
            }
          });
        }

        // 保持心跳活跃
        await env.DB.prepare('UPDATE match_queue SET updated_at = ? WHERE uid = ? AND status = "waiting"').bind(now, matchUid).run();
        return json({ code: 0, status: 'waiting' });
      } catch (err) {
        return publicServerError('轮询异常', err);
      }
    }

    // 3. 取消匹配
    if (url.pathname === '/api/match/cancel' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await readJsonBody(request);
        const { uid } = body;
        const requestedMatchId = typeof body.matchId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.matchId.trim())
          ? body.matchId.trim()
          : '';
        if (uid) {
          const auth = await requireMatchIdentity(uid, getRequestToken(request, body));
          if (auth.response) return auth.response;
          if (requestedMatchId) {
            await env.DB.prepare('DELETE FROM match_queue WHERE uid = ? AND (match_id = ? OR match_id IS NULL)').bind(auth.uid, requestedMatchId).run();
          } else {
            await env.DB.prepare('DELETE FROM match_queue WHERE uid = ?').bind(auth.uid).run();
          }
        }
        return json({ code: 0, msg: '已成功取消匹配' });
      } catch (err) {
        return publicServerError('取消异常', err);
      }
    }

    // ── 7. 全服天梯榜（仅正式注册账号上榜，游客与未注册用户绝不上榜） ──
    if (url.pathname === '/api/rank' && request.method === 'GET') {
      if (!env.DB) return leaderboardJson({ code: 0, data: [] });

      const cacheNow = Date.now();
      if (Array.isArray(cachedLeaderboard) && cacheNow - lastLeaderboardTime < LEADERBOARD_CACHE_TTL_MS) {
        return leaderboardJson({ code: 0, data: cachedLeaderboard });
      }

      // 冷缓存期间共用一次 D1 查询，避免多个客户端同时打开天梯榜造成查询风暴。
      if (!leaderboardQueryPromise) {
        leaderboardQueryPromise = (async () => {
          const { results } = await env.DB.prepare(`
            SELECT uid, nickname AS name,
                   CASE
                     WHEN avatar IS NULL OR avatar = '' OR avatar LIKE 'data:image/%' OR length(avatar) > ${MAX_LEADERBOARD_AVATAR_CHARS}
                     THEN '👦'
                     ELSE avatar
                   END AS avatar,
                   score, wins, total_games
            FROM users
            WHERE username IS NOT NULL AND username != '' AND password_hash IS NOT NULL
            ORDER BY score DESC, wins DESC, uid ASC
            LIMIT 30
          `).all();
          const data = Array.isArray(results) ? results : [];
          cachedLeaderboard = data;
          lastLeaderboardTime = Date.now();
          return data;
        })();
      }

      const queryPromise = leaderboardQueryPromise;
      try {
        const data = await queryPromise;
        return leaderboardJson({ code: 0, data });
      } catch (err) {
        return publicServerError('排行榜查询异常', err);
      } finally {
        if (leaderboardQueryPromise === queryPromise) leaderboardQueryPromise = null;
      }
    }

    // ── 8. 战绩安全上报（Token 验证 + 15 秒冷却防刷） ─────
    if (url.pathname === '/api/report_game' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { uid, token, isWin, isDraw = false } = await readJsonBody(request);

        if (!uid || !token) {
          return json({ code: 401, msg: '未授权：缺失身份凭证' }, 401);
        }
        if (typeof isWin !== 'boolean' || typeof isDraw !== 'boolean' || (isDraw && isWin)) {
          return json({ code: 400, msg: '战绩结果必须是布尔值' }, 400);
        }

        const now = Date.now();
        const user = await env.DB.prepare('SELECT uid, username, score, last_game_at, token_expires_at FROM users WHERE uid = ? AND token = ?').bind(String(uid), String(token)).first();
        if (!user) {
          return json({ code: 403, msg: '未授权：Token 无效或已失效' });
        }

        // 🛡️ 仅注册账号可上天梯榜，游客只做本地存储
        if (!user.username) {
          return json({ code: 403, msg: '游客模式不上天梯榜，请注册账号后参与排名' });
        }

        if (user.token_expires_at && user.token_expires_at <= now) {
          return json({ code: 401, msg: '登录凭证已过期，请重新登录' }, 401);
        }

        const oldScore = Number.isFinite(Number(user.score)) ? Number(user.score) : 1000;
        const scoreDelta = isDraw ? 0 : (isWin ? 25 : -15);
        const newScore = Math.max(0, oldScore + scoreDelta);

        // 15 秒冷却放进 UPDATE 条件，避免并发请求同时通过预检查刷分。
        const updateResult = await env.DB.prepare(`
          UPDATE users
          SET score = ?,
              wins = wins + ?,
              total_games = total_games + 1,
              last_game_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ? AND token = ?
            AND (last_game_at IS NULL OR last_game_at = 0 OR last_game_at <= ?)
        `).bind(newScore, isWin ? 1 : 0, now, String(uid), String(token), now - 15000).run();
        if (!updateResult.meta || updateResult.meta.changes !== 1) {
          return json({ code: 429, msg: '对局结算过于频繁，请 15 秒后再试' }, 429);
        }

        cachedLeaderboard = null;
        lastLeaderboardTime = 0;
        const updated = await env.DB.prepare('SELECT score, wins, total_games FROM users WHERE uid = ?').bind(String(uid)).first();
        return json({
          code: 0,
          msg: isDraw ? '和棋战绩安全归档成功' : '战绩安全归档成功',
          data: {
            score: updated.score,
            wins: updated.wins,
            total_games: updated.total_games,
            oldScore,
            newScore: updated.score,
            scoreDelta,
            isDraw
          }
        });
      } catch (err) {
        return publicServerError('结算异常', err);
      }
    }

    // ── 8. 用户意见反馈与问题提交中枢 ──────────────────────────
    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request);
        const content = String(body.content || '').trim().slice(0, 1000);
        if (!content || content.length < 3) {
          return json({ code: 1, msg: '反馈内容太短，请至少输入3个字' }, 400);
        }

        const feedbackType = sanitizeText(body.type || 'bug', 30);
        const contact = sanitizeText(body.contact || '', 100);
        const uid = sanitizeText(body.uid || '', 64);
        const nickname = sanitizeText(body.nickname || '', 30);
        const version = sanitizeText(body.version || 'v1.0.86', 30);
        const userAgent = request.headers.get('user-agent') ? request.headers.get('user-agent').slice(0, 250) : '';
        const ip = String(request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 64);

        if (env.DB) {
          try {
            const recent = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM feedback WHERE ip = ? AND created_at >= datetime('now', '-1 hour')").bind(ip).first();
            if (recent && Number(recent.cnt) >= 5) {
              return json({ code: 429, msg: '反馈提交过于频繁，请稍后再试' }, 429);
            }
            await env.DB.prepare(`
              INSERT INTO feedback (uid, nickname, feedback_type, content, contact, client_version, user_agent, ip)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(uid, nickname, feedbackType, content, contact, version, userAgent, ip).run();
          } catch (dbErr) {
            console.error('Feedback DB insert error:', dbErr.message);
          }
        }

        return json({
          code: 0,
          msg: '反馈提交成功，非常感谢您的宝贵意见与支持！'
        });
      } catch (err) {
        return publicServerError('反馈提交异常', err);
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
