'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  runRelease,
  main,
  defaultRunner,
  resolveExecutable
} = require('../release_official');

const RUN_ID = '2026-10-20T12-00-00-000Z-1234-abcdef';
const SIGNER_SHA256 = '9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e';
const WRONG_SHA256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CLOUDFLARE_TOKEN = 'unit-test-cloudflare-token-keep-private';
const TEMP_PREFIX = path.join(os.tmpdir(), 'gomoku-official-release-tests-');

function cleanupFixture(root) {
  const absolute = path.resolve(root);
  if (!absolute.startsWith(TEMP_PREFIX) || path.dirname(absolute) !== path.dirname(TEMP_PREFIX)) {
    throw new Error(`Refusing to remove non-test fixture directory: ${absolute}`);
  }
  fs.rmSync(absolute, { recursive: true, force: true });
}

function makeFixture() {
  const root = fs.mkdtempSync(TEMP_PREFIX);
  const write = (relative, content) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write('publish.js', '// mocked by the test runner\n');
  write('version.json', JSON.stringify({ versionName: '1.0.151', versionCode: 152, releaseTag: 'v1.0.151' }, null, 2));
  write('五子棋.apk', 'before-publish-apk');
  write('五子棋大师_单文件版.html', '<html>before publish</html>');
  write('js/ecs-config.js', "window.GOMOKU_BACKEND_CONFIG = Object.freeze({ apiBase: 'https://127.0.0.1/gomoku-api' });\n");
  write('official-site/index.html', '<html>official site</html>');
  write('official-site/version.json', '{"releaseTag":"v1.0.151"}\n');
  write('official-site/_worker.js', 'const STATIC_SITE_VERSION = Object.freeze({ tag: \'v1.0.151\', build: 152 });\n');
  write('official-site/play/js/app.min.js', 'before-publish-js');
  write('node_modules/wrangler/bin/wrangler.js', '// mocked by the test runner\n');
  return { root, write };
}

function mockResponse(status, data, binary = false) {
  const bytes = binary ? Buffer.from(data) : Buffer.from(JSON.stringify(data));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function networkError(code = 'ECONNRESET') {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error(code), { code });
  return error;
}

function currentVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
}

function currentAssets(root) {
  return [
    { name: 'gomoku.apk', digest: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, '五子棋.apk'))).digest('hex')}` },
    { name: 'gomoku.html', digest: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, '五子棋大师_单文件版.html'))).digest('hex')}` }
  ];
}

