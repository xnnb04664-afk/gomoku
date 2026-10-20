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
      const version = currentVersion(fixture.root);
      const release = {
        tag_name: version.releaseTag,
        draft: behavior.ghDraft === true,
        assets: currentAssets(fixture.root)
      };
      if (behavior.ghDigestMismatch) release.assets[0].digest = `sha256:${'b'.repeat(64)}`;
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
    if (urlPath === '/api/site-version') {
      const body = behavior.siteVersionMismatch
        ? { code: 0, tag: 'v0.0.0', build: 1 }
        : { code: 0, tag: version.releaseTag, build: version.versionCode };
      return mockResponse(200, body);
    }
    if (urlPath === '/download/apk') return mockResponse(200, fs.readFileSync(path.join(fixture.root, '五子棋.apk')), true);
    if (urlPath === '/play/js/app.min.js') return mockResponse(200, fs.readFileSync(path.join(fixture.root, 'official-site/play/js/app.min.js')), true);
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
    log: line => logs.push(line),
    errorLog: line => logs.push(line),
    pid: 1234
  };
  return { calls, network, logs, state, runner, fetch, options };
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
    behavior.siteVersionMismatch = false;
    await runRelease({ ...harness.options, resume: resumePath() });
    assert.equal(harness.state.publishCount, 1);
    assert.equal(harness.state.pagesCount, 1, 'successful Pages deployment is persisted and not repeated');
    assert.ok(harness.state.ghCount > ghCountAfterFirstAttempt, 'acceptance is retried');
    assert.equal(runRecord(fixture.root).state, 'live_verified');
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
  } finally {
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

