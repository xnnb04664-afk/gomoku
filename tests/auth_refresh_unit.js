const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const workerSource = fs.readFileSync('backend/worker.js', 'utf8')
  .replace('export class GomokuRoom', 'class GomokuRoom')
  .replace('export class SocialHub', 'class SocialHub')
  .replace('export default {', 'globalThis.__gomokuWorker = {');

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
};

const dbState = {
  user: {
    uid: '557229',
    username: 'refresh-test-user',
    nickname: 'refresh-test-user',
    avatar: 'anime_boy',
    score: 1000,
    wins: 2,
    total_games: 3,
    security_q: '测试问题',
    token: 'access-token-before-refresh',
    token_expires_at: Date.now() + 60 * 1000,
    refresh_token_hash: null,
    refresh_token_expires_at: 0,
  },
};

function cloneUser() {
  return { ...dbState.user };
}

const fakeDb = {
  prepare(sql) {
    const statement = {
      sql,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async run() {
        const normalizedSql = this.sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalizedSql.startsWith('update users set token = ?, token_expires_at = ?, refresh_token_hash = ?, refresh_token_expires_at = ?') &&
            normalizedSql.includes('where uid = ? and token = ? and refresh_token_hash is ?')) {
          const [token, tokenExpiresAt, refreshHash, refreshExpiresAt, uid, expectedAccessToken, expectedRefreshHash, now] = this.args;
          const matches = String(uid) === dbState.user.uid && dbState.user.token === expectedAccessToken &&
            (dbState.user.refresh_token_hash ?? null) === expectedRefreshHash &&
            (!dbState.user.token_expires_at || Number(dbState.user.token_expires_at) > Number(now));
          if (matches) {
            Object.assign(dbState.user, {
              token,
              token_expires_at: tokenExpiresAt,
              refresh_token_hash: refreshHash,
              refresh_token_expires_at: refreshExpiresAt,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (normalizedSql.startsWith('update users set token = ?, token_expires_at = ?, refresh_token_hash = ?, refresh_token_expires_at = ?') &&
            normalizedSql.includes('where uid = ? and refresh_token_hash = ? and refresh_token_expires_at > ?')) {
          const [token, tokenExpiresAt, refreshHash, refreshExpiresAt, uid, expectedRefreshHash, now] = this.args;
          const matches = String(uid) === dbState.user.uid && dbState.user.refresh_token_hash === expectedRefreshHash &&
            Number(dbState.user.refresh_token_expires_at) > Number(now);
          if (matches) {
            Object.assign(dbState.user, {
              token,
              token_expires_at: tokenExpiresAt,
              refresh_token_hash: refreshHash,
              refresh_token_expires_at: refreshExpiresAt,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      async first() {
        if (/FROM users WHERE uid = \?/i.test(this.sql)) return cloneUser();
        return null;
      },
      async all() {
        return { results: [] };
      },
    };
    return statement;
  },
};

vm.runInNewContext(workerSource, sandbox, { filename: 'backend/worker.js' });
const worker = sandbox.__gomokuWorker;

function authRequest(path, body) {
  return new Request(`https://gomoku-api.pages.dev${path}`, {
    method: 'POST',
    headers: { 'Origin': 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  const env = { DB: fakeDb, PRIVATE_GAME_MODE: '0' };

  const verifyResponse = await worker.fetch(authRequest('/api/auth/verify_session', {
    uid: dbState.user.uid,
    token: dbState.user.token,
  }), env);
  const verify = await verifyResponse.json();
  assert.equal(verifyResponse.status, 200);
  assert.equal(verify.code, 0);
  assert.match(verify.data.refreshToken, /^[0-9a-f]{64}$/i);
  assert.notEqual(dbState.user.refresh_token_hash, verify.data.refreshToken, '数据库不得保存 Refresh Token 明文');

  const oldAccessToken = dbState.user.token;
  const oldRefreshToken = verify.data.refreshToken;
  const concurrentRefreshResponses = await Promise.all([1, 2].map(() => worker.fetch(authRequest('/api/auth/refresh_session', {
    uid: dbState.user.uid,
    refreshToken: oldRefreshToken,
  }), env)));
  const concurrentResults = await Promise.all(concurrentRefreshResponses.map(async response => ({
    response,
    payload: await response.json(),
  })));
  const refreshWinner = concurrentResults.find(item => item.response.status === 200);
  const refreshLoser = concurrentResults.find(item => item.response.status === 401);
  assert.ok(refreshWinner, '并发 refresh 只能有一个请求成功轮换 token');
  assert.ok(refreshLoser, '并发 refresh 的 CAS 输家必须收到 401');
  assert.equal(refreshLoser.payload.retryable, true, 'CAS 输家应提示同浏览器等待另一个标签页发布新凭证');
  const refreshResponse = await worker.fetch(authRequest('/api/auth/refresh_session', {
    uid: dbState.user.uid,
    refreshToken: refreshWinner.payload.data.refreshToken,
  }), env);
  const refreshed = await refreshResponse.json();
  assert.equal(refreshResponse.status, 200);
  assert.equal(refreshed.code, 0);
  assert.notEqual(refreshed.data.token, oldAccessToken);
  assert.notEqual(refreshed.data.token, refreshWinner.payload.data.token);
  assert.match(refreshed.data.token, /^[0-9a-f]{48}$/i);
  assert.match(refreshed.data.refreshToken, /^[0-9a-f]{64}$/i);

  const staleRefreshResponse = await worker.fetch(authRequest('/api/auth/refresh_session', {
    uid: dbState.user.uid,
    refreshToken: oldRefreshToken,
  }), env);
  assert.equal(staleRefreshResponse.status, 401, 'Refresh Token 应一次性轮换，旧值必须失效');

  console.log(JSON.stringify({
    verifySeededRefreshToken: true,
    concurrentRefreshSingleWinner: true,
    refreshRotatedAccessToken: true,
    staleRefreshRejected: true,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