function createHarness(fixture, behavior = {}) {
  const calls = [];
  const network = [];
  const logs = [];
  const waits = [];
  const state = {
    publishCount: 0,
    pagesCount: 0,
    ghCount: 0,
    ghPending: false,
    networkWhileGhPending: false
  };
  const runner = async (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const executable = path.basename(command).toLowerCase();
    if (args[0] === path.join(fixture.root, 'publish.js')) {
      state.publishCount += 1;
      if (behavior.failPublish) return { status: 1, stdout: '', stderr: 'mock publish failure' };
      const version = { versionName: '1.0.152', versionCode: 153, releaseTag: 'v1.0.152' };
      fixture.write('version.json', JSON.stringify(version, null, 2));
      fixture.write('五子棋.apk', behavior.apkBytes || 'published-apk-bytes');
      fixture.write('五子棋大师_单文件版.html', behavior.htmlBytes || '<html>published release</html>');
      fixture.write('official-site/version.json', JSON.stringify(version));
      fixture.write('official-site/_worker.js', `const STATIC_SITE_VERSION = Object.freeze({ tag: '${version.releaseTag}', build: ${version.versionCode} });\n`);
      fixture.write('official-site/play/js/app.min.js', behavior.jsBytes || 'published-app-js');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('pages') && args.includes('deploy')) {
      state.pagesCount += 1;
      if (behavior.failPages) return { status: 1, stdout: '', stderr: behavior.pagesError || 'mock Pages failure' };
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'api') {
      state.ghCount += 1;
      state.ghPending = true;
      await new Promise(resolve => setTimeout(resolve, behavior.ghDelayMs === undefined ? 10 : behavior.ghDelayMs));
      if (state.ghCount <= (behavior.ghFailures || 0)) {
        state.ghPending = false;
        if (behavior.ghFailureMode === 'http403') {
          return { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' };
        }
        if (behavior.ghFailureMode === 'http503') {
          return { status: 1, stdout: '', stderr: 'HTTP 503: Service Unavailable' };
        }
        if (behavior.ghFailureMode === 'invalidJson') {
          return { status: 0, stdout: '{ invalid json', stderr: '' };
        }
        if (behavior.ghFailureMode === 'timeout') {
          const error = Object.assign(new Error('command timed out'), { name: 'TimeoutError', code: 'ETIMEDOUT' });
          return { status: 124, stdout: '', stderr: '', error };
        }
        const error = behavior.ghError || Object.assign(new Error('read: connection reset by peer'), { code: 'ECONNRESET' });
        return { status: 1, stdout: '', stderr: error.message, error };
      }
      const version = currentVersion(fixture.root);
      const release = {
        tag_name: version.releaseTag,
        draft: behavior.ghDraft === true,
        assets: currentAssets(fixture.root)
      };
      if (behavior.ghDigestMismatch) release.assets[0].digest = `sha256:${'b'.repeat(64)}`;
      if (behavior.ghInvalidJson) {
        state.ghPending = false;
        return { status: 0, stdout: '{ invalid json', stderr: '' };
      }
      state.ghPending = false;
      return { status: 0, stdout: JSON.stringify(release), stderr: '' };
    }
    if (executable === 'java.exe' || executable === 'java') {
      return { status: 0, stdout: `Signer #1 certificate SHA-256 digest: ${behavior.signerSha256 || SIGNER_SHA256}\n`, stderr: '' };
    }
    if (executable === 'zipalign.exe' || executable === 'zipalign') {
      return { status: 0, stdout: 'Verification successful\n', stderr: '' };
    }
    throw new Error(`Unexpected mocked command: ${command} ${args.join(' ')}`);
  };
  const fetch = async (url, options) => {
    network.push({ url, options });
    if (state.ghPending) state.networkWhileGhPending = true;
    assert.match(options.headers['User-Agent'], /^Mozilla\//);
    assert.ok(options.signal, 'HTTP requests have an explicit timeout signal');
    const version = currentVersion(fixture.root);
    const siteBase = behavior.siteBase || 'https://gomoku-home.pages.dev';
    const urlPath = new URL(url).pathname;
    if (behavior.fetchGate) await behavior.fetchGate(urlPath, url);
    const configuredFailures = behavior.fetchFailures && behavior.fetchFailures[urlPath];
    let configuredFailure;
    if (Array.isArray(configuredFailures) && configuredFailures.length) configuredFailure = configuredFailures.shift();
    else if (Number.isInteger(configuredFailures) && configuredFailures > 0) {
      behavior.fetchFailures[urlPath] -= 1;
      configuredFailure = networkError();
    }
    if (configuredFailure instanceof Error) throw configuredFailure;
    if (configuredFailure) return mockResponse(configuredFailure.status || 503, configuredFailure.body || {});
    if (urlPath === '/api/site-version') {
      if (behavior.siteVersionInvalidJson) {
        return {
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('unexpected EOF while parsing JSON'); }
        };
      }
      const body = behavior.siteVersionMismatch
        ? { code: 0, tag: 'v0.0.0', build: 1 }
        : { code: 0, tag: version.releaseTag, build: version.versionCode };
      return mockResponse(200, body);
    }
    if (urlPath === '/download/apk') {
      const bytes = behavior.apkDownloadMismatch
        ? Buffer.from('wrong apk bytes')
        : fs.readFileSync(path.join(fixture.root, '五子棋.apk'));
      return mockResponse(200, bytes, true);
    }
    if (urlPath === '/play/js/app.min.js') {
      const bytes = behavior.jsDownloadMismatch
        ? Buffer.from('wrong js bytes')
        : fs.readFileSync(path.join(fixture.root, 'official-site/play/js/app.min.js'));
      return mockResponse(200, bytes, true);
    }
    if (urlPath === '/api/version') {
      const wrongDigest = behavior.ecsMismatch ? 'f'.repeat(64) : null;
      return mockResponse(200, {
        tag: version.releaseTag,
        apkSha256: wrongDigest || crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture.root, '五子棋.apk'))).digest('hex'),
        htmlSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture.root, '五子棋大师_单文件版.html'))).digest('hex')
      });
    }
    throw new Error(`Unexpected mocked URL: ${url}`);
  };
  const options = {
    rootDir: fixture.root,
    runId: RUN_ID,
    runner,
    fetch,
    env: {
      CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN,
      GOMOKU_ECS_VERSION_URL: 'http://ecs.invalid/api/version',
      ANDROID_SDK_ROOT: '',
      ANDROID_HOME: ''
    },
    loadSecret: () => {},
    wait: async milliseconds => { waits.push(milliseconds); },
    log: line => {
      logs.push(line);
      if (behavior.onLog) behavior.onLog(line);
    },
    errorLog: line => {
      logs.push(line);
      if (behavior.onLog) behavior.onLog(line);
    },
    pid: 1234,
    siteOrigin: behavior.siteOrigin
  };
  if (behavior.clock) options.clock = behavior.clock;
  return { calls, network, logs, waits, state, runner, fetch, options };
}

