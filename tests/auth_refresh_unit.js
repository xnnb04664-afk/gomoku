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
        if (/UPDATE users SET token = \?, token_expires_at = \?, refresh_token_hash = \?, refresh_token_expires_at = /i.test(this.sql)) {
          const [token, tokenExpiresAt, refreshHash, refreshExpiresAt, uid] = this.args;
          if (String(uid) === dbState.user.uid) {
            Object.assign(dbState.user, {
              token,
              token_expires_at: tokenExpiresAt,
              refresh_token_hash: refreshHash,
              refresh_token_expires_at: refreshExpiresAt,
            });
          }
        }
        return { success: true };
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
  const env = { DB: fakeDb };

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
  const refreshResponse = await worker.fetch(authRequest('/api/auth/refresh_session', {
    uid: dbState.user.uid,
    refreshToken: oldRefreshToken,
  }), env);
  const refreshed = await refreshResponse.json();
  assert.equal(refreshResponse.status, 200);
  assert.equal(refreshed.code, 0);
  assert.notEqual(refreshed.data.token, oldAccessToken);
  assert.match(refreshed.data.token, /^[0-9a-f]{48}$/i);
  assert.match(refreshed.data.refreshToken, /^[0-9a-f]{64}$/i);

  const staleRefreshResponse = await worker.fetch(authRequest('/api/auth/refresh_session', {
    uid: dbState.user.uid,
    refreshToken: oldRefreshToken,
  }), env);
  assert.equal(staleRefreshResponse.status, 401, 'Refresh Token 应一次性轮换，旧值必须失效');

  console.log(JSON.stringify({
    verifySeededRefreshToken: true,
    refreshRotatedAccessToken: true,
    staleRefreshRejected: true,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
