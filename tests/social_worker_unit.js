const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const workerSource = fs.readFileSync('backend/worker.js', 'utf8')
  .replace('export class GomokuRoom', 'class GomokuRoom')
  .replace('export class SocialHub', 'class SocialHub')
  .replace('export default {', 'globalThis.__gomokuRoom = GomokuRoom; globalThis.__gomokuSocialHub = SocialHub; globalThis.__gomokuWorker = {');

let lastWebSocketPair = null;
class TestWebSocket {
  constructor() { this.readyState = 1; this.listeners = new Map(); this.closed = false; }
  accept() {}
  send() {}
  close() { this.closed = true; this.readyState = 3; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
}
class TestWebSocketPair {
  constructor() {
    this[0] = new TestWebSocket();
    this[1] = new TestWebSocket();
    lastWebSocketPair = this;
  }
}
class TestResponse extends Response {
  constructor(body, init = {}) {
    if (init.status === 101) {
      super(null, { status: 200, headers: init.headers });
      this.webSocket = init.webSocket;
    } else super(body, init);
  }
}

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
  Response: TestResponse,
  Headers,
  Blob,
  FormData,
  AbortController,
  setTimeout,
  clearTimeout,
  btoa,
  atob,
  WebSocketPair: TestWebSocketPair,
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
    if (q.startsWith('select score, wins, total_games from users where uid = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user ? { score: user.score, wins: user.wins, total_games: user.total_games } : null;
    }
    if (q.startsWith('select failed_login_count as failure_count, locked_until as locked_until from users where uid = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user ? { failure_count: user.failed_login_count, locked_until: user.locked_until } : null;
    }
    if (q.startsWith('select failed_reset_count as failure_count, reset_locked_until as locked_until from users where uid = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user ? { failure_count: user.failed_reset_count, locked_until: user.reset_locked_until } : null;
    }
    if (q.startsWith('select q.uid, q.matched_with, q.room_code')) {
      const row = this.db.matchQueue.get(String(a[0]));
      const peer = row && this.db.matchQueue.get(String(row.matched_with));
      return row && peer && row.status === 'matched' && peer.status === 'matched' &&
        peer.matched_with === row.uid && peer.room_code === row.room_code &&
        row.room_code && row.updated_at > Number(a[1]) && peer.updated_at > Number(a[2])
        ? {
            uid: row.uid, matched_with: row.matched_with, room_code: row.room_code,
            reported_outcome: row.reported_outcome, settlement_claim_id: row.settlement_claim_id,
            opponent_outcome: peer.reported_outcome,
            opponent_settlement_claim_id: peer.settlement_claim_id,
          }
        : null;
    }
    if (q.startsWith('select q.reported_outcome, q.settlement_claim_id')) {
      const row = this.db.matchQueue.get(String(a[0]));
      const peer = row && this.db.matchQueue.get(String(row.matched_with));
      return row && peer && row.status === 'matched' && peer.status === 'matched' &&
        peer.matched_with === row.uid && peer.room_code === row.room_code
        ? {
            reported_outcome: row.reported_outcome,
            settlement_claim_id: row.settlement_claim_id,
            opponent_outcome: peer.reported_outcome,
            opponent_settlement_claim_id: peer.settlement_claim_id,
          }
        : null;
    }
    if (q.includes('from users') && q.includes('where username = ?')) {
      const user = [...this.db.users.values()].find(row => row.username === a[0] && row.username);
      return user ? { ...user } : null;
    }
    if (q.startsWith('select * from users where (lower(username) = ? or uid = ? or nickname = ?)')) {
      const user = [...this.db.users.values()].find(row => String(row.username || '').toLowerCase() === a[0] || row.uid === a[1] || row.nickname === a[2]);
      return user ? { ...user } : null;
    }
    if (q.startsWith('select * from users where (username = ? or uid = ?)')) {
      const user = [...this.db.users.values()].find(row => row.username === a[0] || row.uid === a[1]);
      return user ? { ...user } : null;
    }
    if (q.includes('select uid from users where uid = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user && user.username ? { uid: user.uid } : null;
    }
    if (q.startsWith('select uid, username from users where uid = ?')) {
      const user = this.db.users.get(String(a[0]));
      return user && user.username ? { uid: user.uid, username: user.username } : null;
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
    if (q.includes('from social_socket_tickets') && q.includes('ticket_hash = ?')) {
      const row = this.db.tickets.get(String(a[0]));
      return row && row.used === 0 && row.expires_at > Number(a[1]) ? { uid: row.uid, channel: row.channel || 'friends' } : null;
    }
    if (q.includes('from room_socket_tickets') && q.includes('ticket_hash = ?')) {
      const row = this.db.roomSocketTickets.get(String(a[0]));
      const user = row && this.db.users.get(String(row.uid));
      return row && user && row.used === 0 && row.expires_at > Number(a[1])
        ? { ...row, username: user.username }
        : null;
    }
    if (q.includes('select * from game_invites where id = ? and receiver_uid = ?')) {
      const invite = this.db.gameInvites.get(String(a[0]));
      return invite && invite.receiver_uid === String(a[1]) ? { ...invite } : null;
    }
    if (q.startsWith('select max(id) as max_id from private_messages')) {
      const ids = this.db.messages.filter(row => row.pair_key === a[0]).map(row => row.id);
      return { max_id: ids.length ? Math.max(...ids) : null };
    }
    if (q.startsWith('select max(id) as max_id from world_messages')) {
      const requestingUid = q.includes('from user_blocks') ? String(a[a.length - 1]) : '';
      const ids = this.db.worldMessages
        .filter(row => row.channel === a[0] && row.moderation_state === 'visible' && row.created_at >= Number(a[1]) &&
          (!requestingUid || !this.db.blocks.has(`${requestingUid}:${row.sender_uid}`)))
        .map(row => row.id);
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
      const [key, cursor, cleared, limit] = this.args;
      if (q.includes('order by id asc')) {
        return {
          results: this.db.messages
            .filter(row => row.pair_key === key && row.id > Number(cursor) && row.id > Number(cleared))
            .sort((a, b) => a.id - b.id)
            .slice(0, Number(limit))
            .map(row => this.db.publicMessage(row)),
        };
      }
      return {
        results: this.db.messages
          .filter(row => row.pair_key === key && row.id < Number(cursor) && row.id > Number(cleared))
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
    if (q.startsWith('insert into world_message_state')) {
      const uid = String(a[0]);
      const previous = this.db.worldMessageStates.get(uid) || { last_read_id: 0, cleared_before_id: 0 };
      this.db.worldMessageStates.set(uid, {
        last_read_id: Math.max(previous.last_read_id, Number(a[1]) || 0),
        cleared_before_id: previous.cleared_before_id,
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update users set failed_login_count = coalesce(failed_login_count, 0) + 1')) {
      const [limit, lockUntil, uid, now] = a;
      const user = this.db.users.get(String(uid));
      if (!user || Number(user.locked_until || 0) > Number(now)) return { meta: { changes: 0 } };
      user.failed_login_count = Number(user.failed_login_count || 0) + 1;
      if (user.failed_login_count >= Number(limit)) user.locked_until = Number(lockUntil);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update users set failed_reset_count = coalesce(failed_reset_count, 0) + 1')) {
      const [limit, lockUntil, uid, now] = a;
      const user = this.db.users.get(String(uid));
      if (!user || Number(user.reset_locked_until || 0) > Number(now)) return { meta: { changes: 0 } };
      user.failed_reset_count = Number(user.failed_reset_count || 0) + 1;
      if (user.failed_reset_count >= Number(limit)) user.reset_locked_until = Number(lockUntil);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update match_queue set reported_outcome =')) {
      const [outcome, uid, cutoff, peerCutoff] = a;
      const row = this.db.matchQueue.get(String(uid));
      const peer = row && this.db.matchQueue.get(String(row.matched_with));
      if (!row || row.status !== 'matched' || row.settlement_claim_id || row.reported_outcome ||
          Number(row.updated_at) <= Number(cutoff) || !peer || peer.status !== 'matched' ||
          peer.matched_with !== row.uid || peer.room_code !== row.room_code || Number(peer.updated_at) <= Number(peerCutoff)) {
        return { meta: { changes: 0 } };
      }
      row.reported_outcome = String(outcome);
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update match_queue set settlement_claim_id =')) {
      const [claimId, firstUid, secondUid, cutoff, aUid, bUid, aCutoff, bCutoff, aOutcome, bOutcome, firstUserUid, secondUserUid] = a;
      const first = this.db.matchQueue.get(String(firstUid));
      const second = this.db.matchQueue.get(String(secondUid));
      const rowA = this.db.matchQueue.get(String(aUid));
      const rowB = this.db.matchQueue.get(String(bUid));
      if (!first || !second || first.status !== 'matched' || second.status !== 'matched' ||
          first.settlement_claim_id || second.settlement_claim_id ||
          Number(first.updated_at) <= Number(cutoff) || Number(second.updated_at) <= Number(cutoff) ||
          !rowA || !rowB || rowA.status !== 'matched' || rowB.status !== 'matched' ||
          rowA.matched_with !== rowB.uid || rowB.matched_with !== rowA.uid || rowA.room_code !== rowB.room_code ||
          Number(rowA.updated_at) <= Number(aCutoff) || Number(rowB.updated_at) <= Number(bCutoff) ||
          rowA.reported_outcome !== aOutcome || rowB.reported_outcome !== bOutcome ||
          !this.db.users.has(String(firstUserUid)) || !this.db.users.has(String(secondUserUid))) {
        return { meta: { changes: 0 } };
      }
      first.settlement_claim_id = String(claimId);
      second.settlement_claim_id = String(claimId);
      return { meta: { changes: 2 } };
    }
    if (q.startsWith('update users set score =')) {
      const [settledAt, firstUid, secondUid, bUid, aUid, claimA, claimB, outcomeA, outcomeB] = a;
      const rowA = this.db.matchQueue.get(String(aUid));
      const rowB = this.db.matchQueue.get(String(bUid));
      if (!rowA || !rowB || rowA.settlement_claim_id !== claimA || rowB.settlement_claim_id !== claimB ||
          rowA.reported_outcome !== outcomeA || rowB.reported_outcome !== outcomeB ||
          rowA.matched_with !== rowB.uid || rowB.matched_with !== rowA.uid) return { meta: { changes: 0 } };
      for (const uid of [String(firstUid), String(secondUid)]) {
        const user = this.db.users.get(uid);
        const result = this.db.matchQueue.get(uid)?.reported_outcome;
        const delta = result === 'win' ? 25 : result === 'loss' ? -15 : 0;
        user.score = Math.max(0, Number(user.score) + delta);
        user.wins = Number(user.wins || 0) + (result === 'win' ? 1 : 0);
        user.total_games = Number(user.total_games || 0) + 1;
        user.last_game_at = Number(settledAt);
      }
      return { meta: { changes: 2 } };
    }
    if (q.startsWith('delete from social_socket_tickets')) {
      for (const [hash, row] of this.db.tickets) {
        if (row.expires_at <= Number(a[0]) || row.used !== 0) this.db.tickets.delete(hash);
      }
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into social_socket_tickets')) {
      this.db.tickets.set(String(a[0]), { uid: String(a[1]), expires_at: Number(a[2]), used: 0, channel: String(a[3] || 'friends') });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update social_socket_tickets set used = 1')) {
      const row = this.db.tickets.get(String(a[0]));
      if (!row || row.used !== 0 || row.expires_at <= Number(a[1])) return { meta: { changes: 0 } };
      row.used = 1;
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('delete from room_socket_tickets')) {
      for (const [hash, row] of this.db.roomSocketTickets) {
        if (row.expires_at <= Number(a[0]) || row.used !== 0) this.db.roomSocketTickets.delete(hash);
      }
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('insert into room_socket_tickets')) {
      this.db.roomSocketTickets.set(String(a[0]), {
        ticket_hash: String(a[0]), uid: String(a[1]), room_code: String(a[2]), role: String(a[3]),
        session_id: String(a[4]), join_ticket: String(a[5]), expires_at: Number(a[6]), used: 0,
        created_at: Number(a[7]),
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith('update room_socket_tickets set used = 1')) {
      const row = this.db.roomSocketTickets.get(String(a[0]));
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
    this.users = new Map(users.map(user => [user.uid, {
      score: 1000, wins: 0, total_games: 0,
      failed_login_count: 0, locked_until: 0,
      failed_reset_count: 0, reset_locked_until: 0,
      ...user,
    }]));
    this.friendRequests = new Map();
    this.friendships = new Set();
    this.blocks = new Set();
    this.messages = [];
    this.worldMessages = [];
    this.messageStates = new Map();
    this.worldMessageStates = new Map();
    this.matchQueue = new Map();
    this.tickets = new Map();
    this.roomSocketTickets = new Map();
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
    { uid: '100004', username: 'reset-user', nickname: 'Reset User', security_q: 'favorite color?', security_salt: 'reset-salt', security_a_hash: 'no-match' },
  ]);
  const notifications = [];
  const socialFetches = [];
  const roomFetches = [];
  const env = {
    DB: db,
    PRIVATE_GAME_MODE: '0',
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
    GOMOKU_ROOMS: {
      idFromName(name) { return name; },
      get(id) {
        return {
          async fetch(input) {
            roomFetches.push({ id, request: input });
            return new Response(JSON.stringify({ routed: true }), { status: 200 });
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
    ['/api/room/socket-ticket', { method: 'POST', body: { uid: '100001', roomCode: '123456', role: 'host', sessionId: 'session-a', joinTicket: 'join-a' } }],
  ]) {
    const result = await call(env, path, options);
    assert.ok([401, 403].includes(result.response.status), `${path} 必须拒绝未认证请求`);
  }

  const unconfiguredPrivateEnv = { ...env, PRIVATE_GAME_MODE: '1' };
  result = await call(unconfiguredPrivateEnv, '/api/friends?uid=100001', { token: 'token-alice' });
  assert.equal(result.response.status, 403, '缺少 PRIVATE_GAME_USERNAMES 时私人模式必须 fail closed');
  const configuredPrivateEnv = { ...env, PRIVATE_GAME_MODE: '1', PRIVATE_GAME_USERNAMES: 'alice,bob' };
  result = await call(configuredPrivateEnv, '/api/friends/search?uid=100001&username=bob', { token: 'token-alice' });
  assert.equal(result.response.status, 200, '私人账号白名单应从运行时环境变量读取');

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

  const longUsernamePrefix = 'x'.repeat(32);
  db.users.set('100005', {
    uid: '100005', username: longUsernamePrefix, nickname: 'Long User', avatar: '👦',
    token: 'token-long-user', token_expires_at: Date.now() + 86400000,
  });
  result = await call(env, '/api/friends/requests', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { targetUsername: `${longUsernamePrefix}-suffix` },
  });
  assert.equal(result.response.status, 400, '超长好友申请账号名必须拒绝，不能截断到另一个真实账号');
  assert.equal(db.friendRequests.size, 0, '拒绝超长账号名不得创建好友申请');
  db.users.delete('100005');

  const roomTicketIssued = await call(env, '/api/room/socket-ticket', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { roomCode: '123456', role: 'host', sessionId: 'room-session-a', joinTicket: 'room-join-a' },
  });
  assert.equal(roomTicketIssued.response.status, 200);
  const roomSocketTicket = roomTicketIssued.payload.data.ticket;
  result = await call(env,
    `/api/room/socket?room=123456&role=host&session=room-session-a&ticket=room-join-a&socketTicket=${roomSocketTicket}`,
    { headers: { Upgrade: 'websocket', 'X-Gomoku-Room-Uid': '100002' } },
  );
  assert.equal(result.response.status, 200);
  assert.equal(roomFetches.at(-1).request.headers.get('X-Gomoku-Room-Uid'), '100001',
    '房间 DO 身份必须覆盖为一次性票据绑定的 UID，不能接受客户端伪造头');
  result = await call(env,
    `/api/room/socket?room=123456&role=host&session=room-session-a&ticket=room-join-a&socketTicket=${roomSocketTicket}`,
    { headers: { Upgrade: 'websocket' } },
  );
  assert.equal(result.response.status, 401, '房间连接票据必须只能消费一次');

  const room = new sandbox.__gomokuRoom({}, {});
  const hostRequest = (uid, sessionId, joinTicket) => new Request(
    `https://gomoku-api.pages.dev/api/room/socket?room=654321&role=host&session=${sessionId}&ticket=${joinTicket}`,
    { headers: { Upgrade: 'websocket', 'X-Gomoku-Room-Uid': uid } },
  );
  const hostConnection = await room.fetch(hostRequest('100001', 'owner-session', 'owner-join'));
  assert.equal(hostConnection.status, 200);
  const originalHostSocket = lastWebSocketPair[1];
  const takeover = await room.fetch(hostRequest('100002', 'attacker-session', 'attacker-join'));
  assert.equal(takeover.status, 403, '另一账号不得接管已有房主的房间');
  assert.equal(originalHostSocket.closed, false, '拒绝接管不得关闭现有房主连接');

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
  result = await call(env, '/api/messages/read', {
    method: 'POST', uid: '100001', token: 'token-alice',
    body: { friendUid: '100002', lastMessageId: 999999 },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.lastReadId, firstMessage.payload.data.id, '私聊已读游标不得越过该会话的最新消息');
  db.worldMessages.push({
    id: 50, channel: 'world', sender_uid: '100002', moderation_state: 'visible', created_at: Date.now(),
  });
  result = await call(env, '/api/world/messages/read', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { lastMessageId: 999999 },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.lastReadId, 50, '世界频道已读游标不得越过当前可见消息');
  const bobIncrementalMessages = await call(env, '/api/messages?uid=100002&friendUid=100001&after=0&limit=50', { token: 'token-bob' });
  assert.deepEqual(bobIncrementalMessages.payload.data.map(row => row.id), [firstMessage.payload.data.id], 'after 游标应只返回游标之后的新私聊');
  const bobNoNewMessages = await call(env, `/api/messages?uid=100002&friendUid=100001&after=${firstMessage.payload.data.id}&limit=50`, { token: 'token-bob' });
  assert.deepEqual(bobNoNewMessages.payload.data, [], 'after 游标之后没有新消息时应返回空数组');
  const invalidMessageCursor = await call(env, '/api/messages?uid=100002&friendUid=100001&after=-1', { token: 'token-bob' });
  assert.equal(invalidMessageCursor.response.status, 400, '私聊增量游标必须是非负整数');
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
  const aliceAfterClearIncremental = await call(env, '/api/messages?uid=100001&friendUid=100002&after=0', { token: 'token-alice' });
  assert.equal(aliceAfterClearIncremental.payload.data.length, 0, '增量查询也必须尊重当前用户的清空位置');
  assert.equal(bobMessages.payload.data.length, 1, '对方聊天历史不得被一并删除');
  assert.equal(db.messages.length, 1, '清空聊天不得删除永久消息记录');

  db.matchQueue.set('100001', {
    uid: '100001', status: 'matched', matched_with: '100002', room_code: '345678',
    updated_at: Date.now(), reported_outcome: null, settlement_claim_id: null,
  });
  db.matchQueue.set('100002', {
    uid: '100002', status: 'matched', matched_with: '100001', room_code: '345678',
    updated_at: Date.now(), reported_outcome: null, settlement_claim_id: null,
  });
  result = await call(env, '/api/report_game', {
    method: 'POST', uid: '100003', token: 'token-charlie', body: { isWin: true, isDraw: false },
  });
  assert.equal(result.response.status, 409, '没有服务器匹配凭证的客户端不得伪造胜场');
  assert.equal(db.users.get('100003').score, 1000);
  result = await call(env, '/api/report_game', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { isWin: true, isDraw: false },
  });
  assert.equal(result.response.status, 202, '只有一方确认时战绩应暂存且不计分');
  assert.equal(db.users.get('100001').score, 1000);
  result = await call(env, '/api/report_game', {
    method: 'POST', uid: '100002', token: 'token-bob', body: { isWin: false, isDraw: false },
  });
  assert.equal(result.response.status, 200, '双方一致确认后结算天梯');
  assert.equal(db.users.get('100001').score, 1025);
  assert.equal(db.users.get('100001').wins, 1);
  assert.equal(db.users.get('100001').total_games, 1);
  assert.equal(db.users.get('100002').score, 985);
  assert.equal(db.users.get('100002').wins, 0);
  assert.equal(db.users.get('100002').total_games, 1);
  result = await call(env, '/api/report_game', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { isWin: true, isDraw: false },
  });
  assert.equal(result.response.status, 200, '重复结算请求保持幂等');
  assert.equal(db.users.get('100001').score, 1025, '重放战绩不能重复加分');

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
  db.worldMessages.push(
    { id: 51, channel: 'world', sender_uid: '100003', moderation_state: 'visible', created_at: Date.now() },
    { id: 75, channel: 'world', sender_uid: '100002', moderation_state: 'visible', created_at: Date.now() },
  );
  result = await call(env, '/api/world/messages/read', {
    method: 'POST', uid: '100001', token: 'token-alice', body: { lastMessageId: 999999 },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.lastReadId, 51, '世界频道游标不得越过被屏蔽来源的消息');

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
    [/withdrawn/, '撤下状态保留审计而不公开展示'],
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

  const badLoginAttempts = await Promise.all(Array.from({ length: 7 }, () => call(env, '/api/auth/login', {
    method: 'POST', body: { username: 'alice', password: 'wrong-password' },
  })));
  const aliceAfterBadLogins = db.users.get('100001');
  assert.ok(aliceAfterBadLogins.failed_login_count <= 5, '并发错误登录不可绕过原子失败次数上限');
  assert.ok(aliceAfterBadLogins.locked_until > Date.now(), '达到阈值后账号应被锁定');
  assert.ok(badLoginAttempts.some(item => item.response.status === 429 || item.payload.code === 429), '并发错误登录达到阈值时应反馈锁定');
  const resetAttempts = await Promise.all(Array.from({ length: 5 }, () => call(env, '/api/auth/reset_password', {
    method: 'POST', body: { username: 'reset-user', securityAnswer: 'wrong-answer', newPassword: 'new-password' },
  })));
  const resetUser = db.users.get('100004');
  assert.ok(resetUser.failed_reset_count <= 3, '并发错误密保不可绕过原子失败次数上限');
  assert.ok(resetUser.reset_locked_until > Date.now(), '密保达到阈值后应锁定找回流程');
  assert.ok(resetAttempts.some(item => item.payload.code === 429), '并发错误密保达到阈值时应反馈锁定');

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
    privateGameAllowlistRuntimeAndFailClosed: true,
    messageReadCursorsClamped: true,
    pairedGameSettlementVerifiedAndIdempotent: true,
    concurrentCredentialFailuresLockedAtomically: true,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