function runRecord(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.codex-diagnostics', 'official-release', RUN_ID, 'run.json'), 'utf8'));
}

function resumePath() {
  return path.join('.codex-diagnostics', 'official-release', RUN_ID);
}

test('official release publishes, deploys Pages, then runs parallel public checks and records timings', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture);
    const record = await runRelease(harness.options);
    assert.equal(record.state, 'live_verified');
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 1);
    assert.equal(harness.state.networkWhileGhPending, true, 'HTTP acceptance starts while gh api is still pending');
    assert.equal(harness.calls[0].args[0], path.join(fixture.root, 'publish.js'));
    const pagesCallIndex = harness.calls.findIndex(call => call.args.includes('pages') && call.args.includes('deploy'));
    assert.ok(pagesCallIndex > 0, 'Pages deploy follows publish');
    assert.equal(harness.calls[0].options.env.GOMOKU_DEPLOY_CLOUDFLARE, '0');
    assert.equal(harness.calls[0].options.env.GOMOKU_SKIP_VERSION_BUMP, '0');
    assert.equal(harness.calls[0].options.env.GOMOKU_ALLOW_RELEASE_OVERWRITE, '0');
    assert.equal(harness.calls[0].options.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.ok(harness.logs.some(line => line.startsWith('LIVE_VERIFIED tag=v1.0.152 build=153')));
    const timings = JSON.parse(fs.readFileSync(path.join(fixture.root, '.codex-diagnostics', 'official-release', RUN_ID, 'timings.json'), 'utf8'));
    for (const timing of timings.timings) {
      assert.ok(timing.startedAt);
      assert.ok(timing.endedAt);
      assert.ok(Number.isFinite(timing.durationMs));
      assert.ok(Number.isInteger(timing.exitCode));
    }
    assert.ok(timings.timings.some(item => item.name === 'verify.github_release'));
    assert.ok(timings.timings.some(item => item.name === 'verify.pages_download_apk'));
    assert.ok(fs.existsSync(path.join(fixture.root, '.codex-diagnostics', 'official-release', RUN_ID, 'report.md')));
    assert.match(harness.network[0].options.headers['User-Agent'], /^Mozilla\//);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('publish failure does not deploy Pages or claim LIVE_VERIFIED', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, { failPublish: true });
    await assert.rejects(runRelease(harness.options), /publish\.js 未成功/);
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 0);
    assert.equal(harness.logs.some(line => line.includes('LIVE_VERIFIED')), false);
    assert.equal(runRecord(fixture.root).state, 'publish_failed');
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('Pages failure can resume without rerunning publish and retries Pages once', async () => {
  const fixture = makeFixture();
  try {
    const behavior = { failPages: true };
    const harness = createHarness(fixture, behavior);
    await assert.rejects(runRelease(harness.options), /Cloudflare Pages 部署失败/);
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 1);
    behavior.failPages = false;
    await runRelease({ ...harness.options, resume: resumePath() });
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 2);
    assert.equal(harness.logs.some(line => line.includes('LIVE_VERIFIED')), true);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('resume after successful Pages deployment retries only acceptance', async () => {
  const fixture = makeFixture();
  try {
    const behavior = { siteVersionMismatch: true };
    const harness = createHarness(fixture, behavior);
    await assert.rejects(runRelease(harness.options), /线上验收失败/);
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 1);
    assert.equal(runRecord(fixture.root).pagesDeployment.status, 'succeeded');
    const ghCountAfterFirstAttempt = harness.state.ghCount;
    const initialPathCounts = Object.fromEntries(['/api/site-version', '/download/apk', '/play/js/app.min.js']
      .map(pathname => [pathname, harness.network.filter(item => new URL(item.url).pathname === pathname).length]));
    behavior.siteVersionMismatch = false;
    await runRelease({ ...harness.options, resume: resumePath() });
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 1, 'successful Pages deployment is persisted and not repeated');
    assert.equal(harness.state.ghCount, ghCountAfterFirstAttempt, 'successful GitHub verification is reused');
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/site-version').length,
      initialPathCounts['/api/site-version'] + 1, 'only the failed site-version check is rerun');
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/download/apk').length,
      initialPathCounts['/download/apk'], 'successful APK verification is reused');
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/play/js/app.min.js').length,
      initialPathCounts['/play/js/app.min.js'], 'successful JS verification is reused');
    assert.equal(runRecord(fixture.root).state, 'live_verified');
    assert.equal(runRecord(fixture.root).lastError, undefined, 'successful resume clears the previous error');
    assert.ok(harness.logs.some(line => line.includes('复用验收 github_release')));
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('resume discards cached checks when the site, ECS endpoint, or ten-minute cache age changes', async t => {
  const scenarios = [
    {
      name: 'site origin changes',
      update: harness => { harness.options.siteOrigin = 'https://alternate-gomoku.example'; }
    },
    {
      name: 'ECS endpoint changes',
      update: harness => { harness.options.env.GOMOKU_ECS_VERSION_URL = 'https://ecs.example/api/version'; }
    },
    {
      name: 'cache expires after ten minutes',
      before: () => {
        let current = Date.parse('2026-10-20T12:00:00.000Z');
        return {
          clock: { now: () => new Date(current) },
          advance: () => { current += 10 * 60 * 1000 + 1; }
        };
      },
      update: (_harness, state) => state.advance()
    }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const fixture = makeFixture();
      try {
        const clockState = scenario.before ? scenario.before() : null;
        const behavior = { siteVersionMismatch: true, clock: clockState && clockState.clock };
        const harness = createHarness(fixture, behavior);
        await assert.rejects(runRelease(harness.options), /线上验收失败/);
        const firstGithubCalls = harness.state.ghCount;
        behavior.siteVersionMismatch = false;
        scenario.update(harness, clockState);
        await runRelease({ ...harness.options, resume: resumePath() });
        assert.equal(harness.state.publishCount, 1);
        assert.equal(harness.state.pagesCount, 1);
        assert.equal(harness.state.ghCount, firstGithubCalls + 1, 'all stale-context GitHub evidence is refreshed');
        assert.equal(runRecord(fixture.root).state, 'live_verified');
        if (scenario.name === 'ECS endpoint changes') {
          assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/version').length, 1);
        }
      } finally {
        cleanupFixture(fixture.root);
      }
    });
  }
});

