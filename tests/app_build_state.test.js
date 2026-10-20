const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  ensureAppBuild,
  getAppBuildFingerprint,
  readReuseFingerprintArg
} = require('../app_build_state');

const sourceFiles = [
  'js/app.js', 'js/account.js', 'js/replay.js', 'js/settings.js', 'js/online.js', 'js/social.js'
];
const outputFiles = sourceFiles.map(file => file.replace(/\.js$/, '.min.js'));
const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-app-build-state-'));

function writeFixtureFile(relativePath, contents) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function resetFixture() {
  writeFixtureFile('package.json', JSON.stringify({ scripts: { 'build:app': 'terser --compress passes=2 --mangle' } }));
  writeFixtureFile('package-lock.json', JSON.stringify({ lockfileVersion: 3, terser: '5.51.2' }));
  writeFixtureFile('node_modules/terser/package.json', JSON.stringify({ name: 'terser', version: '5.51.2' }));
  writeFixtureFile('node_modules/terser/bin/terser', '#!/usr/bin/env node\n// fixture CLI\n');
  writeFixtureFile('node_modules/.bin/terser', 'fixture shim');
  writeFixtureFile('node_modules/.bin/terser.cmd', 'fixture shim');
  sourceFiles.forEach((file, index) => writeFixtureFile(file, `source-${index}`));
  outputFiles.forEach((file, index) => writeFixtureFile(file, `min-${index}`));
}

function assertFingerprintInvalidates(relativePath, replacement) {
  resetFixture();
  const expected = getAppBuildFingerprint(rootDir);
  writeFixtureFile(relativePath, replacement);
  assert.notStrictEqual(getAppBuildFingerprint(rootDir), expected, `${relativePath} must invalidate reuse`);
  assert.throws(() => ensureAppBuild({ rootDir, reuseFingerprint: expected }), /拒绝复用发布压缩产物/);
}

