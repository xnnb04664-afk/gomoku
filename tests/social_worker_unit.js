const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const workerSource = fs.readFileSync('backend/worker.js', 'utf8')
  .replace('export class GomokuRoom', 'class GomokuRoom')
  .replace('export class SocialHub', 'class SocialHub')
  .replace('export default {', 'globalThis.__gomokuSocialHub = SocialHub; globalThis.__gomokuWorker = {');

const sandbox = {
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Uint32Array,
  Array,
  JSON,
  Math,
  Date,
  Number,
  String,
  Object,
  Promise,
  URL,
  URLSearchParams,
  Request,
  Response,
  Headers,
  Blob,
  FormData,
  AbortController,
  setTimeout,
  clearTimeout,
  btoa,
  atob,
  fetch: async url => { throw new Error(`unexpected network request: ${url}`); },
};

vm.runInNewContext(workerSource, sandbox, { filename: 'backend/worker.js' });
const worker = sandbox.__gomokuWorker;

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function pairKey(left, right) {
  return [String(left), String(right)].sort().join(':');
}

class MemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = String(sql);
    this.normalized = normalizeSql(sql);
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const q = this.normalized;
    const a = this.args;

    if (q.includes('from users where uid = ? and token = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user && user.token === a[1] ? { ...user } : null;
    }
    if (q.includes('from users') && q.includes('where username = ?')) {
      const user = [...this.db.users.values()].find(row => row.username === a[0] && row.username);
      return user ? { ...user } : null;
    }
    if (q.includes('select uid from users where uid = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user && user.username ? { uid: user.uid } : null;
    }
    if (q.includes('select 1 as ok from friendships')) {
      return this.db.friendships.has(pairKey(a[0], a[1])) ? { ok: 1 } : null;
    }
    if (q.includes('select 1 as ok from user_blocks')) {
      const blocked = this.db.blocks.has(`${a[0]}:${a[1]}`) || this.db.blocks.has(`${a[2]}:${a[3]}`);
      return blocked ? { ok: 1 } : null;
    }
    if (q.includes('select 1 as ok from recent_opponent_reports')) {
      const report = this.db.recentReports.get(`${a[0]}:${a[1]}`);
      return report && report.reported_at >= Number(a[2]) ? { ok: 1 } : null;
    }
    if (q.includes('select count(*) as cnt from friendships')) {
      const uid = String(a[0]);
      const cnt = [...this.db.friendships].filter(key => key.split(':').includes(uid)).length;
      return { cnt };
    }
    if (q.includes('from friend_requests') && q.includes("status = 'pending'")) {
      let rows = [...this.db.friendRequests.values()].filter(row => row.status === 'pending');
      if (q.includes('where id = ?')) rows = rows.filter(row => row.id === a[0]);
      else if (q.includes('where pair_key = ?')) rows = rows.filter(row => row.pair_key === a[0]);
      else if (q.includes('sender_uid = ? and receiver_uid = ?')) {
        rows = rows.filter(row => row.sender_uid === a[0] && row.receiver_uid === a[1]);
      }
      rows.sort((x, y) => y.created_at - x.created_at);
      return rows[0] ? { ...rows[0] } : null;
    }
    if (q.includes('from private_messages where sender_uid = ? and client_message_id = ?')) {
      const message = this.db.messages.find(row => row.sender_uid === a[0] && row.client_message_id === a[1]);
      return message ? this.db.publicMessage(message) : null;
    }
    if (q.includes('select uid from social_socket_tickets')) {
      const row = this.db.tickets.get(String(a[0]));
      return row && row.used === 0 && row.expires_at > Number(a[1]) ? { uid: row.uid } : null;
    }
    if (q.includes('select * from game_invites where id = ? and receiver_uid = ?')) {
      const invite = this.db.gameInvites.get(String(a[0]));
      return invite && invite.receiver_uid === String(a[1]) ? { ...invite } : null;
    }
    if (q.startsWith('select max(id) as max_id from private_messages')) {
      const ids = this.db.messages.filter(row => row.pair_key === a[0]).map(row => row.id);
      return { max_id: ids.length ? Math.max(...ids) : null };
    }
    if (q.startsWith('select cleared_before_id from message_state')) {
      const state = this.db.messageStates.get(`${a[0]}:${a[1]}`);
      return state ? { cleared_before_id: state.cleared_before_id } : null;
    }
    if (q.includes('from premium_wallets where uid = ?')) {
      const wallet = this.db.premiumWallets.get(String(a[0]));
      return wallet ? { ...wallet } : null;
    }
    if (q.includes('from premium_orders where uid = ? and client_order_id = ?')) {
      const order = [...this.db.premiumOrders.values()].find(row => row.uid === String(a[0]) && row.client_order_id === String(a[1]));
      return order ? { ...order } : null;
    }
    if (q.includes('from premium_orders where id = ? and uid = ?')) {
      const order = this.db.premiumOrders.get(String(a[0]));
      return order && order.uid === String(a[1]) ? { ...order } : null;
    }
    if (q.includes('from user_game_layouts where uid = ?')) {
      const layout = this.db.gameLayouts.get(String(a[0]));
      return layout ? { ...layout } : null;
    }
    if (q.startsWith('select presence_hidden, metrics_enabled from user_social_settings')) return null;
    if (q.startsWith('select uid from users where uid = ? or username = ?')) return null;
    return null;
  }

  async all() {
    const q = this.normalized;
    if (q.startsWith('pragma table_info(match_queue)')) return { results: [{ name: 'match_id' }] };
    if (q.includes('from recent_opponents r join users u')) {
      const uid = String(this.args[0]);
      return {
        results: [...this.db.recentOpponents.values()]
          .filter(row => row.uid === uid && !this.db.blocks.has(`${uid}:${row.opponent_uid}`) && !this.db.blocks.has(`${row.opponent_uid}:${uid}`))
          .sort((left, right) => right.last_played_at - left.last_played_at)
          .slice(0, 30)
          .map(row => ({ ...this.db.users.get(row.opponent_uid), games_count: row.games_count, last_played_at: row.last_played_at })),
      };
    }
    if (q.includes('from private_messages') && q.includes('where pair_key = ?')) {
      const [key, before, cleared, limit] = this.args;
      return {
        results: this.db.messages
          .filter(row => row.pair_key === key && row.id < Number(before) && row.id > Number(cleared))
          .sort((a, b) => b.id - a.id)
          .slice(0, Number(limit))
          .map(row => this.db.publicMessage(row)),
      };
    }
    return { results: [] };
  }

  async run() {
    const q = this.normalized;
    const a = this.args;

    // Schema initialization is deliberately a no-op in the in-memory mock.
    if (q.startsWith('create ') || q.startsWith('alter ') ||
        (q.startsWith('update friend_requests') && q.includes('set pair_key = case')) ||
        (q.startsWith('update friend_requests') && q.includes("rowid not in"))) return { meta: { changes: 0 } };

    if (q.startsWith('insert into friend_requests')) {
      this.db.friendRequests.set(String(a[0]), {
        id: String(a[0]), pair_key: String(a[1]), sender_uid: String(a[2]), receiver_uid: String(a[3]),
        status: 'pending', created_at: Number(a[4]), updated_at: Number(a[5]),
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert or ignore into friendships')) {
      const key = pairKey(a[0], a[1]);
      if (q.includes('where exists')) {
        const request = this.db.friendRequests.get(String(a[3]));
        const expectedReceiver = a.length > 4 ? String(a[4]) : '';
        if (!request || request.status !== 'pending' || (expectedReceiver && request.receiver_uid !== expectedReceiver)) {
          return { meta: { changes: 0 } };
        }
      }
      const changes = this.db.friendships.has(key) ? 0 : 1;
      this.db.friendships.add(key);
      return { meta: { changes } };
    }
    if (q.startsWith('update friend_requests set status =')) {
      if (q.includes('where id = ?')) {
        const status = q.includes("status = 'accepted'") ? 'accepted' : String(a[0]);
        const id = q.includes("status = 'accepted'") ? a[1] : a[2];
        const row = this.db.friendRequests.get(String(id));
        const requiredReceiver = q.includes('receiver_uid = ?') ? String(a[2]) : '';
        if (row && row.status === 'pending' && (!requiredReceiver || row.receiver_uid === requiredReceiver)) {
          row.status = status;
          row.updated_at = Number(q.includes("status = 'accepted'") ? a[0] : a[1]);
          return { meta: { changes: 1 } };
        }
      } else if (q.includes("status = 'blocked'")) {
        for (const row of this.db.friendRequests.values()) {
          if (row.status === 'pending' && ((row.sender_uid === a[1] && row.receiver_uid === a[2]) ||
              (row.sender_uid === a[3] && row.receiver_uid === a[4]))) row.status = 'blocked';
        }
      }
      return { meta: { changes: 0 } };
    }
    if (q.startsWith('delete from friendships')) {
      return { meta: { changes: this.db.friendships.delete(pairKey(a[0], a[1])) ? 1 : 0 } };
    }
    if (q.startsWith('insert or replace into user_blocks')) {
      this.db.blocks.add(`${a[0]}:${a[1]}`);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('delete from user_blocks')) {
      return { meta: { changes: this.db.blocks.delete(`${a[0]}:${a[1]}`) ? 1 : 0 } };
    }
    if (q.startsWith('insert or ignore into private_messages')) {
      if (q.includes('where exists')) {
        const friendKey = pairKey(a[6], a[7]);
        const blocked = this.db.blocks.has(`${a[8]}:${a[9]}`) || this.db.blocks.has(`${a[10]}:${a[11]}`);
        if (!this.db.friendships.has(friendKey) || blocked) return { meta: { changes: 0 } };
      }
      const duplicate = this.db.messages.find(row => row.sender_uid === a[1] && row.client_message_id === a[3]);
      if (duplicate) return { meta: { changes: 0 } };
      this.db.messages.push({
        id: this.db.nextMessageId++, pair_key: a[0], sender_uid: a[1], receiver_uid: a[2],
        client_message_id: a[3], body: a[4], created_at: Number(a[5]),
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into message_state')) {
      const key = `${a[0]}:${a[1]}`;
      const previous = this.db.messageStates.get(key) || { last_read_id: 0, cleared_before_id: 0 };
      this.db.messageStates.set(key, {
        last_read_id: Math.max(previous.last_read_id, Number(a[2]) || 0),
        cleared_before_id: Math.max(previous.cleared_before_id, Number(a[3]) || 0),
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('delete from social_socket_tickets')) {
      for (const [hash, row] of this.db.tickets) {
        if (row.expires_at <= Number(a[0]) || row.used !== 0) this.db.tickets.delete(hash);
      }
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into social_socket_tickets')) {
      this.db.tickets.set(String(a[0]), { uid: String(a[1]), expires_at: Number(a[2]), used: 0 });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update social_socket_tickets set used = 1')) {
      const row = this.db.tickets.get(String(a[0]));
      if (!row || row.used !== 0 || row.expires_at <= Number(a[1])) return { meta: { changes: 0 } };
      row.used = 1;
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into game_invites')) {
      if (q.includes('where exists')) {
        const friendKey = pairKey(a[7], a[8]);
        const blocked = this.db.blocks.has(`${a[9]}:${a[10]}`) || this.db.blocks.has(`${a[11]}:${a[12]}`);
        if (!this.db.friendships.has(friendKey) || blocked) return { meta: { changes: 0 } };
      }
      this.db.gameInvites.set(String(a[0]), {
        id: String(a[0]), sender_uid: String(a[1]), receiver_uid: String(a[2]), room_code: String(a[3]),
        status: 'pending', created_at: Number(a[4]), expires_at: Number(a[5]), updated_at: Number(a[6]),
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into recent_opponent_reports')) {
      this.db.recentReports.set(`${a[0]}:${a[1]}`, { reporter_uid: String(a[0]), opponent_uid: String(a[1]), reported_at: Number(a[2]) });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into recent_opponents')) {
      const blocked = this.db.blocks.has(`${a[3]}:${a[4]}`) || this.db.blocks.has(`${a[5]}:${a[6]}`);
      if (blocked) return { meta: { changes: 0 } };
      const key = `${a[0]}:${a[1]}`;
      const previous = this.db.recentOpponents.get(key);
      this.db.recentOpponents.set(key, {
        uid: String(a[0]), opponent_uid: String(a[1]), games_count: (previous?.games_count || 0) + 1, last_played_at: Number(a[2]),
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('delete from recent_opponent_reports')) {
      if (q.includes('reported_at < ?')) {
        for (const [key, report] of this.db.recentReports) if (report.reported_at < Number(a[0])) this.db.recentReports.delete(key);
      } else {
        this.db.recentReports.delete(`${a[0]}:${a[1]}`);
        this.db.recentReports.delete(`${a[2]}:${a[3]}`);
      }
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('delete from recent_opponents')) {
      if (q.includes('(uid = ? and opponent_uid = ?)')) {
        this.db.recentOpponents.delete(`${a[0]}:${a[1]}`);
        this.db.recentOpponents.delete(`${a[2]}:${a[3]}`);
      }
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update game_invites set status =')) {
      if (q.includes("status = 'cancelled'")) {
        for (const invite of this.db.gameInvites.values()) {
          if (invite.status === 'pending' && ((invite.sender_uid === String(a[1]) && invite.receiver_uid === String(a[2])) ||
              (invite.sender_uid === String(a[3]) && invite.receiver_uid === String(a[4])))) invite.status = 'cancelled';
        }
        return { meta: { changes: 1 } };
      }
      if (q.includes("status = 'expired'")) {
        const invite = this.db.gameInvites.get(String(a[1]));
        if (invite?.status === 'pending') { invite.status = 'expired'; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      const invite = this.db.gameInvites.get(String(a[2]));
      if (!invite || invite.receiver_uid !== String(a[3]) || invite.status !== 'pending' || invite.expires_at <= Number(a[4])) {
        return { meta: { changes: 0 } };
      }
      invite.status = String(a[0]);
      invite.updated_at = Number(a[1]);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert or ignore into premium_orders')) {
      const clientKey = `${a[1]}:${a[6]}`;
      if (this.db.premiumOrdersByClient.has(clientKey)) return { meta: { changes: 0 } };
      const order = {
        id: String(a[0]), uid: String(a[1]), product_id: String(a[2]), diamonds: Number(a[3]), price_cents: Number(a[4]),
        currency: 'CNY', payment_mode: String(a[5]), status: 'sandbox_pending', client_order_id: String(a[6]),
        created_at: Number(a[7]), updated_at: Number(a[8]),
      };
      this.db.premiumOrders.set(order.id, order);
      this.db.premiumOrdersByClient.set(clientKey, order.id);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update premium_orders set status =')) {
      const order = this.db.premiumOrders.get(String(a[1]));
      if (!order || order.uid !== String(a[2]) || !['pending', 'sandbox_pending'].includes(order.status)) return { meta: { changes: 0 } };
      order.status = 'cancelled';
      order.updated_at = Number(a[0]);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into user_game_layouts')) {
      this.db.gameLayouts.set(String(a[0]), { uid: String(a[0]), button_order: String(a[1]), updated_at: Number(a[2]) });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into metrics_daily')) {
      this.db.metrics.push({ args: [...a] });
      return { meta: { changes: 1 } };
    }
    // Queries outside the social feature are schema maintenance in this suite.
    return { meta: { changes: 0 } };
  }
}

class MemoryDB {
  constructor(users) {
    this.users = new Map(users.map(user => [user.uid, { score: 1000, wins: 0, total_games: 0, ...user }]));
    this.friendRequests = new Map();
    this.friendships = new Set();
    this.blocks = new Set();
    this.messages = [];
    this.messageStates = new Map();
    this.tickets = new Map();
    this.gameInvites = new Map();
    this.recentReports = new Map();
    this.recentOpponents = new Map();
    this.metrics = [];
    this.premiumWallets = new Map();
    this.premiumOrders = new Map();
    this.premiumOrdersByClient = new Map();
    this.gameLayouts = new Map();
    this.nextMessageId = 1;
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map(statement => statement.run()));
  }

  publicMessage(row) {
    return {
      id: row.id,
      sender_uid: row.sender_uid,
      receiver_uid: row.receiver_uid,
      body: row.body,
      created_at: row.created_at,
    };
  }
}

function request(path, { method = 'GET', uid, token, body, headers = {} } = {}) {
  const finalHeaders = new Headers({ Origin: 'null', ...headers });
  if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');
  return new Request(`https://gomoku-api.pages.dev${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify({ ...(uid ? { uid } : {}), ...body }),
  });
}

async function call(env, path, options) {
  const response = await worker.fetch(request(path, options), env);
  const payload = await response.json();
  return { response, payload };
}

async function main() {
  const db = new MemoryDB([
    { uid: '100001', username: 'alice', nickname: 'Alice', avatar: '👧', token: 'token-alice', token_expires_at: Date.now() + 86400000 },
    { uid: '100002', username: 'bob', nickname: 'Bob', avatar: '👦', token: 'token-bob', token_expires_at: Date.now() + 86400000 },
    { uid: '100003', username: 'charlie', nickname: 'Charlie', avatar: '🐼', token: 'token-charlie', token_expires_at: Date.now() + 86400000 },
  ]);
  const notifications = [];
  const socialFetches = [];
  const env = {
    DB: db,
    GOMOKU_SOCIAL: {
      idFromName(name) { return name; },
      get(id) {
        return {
          async fetch(input, init) {
            const url = new URL(typeof input === 'string' ? input : input.url);
            if (url.pathname === '/notify') {
              const event = JSON.parse(init.body);
              notifications.push({ id, event });
              return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            socialFetches.push({ id, uid: input.headers.get('X-Gomoku-Social-Uid') });
            return new Response(JSON.stringify({ upgraded: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        };
      },
    },
  };

  // SocialHub 新账号没有 settings 行时应默认公开在线；多设备中一个连接
  // 断开不能误报离线，最后一个连接断开才广播离线。
  const hubEvents = [];
  const closingSocket = { readyState: 1, close() { this.readyState = 3; } };
  const otherSocket = { readyState: 1 };
  let hubSockets = [closingSocket, otherSocket];
  const hubWaits = [];
  const hubState = {
    getWebSockets: () => hubSockets,
    getTags: socket => socket === closingSocket ? ['100001'] : ['100001'],
    waitUntil(promise) { hubWaits.push(Promise.resolve(promise)); },
  };
  const hub = new sandbox.__gomokuSocialHub(hubState, {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() { return null; },
          async all() {
            return normalizeSql(sql).includes('from friendships') ? { results: [{ friend_uid: '100002' }] } : { results: [] };
          },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    },
    GOMOKU_SOCIAL: {
      idFromName: name => name,
      get: id => ({
        async fetch(_url, init) {
          hubEvents.push({ id, event: JSON.parse(init.body) });
          return new Response('{}', { status: 200 });
        },
      }),
    },
  });
  await hub._broadcastPresence('100001', true);
  assert.equal(hubEvents.at(-1).event.online, true, '缺少隐私设置行时默认应公开在线');
  hub.webSocketClose(closingSocket);
  assert.equal(hubWaits.length, 0, '还有其他设备连接时不得广播离线');
  hubSockets = [closingSocket];
  hub.webSocketClose(closingSocket);
  await Promise.all(hubWaits);
  assert.equal(hubEvents.at(-1).event.online, false, '最后一个设备连接断开后应广播离线');

  let result;
  for (const [path, options] of [
    ['/api/friends/search?uid=100001&username=bob', {}],
    ['/api/friends/requests', { method: 'POST', body: { uid: '100001', targetUsername: 'bob' } }],
    ['/api/blocks', { method: 'POST', body: { uid: '100001', targetUid: '100002' } }],
    ['/api/messages', { method: 'POST', body: { uid: '100001', receiverUid: '100002', text: 'x', clientMessageId: 'unauth0001' } }],
    ['/api/social/socket-ticket', { method: 'POST', body: { uid: '100001' } }],
  ]) {
    const result = await call(env, path, options);
    assert.ok([401, 403].includes(result.response.status), `${path} 必须拒绝未认证请求`);
  }

  // CORS headers alone are not a CSRF boundary: a hostile page can still send
  // a simple request even when it cannot read the response. Authenticated API
  // and the social WebSocket ticket endpoint must reject an untrusted Origin;
  // native/Android `Origin: null` remains covered by the cases above.
  result = await call(env, '/api/friends?uid=100001', {
    token: 'token-alice',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(result.response.status, 403, '不可信网页来源不得访问好友 API');
  result = await call(env, '/api/social/socket-ticket', {
    method: 'POST', uid: '100001', token: 'token-alice',
    headers: { Origin: 'https://evil.example' }, body: {},
  });
  assert.equal(result.response.status, 403, '不可信网页来源不得申请社交 WebSocket 票据');
  result = await call(env, '/api/friends?uid=100001', {
    token: 'token-alice',
    headers: { Origin: 'https://gomoku-home.pages.dev/forged-path' },
  });
  assert.equal(result.response.status, 403, 'Origin 伪造路径不得绕过来源白名单');

  result = await call(env, '/api/friends/search?uid=100001&username=bob', { token: 'token-alice' });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.username, 'bob', '搜索必须按完整账号精确返回');
  result = await call(env, '/api/friends/search?uid=100001&username=bo', { token: 'token-alice' });
  assert.equal(result.response.status, 404, '账号前缀不得产生模糊搜索结果');
  result = await call(env, `/api/friends/search?uid=100001&username=${'b'.repeat(33)}`, { token: 'token-alice' });
  assert.equal(result.response.status, 400, '超长搜索词不得被静默截断');

  // 充值目录可展示，但余额和订单必须绑定正式账号；默认生产模式关闭，
  // 沙盒只创建 pending 订单，绝不能凭客户端请求增加钻石。
  result = await call(env, '/api/economy/catalog');
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.currency, 'diamonds');
  assert.equal(result.payload.data.paymentMode, 'disabled');
  assert.equal(result.payload.data.canCredit, false);
  result = await call(env, '/api/economy/wallet?uid=100001');
  assert.ok([401, 403].includes(result.response.status), '余额接口必须要求正式登录凭证');
  result = await call(env, '/api/economy/orders', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { productId: 'diamonds_60', clientOrderId: 'alice-order-01' },
  });
  assert.equal(result.response.status, 503, '没有支付渠道时不得直接创建真实充值订单');
  env.PREMIUM_PAYMENT_MODE = 'sandbox';
  result = await call(env, '/api/economy/orders', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { productId: 'diamonds_60', clientOrderId: 'alice-order-01' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.order.status, 'sandbox_pending');
  assert.equal(result.payload.data.credited, false);
  const premiumOrderId = result.payload.data.order.id;
  result = await call(env, '/api/economy/orders', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { productId: 'diamonds_60', clientOrderId: 'alice-order-01' },
  });
  assert.equal(result.payload.data.idempotent, true, '充值订单客户端幂等键必须复用原订单');
  assert.equal(result.payload.data.order.id, premiumOrderId);
  result = await call(env, '/api/economy/orders', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { productId: 'diamonds_300', clientOrderId: 'alice-order-01' },
  });
  assert.equal(result.response.status, 409, '幂等键不得切换到另一商品');
  result = await call(env, `/api/economy/orders/${premiumOrderId}?uid=100001`, { token: 'token-alice' });
  assert.equal(result.response.status, 200);
  result = await call(env, `/api/economy/orders/${premiumOrderId}/cancel`, {
    method: 'POST', uid: '100001', token: 'token-alice', body: {},
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.order.status, 'cancelled');
  result = await call(env, '/api/economy/wallet?uid=100001', { token: 'token-alice' });
  assert.equal(result.payload.data.diamonds, 0, '沙盒创建/取消订单不得伪造钻石到账');
  env.PREMIUM_PAYMENT_MODE = undefined;

  // 八按钮布局只接受固定 ID，服务端去重并补全缺失项；游客和伪造 uid 均不可写。
  result = await call(env, '/api/user/game-layout?uid=100001');
  assert.ok([401, 403].includes(result.response.status));
  result = await call(env, '/api/user/game-layout', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { buttonOrder: ['settings', 'friends', 'friends', 'bogus', 'activity'] },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.data.buttonOrder, ['settings', 'friends', 'activity', 'recent', 'rank', 'bag', 'tasks', 'achievements']);
  result = await call(env, '/api/user/game-layout?uid=100001', { token: 'token-alice' });
  assert.deepEqual(result.payload.data.buttonOrder, ['settings', 'friends', 'activity', 'recent', 'rank', 'bag', 'tasks', 'achievements']);

  result = await call(env, '/api/friends/requests', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { targetUsername: 'bob' },
  });
  assert.equal(result.response.status, 200);
  assert.match(result.payload.data.requestId, /^[a-f0-9]{24}$/i);
  const requestId = result.payload.data.requestId;

  result = await call(env, '/api/friends/requests', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { targetUsername: 'bob' },
  });
  assert.equal(result.payload.data.duplicate, true, '重复好友申请必须幂等');
  assert.equal(result.payload.data.requestId, requestId);

  result = await call(env, '/api/friends/requests', {
    method: 'POST', uid: '100002', token: 'token-bob', body: { targetUsername: 'alice' },
  });
  assert.equal(result.payload.data.accepted, true, '交叉申请应直接建立好友关系');
  assert.equal(db.friendships.has(pairKey('100001', '100002')), true);
  assert.equal(db.friendRequests.get(requestId).status, 'accepted');

  const oneSidedRecent = await call(env, '/api/recent-opponents', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { opponentUid: '100002' },
  });
  const unknownRecent = await call(env, '/api/recent-opponents', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { opponentUid: '999999' },
  });
  assert.deepEqual(oneSidedRecent.payload, unknownRecent.payload, '未确认账号与不存在账号必须返回同形结果，避免 UID 枚举');
  assert.equal(oneSidedRecent.payload.data.confirmed, false);
  result = await call(env, '/api/recent-opponents?uid=100001', { token: 'token-alice' });
  assert.equal(result.payload.data.length, 0, '单边上报不得进入最近对手');
  result = await call(env, '/api/recent-opponents', {
    method: 'POST', uid: '100002', token: 'token-bob', body: { opponentUid: '100001' },
  });
  assert.equal(result.payload.data.confirmed, true, '双方十分钟内互报后应完成身份确认');
  const aliceRecent = await call(env, '/api/recent-opponents?uid=100001', { token: 'token-alice' });
  const bobRecent = await call(env, '/api/recent-opponents?uid=100002', { token: 'token-bob' });
  assert.deepEqual(aliceRecent.payload.data.map(row => row.uid), ['100002']);
  assert.deepEqual(bobRecent.payload.data.map(row => row.uid), ['100001']);

  result = await call(env, '/api/game-invites', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { friendUid: '100002', roomCode: '123456' },
  });
  assert.equal(result.response.status, 200);
  const inviteId = result.payload.data.inviteId;
  result = await call(env, `/api/game-invites/${inviteId}/respond`, {
    method: 'POST', uid: '100002', token: 'token-bob', body: { response: 'accepted' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.roomCode, '123456');
  result = await call(env, `/api/game-invites/${inviteId}/respond`, {
    method: 'POST', uid: '100002', token: 'token-bob', body: { response: 'rejected' },
  });
  assert.equal(result.response.status, 410, '同一邀战只能被处理一次');

  result = await call(env, '/api/messages', {
    method: 'POST', uid: '100003', token: 'token-charlie',
    body: { receiverUid: '100001', text: 'not friends', clientMessageId: 'charlie001' },
  });
  assert.equal(result.response.status, 403, '非好友不得发送私聊');

  const message = { receiverUid: '100002', text: 'hello Bob', clientMessageId: 'alice-msg-0001' };
  const firstMessage = await call(env, '/api/messages', {
    method: 'POST', uid: '100001', token: 'token-alice', body: message,
  });
  const duplicateMessage = await call(env, '/api/messages', {
    method: 'POST', uid: '100001', token: 'token-alice', body: message,
  });
  assert.equal(firstMessage.response.status, 200);
  assert.equal(duplicateMessage.payload.data.id, firstMessage.payload.data.id, '相同客户端消息 ID 应返回同一消息');
  assert.equal(db.messages.length, 1, '相同客户端消息 ID 不得重复落库');
  result = await call(env, '/api/messages', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { receiverUid: '100002', text: 'changed body', clientMessageId: message.clientMessageId },
  });
  assert.equal(result.response.status, 409, '同一客户端消息 ID 不得改写正文');
  result = await call(env, '/api/messages', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { receiverUid: '100002', text: 'x'.repeat(501), clientMessageId: 'alice-msg-too-long' },
  });
  assert.equal(result.response.status, 400, '私聊正文超过 500 字符必须拒绝而不是静默截断');
  result = await call(env, '/api/messages/clear', {
    method: 'POST', uid: '100003', token: 'token-charlie', body: { friendUid: '100001' },
  });
  assert.equal(result.response.status, 403, '非好友不得写入任意会话的清空位置');
  result = await call(env, '/api/messages/clear', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { friendUid: '100002' },
  });
  assert.equal(result.response.status, 200);
  const aliceMessages = await call(env, '/api/messages?uid=100001&friendUid=100002', { token: 'token-alice' });
  const bobMessages = await call(env, '/api/messages?uid=100002&friendUid=100001', { token: 'token-bob' });
  assert.equal(aliceMessages.payload.data.length, 0, '清空聊天只隐藏当前用户一侧历史');
  assert.equal(bobMessages.payload.data.length, 1, '对方聊天历史不得被一并删除');
  assert.equal(db.messages.length, 1, '清空聊天不得删除永久消息记录');

  result = await call(env, '/api/blocks', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { targetUid: '100002' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(db.blocks.has('100001:100002'), true);
  assert.equal(db.friendships.has(pairKey('100001', '100002')), false, '拉黑必须解除好友关系');
  result = await call(env, '/api/recent-opponents?uid=100001', { token: 'token-alice' });
  assert.equal(result.payload.data.length, 0, '拉黑后双方最近对手记录不得继续显示');
  result = await call(env, '/api/recent-opponents?uid=100002', { token: 'token-bob' });
  assert.equal(result.payload.data.length, 0, '被拉黑方也不得继续看到该最近对手');

  result = await call(env, '/api/friends/search?uid=100002&username=alice', { token: 'token-bob' });
  assert.equal(result.response.status, 404, '被拉黑用户不得通过搜索确认拉黑方账号');
  assert.equal(result.payload.msg, '未找到可添加的账号');
  result = await call(env, '/api/messages', {
    method: 'POST', uid: '100002', token: 'token-bob',
    body: { receiverUid: '100001', text: 'blocked', clientMessageId: 'bob-blocked-01' },
  });
  assert.equal(result.response.status, 403, '拉黑后旧关系不得继续发送私聊');

  const issuedAt = Date.now();
  result = await call(env, '/api/social/socket-ticket', {
    method: 'POST', uid: '100001', token: 'token-alice', body: {},
  });
  assert.equal(result.response.status, 200);
  assert.match(result.payload.data.ticket, /^[a-f0-9]{48}$/i);
  assert.ok(result.payload.data.expiresAt >= issuedAt + 59000 && result.payload.data.expiresAt <= Date.now() + 61000,
    '社交连接票据有效期应约为 60 秒');
  const ticket = result.payload.data.ticket;
  result = await call(env, `/api/social/socket?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } });
  assert.equal(result.response.status, 200);
  assert.equal(socialFetches.at(-1).uid, '100001', 'DO 身份必须来自已消费票据，不得来自客户端参数');
  result = await call(env, `/api/social/socket?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } });
  assert.equal(result.response.status, 401, '社交连接票据必须只能消费一次');

  result = await call(env, '/api/metrics', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.10' }, body: {
      clientVersion: 'v1.0.120', platform: 'android', samples: [
        { metric: '', bucket: 'fast', value: 100 },
        { metric: 'boot', bucket: '', value: 100 },
        { metric: 'boot', bucket: 'negative', value: -1 },
        { metric: 'boot', bucket: 'too-large', value: 3600001 },
        { metric: 'boot', bucket: 'not-number', value: 'invalid' },
      ],
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.accepted, 0, '非法统计样本不得进入汇总');
  assert.equal(db.metrics.length, 0);

  result = await call(env, '/api/metrics', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.11' }, body: {
      clientVersion: 'v1.0.120', platform: 'android', samples: [
        { metric: 'interactive', bucket: 'normal', endpoint: 'worker', route: 'websocket', value: 1234 },
        { metric: 'graphics_quality', bucket: 'smooth', value: 1 },
        { metric: 'graphics_quality', bucket: 'smooth', value: 2 },
        { metric: 'graphics_quality', bucket: 'ultra', value: 1 },
        { metric: 'interactive', bucket: 'success', value: 1234 },
      ],
    },
  });
  assert.equal(result.payload.data.accepted, 2);
  assert.equal(db.metrics.length, 2, '启动和画质合法样本写入，画质值/档位与跨指标桶必须严格拒绝');
  assert.equal(db.metrics[1].args[3], 'graphics_quality');
  assert.equal(db.metrics[1].args[4], 'smooth');
  assert.equal(db.metrics[1].args[7], 1);

  const sourceChecks = [
    [/WHERE username = \? AND username IS NOT NULL/, '账号搜索使用参数化精确匹配'],
    [/UNIQUE\(sender_uid, client_message_id\)/, '消息表具有幂等唯一约束'],
    [/used = 1 WHERE ticket_hash = \? AND used = 0 AND expires_at > \?/, '票据消费为条件更新'],
    [/WHERE id = \? AND receiver_uid = \? AND status = 'pending' AND expires_at > \?/, '邀战响应使用条件更新保证单次处理'],
    [/if \(!await areFriends\(uid, receiverUid\) \|\| await isBlockedEitherWay\(uid, receiverUid\)\)/, '私聊同时验证好友与拉黑关系'],
    [/samples\.slice\(0, 20\)/, '单次匿名统计批量大小受限'],
    [/\['graphics_quality', new Set\(\['auto', 'high', 'standard', 'smooth'\]\)\]/, '画质统计只接受四个受控档位'],
    [/WHERE pair_key IS NULL OR pair_key = ''/, '旧 friend_requests 会回填 pair_key'],
    [/isAllowedClientOrigin\(requestOrigin\)/, 'HTTP 与 WebSocket 共用来源白名单'],
    [/url\.pathname\.startsWith\('\/api\/'\).*请求来源不受信任/s, 'API 在业务处理前拒绝跨站写请求'],
    [/consumeSocialRequestRate\(uid, 'message'/, '社交接口同时执行账号与边缘 IP 限频'],
    [/candidate\.length <= 256/, '认证令牌输入长度受限'],
    [/PREMIUM_DEFAULT_PAYMENT_MODE = 'disabled'/, '付费货币默认关闭真实充值'],
    [/canCredit: false/, '商品目录明确禁止客户端伪造到账'],
    [/status = 'cancelled'.*status IN \('pending', 'sandbox_pending'\)/s, '订单取消只能作用于未完成订单'],
    [/INSERT INTO user_game_layouts/, '八按钮布局按账号保存'],
    [/GAME_LAYOUT_DEFAULT_ORDER\.includes\(id\)/, '布局只接受固定合法按钮 ID'],
    [/username\.length > 32/, '精确搜索拒绝被静默截断的超长账号名'],
    [/ANNOUNCEMENT_MAX_PAGE_SIZE/, '公告分页上限受控'],
    [/ANNOUNCEMENT_HISTORY_WINDOW_MS/, '公告公开历史窗口受控'],
    [/CREATE TABLE IF NOT EXISTS announcements/, '公告记录使用独立持久化表'],
    [/CREATE TABLE IF NOT EXISTS announcement_state/, '公告已读位置按账号持久化'],
    [/safeAnnouncementActionUrl/, '公告行动链接经过 HTTPS/站内路径校验'],
    [/announcementAdminUidAllowed/, '管理员由服务端 UID 允许列表判定'],
    [/requireAnnouncementAdmin/, '公告写入接口要求正式账号和管理员认证'],
    [/published_at >= \?/, '公告读取遵守历史窗口'],
    [/status = 'withdrawn'/, '撤下状态保留审计而不公开展示'],
    [/ON CONFLICT\(uid\) DO UPDATE SET last_read_id = MAX/, '公告已读写入幂等且只前进'],
    [/lastReadId/, '公告未读响应返回已读游标'],
    [/nextBefore/, '公告分页返回继续游标'],
  ];
  for (const [pattern, messageText] of sourceChecks) assert.match(workerSource, pattern, messageText);
  assert.equal(workerSource.includes('body.admin') || workerSource.includes('body.isAdmin'), false, '客户端不能伪造管理员字段');
  const announcementStart = workerSource.indexOf("if (url.pathname === '/api/announcements'");
  const announcementAdminStart = workerSource.indexOf("if (url.pathname === '/api/admin/announcements'");
  assert(announcementStart >= 0 && announcementAdminStart > announcementStart, '公告路由顺序有效');
  assert.equal(workerSource.slice(announcementStart, announcementAdminStart).includes('notifySocialWorld'), false, '公告不广播到世界频道');

  const duplicateNotifications = notifications.filter(item => item.event.kind === 'message' && item.event.messageId === firstMessage.payload.data.id).length;
  assert.equal(duplicateNotifications, 1, '幂等消息重试不得重复推送实时通知');
  console.log(JSON.stringify({
    unauthenticatedRoutesRejected: 5,
    exactSearchAndBlockedPrivacy: true,
    friendRequestCrossAccept: true,
    inviteResponseOneTime: true,
    messageFriendGate: true,
    messageStorageIdempotent: true,
    messageClearOneSided: true,
    duplicateRealtimeNotifications: duplicateNotifications,
    blockRevokesFriendship: true,
    recentOpponentMutualConfirmation: true,
    recentOpponentBlockPrivacy: true,
    socketTicketOneTime: true,
    invalidMetricsRejected: 5,
    graphicsQualityMetricStrict: true,
    socialHubMultiDevicePresence: true,
    premiumCatalogAndSandboxNoCredit: true,
    gameLayoutNormalizedAndAuthenticated: true,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