test('legacy run records without snapshot-bound check entries perform a full recheck', async () => {
  const fixture = makeFixture();
  try {
    const behavior = { siteVersionMismatch: true };
    const harness = createHarness(fixture, behavior);
    await assert.rejects(runRelease(harness.options), /线上验收失败/);
    const runFile = path.join(fixture.root, '.codex-diagnostics', 'official-release', RUN_ID, 'run.json');
    const legacyRecord = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    delete legacyRecord.acceptanceChecks;
    fs.writeFileSync(runFile, `${JSON.stringify(legacyRecord, null, 2)}\n`, 'utf8');
    behavior.siteVersionMismatch = false;
    await runRelease({ ...harness.options, resume: resumePath() });
    assert.equal(harness.state.ghCount, 2);
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/download/apk').length, 2);
    assert.equal(harness.logs.some(line => line.includes('复用验收')), false);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('optional ECS failures are retried but never cached as a pass', async () => {
  const fixture = makeFixture();
  try {
    const behavior = {
      siteVersionMismatch: true,
      fetchFailures: { '/api/version': [{ status: 503 }, { status: 503 }, { status: 503 }] }
    };
    const harness = createHarness(fixture, behavior);
    harness.options.env.GOMOKU_ECS_VERSION_URL = 'https://ecs.example/api/version';
    await assert.rejects(runRelease(harness.options), /线上验收失败/);
    const failedRecord = runRecord(fixture.root);
    assert.equal(failedRecord.acceptance.ecs_optional.checked, false);
    assert.equal(failedRecord.acceptanceChecks.ecs_optional, undefined);
    assert.equal(failedRecord.acceptanceAttempts.ecs_optional.length, 3);
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/version').length, 3);

    behavior.siteVersionMismatch = false;
    await runRelease({ ...harness.options, resume: resumePath() });
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/version').length, 4);
    assert.equal(runRecord(fixture.root).acceptance.ecs_optional.checked, true);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('resume refuses changed APK or official-site files before another deployment', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, { siteVersionMismatch: true });
    await assert.rejects(runRelease(harness.options), /线上验收失败/);
    const pagesBeforeResume = harness.state.pagesCount;
    fixture.write('official-site/index.html', '<html>changed after failed run</html>');
    await assert.rejects(
      runRelease({ ...harness.options, resume: resumePath() }),
      /输入已变化/
    );
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, pagesBeforeResume);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('an acceptance mismatch never prints LIVE_VERIFIED', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, { siteVersionMismatch: true });
    await assert.rejects(runRelease(harness.options), /线上验收失败/);
    assert.equal(harness.logs.some(line => line.includes('LIVE_VERIFIED')), false);
    assert.equal(runRecord(fixture.root).state, 'continuation_failed');
    assert.equal(runRecord(fixture.root).acceptanceAttempts.pages_site_version.length, 1,
      'tag/build integrity mismatches fail without retry');
    assert.deepEqual(harness.waits, []);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('a transient HTTP read failure retries only its check and records each attempt', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, {
      fetchFailures: { '/api/site-version': [networkError('ECONNRESET')] }
    });
    const record = await runRelease(harness.options);
    assert.equal(record.state, 'live_verified');
    assert.deepEqual(harness.waits, [250]);
    assert.equal(harness.state.ghCount, 1);
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/site-version').length, 2);
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/download/apk').length, 1);
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/play/js/app.min.js').length, 1);
    const attempts = runRecord(fixture.root).acceptanceAttempts.pages_site_version;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, 'failed');
    assert.match(attempts[0].reason, /ECONNRESET/);
    assert.equal(attempts[0].retryable, true);
    assert.equal(attempts[0].delayMs, 250);
    assert.ok(Number.isFinite(attempts[0].durationMs));
    assert.equal(attempts[1].status, 'passed');
    assert.ok(harness.logs.some(line => line.includes('重试验收项 pages_site_version')));
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('abort, EOF, socket, and temporary DNS failures are recognized as transient', async t => {
  const cases = [
    { name: 'AbortError', error: Object.assign(new Error('request aborted'), { name: 'AbortError' }) },
    { name: 'unexpected EOF', error: new Error('unexpected EOF while reading response') },
    { name: 'socket hang up', error: new Error('socket hang up') },
    { name: 'EAI_AGAIN', error: Object.assign(new Error('temporary DNS lookup failure'), { code: 'EAI_AGAIN' }) },
    { name: 'ENOTFOUND', error: Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' }) }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const fixture = makeFixture();
      try {
        const harness = createHarness(fixture, { fetchFailures: { '/api/site-version': [item.error] } });
        await runRelease(harness.options);
        const attempts = runRecord(fixture.root).acceptanceAttempts.pages_site_version;
        assert.equal(attempts.length, 2);
        assert.equal(attempts[0].retryable, true);
        assert.deepEqual(harness.waits, [250]);
      } finally {
        cleanupFixture(fixture.root);
      }
    });
  }
});

test('HTTP 503 reaches the three-attempt limit and reports an exact resume command', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, {
      fetchFailures: {
        '/api/site-version': [{ status: 503 }, { status: 503 }, { status: 503 }]
      }
    });
    await assert.rejects(runRelease(harness.options), /线上验收失败：pages_site_version：\/api\/site-version 返回 HTTP 503/);
    assert.deepEqual(harness.waits, [250, 750]);
    assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/site-version').length, 3);
    assert.equal(harness.state.ghCount, 1, 'successful parallel GitHub check is not repeated');
    const record = runRecord(fixture.root);
    assert.equal(record.acceptanceAttempts.pages_site_version.length, 3);
    assert.deepEqual(record.acceptanceAttempts.pages_site_version.map(item => item.delayMs), [250, 750, 0]);
    assert.ok(harness.logs.some(line => line.includes('验收失败 pages_site_version：/api/site-version 返回 HTTP 503')));
    assert.ok(harness.logs.some(line => line.includes(`可恢复命令：node release_official.js --resume ${resumePath()}`)));
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('TLS certificate and GitHub authorization errors are never retried', async t => {
  const cases = [
    {
      name: 'TLS certificate',
      behavior: { fetchFailures: { '/api/site-version': [Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })] } },
      check: harness => assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/site-version').length, 1)
    },
    {
      name: 'GitHub HTTP 403',
      behavior: { ghFailures: 1, ghFailureMode: 'http403' },
      check: harness => assert.equal(harness.state.ghCount, 1)
    },
    {
      name: 'site HTTP 401',
      behavior: { fetchFailures: { '/api/site-version': [{ status: 401 }] } },
      check: harness => assert.equal(harness.network.filter(item => new URL(item.url).pathname === '/api/site-version').length, 1)
    }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const fixture = makeFixture();
      try {
        const harness = createHarness(fixture, item.behavior);
        await assert.rejects(runRelease(harness.options), /线上验收失败/);
        assert.deepEqual(harness.waits, []);
        item.check(harness);
        const attempts = item.name === 'GitHub HTTP 403'
          ? runRecord(fixture.root).acceptanceAttempts.github_release
          : runRecord(fixture.root).acceptanceAttempts.pages_site_version;
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].retryable, false);
      } finally {
        cleanupFixture(fixture.root);
      }
    });
  }
});