try {
  resetFixture();
  const initialFingerprint = getAppBuildFingerprint(rootDir);
  assert.strictEqual(getAppBuildFingerprint(rootDir), initialFingerprint, 'unchanged fixture must be stable');
  assert.strictEqual(ensureAppBuild({ rootDir, reuseFingerprint: initialFingerprint }), initialFingerprint);

  assertFingerprintInvalidates('js/app.js', 'changed source');
  assertFingerprintInvalidates('js/app.min.js', 'tampered output');
  assertFingerprintInvalidates('package.json', '{"scripts":{"build:app":"terser --compress passes=3"}}');
  assertFingerprintInvalidates('package-lock.json', '{"lockfileVersion":3,"terser":"5.51.3"}');
  assertFingerprintInvalidates('node_modules/terser/bin/terser', 'changed CLI');
  assertFingerprintInvalidates('node_modules/terser/lib/compress/index.js', 'changed compressor');

  resetFixture();
  const unusedShim = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'terser' : 'terser.cmd');
  fs.unlinkSync(unusedShim);
  assert.doesNotThrow(() => getAppBuildFingerprint(rootDir), 'missing shim for another OS must not block fingerprint validation');

  resetFixture();
  let buildCalls = 0;
  const independentlyBuiltFingerprint = ensureAppBuild({
    rootDir,
    runBuild: () => { buildCalls++; }
  });
  assert.strictEqual(buildCalls, 1, 'without a publish fingerprint, standalone build must run the app build');
  assert.strictEqual(independentlyBuiltFingerprint, getAppBuildFingerprint(rootDir));
  assert.strictEqual(readReuseFingerprintArg([]), '', 'standalone bundle/APK calls have no reuse marker by default');
  assert.strictEqual(readReuseFingerprintArg(['--sync-only']), '');
  assert.strictEqual(readReuseFingerprintArg([`--reuse-app-build=${initialFingerprint}`]), initialFingerprint);

  for (const script of ['bundle_single_file.js', 'build_apk.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');
    assert(source.includes('ensureAppBuild'), `${script} must use the shared build gate`);
    assert(source.includes('readReuseFingerprintArg'), `${script} must require an explicit publish reuse argument`);
    assert(source.includes('reuseFingerprint: readReuseFingerprintArg()'), `${script} must default to standalone auto-build`);
  }

  const publishSource = fs.readFileSync(path.join(__dirname, '..', 'publish.js'), 'utf8');
  const versionWrittenAt = publishSource.indexOf("timed('version.write_json'");
  const minBuildAt = publishSource.indexOf("timed('build.app_min_js'");
  const siteSyncAt = publishSource.indexOf("timed('build.official_site_sync'");
  const bundleAt = publishSource.indexOf("timed('build.single_file_html'");
  const apkAt = publishSource.indexOf("timed('build.android_apk'");
  assert(versionWrittenAt < minBuildAt && minBuildAt < siteSyncAt && siteSyncAt < bundleAt && bundleAt < apkAt,
    'publish must write the version, build min.js once, sync the final site copy, then bundle HTML and APK');
  assert.strictEqual((publishSource.match(/timed\('build\.official_site_sync'/g) || []).length, 1,
    'publish must run the official-site generator only once');
  for (const label of [
    'release.lookup_previous_tag', 'release.download_previous_html',
    'release.generate_html_delta', 'release.create_and_upload_assets', 'release.upload_assets_clobber'
  ]) {
    assert(publishSource.includes(`timed('${label}'`), `${label} must have separate timing evidence`);
  }
  assert(publishSource.includes("'app_build_state.js'") && publishSource.includes("'tests/app_build_state.test.js'"),
    'new files needed by a future release must be in the explicit staging list');
  for (const file of ['release_official.js', 'tests/release_official.test.js', 'RELEASE_PERFORMANCE_20261020.md']) {
    assert(publishSource.includes(`'${file}'`), `${file} must be included in the future release staging list`);
  }
  assert(publishSource.includes('timingRecords.push(timer.record)')
    && publishSource.includes('activeTimers.add(timer)')
    && publishSource.includes("process.once('exit', exitCode => persistTimings(exitCode))"),
  'publish timing must retain started records and close interrupted phases on exit');

  const timingStartAt = publishSource.indexOf('const timingStartedAt = new Date();');
  const timingEndAt = publishSource.indexOf('const SHOULD_DEPLOY_CLOUDFLARE', timingStartAt);
  assert(timingStartAt >= 0 && timingEndAt > timingStartAt, 'publish timing block must remain extractable for exit-path verification');
  const timingSource = publishSource.slice(timingStartAt, timingEndAt);
  const timingWrites = [];
  let registeredExitHandler;
  let hrtimeNow = 0n;
  const timingProcess = {
    pid: 1234,
    hrtime: { bigint: () => { hrtimeNow += 1_000_000n; return hrtimeNow; } },
    once: (eventName, handler) => {
      assert.strictEqual(eventName, 'exit');
      registeredExitHandler = handler;
    }
  };
  const timingContext = {
    Date,
    ROOT_DIR: 'C:\\fixture',
    fs: {
      mkdirSync: () => {},
      writeFileSync: (filePath, contents) => timingWrites.push({ filePath, contents })
    },
    path: {
      join: (...parts) => parts.join('\\'),
      dirname: filePath => filePath.slice(0, filePath.lastIndexOf('\\'))
    },
    process: timingProcess,
    console: { log: () => {}, warn: () => {} }
  };
  vm.runInNewContext(timingSource, timingContext, { filename: 'publish-timing-exit-fixture.js' });
  timingContext.startTiming('version.prepare.failure_fixture');
  assert.strictEqual(typeof registeredExitHandler, 'function', 'publish must register a process exit handler');
  registeredExitHandler(17);
  const exitTimingFile = timingWrites[timingWrites.length - 1];
  const exitTimingDocument = JSON.parse(exitTimingFile.contents);
  const interruptedPhase = exitTimingDocument.timings.find(item => item.label === 'version.prepare.failure_fixture');
  assert(interruptedPhase, 'interrupted phase must be persisted on process exit');
  assert(interruptedPhase.endedAt && Number.isFinite(interruptedPhase.durationMs), 'interrupted phase must receive end time and duration');
  assert.strictEqual(interruptedPhase.exitCode, 17, 'interrupted phase must retain the process exit status');
  console.log('app_build_state tests passed');
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
