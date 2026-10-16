const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const start = appSource.indexOf('    async function fetchUpdateJson(url, timeoutMs, externalSignal = null) {');
const end = appSource.indexOf('\n    let isCheckingAppUpdate', start);
assert.notEqual(start, -1, 'update JSON helper exists');
assert.notEqual(end, -1, 'update manifest section end exists');
const updateSource = appSource.slice(start, end);

const mirrors = [
  'https://gh-proxy.com/https://api.github.com/repos/xnnb04664-afk/gomoku/releases/latest',
  'https://gh-proxy.org/https://api.github.com/repos/xnnb04664-afk/gomoku/releases/latest',
  'https://api.github.com/repos/xnnb04664-afk/gomoku/releases/latest'
];
const ecs = 'https://ecs.test/gomoku-api';
const pages = 'https://pages.test/gomoku-api';
const worker = 'https://worker.test/gomoku-api';

function makeHarness(fetchImpl) {
  const requests = [];
  const context = {
    AbortController,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    console: { warn() {} },
    ECS_API_HOST: ecs,
    UPDATE_CLOUDFLARE_PAGES_ORIGIN: pages,
    UPDATE_CLOUDFLARE_WORKER_ORIGIN: worker,
    UPDATE_SERVICE_ORIGINS: [ecs, pages, worker],
    UPDATE_MANIFEST_TIMEOUTS_MS: [300, 300],
    GITHUB_RELEASE_API_MIRRORS: mirrors,
    fetch: (url, options) => {
      requests.push({ url, options });
      return fetchImpl(url, options);
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
  vm.runInNewContext(`${updateSource}\nthis.fetchUpdateManifestForTest = fetchUpdateManifest;`, context);
  return { fetch: context.fetchUpdateManifestForTest, requests };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function run() {
  {
    const harness = makeHarness((url, options) => {
      if (url.includes('gh-proxy.com')) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      if (url.includes('gh-proxy.org')) return new Promise(resolve => setTimeout(() => resolve(response(200, { tag_name: 'v1.0.200' })), 15));
      if (url.includes('api.github.com')) return Promise.resolve(response(503, { message: 'unavailable' }));
      throw new Error(`unexpected fallback request ${url}`);
    });
    const manifest = await harness.fetch();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(manifest.tag, 'v1.0.200');
    assert.equal(manifest.sourceLabel, 'GitHub 代理节点 B');
    assert.equal(harness.requests.length, 3, 'GitHub mirrors are started concurrently');
    assert.equal(harness.requests.some(request => request.url.startsWith(ecs)), false, 'ECS is used only after every GitHub mirror fails');
    assert.equal(harness.requests.find(request => request.url.includes('gh-proxy.com')).options.signal.aborted, true,
      'the slower mirror is cancelled after a valid manifest wins');
  }

  {
    const harness = makeHarness(async url => {
      if (url.startsWith('https://gh-proxy.com') || url.startsWith('https://gh-proxy.org') || url.startsWith('https://api.github.com')) {
        return response(503, { message: 'unavailable' });
      }
      if (url.startsWith(ecs)) return response(200, { code: 0, tag: 'v1.0.201' });
      throw new Error(`unexpected fallback request ${url}`);
    });
    const manifest = await harness.fetch();
    assert.equal(manifest.type, 'ticketed');
    assert.equal(manifest.tag, 'v1.0.201');
    assert.equal(manifest.sourceOrigin, ecs, 'ECS remains first fallback after all GitHub mirrors fail');
    assert.equal(harness.requests.filter(request => request.url.startsWith(pages) || request.url.startsWith(worker)).length, 0,
      'Cloudflare remains a last resort');
  }
}

run().then(() => console.log('Update manifest race regression checks passed.')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
