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

// Execute the worker's SQL against SQLite rather than duplicating its old
// users-table credential implementation in a permissive mock (Node >= 22.13).
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const sqlite = new DatabaseSync(':memory:');
let readBarrier = null;
let legacyReadPause = null;
const db = {
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.executeRun());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
  prepare(sql) {
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async run() { return this.executeRun(); },
      executeRun() {
        const result = sqlite.prepare(sql).run(...this.args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() {
        const row = sqlite.prepare(sql).get(...this.args) || null;
        if (legacyReadPause && /FROM users WHERE uid = \? AND token = \?/i.test(sql)) {
          const pause = legacyReadPause;
          legacyReadPause = null;
          pause.captured();
          await pause.resumed;
        }
        // Force both requests to read the same pre-rotation snapshot. This
        // exercises the SQL CAS rather than depending on crypto scheduling.
        if (readBarrier && /FROM auth_sessions WHERE uid = \? AND (access_token_hash|refresh_token_hash) = \?/i.test(sql)) {
          const barrier = readBarrier;
          barrier.remaining -= 1;
          if (!barrier.remaining) { readBarrier = null; barrier.release(); }
          await barrier.ready;
        }
        return row;
      },
      async all() { return { results: sqlite.prepare(sql).all(...this.args) }; },
    };
  },
};
vm.runInNewContext(workerSource, sandbox, { filename: 'backend/worker.js' });
const worker = sandbox.__gomokuWorker;
const env = { DB: db, PRIVATE_GAME_MODE: '0' };
const uid = '557229';
const hash = (token, salt) => createHash('sha256')
  .update(`${token}__GOMOKU_PEPPER_2026__${salt}`).digest('hex');
