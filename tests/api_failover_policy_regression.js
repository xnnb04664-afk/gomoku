const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const socialSource = fs.readFileSync(path.join(root, 'js/social.js'), 'utf8');
const ecsConfigSource = fs.readFileSync(path.join(root, 'js/ecs-config.js'), 'utf8');

const fetchStart = appSource.indexOf('    async function safeApiFetch(endpoint, options = {}) {');
const fetchEnd = appSource.indexOf('\n    // 匿名性能/线路指标', fetchStart);
assert.notEqual(fetchStart, -1, 'safeApiFetch definition exists');
assert.notEqual(fetchEnd, -1, 'safeApiFetch end marker exists');
const safeApiFetchSource = appSource.slice(fetchStart, fetchEnd);

const ECS = 'https://ecs.test/gomoku-api';
const CF_PAGES = 'https://pages.test/gomoku-api';
const CF_WORKER = 'https://worker.test/gomoku-api';
const allHosts = [ECS, CF_PAGES, CF_WORKER];
const ecsOnlyHosts = [ECS];

assert.match(ecsConfigSource, /enableCloudflareEmergencyApi:\s*false/,
  'Cloudflare game API failover is disabled in the shipped configuration');

function makeResponse(status, body = {}) {
  return {
    status,
    body: { cancel: async () => { body.cancelled = true; } },
    bodyState: body
  };
}

function createHarness(fetchImpl, hosts = ecsOnlyHosts) {
  const requests = [];
  const notices = [];
  const context = {
    API_PRIMARY_HOST: ECS,
    API_LOGIN_PATH: '/api/auth/login',
    CLOUDFLARE_API_HOSTS: [CF_PAGES, CF_WORKER],
    apiOperationLabel: path => path || '游戏服务请求',
    getOrderedApiHosts: () => hosts,
    getAllowedApiHostForUrl(url) {
      return hosts.find(host => {
        const base = new URL(host);
        return url.origin === base.origin && url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/');
      }) || '';
    },
    getApiPathname(url) {
      const host = this.getAllowedApiHostForUrl(url);
      const prefix = host ? new URL(host).pathname.replace(/\/$/, '') : '';
      return prefix ? (url.pathname.slice(prefix.length) || '/') : url.pathname;
    },
    resolveApiUrl(endpoint, host) {
      const base = new URL(host);
      const parsed = new URL(endpoint, 'https://gomoku.invalid');
      const url = new URL(base.origin);
      url.pathname = base.pathname.replace(/\/$/, '') + parsed.pathname;
      url.search = parsed.search;
      return url;
    },
    isAllowedApiHost(host) { return hosts.includes(host); },
    isApiAbortError(error) { return error && error.name === 'AbortError'; },
    markApiHostFailure() {},
    markApiHostSuccess() {},
    persistApiHostFailures() {},
    localStorage: { getItem: () => null },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetchImpl(url, options);
    },
    AbortController,
    setTimeout: () => 1,
    clearTimeout: () => {},
    showGameNotice: message => notices.push(String(message)),
    console: { warn() {} },
    URL
  };
  vm.runInNewContext(`${safeApiFetchSource}\nthis.safeApiFetch = safeApiFetch;`, context);
  return { fetch: context.safeApiFetch, requests, notices };
}

async function run() {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const failure = makeResponse(503);
    const harness = createHarness(async () => failure);
    const result = await harness.fetch('/api/health', { method });
    assert.equal(result, failure);
    assert.equal(harness.requests.length, 1, `safe ${method} stays on ECS when Cloudflare is disabled`);
    assert.match(harness.requests[0].url, /^https:\/\/ecs\.test\/gomoku-api\//);
  }

  {
    let call = 0;
    const success = makeResponse(200);
    const harness = createHarness(async () => (++call === 1 ? makeResponse(503) : success), allHosts);
    const result = await harness.fetch('/api/health', { method: 'GET' });
    assert.equal(result, success);
    assert.equal(harness.requests.length, 2, 'operator-enabled emergency mode can fall back after ECS fails');
    assert.match(harness.requests[1].url, /^https:\/\/pages\.test\/gomoku-api\//);
  }

  {
    const originalFailure = makeResponse(503);
    const harness = createHarness(async () => originalFailure);
    const result = await harness.fetch('/api/friends/send', { method: 'POST', body: '{}' });
    assert.equal(result, originalFailure, 'mutation returns the original ECS response');
    assert.equal(harness.requests.length, 1, 'mutation is not replayed on another backend');
    assert.match(harness.requests[0].url, /^https:\/\/ecs\.test\/gomoku-api\//);
    assert.match(harness.notices[0], /HTTP 503.*是否完成无法确认/);
    assert.equal(originalFailure.bodyState.cancelled, undefined, 'original failure body stays available to caller');
  }

  {
    const harness = createHarness(async () => { throw new TypeError('connection reset'); });
    await assert.rejects(
      harness.fetch('/api/history/record', { method: 'POST', body: '{}' }),
      error => error.code === 'API_COMMIT_UNKNOWN' && /无法确认/.test(error.message)
    );
    assert.equal(harness.requests.length, 1, 'network failure does not replay a mutation');
    assert.match(harness.notices[0], /无法确认/);
  }

  {
    const originalFailure = makeResponse(503);
    const harness = createHarness(async () => originalFailure);
    await assert.rejects(
      harness.fetch(`${CF_PAGES}/api/profile/update`, { method: 'PATCH', body: '{}' }),
      /拒绝访问非官方 API 地址/
    );
    assert.equal(harness.requests.length, 0, 'Cloudflare business API is not directly reachable by default');
  }

  {
    const originalFailure = makeResponse(503);
    const harness = createHarness(async () => originalFailure);
    await harness.fetch('/api/metrics', { method: 'POST', anonymous: true, body: '{}' });
    assert.equal(harness.requests.length, 1, 'anonymous metrics are also not replayed');
    assert.equal(harness.notices.length, 0, 'fire-and-forget telemetry does not interrupt gameplay');
  }

  const stopStart = socialSource.indexOf('  function stop() {');
  const stopEnd = socialSource.indexOf('\n  window.GomokuSocial', stopStart);
  assert.notEqual(stopStart, -1, 'GomokuSocial.stop definition exists');
  assert.notEqual(stopEnd, -1, 'GomokuSocial export marker exists');
  assert.match(socialSource.slice(stopStart, stopEnd), /state\.affinity\.clear\(\)/,
    'stopping social clears the account-scoped affinity cache');
}

run().then(() => {
  console.log('API failover and social affinity regression checks passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
