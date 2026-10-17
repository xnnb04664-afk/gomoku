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

let githubCalls = 0;
let mirrorCalls = 0;
let officialAssetCalls = 0;
let mirrorUnavailable = false;
let nextMirrorAssetResponse = null;
let nextOfficialAssetResponse = null;
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

sandbox.fetch = async (url, init = {}) => {
  githubCalls++;
  if (String(url).includes('/releases/latest')) {
    return new Response(JSON.stringify(release), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (String(url).includes('gh-proxy.com/https://github.com/')) {
    mirrorCalls++;
    if (mirrorUnavailable) throw new Error('unit-test mirror unavailable');
    if (nextMirrorAssetResponse) {
      const makeResponse = nextMirrorAssetResponse;
      nextMirrorAssetResponse = null;
      return makeResponse(init);
    }
    return new Response('apk-test-payload', {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  if (String(url).endsWith('/releases/assets/1')) {
    officialAssetCalls++;
    if (nextOfficialAssetResponse) {
      const makeResponse = nextOfficialAssetResponse;
      nextOfficialAssetResponse = null;
      return makeResponse(init);
    }
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

  const requestsBeforeMissingSecret = githubCalls;
  const missingTicketSecret = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/version', {
    headers: { Origin: 'null' },
  }), { UPDATE_TICKET_ENFORCED: '1' });
  const missingTicketPayload = await missingTicketSecret.json();
  assert.equal(missingTicketSecret.status, 503, '票据保护启用但没有可用签名密钥时必须停止更新检查');
  assert.match(missingTicketPayload.msg, /票据签名密钥/);
  assert.equal(githubCalls, requestsBeforeMissingSecret, '缺少签名密钥时不得返回版本信息或发起 Release 查询');

  const officialSiteResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/version', {
    headers: { Origin: 'https://gomoku-home.pages.dev' },
  }), env);
  assert.equal(officialSiteResponse.status, 200, '官网来源应能访问 API');
  assert.equal(officialSiteResponse.headers.get('Access-Control-Allow-Origin'), 'https://gomoku-home.pages.dev');

  const rangePreflight = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    method: 'OPTIONS',
    headers: { Origin: 'null', 'Access-Control-Request-Headers': 'range, if-range' },
  }), env);
  assert.match(rangePreflight.headers.get('Access-Control-Allow-Headers'), /Range/i);
  assert.match(rangePreflight.headers.get('Access-Control-Allow-Headers'), /If-Range/i);

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
  assert.equal(assetResponse.headers.get('X-Gomoku-Update-Source'), 'github-proxy', '代理下载来源标记必须是合法 ASCII 响应头');
  assert.equal(githubCalls, 2, '成功的代理下载不再访问 GitHub 官方资产');

  nextMirrorAssetResponse = () => new Response('part', {
    status: 206,
    headers: { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/15' },
  });
  const unexpectedPartialResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    headers: {
      Origin: 'null',
      'X-Gomoku-Client': 'gomoku-app-client-v2',
      'X-Gomoku-Update-Ticket': versionA.apkTicket,
    },
  }), env);
  assert.equal(unexpectedPartialResponse.status, 200, '未请求 Range 时代理返回 206 必须回退到完整官方文件');
  assert.equal(await unexpectedPartialResponse.text(), 'apk-test-payload');
  assert.equal(unexpectedPartialResponse.headers.get('X-Gomoku-Update-Source'), 'github-official');
  assert.equal(mirrorCalls, 2);
  assert.equal(officialAssetCalls, 1);

  nextMirrorAssetResponse = init => {
    assert.equal(new Headers(init.headers).get('Range'), 'bytes=0-3', 'Range 请求必须转发给代理源');
    assert.equal(new Headers(init.headers).get('If-Range'), '"unit-etag"', 'If-Range 必须随 Range 转发');
    return new Response('apkt', {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Length': '4',
        'Content-Range': 'bytes 0-3/15',
        'Accept-Ranges': 'bytes',
        ETag: '"unit-etag"',
      },
    });
  };
  const validRangeResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    headers: {
      Origin: 'null',
      Range: 'bytes=0-3',
      'If-Range': '"unit-etag"',
      'X-Gomoku-Client': 'gomoku-app-client-v2',
      'X-Gomoku-Update-Ticket': versionA.apkTicket,
    },
  }), env);
  assert.equal(validRangeResponse.status, 206, '有效 Range 响应必须保留 206');
  assert.equal(validRangeResponse.statusText, 'Partial Content');
  assert.equal(validRangeResponse.headers.get('Content-Range'), 'bytes 0-3/15');
  assert.equal(validRangeResponse.headers.get('Content-Length'), '4');
  assert.equal(validRangeResponse.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(validRangeResponse.headers.get('ETag'), '"unit-etag"');
  assert.match(validRangeResponse.headers.get('Access-Control-Expose-Headers'), /Content-Range/i);
  assert.equal(await validRangeResponse.text(), 'apkt');

  nextMirrorAssetResponse = () => new Response('part', {
    status: 206,
    headers: { 'Content-Length': '4', 'Content-Range': 'bytes 1-4/15' },
  });
  nextOfficialAssetResponse = () => new Response('apkt', {
    status: 206,
    statusText: 'Partial Content',
    headers: { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/15', 'Accept-Ranges': 'bytes' },
  });
  const mismatchedRangeResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    headers: {
      Origin: 'null',
      Range: 'bytes=0-3',
      'X-Gomoku-Client': 'gomoku-app-client-v2',
      'X-Gomoku-Update-Ticket': versionA.apkTicket,
    },
  }), env);
  assert.equal(mismatchedRangeResponse.status, 206, '镜像 Range 不匹配时应回退到匹配范围的官方源');
  assert.equal(mismatchedRangeResponse.headers.get('Content-Range'), 'bytes 0-3/15');
  assert.equal(mismatchedRangeResponse.headers.get('X-Gomoku-Update-Source'), 'github-official');
  assert.equal(await mismatchedRangeResponse.text(), 'apkt');

  mirrorUnavailable = true;
  const fallbackResponse = await worker.fetch(new Request('https://gomoku-api.pages.dev/api/update/apk', {
    headers: {
      Origin: 'null',
      'X-Gomoku-Client': 'gomoku-app-client-v2',
      'X-Gomoku-Update-Ticket': versionA.apkTicket,
    },
  }), env);
  assert.equal(fallbackResponse.status, 200, '代理失败后应回退到 GitHub 官方 Release 资产');
  assert.equal(await fallbackResponse.text(), 'apk-test-payload');
  assert.equal(fallbackResponse.headers.get('X-Gomoku-Update-Source'), 'github-official', '官方源也应使用合法 ASCII 来源标记');
  assert.equal(officialAssetCalls, 3, '错误分段和代理不可用时都应回退到官方资产');

  console.log(JSON.stringify({
    versionStatus: responseA.status,
    releaseRequests: 1,
    mirrorAssetRequests: mirrorCalls,
    officialAssetRequests: officialAssetCalls,
    partialResponsesValidated: true,
    ticketIssued: true,
    tokenLeaked: false,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
