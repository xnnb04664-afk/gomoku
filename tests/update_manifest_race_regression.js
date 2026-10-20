const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const constantsStart = appSource.indexOf('    const UPDATE_CLOUDFLARE_PAGES_ORIGIN = ');
const constantsEnd = appSource.indexOf('    function isTrustedUpdatePath', constantsStart);
const helpersStart = appSource.indexOf('    async function fetchUpdateJson(url, timeoutMs, externalSignal = null) {');
const helpersEnd = appSource.indexOf('\n    let isCheckingAppUpdate', helpersStart);
assert.notEqual(constantsStart, -1, 'update endpoint constants exist');
assert.notEqual(constantsEnd, -1, 'update endpoint constants end exists');
assert.notEqual(helpersStart, -1, 'update fetch helpers exist');
assert.notEqual(helpersEnd, -1, 'update manifest section end exists');
const constantsSource = appSource.slice(constantsStart, constantsEnd);
const updateSource = appSource.slice(helpersStart, helpersEnd);

const ecs = 'https://ecs.test/gomoku-api';

function makeHarness(fetchImpl) {
  const requests = [];
  const context = {
    AbortController,
    URL,
    Date,
    console: { warn() {} },
    ECS_API_HOST: ecs,
    setTimeout: (callback, timeoutMs) => setTimeout(callback, Math.max(2, Math.ceil(timeoutMs / 500) * 2)),
    clearTimeout,
    fetch: (url, options) => {
      requests.push({ url, options });
      return fetchImpl(url, options, requests);
    },
    normalizeGithubReleaseManifest(release, sourceLabel) {
      if (!/^v\d+\.\d+\.\d+$/.test(String(release?.tag_name || ''))) throw new Error('invalid GitHub manifest');
      return { type: 'github', tag: release.tag_name, sourceLabel };
    },
    normalizeUpdateManifest(data, sourceOrigin, sourceLabel) {
      if (Number(data?.code) !== 0 || !/^v\d+\.\d+\.\d+$/.test(String(data?.tag || ''))) throw new Error('invalid ticket manifest');
      return { type: 'ticketed', tag: data.tag, sourceOrigin, sourceLabel };
    }
  };
  vm.runInNewContext(
    `${constantsSource}\n${updateSource}\n` +
      'this.fetchUpdateManifestForTest = fetchUpdateManifest;\n' +
      'this.proxyUrlsForTest = GITHUB_RELEASE_API_MIRRORS;\n' +
      'this.officialUrlForTest = GITHUB_LATEST_RELEASE_API;\n' +
      'this.serviceOriginsForTest = UPDATE_SERVICE_ORIGINS;',
    context
  );
  return {
    fetch: context.fetchUpdateManifestForTest,
    requests,
    proxyUrls: Array.from(context.proxyUrlsForTest),
    officialUrl: context.officialUrlForTest,
    serviceOrigins: Array.from(context.serviceOriginsForTest)
  };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function abortablePending(signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const error = new Error('request aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function delay(timeoutMs) {
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

function cleanUrl(url) {
  return url.split('?')[0];
}

async function run() {
  {
    const harness = makeHarness((url, options) => {
      if (url.startsWith('https://gh-proxy.com/')) return abortablePending(options.signal);
      if (url.startsWith('https://gh-proxy.org/')) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(response(200, { tag_name: 'v1.0.200' })), 15);
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('request aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      throw new Error(`unexpected request while a proxy is pending: ${url}`);
    });
    const manifestRequest = harness.fetch();
    await delay(5);
    assert.equal(harness.requests.length, 2, 'both proxy requests start together');
    assert.equal(harness.requests.some(request => cleanUrl(request.url) === harness.officialUrl), false,
      'the official API is not started while either proxy is pending');

    const manifest = await manifestRequest;
    assert.equal(manifest.tag, 'v1.0.200');
    assert.equal(manifest.sourceLabel, 'GitHub 代理节点 B');
    assert.equal(harness.requests.some(request => cleanUrl(request.url) === harness.officialUrl), false,
      'a proxy success avoids the direct GitHub API request');
    assert.equal(harness.requests.find(request => request.url.startsWith(harness.proxyUrls[0])).options.signal.aborted, true,
      'the pending proxy request is cancelled after the other proxy succeeds');
    assert.deepEqual(harness.proxyUrls.map(url => new URL(url).hostname), ['gh-proxy.com', 'gh-proxy.org']);
  }

  {
    const harness = makeHarness((url, options, requests) => {
      if (harness.proxyUrls.includes(cleanUrl(url))) return abortablePending(options.signal);
      if (cleanUrl(url) === harness.officialUrl) {
        assert.equal(requests.slice(0, 2).every(request => request.options.signal.aborted), true,
          'the direct request starts only after both proxy requests time out');
        return Promise.resolve(response(200, { tag_name: 'v1.0.201' }));
      }
      throw new Error(`unexpected fallback request ${url}`);
    });
    // The fetch closure is called after the harness has been initialized.
    const manifest = await harness.fetch();
    assert.equal(manifest.tag, 'v1.0.201');
    assert.equal(manifest.sourceLabel, 'GitHub 官方接口');
    assert.equal(harness.requests.length, 3, 'all timed-out proxies are followed by one official request');
    assert.equal(harness.requests[0].options.signal.aborted, true);
    assert.equal(harness.requests[1].options.signal.aborted, true);
    assert.equal(cleanUrl(harness.requests[2].url), harness.officialUrl);
  }

  {
    let harness;
    harness = makeHarness(async (url, options) => {
      const requestUrl = cleanUrl(url);
      if (harness.proxyUrls.includes(requestUrl)) return response(503, { message: 'proxy unavailable' });
      if (requestUrl === harness.officialUrl) return response(503, { message: 'GitHub unavailable' });
      if (requestUrl === `${ecs}/api/version`) return response(503, { msg: 'ECS unavailable' });
      if (requestUrl === `${harness.serviceOrigins[1]}/api/version`) {
        return response(200, { code: 0, tag: 'v1.0.202' });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const manifest = await harness.fetch();
    assert.equal(manifest.type, 'ticketed');
    assert.equal(manifest.tag, 'v1.0.202');
    assert.equal(manifest.sourceOrigin, harness.serviceOrigins[1]);
    assert.deepEqual(harness.requests.slice(-3).map(request => cleanUrl(request.url)), [
      harness.officialUrl,
      `${ecs}/api/version`,
      `${harness.serviceOrigins[1]}/api/version`
    ], 'official failure falls through to ECS and then the first Cloudflare service');
    assert.equal(harness.requests.some(request => cleanUrl(request.url) === `${harness.serviceOrigins[2]}/api/version`), false,
      'later Cloudflare fallback is not contacted after an earlier one succeeds');
  }
}

run().then(() => console.log('Update manifest proxy-priority regression checks passed.')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