test('GitHub read API timeout is explicit and its typed timeout can recover', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, { ghFailures: 1, ghFailureMode: 'timeout' });
    const record = await runRelease(harness.options);
    const ghCalls = harness.calls.filter(call => call.command === 'gh' && call.args[0] === 'api');
    assert.equal(record.state, 'live_verified');
    assert.equal(ghCalls.length, 2);
    assert.ok(ghCalls.every(call => call.options.timeoutMs === 30_000));
    assert.deepEqual(harness.waits, [250]);
    const attempts = runRecord(fixture.root).acceptanceAttempts.github_release;
    assert.equal(attempts.length, 2);
    assert.match(attempts[0].reason, /ETIMEDOUT|超时/);
    assert.equal(attempts[0].retryable, true);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('retryable verification failure is logged before other parallel checks finish', async () => {
  const fixture = makeFixture();
  let releasePageCheck;
  let sawGithubFailure;
  const pageGate = new Promise(resolve => { releasePageCheck = resolve; });
  const failureLogged = new Promise(resolve => { sawGithubFailure = resolve; });
  try {
    const harness = createHarness(fixture, {
      ghFailures: 3,
      ghDelayMs: 0,
      fetchGate: pathname => pathname === '/api/site-version' ? pageGate : Promise.resolve(),
      onLog: line => { if (line.startsWith('验收失败 github_release：')) sawGithubFailure(); }
    });
    const pending = runRelease(harness.options);
    let timeoutHandle;
    await Promise.race([
      failureLogged,
      new Promise((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error('GH failure log was delayed')), 1500); })
    ]);
    clearTimeout(timeoutHandle);
    assert.equal(harness.network.some(item => new URL(item.url).pathname === '/api/site-version'), true);
    assert.equal(harness.logs.some(line => line.startsWith('验收失败 github_release：')), true);
    releasePageCheck();
    await assert.rejects(pending, /线上验收失败/);
  } finally {
    releasePageCheck();
    cleanupFixture(fixture.root);
  }
});