function barrierForTwoReads() {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  readBarrier = { remaining: 2, ready, release };
}
async function request(path, credentials) {
  const response = await worker.fetch(new Request(`https://gomoku-api.pages.dev/api/auth/${path}`, {
    method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, ...credentials }),
  }), env);
  return { status: response.status, payload: await response.json() };
}
function reset() {
  sqlite.exec('DELETE FROM auth_sessions; DELETE FROM users');
  sqlite.prepare(`INSERT INTO users
    (uid, username, nickname, avatar, score, wins, total_games, security_q, token, token_expires_at)
    VALUES (?, ?, ?, ?, 1000, 2, 3, ?, ?, ?)`)
    .run(uid, 'refresh-test-user', 'refresh-test-user', 'anime_boy', 'test question', 'legacy-other-device', Date.now() + 60000);
}
function seedSession(id = 'device-a', token = 'device-a-access', refreshToken = 'a'.repeat(64), options = {}) {
  const now = Date.now();
  sqlite.prepare(`INSERT INTO auth_sessions
    (session_id, uid, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at, created_at, last_used_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, uid, hash(token, `${uid}:access`), options.accessExpiresAt ?? now + 60000,
      hash(refreshToken, uid), options.refreshExpiresAt ?? now + 60000, now, now, options.revokedAt ?? null);
  return { token, refreshToken };
}
async function protectedHistory(token) {
  const response = await worker.fetch(new Request(`https://gomoku-api.pages.dev/api/history/list?uid=${uid}`, {
    headers: { Origin: 'null', Authorization: `Bearer ${token}` },
  }), env);
  return { status: response.status, payload: await response.json() };
}
const session = id => sqlite.prepare('SELECT * FROM auth_sessions WHERE session_id = ?').get(id);
function assertCredentialHashes(row, credentials) {
  assert.equal(row.access_token_hash, hash(credentials.token, `${uid}:access`));
  assert.equal(row.refresh_token_hash, hash(credentials.refreshToken, uid));
  assert.notEqual(row.access_token_hash, credentials.token, 'Access Token must never be stored in plaintext');
  assert.notEqual(row.refresh_token_hash, credentials.refreshToken, 'Refresh Token must never be stored in plaintext');
}
async function main() {
  // Bootstrap the real worker schema, including its migration statements.
  await request('verify_session', {});
  reset();
  const original = seedSession();
  seedSession('device-b', 'device-b-access', 'b'.repeat(64));
  const otherDeviceBefore = { ...session('device-b') };
  const verified = await request('verify_session', { token: original.token });
  assert.equal(verified.status, 200);
  assert.equal(verified.payload.code, 0);
  assert.match(verified.payload.data.token, /^[0-9a-f]{48}$/i);
  assert.match(verified.payload.data.refreshToken, /^[0-9a-f]{64}$/i);
  assert.notEqual(verified.payload.data.token, original.token);
  assertCredentialHashes(session('device-a'), verified.payload.data);
  assert.deepEqual({ ...session('device-b') }, otherDeviceBefore, 'Verification must preserve another device session');

  const old = verified.payload.data;
  barrierForTwoReads();
  const results = await Promise.all([1, 2].map(() => request('refresh_session', { refreshToken: old.refreshToken })));
  assert.equal(results.filter(item => item.status === 200 && item.payload.code === 0).length, 1, 'Exactly one refresh CAS winner');
  assert.equal(results.filter(item => item.status === 401 && item.payload.retryable === true).length, 1, 'Refresh CAS loser must wait for the other tab credentials');
  const winner = results.find(item => item.status === 200).payload.data;
  assertCredentialHashes(session('device-a'), winner);
  assert.equal((await request('refresh_session', { refreshToken: old.refreshToken })).status, 401, 'Rotated refresh must be unusable');
  assert.notEqual((await request('verify_session', { token: old.token })).payload.code, 0, 'Rotated access must be unusable');
  assert.deepEqual({ ...session('device-b') }, otherDeviceBefore, 'Refresh must preserve another device session');

  const refreshed = await request('refresh_session', { refreshToken: winner.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.payload.code, 0);
  assert.notEqual(refreshed.payload.data.token, winner.token);
  assert.notEqual(refreshed.payload.data.refreshToken, winner.refreshToken);
  assertCredentialHashes(session('device-a'), refreshed.payload.data);

  for (const [name, options] of [
    ['revoked', { revokedAt: Date.now() }],
    ['expired access', { accessExpiresAt: Date.now() - 1 }],
  ]) {
    reset(); const credentials = seedSession('device-a', 'device-a-access', 'a'.repeat(64), options);
    const before = { ...session('device-a') };
    assert.equal((await request('verify_session', { token: credentials.token })).status, 401, `${name} access must fail`);
    assert.deepEqual({ ...session('device-a') }, before, `${name} verification must not rotate credentials`);
  }
  for (const [name, options] of [
    ['revoked', { revokedAt: Date.now() }],
    ['expired refresh', { refreshExpiresAt: Date.now() - 1 }],
  ]) {
    reset(); const credentials = seedSession('device-a', 'device-a-access', 'a'.repeat(64), options);
    const before = { ...session('device-a') };
    assert.equal((await request('refresh_session', { refreshToken: credentials.refreshToken })).status, 401, `${name} refresh must fail`);
    assert.deepEqual({ ...session('device-a') }, before, `${name} refresh must not rotate credentials`);
  }
  reset();
  const expiredAccess = seedSession('device-a', 'device-a-access', 'a'.repeat(64), { accessExpiresAt: Date.now() - 1 });
  assert.equal((await request('refresh_session', { refreshToken: expiredAccess.refreshToken })).status, 200, 'Valid refresh must recover expired access');
  for (const refreshToken of ['', 'x'.repeat(64), 'a'.repeat(63), 'c'.repeat(64)]) {
    assert.equal((await request('refresh_session', { refreshToken })).status, 401, 'Malformed or unknown refresh must fail');
  }
  // Existing installations may carry refresh credentials only in users.
  reset();
  const legacyRefresh = 'd'.repeat(64);
  sqlite.prepare('UPDATE users SET refresh_token_hash = ?, refresh_token_expires_at = ? WHERE uid = ?')
    .run(hash(legacyRefresh, uid), Date.now() + 60000, uid);
  barrierForTwoReads();
  const legacyRefreshResults = await Promise.all([1, 2].map(() => request('refresh_session', { refreshToken: legacyRefresh })));
  assert.equal(legacyRefreshResults.filter(item => item.status === 200 && item.payload.code === 0).length, 1, 'Exactly one legacy migration winner');
  assert.equal(legacyRefreshResults.filter(item => item.status === 401 && item.payload.retryable === true).length, 1, 'Legacy migration loser must retry');
  const migrated = legacyRefreshResults.find(item => item.status === 200).payload.data;
  const activeSessions = sqlite.prepare('SELECT * FROM auth_sessions WHERE uid = ? AND revoked_at IS NULL').all(uid);
  assert.equal(activeSessions.length, 1, 'Losing legacy migration must revoke its newly inserted session');
  assertCredentialHashes(activeSessions[0], migrated);
  assert.equal((await request('refresh_session', { refreshToken: legacyRefresh })).status, 401, 'Legacy refresh must be single use');
  // Even if a previous release left users.token behind, revoked/expired
  // session rows are authoritative and must never be reactivated by migration.
  for (const options of [
    { revokedAt: Date.now() },
    { accessExpiresAt: Date.now() - 1, refreshExpiresAt: Date.now() - 1 },
  ]) {
    reset();
    const credentials = seedSession('legacy-session', 'legacy-other-device', 'f'.repeat(64), options);
    sqlite.prepare('UPDATE users SET refresh_token_hash = ?, refresh_token_expires_at = ? WHERE uid = ?')
      .run(hash(credentials.refreshToken, uid), Date.now() + 60000, uid);
    assert.notEqual((await request('verify_session', { token: credentials.token })).payload.code, 0);
    assert.notEqual((await request('refresh_session', { refreshToken: credentials.refreshToken })).payload.code, 0);
    assert.notEqual((await protectedHistory(credentials.token)).status, 200);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 1,
      'Migration must preserve the existing expired/revoked row');
  }
  reset();
  sqlite.prepare('UPDATE users SET token_expires_at = ? WHERE uid = ?').run(Date.now() - 1, uid);
  assert.notEqual((await request('verify_session', { token: 'legacy-other-device' })).payload.code, 0);
  assert.notEqual((await protectedHistory('legacy-other-device')).status, 200);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0, 'Expired legacy access must not migrate');

  // Both verifiers observe the same absent session before attempting the
  // migration. Only the winning rotation can return usable credentials.
  reset();
  seedSession('other-device', 'other-device-access', '9'.repeat(64));
  const otherBeforeMigration = { ...session('other-device') };
  barrierForTwoReads();
  const migrationResults = await Promise.all([1, 2].map(() => request('verify_session', { token: 'legacy-other-device' })));
  const migrationSuccesses = migrationResults.filter(item => item.payload.code === 0);
  assert.equal(migrationSuccesses.length, 1, 'Concurrent migration and verify must have exactly one winner');
  assert.ok(migrationResults.some(item => item.status === 401 && item.payload.retryable), 'Concurrent migration loser must retry');
  assert.deepEqual({ ...session('other-device') }, otherBeforeMigration, 'Migration must not alter another device');
  assert.equal((await protectedHistory(migrationSuccesses[0].payload.data.token)).status, 200);
  assert.notEqual((await protectedHistory('legacy-other-device')).status, 200);
  const consumedLegacy = sqlite.prepare('SELECT token, refresh_token_hash FROM users WHERE uid = ?').get(uid);
  assert.equal(consumedLegacy.token, null);
  assert.equal(consumedLegacy.refresh_token_hash, null);

  // Pause a protected request after it reads users but before its migration.
  // Another verifier rotates the session while that legacy snapshot is stale.
  reset();
  let captured, resume;
  const snapshotCaptured = new Promise(resolve => { captured = resolve; });
  const resumed = new Promise(resolve => { resume = resolve; });
  legacyReadPause = { captured, resumed };
  const delayedLegacyRequest = protectedHistory('legacy-other-device');
  await snapshotCaptured;
  const rotatedDuringMigration = await request('verify_session', { token: 'legacy-other-device' });
  assert.equal(rotatedDuringMigration.payload.code, 0);
  resume();
  assert.notEqual((await delayedLegacyRequest).status, 200, 'A stale legacy snapshot must not recreate rotated access');
  assert.notEqual((await protectedHistory('legacy-other-device')).status, 200);
  assert.equal((await protectedHistory(rotatedDuringMigration.payload.data.token)).status, 200);

  // A refreshable session may outlive its access token. Its leftover legacy
  // alias must still be consumed when refresh rotates the expired access hash.
  reset();
  const expiredAlias = seedSession('old-expired-access', 'legacy-other-device', '7'.repeat(64), { accessExpiresAt: Date.now() - 1 });
  const recoveredAlias = await request('refresh_session', { refreshToken: expiredAlias.refreshToken });
  assert.equal(recoveredAlias.payload.code, 0);
  assert.notEqual((await protectedHistory(expiredAlias.token)).status, 200);
  assert.equal((await protectedHistory(recoveredAlias.payload.data.token)).status, 200);

  for (const rotation of ['verify_session', 'refresh_session']) {
    reset();
    const credentials = seedSession('old-migrated-session', 'legacy-other-device', '8'.repeat(64));
    sqlite.prepare('UPDATE users SET refresh_token_hash = ?, refresh_token_expires_at = ? WHERE uid = ?')
      .run(hash(credentials.refreshToken, uid), Date.now() + 60000, uid);
    const rotated = await request(rotation, credentials);
    assert.equal(rotated.payload.code, 0, 'Previously migrated session must still rotate');
    assert.notEqual((await protectedHistory(credentials.token)).status, 200, 'Old migration alias must not revive');
    assert.equal((await protectedHistory(rotated.payload.data.token)).status, 200);
  }
  {
    reset();
    const legacyToken = 'legacy-other-device';
    const legacyResult = await request('verify_session', { token: legacyToken });
    const legacyMigrated = legacyResult.payload.code === 0 &&
      Boolean(legacyResult.payload.data?.token) && Boolean(legacyResult.payload.data?.refreshToken);

    reset();
    const initial = seedSession();
    barrierForTwoReads();
    const concurrentVerify = await Promise.all([1, 2].map(() => request('verify_session', { token: initial.token })));
    const returnedOtherDeviceToken = concurrentVerify.some(item =>
      item.payload.code === 0 && item.payload.data?.token === legacyToken);
    const invalidSuccessfulTokens = concurrentVerify.filter(item => item.payload.code === 0 &&
      !sqlite.prepare('SELECT session_id FROM auth_sessions WHERE uid = ? AND access_token_hash = ? AND revoked_at IS NULL')
        .get(uid, hash(item.payload.data.token, `${uid}:access`))).length;
    const legacyAccessReused = [];
    for (const rotation of ['verify_session', 'refresh_session']) {
      reset();
      // Simulate an existing installation migrating through an authenticated
      // API before it verifies/refreshes its session on the next startup.
      const legacyRefresh = 'e'.repeat(64);
      sqlite.prepare('UPDATE users SET refresh_token_hash = ?, refresh_token_expires_at = ? WHERE uid = ?')
        .run(hash(legacyRefresh, uid), Date.now() + 60000, uid);
      const firstProtected = await protectedHistory(legacyToken);
      assert.equal(firstProtected.status, 200, 'Legacy access must migrate through requireUser');
      const rotated = await request(rotation, { token: legacyToken, refreshToken: legacyRefresh });
      assert.equal(rotated.payload.code, 0, `${rotation} must rotate migrated credentials`);
      const replay = await protectedHistory(legacyToken);
      const fresh = await protectedHistory(rotated.payload.data.token);
      assert.equal(fresh.status, 200, 'New access must remain valid');
      legacyAccessReused.push({ rotation, oldAccessAccepted: replay.status === 200 });
    }
    console.log(JSON.stringify({ legacyMigrated, legacyResponse: legacyResult.payload.code,
      legacyAccessReused,
      concurrentVerify: concurrentVerify.map(item => ({ status: item.status, code: item.payload.code,
        hasRefreshToken: Boolean(item.payload.data?.refreshToken),
        returnedOtherDeviceToken: item.payload.data?.token === legacyToken })),
      invalidSuccessfulTokens }));
    assert.ok(legacyMigrated && !returnedOtherDeviceToken && invalidSuccessfulTokens === 0 &&
      legacyAccessReused.every(item => !item.oldAccessAccepted),
      'Legacy verification must migrate credentials; concurrent verification must never return another device or invalid token; rotated legacy access must not revive');
  }
  console.log(JSON.stringify({
    sqliteBacked: true, verifyRotatesHashedCredentials: true, concurrentRefreshSingleWinner: true,
    refreshRotatesBothTokens: true, staleTokensRejected: true, otherDevicePreserved: true,
    revokedAndExpiredRejected: true, expiredAccessRecoverableByRefresh: true, legacyRefreshMigrationSingleWinner: true,
  }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => sqlite.close());
