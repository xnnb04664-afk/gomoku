const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const workerSource = fs.readFileSync('backend/worker.js', 'utf8')
  .replace('export class GomokuRoom', 'class GomokuRoom')
  .replace('export default {', 'globalThis.__gomokuWorker = {');

const sandbox = {
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
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

let cloudflareTurnCalls = 0;
sandbox.fetch = async (url, init = {}) => {
  assert.match(String(url), /^https:\/\/rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/turn-key-id\/credentials\/generate-ice-servers$/);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer turn-api-secret');
  assert.deepEqual(JSON.parse(init.body), { ttl: 3600 });
  cloudflareTurnCalls += 1;
  return new Response(JSON.stringify({
    iceServers: [
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'temporary-user',
        credential: 'temporary-credential',
      },
    ],
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

vm.runInNewContext(workerSource, sandbox, { filename: 'backend/worker.js' });
const worker = sandbox.__gomokuWorker;
const env = {
  TURN_KEY_ID: 'turn-key-id',
  TURN_KEY_API_TOKEN: 'turn-api-secret',
};

async function main() {
  const response = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/rtc/ice-servers', {
    headers: {
      Origin: 'null',
      'CF-Connecting-IP': '198.51.100.20',
    },
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.code, 0);
  assert.equal(cloudflareTurnCalls, 1);
  assert.equal(payload.data.iceServers.length, 1);
  assert.deepEqual(payload.data.iceServers[0].urls, [
    'turn:turn.cloudflare.com:3478?transport=udp',
    'turns:turn.cloudflare.com:443?transport=tcp',
  ]);
  assert.equal(payload.data.iceServers[0].username, 'temporary-user');
  assert.equal(payload.data.iceServers[0].credential, 'temporary-credential');
  assert.equal(JSON.stringify(payload).includes('turn-api-secret'), false);

  const missingResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/rtc/ice-servers', {
    headers: { Origin: 'null' },
  }), {});
  assert.equal(missingResponse.status, 503);

  console.log(JSON.stringify({
    pass: true,
    status: response.status,
    filteredPort53: true,
    secretNotReturned: true,
    missingSecretStatus: missingResponse.status,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