test('failed Pages diagnostics redact a Cloudflare token from errors and evidence', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, { failPages: true, pagesError: `request failed with ${CLOUDFLARE_TOKEN}` });
    let failure = '';
    try {
      await runRelease(harness.options);
    } catch (error) {
      failure = error.message;
    }
    assert.ok(failure.includes('[REDACTED]'));
    assert.equal(failure.includes(CLOUDFLARE_TOKEN), false);
    const runDir = path.join(fixture.root, '.codex-diagnostics', 'official-release', RUN_ID);
    const persisted = fs.readFileSync(path.join(runDir, 'run.json'), 'utf8') + fs.readFileSync(path.join(runDir, 'timings.json'), 'utf8');
    assert.equal(persisted.includes(CLOUDFLARE_TOKEN), false);
    assert.equal(harness.logs.join('\n').includes(CLOUDFLARE_TOKEN), false);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('apksigner with a different certificate blocks Pages deployment', async () => {
  const fixture = makeFixture();
  try {
    const sdk = path.join(fixture.root, 'android-sdk');
    const tools = path.join(sdk, 'build-tools', '35.0.0');
    const javaDir = path.join(fixture.root, 'java-bin');
    fs.mkdirSync(path.join(tools, 'lib'), { recursive: true });
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(path.join(tools, 'lib', 'apksigner.jar'), 'mock');
    fs.writeFileSync(path.join(tools, 'zipalign.exe'), 'mock');
    fs.writeFileSync(path.join(javaDir, 'java.exe'), 'mock');
    const harness = createHarness(fixture, { signerSha256: WRONG_SHA256 });
    harness.options.env.ANDROID_SDK_ROOT = sdk;
    harness.options.env.PATH = javaDir;
    await assert.rejects(runRelease(harness.options), /APK 发行证书 SHA-256 不匹配/);
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 0);
    assert.equal(runRecord(fixture.root).signatureCheck.status, 'failed');
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('Windows-style Path key is accepted when resolving Java from the environment', () => {
  const fixture = makeFixture();
  try {
    const javaDir = path.join(fixture.root, 'java-bin');
    fs.mkdirSync(javaDir, { recursive: true });
    const javaPath = path.join(javaDir, 'java.exe');
    fs.writeFileSync(javaPath, 'mock');
    assert.equal(resolveExecutable('java', { Path: javaDir }), javaPath);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('draft GitHub Release is rejected and never claimed live', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, { ghDraft: true });
    await assert.rejects(runRelease(harness.options), /线上验收失败/);
    assert.equal(harness.logs.some(line => line.includes('LIVE_VERIFIED')), false);
    const record = runRecord(fixture.root);
    assert.equal(record.state, 'continuation_failed');
    assert.match(record.acceptanceFailures.find(item => item.name === 'github_release').error, /仍是草稿/);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('HTTP 408, 429, and 5xx responses retry, including the read-only GitHub API', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture, {
      ghFailures: 1,
      ghFailureMode: 'http503',
      fetchFailures: {
        '/api/site-version': [{ status: 408 }],
        '/download/apk': [{ status: 429 }],
        '/play/js/app.min.js': [{ status: 500 }],
        '/api/version': [{ status: 599 }]
      }
    });
    harness.options.env.GOMOKU_ECS_VERSION_URL = 'https://ecs.example/api/version';
    const record = await runRelease(harness.options);
    assert.equal(record.state, 'live_verified');
    assert.equal(harness.state.ghCount, 2);
    assert.deepEqual(harness.waits, [250, 250, 250, 250, 250]);
    for (const name of ['github_release', 'pages_site_version', 'pages_download_apk', 'pages_app_js', 'ecs_optional']) {
      assert.equal(runRecord(fixture.root).acceptanceAttempts[name].length, 2, `${name} retries once`);
      assert.equal(runRecord(fixture.root).acceptanceAttempts[name][0].retryable, true);
    }
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('malformed JSON is classified as invalid data and never retried', async t => {
  const cases = [
    { name: 'site JSON ends early', behavior: { siteVersionInvalidJson: true }, check: record => record.acceptanceAttempts.pages_site_version },
    { name: 'GitHub Release JSON is invalid', behavior: { ghInvalidJson: true }, check: record => record.acceptanceAttempts.github_release }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const fixture = makeFixture();
      try {
        const harness = createHarness(fixture, item.behavior);
        await assert.rejects(runRelease(harness.options), /线上验收失败/);
        assert.deepEqual(harness.waits, []);
        const attempts = item.check(runRecord(fixture.root));
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].retryable, false);
        if (item.name === 'site JSON ends early') assert.equal(attempts[0].failureType, 'invalid_json');
      } finally {
        cleanupFixture(fixture.root);
      }
    });
  }
});

test('tag, asset digest, and downloaded byte mismatches fail immediately', async t => {
  const cases = [
    { name: 'site tag/build', behavior: { siteVersionMismatch: true }, check: record => record.acceptanceAttempts.pages_site_version },
    { name: 'GitHub asset digest', behavior: { ghDigestMismatch: true }, check: record => record.acceptanceAttempts.github_release },
    { name: 'APK bytes', behavior: { apkDownloadMismatch: true }, check: record => record.acceptanceAttempts.pages_download_apk },
    { name: 'game JS bytes', behavior: { jsDownloadMismatch: true }, check: record => record.acceptanceAttempts.pages_app_js },
    { name: 'ECS digest', behavior: { ecsMismatch: true }, ecs: true, check: record => record.acceptanceAttempts.ecs_optional }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const fixture = makeFixture();
      try {
        const harness = createHarness(fixture, item.behavior);
        if (item.ecs) harness.options.env.GOMOKU_ECS_VERSION_URL = 'https://ecs.example/api/version';
        await assert.rejects(runRelease(harness.options), /线上验收失败/);
        assert.deepEqual(harness.waits, []);
        const attempts = item.check(runRecord(fixture.root));
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].retryable, false);
        assert.equal(attempts[0].failureType, 'integrity');
      } finally {
        cleanupFixture(fixture.root);
      }
    });
  }
});

