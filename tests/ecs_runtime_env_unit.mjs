import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeRuntimeEnv } from '../backend/ecs-host/runtime-env.mjs';

const database = { kind: 'sqlite-adapter' };
const rooms = { kind: 'rooms' };
const social = { kind: 'social' };
const sourceEnv = {
  PRIVATE_GAME_MODE: '1',
  PRIVATE_GAME_USERNAMES: 'alpha,beta',
  UPDATE_TICKET_ENFORCED: '1',
  PREMIUM_PAYMENT_MODE: 'disabled'
};
const env = makeRuntimeEnv(database, rooms, social, sourceEnv);

assert.equal(env.DB, database);
assert.equal(env.GOMOKU_ROOMS, rooms);
assert.equal(env.GOMOKU_SOCIAL, social);
assert.equal(env.PRIVATE_GAME_MODE, '1');
assert.equal(env.PRIVATE_GAME_USERNAMES, sourceEnv.PRIVATE_GAME_USERNAMES);
assert.equal(env.UPDATE_TICKET_ENFORCED, '1');
assert.equal(env.PREMIUM_PAYMENT_MODE, 'disabled');
assert.equal(makeRuntimeEnv(database, rooms, social, {}).PRIVATE_GAME_USERNAMES, '');
const serviceUnit = await readFile(new URL('../backend/ecs-host/deploy/gomoku-ecs.service', import.meta.url), 'utf8');
assert.match(serviceUnit, /^Environment=PRIVATE_GAME_MODE=1$/m);
assert.match(serviceUnit, /^EnvironmentFile=\/etc\/gomoku\/gomoku\.env$/m);
assert.doesNotMatch(serviceUnit, /^PRIVATE_GAME_MODE=/m);
assert.doesNotMatch(serviceUnit, /^GOMOKU_ECS_PORT=/m);
console.log('ECS runtime environment forwarding: PASS');
