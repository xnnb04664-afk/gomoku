import assert from 'node:assert/strict';
import { D1Database } from '../backend/ecs-host/d1.mjs';
import { makeRuntimeEnv } from '../backend/ecs-host/runtime-env.mjs';
import workerModule from '../backend/worker.js';

const database = new D1Database(':memory:');
const env = makeRuntimeEnv(database, null, null, {
  PRIVATE_GAME_MODE: '0',
  UPDATE_TICKET_ENFORCED: '0'
});
const worker = workerModule.default || workerModule;

async function post(path, body) {
  return worker.fetch(new Request(`https://gomoku.invalid${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'null' },
    body: JSON.stringify(body)
  }), env);
}

try {
  // Any authenticated route initializes the schema before the test seeds accounts.
  const initResponse = await post('/api/match/join', { uid: 'guest_not_allowed' });
  assert.equal(initResponse.status, 401);

  const expiry = Date.now() + 60_000;
  for (const account of [
    { uid: 'sqlite-match-host', username: 'sqlite_host', token: 'sqlite-host-token' },
    { uid: 'sqlite-match-guest', username: 'sqlite_guest', token: 'sqlite-guest-token' }
  ]) {
    await database.prepare(`
      INSERT INTO users (uid, username, nickname, avatar, score, token, token_expires_at)
      VALUES (?, ?, ?, 'anime_boy', 1000, ?, ?)
    `).bind(account.uid, account.username, account.username, account.token, expiry).run();
  }

  const hostJoin = await post('/api/match/join', {
    uid: 'sqlite-match-host', token: 'sqlite-host-token', nickname: 'SQLite Host', matchId: 'sqlite-match-host-001'
  });
  assert.equal(hostJoin.status, 200);
  assert.deepEqual(await hostJoin.json(), { code: 0, status: 'waiting' });

  const hostPoll = await post('/api/match/poll', {
    uid: 'sqlite-match-host', token: 'sqlite-host-token', matchId: 'sqlite-match-host-001'
  });
  assert.equal(hostPoll.status, 200);
  assert.equal((await hostPoll.json()).status, 'waiting');

  const guestJoin = await post('/api/match/join', {
    uid: 'sqlite-match-guest', token: 'sqlite-guest-token', nickname: 'SQLite Guest', matchId: 'sqlite-match-guest-001'
  });
  assert.equal(guestJoin.status, 200);
  const guestMatch = await guestJoin.json();
  assert.equal(guestMatch.code, 0);
  assert.equal(guestMatch.status, 'matched');
  assert.equal(guestMatch.role, 'client');
  assert.equal(guestMatch.opponent.uid, 'sqlite-match-host');

  const matchedHostPoll = await post('/api/match/poll', {
    uid: 'sqlite-match-host', token: 'sqlite-host-token', matchId: 'sqlite-match-host-001'
  });
  assert.equal(matchedHostPoll.status, 200);
  const hostMatch = await matchedHostPoll.json();
  assert.equal(hostMatch.code, 0);
  assert.equal(hostMatch.status, 'matched');
  assert.equal(hostMatch.role, 'host');
  assert.equal(hostMatch.opponent.uid, 'sqlite-match-guest');
  assert.equal(hostMatch.roomCode, guestMatch.roomCode);

  console.log(JSON.stringify({
    waitingJoin: true,
    waitingPoll: true,
    secondJoinMatched: true,
    matchedHostPoll: true,
    roomCodeShared: true
  }));
} finally {
  database.close();
}