test('verified runs cannot be resumed as if old evidence were current', async () => {
  const fixture = makeFixture();
  try {
    const harness = createHarness(fixture);
    await runRelease(harness.options);
    const before = { gh: harness.state.ghCount, pages: harness.state.pagesCount, network: harness.network.length };
    await assert.rejects(
      runRelease({ ...harness.options, resume: resumePath() }),
      /历史线上验收当作当前状态/
    );
    assert.deepEqual({ gh: harness.state.ghCount, pages: harness.state.pagesCount, network: harness.network.length }, before);
  } finally {
    cleanupFixture(fixture.root);
  }
});

test('help prints usage without creating a run or invoking injected services', async () => {
  const root = path.join(os.tmpdir(), `gomoku-help-no-side-effect-${process.pid}-${Date.now()}`);
  const lines = [];
  let calls = 0;
  const code = await main(['--help'], {
    rootDir: root,
    log: line => lines.push(line),
    runner: async () => { calls += 1; throw new Error('must not run'); },
    fetch: async () => { calls += 1; throw new Error('must not fetch'); }
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.ok(lines.some(line => line.includes('node release_official.js')));
  assert.equal(fs.existsSync(root), false);
});

test('default command runner is asynchronous and does not block the event loop', async () => {
  let timerFired = false;
  const command = defaultRunner(process.execPath, ['-e', 'setTimeout(() => process.stdout.write("done"), 70)'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe'
  });
  setTimeout(() => { timerFired = true; }, 10);
  const result = await command;
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'done');
  assert.equal(timerFired, true);
});

test('default command runner times out a local child and returns a typed timeout', async () => {
  const result = await defaultRunner(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
    timeoutMs: 100
  });
  assert.equal(result.status, 124);
  assert.equal(result.error.name, 'TimeoutError');
  assert.equal(result.error.code, 'ETIMEDOUT');
  assert.equal(result.error.timedOut, true);
});

