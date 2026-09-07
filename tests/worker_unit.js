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

let githubCalls = 0;
const digest = 'sha256:' + 'a'.repeat(64);
const release = {
  tag_name: 'v9.9.9',
  body: 'unit test release',
  assets: [
    {
      name: 'gomoku.apk',
      url: 'https://api.github.com/repos/xnnb04664-afk/gomoku/releases/assets/1',
      digest,
    },
    {
      name: 'gomoku.html',
      url: 'https://api.github.com/repos/xnnb04664-afk/gomoku/releases/assets/2',
      digest,
    },
  ],
};

sandbox.fetch = async (url) => {
  githubCalls++;
  if (String(url).includes('/releases/latest')) {
    return new Response(JSON.stringify(release), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (String(url).endsWith('/releases/assets/1')) {
    return new Response('apk-test-payload', {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  throw new Error(`unexpected URL: ${url}`);
};

vm.runInNewContext(workerSource, sandbox, { filename: 'backend/worker.js' });
const worker = sandbox.__gomokuWorker;
const env = { GITHUB_READ_TOKEN: 'unit-test-token' };

async function main() {
  const requestA = new Request('https://gomoku-api.pages.dev/api/version', {
    headers: { Origin: 'null' },
  });
  const requestB = new Request('https://gomoku-api.pages.dev/api/version', {
    headers: { Origin: 'null' },
  });
  const [responseA, responseB] = await Promise.all([
    worker.fetch(requestA, env),
    worker.fetch(requestB, env),
  ]);
  const versionA = await responseA.json();
  const versionB = await responseB.json();

  assert.equal(responseA.status, 200);
  assert.equal(versionA.code, 0);
  assert.equal(versionA.tag, 'v9.9.9');
  assert.equal(versionB.tag, 'v9.9.9');
  assert.equal(githubCalls, 1, '并发版本请求应合并为一次 GitHub 请求');
  assert.equal(JSON.stringify(versionA).includes('unit-test-token'), false, '响应不得泄露 GitHub Token');
  assert.match(versionA.apkTicket, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const blockedResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    headers: {
      Origin: 'null',
      'X-Gomoku-Client': 'gomoku-app-client-v2',
    },
  }), env);
  assert.equal(blockedResponse.status, 401, '未配置开关时也必须默认拦截无票据下载');

  const assetResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    headers: {
      Origin: 'null',
      'X-Gomoku-Client': 'gomoku-app-client-v2',
      'X-Gomoku-Update-Ticket': versionA.apkTicket,
    },
  }), env);
  assert.equal(assetResponse.status, 200);
  assert.equal(await assetResponse.text(), 'apk-test-payload');
  assert.equal(githubCalls, 2, '下载应只额外读取 Release 文件，不重复读取 latest 元数据');

  console.log(JSON.stringify({
    versionStatus: responseA.status,
    releaseRequests: 1,
    assetRequests: 1,
    ticketIssued: true,
    tokenLeaked: false,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
