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
const githubNativeStart = appSource.indexOf('    function invokeGithubProxyNativeApkUpdate(updateData) {');
const githubNativeEnd = appSource.indexOf('\n    async function sha256Hex', githubNativeStart);
const nativeApkStart = appSource.indexOf('    function startNativeApkUpdate(updateData) {');
const nativeApkEnd = appSource.indexOf('\n    async function recoverGithubHtmlAfterProxyFailure(', nativeApkStart);
const htmlRecoveryStart = appSource.indexOf('    async function recoverGithubHtmlAfterProxyFailure(');
const htmlRecoveryEnd = appSource.indexOf('\n    async function continueNativeUpdateFallback', htmlRecoveryStart);
const versionCompareStart = appSource.indexOf('    function compareVersions(v1, v2) {');
const versionCompareEnd = appSource.indexOf('\n    function ', versionCompareStart + 1);
const updateDecisionStart = appSource.indexOf('    function resolveUpdateCheckDecision(');
const updateDecisionEnd = appSource.indexOf('\n    function createUpdateCheckRunner(', updateDecisionStart);
const checkRunnerStart = updateDecisionEnd + 1;
const coordinatorStart = appSource.indexOf('    function createAppUpdateCoordinator(', checkRunnerStart);
const coordinatorEnd = appSource.indexOf('\n    function isAppUpdateActivityBusy(', coordinatorStart);
const performUpdateStart = appSource.indexOf('    async function performAppUpdateAction(');
const startUpdateActionStart = appSource.indexOf('    function startAppUpdate(updateData, options = {}) {', performUpdateStart);
const startUpdateActionEnd = appSource.indexOf('\n    const appUpdateCoordinator = ', startUpdateActionStart);
const runAppUpdateCheckStart = appSource.indexOf('    async function runAppUpdateCheck(initialManual = false, isManualRequested = () => false) {');
const runAppUpdateCheckEnd = appSource.indexOf('\n    const updateCheckRunner = createUpdateCheckRunner(runAppUpdateCheck);', runAppUpdateCheckStart);
const attemptKeyStart = appSource.indexOf('    function makeAutomaticUpdateAttemptKey(updateData, forceFullApk) {');
const attemptKeyEnd = appSource.indexOf('\n    function hasAutomaticUpdateAttempt(', attemptKeyStart);
const installManualActionStart = appSource.indexOf('    function installManualUpdateAction(updateData, forceFullApk) {');
const installManualActionEnd = appSource.indexOf('\n    async function performAppUpdateAction(', installManualActionStart);
const postUpdateAnnouncementStart = appSource.indexOf('    function checkPostUpdateAnnouncement() {');
const postUpdateAnnouncementEnd = appSource.indexOf('\n    function openUpdateModal()', postUpdateAnnouncementStart);
const activityBusyStart = appSource.indexOf('    function isAppUpdateActivityBusy() {');
const activityBusyEnd = appSource.indexOf('\n    let isCheckingAppUpdate = ', activityBusyStart);
assert.notEqual(constantsStart, -1, 'update endpoint constants exist');
assert.notEqual(constantsEnd, -1, 'update endpoint constants end exists');
assert.notEqual(helpersStart, -1, 'update fetch helpers exist');
assert.notEqual(helpersEnd, -1, 'update manifest section end exists');
assert.notEqual(githubNativeStart, -1, 'GitHub native APK bridge helper exists');
assert.notEqual(githubNativeEnd, -1, 'GitHub native APK bridge helper end exists');
assert.notEqual(nativeApkStart, -1, 'native APK route helper exists');
assert.notEqual(nativeApkEnd, -1, 'native APK route helper end exists');
assert.notEqual(htmlRecoveryStart, -1, 'HTML failure recovery helper exists');
assert.notEqual(htmlRecoveryEnd, -1, 'HTML failure recovery helper end exists');
assert.notEqual(versionCompareStart, -1, 'version comparison helper exists');
assert.notEqual(versionCompareEnd, -1, 'version comparison helper end exists');
assert.notEqual(updateDecisionStart, -1, 'update decision helper exists');
assert.notEqual(updateDecisionEnd, -1, 'update decision helper end exists');
assert.notEqual(coordinatorStart, -1, 'automatic update coordinator exists');
assert.notEqual(coordinatorEnd, -1, 'automatic update coordinator end exists');
assert.notEqual(performUpdateStart, -1, 'shared production update action exists');
assert.notEqual(startUpdateActionStart, -1, 'shared production startAppUpdate exists');
assert.notEqual(startUpdateActionEnd, -1, 'shared production startAppUpdate end exists');
assert.notEqual(runAppUpdateCheckStart, -1, 'production update check function exists');
assert.notEqual(runAppUpdateCheckEnd, -1, 'production update check function end exists');
assert.notEqual(attemptKeyStart, -1, 'automatic update attempt key function exists');
assert.notEqual(attemptKeyEnd, -1, 'automatic update attempt key function end exists');
assert.notEqual(installManualActionStart, -1, 'production manual retry action wiring exists');
assert.notEqual(installManualActionEnd, -1, 'production manual retry action wiring end exists');
assert.notEqual(postUpdateAnnouncementStart, -1, 'production post-update announcement callback exists');
assert.notEqual(postUpdateAnnouncementEnd, -1, 'production post-update announcement callback end exists');
assert.notEqual(activityBusyStart, -1, 'production activity predicate exists');
assert.notEqual(activityBusyEnd, -1, 'production activity predicate end exists');
const constantsSource = appSource.slice(constantsStart, constantsEnd);
const updateSource = appSource.slice(helpersStart, helpersEnd);
const githubNativeSource = appSource.slice(githubNativeStart, githubNativeEnd);
const nativeApkSource = appSource.slice(nativeApkStart, nativeApkEnd);
const htmlRecoverySource = appSource.slice(htmlRecoveryStart, htmlRecoveryEnd);
const versionCompareSource = appSource.slice(versionCompareStart, versionCompareEnd);
const updateDecisionSource = appSource.slice(updateDecisionStart, updateDecisionEnd);
const checkRunnerSource = appSource.slice(checkRunnerStart, coordinatorStart);
const coordinatorSource = appSource.slice(coordinatorStart, coordinatorEnd);
const updateActionSource = appSource.slice(performUpdateStart, startUpdateActionEnd);
const runAppUpdateCheckSource = appSource.slice(runAppUpdateCheckStart, runAppUpdateCheckEnd);
const attemptKeySource = appSource.slice(attemptKeyStart, attemptKeyEnd);
const installManualActionSource = appSource.slice(installManualActionStart, installManualActionEnd);
const postUpdateAnnouncementSource = appSource.slice(postUpdateAnnouncementStart, postUpdateAnnouncementEnd);
const activityBusySource = appSource.slice(activityBusyStart, activityBusyEnd);

function makeUpdateFlowHarness({ android = true, busy = false, startUpdate } = {}) {
  const attempted = new Set();
  const calls = [];
  let deferredCount = 0;
  let isBusy = busy;
  const context = { Promise };
  vm.runInNewContext(
    `${versionCompareSource}\n${updateDecisionSource}\n${checkRunnerSource}\n${coordinatorSource}\n` +
      'this.resolveUpdateCheckDecisionForTest = resolveUpdateCheckDecision;\n' +
      'this.maybeStartAutomaticUpdateIfNeededForTest = maybeStartAutomaticUpdateIfNeeded;\n' +
      'this.createUpdateCheckRunnerForTest = createUpdateCheckRunner;\n' +
      'this.createAppUpdateCoordinatorForTest = createAppUpdateCoordinator;',
    context
  );
  const coordinator = context.createAppUpdateCoordinatorForTest({
    isAndroid: () => android,
    isBusy: () => isBusy,
    startUpdate: (data, options) => {
      calls.push({ data, options });
      return typeof startUpdate === 'function' ? startUpdate(data, options, calls) : Promise.resolve({ status: 'started' });
    },
    hasAttempted: key => attempted.has(key),
    markAttempted: key => attempted.add(key),
    onDeferred: () => { deferredCount += 1; }
  });
  return {
    context,
    coordinator,
    calls,
    attempted,
    setBusy(value) { isBusy = value; },
    get deferredCount() { return deferredCount; }
  };
}

function makeProductionStartUpdateHarness({ manifest, apkRequired = false } = {}) {
  const calls = { nativeStart: 0, protectedDownload: 0, hotWrite: 0, fetchManifest: 0, errors: [] };
  const bridge = {
    saveHotUpdateFile() { calls.hotWrite += 1; return true; },
    downloadAndInstallGithubReleaseApk() { calls.nativeStart += 1; },
    downloadAndInstallProtectedApk() { calls.nativeStart += 1; }
  };
  const elements = Object.create(null);
  const context = {
    Promise,
    CURRENT_VERSION_TAG: 'v1.0.152',
    DISPLAY_VERSION_TAG: 'v1.0.152',
    AndroidNativeApp: bridge,
    buildGithubProxyUrls: () => ['https://proxy.test/example.apk'],
    fetchTicketedUpdateManifests: async () => [],
    isAppDownloading: false,
    activeUpdateActionPromise: null,
    window: { AndroidNativeApp: bridge, location: { reload() {} } },
    document: { getElementById: id => elements[id] || null },
    console: { warn(message) { calls.errors.push(String(message)); } },
    fetchUpdateManifest: async () => { calls.fetchManifest += 1; return manifest; },
    isAndroidApkUpdateRequired: () => apkRequired,
    formatDisplayVersionTag: tag => String(tag),
    showAutomaticUpdateProgress() {},
    downloadProtectedApk: async () => { calls.protectedDownload += 1; },
    resetUpdateDownloadUI() {},
    showGameNotice() {},
    setTimeout(callback) { return 1; },
    clearTimeout() {}
  };
  vm.runInNewContext(
    `${versionCompareSource}\n${updateDecisionSource}\n${githubNativeSource}\nlet activeNativeUpdateFallback = null;\n${nativeApkSource}\n${updateActionSource}\n` +
      'this.startAppUpdateForTest = startAppUpdate;',
    context
  );
  return { context, calls, elements, start: context.startAppUpdateForTest };
}

function makeProductionManualUpdateCheckHarness({ manifest, apkRequired = true, busy = false } = {}) {
  const calls = { manifestCheck: 0, modalOpened: 0, coordinatorStart: 0, deferred: 0, actionPromise: null };
  const actionHarness = makeProductionStartUpdateHarness({ manifest, apkRequired });
  const bridge = actionHarness.context.AndroidNativeApp;
  const attempted = new Set();
  let isBusy = busy;
  const elements = Object.create(null);
  const getElement = id => {
    if (!elements[id]) {
      elements[id] = {
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        textContent: '',
        innerHTML: '',
        disabled: false,
        setAttribute() {},
        removeAttribute() {}
      };
    }
    return elements[id];
  };
  const context = {
    Promise,
    CURRENT_VERSION_TAG: 'v1.0.152',
    DISPLAY_VERSION_TAG: 'v1.0.152',
    CURRENT_UPDATE_NOTES: [],
    AndroidNativeApp: bridge,
    window: { AndroidNativeApp: bridge, GOMOKU_UPDATE_BADGE_TEXT: '', GOMOKU_UPDATE_BADGE_TITLE: '' },
    document: { getElementById: getElement, querySelector() { return null; } },
    getUpdateManifest: async () => { calls.manifestCheck += 1; return manifest; },
    isAndroidApkUpdateRequired: () => apkRequired,
    formatDisplayVersionTag: tag => String(tag),
    makeAutomaticUpdateAttemptKey: updateData => `v1.0.152:${updateData.tag}:${updateData.apkSha256}:apk`,
    removePendingUpdateActivityListeners() {},
    showGameNotice() {},
    showUpdateCheckPendingState() {},
    setManualUpdateCheckBusy() {},
    finishManualUpdateCheck() { context.isManualUpdateCheckInProgress = false; },
    resetUpdateDownloadUI() {},
    openUpdateModal() { calls.modalOpened += 1; },
    console: { warn() {} },
    isManualUpdateCheckInProgress: false
  };
  vm.runInNewContext(
    `${versionCompareSource}\n${updateDecisionSource}\n${checkRunnerSource}\n${coordinatorSource}\n` +
      `${attemptKeySource}\n${installManualActionSource}\n${runAppUpdateCheckSource}\n` +
      'this.createAppUpdateCoordinatorForTest = createAppUpdateCoordinator;\n' +
      'this.runAppUpdateCheckForTest = runAppUpdateCheck;',
    context
  );
  context.appUpdateCoordinator = context.createAppUpdateCoordinatorForTest({
    isAndroid: () => true,
    isBusy: () => isBusy,
    startUpdate: (data, options) => {
      calls.coordinatorStart += 1;
      calls.actionPromise = actionHarness.start(data, options);
      return calls.actionPromise;
    },
    hasAttempted: key => attempted.has(key),
    markAttempted: key => attempted.add(key),
    onDeferred: () => { calls.deferred += 1; }
  });
  return {
    context,
    calls,
    elements,
    actionHarness,
    setBusy(value) { isBusy = value; }
  };
}

function makePostUpdateAnnouncementHarness(active = {}) {
  const timers = [];
  const stored = { gomoku_last_seen_version: 'v1.0.151' };
  const storageWrites = [];
  const calls = { opened: 0 };
  const elements = Object.create(null);
  const getElement = id => {
    if (!elements[id]) elements[id] = { style: {}, textContent: '', classList: { add() {} } };
    return elements[id];
  };
  ['updateModalTitle', 'btnFastDownload'].forEach(getElement);
  const context = {
    CURRENT_VERSION_TAG: 'v1.0.152',
    DISPLAY_VERSION_TAG: 'v1.0.152',
    CURRENT_UPDATE_NOTES: ['修复与优化'],
    isAppDownloading: Boolean(active.downloading),
    activeUpdateActionPromise: active.action ? Promise.resolve() : null,
    updateManifestRequest: active.manifestRequest ? Promise.resolve({}) : null,
    isCheckingAppUpdate: Boolean(active.checkingManifest),
    updateCheckRunner: { isRunning: () => Boolean(active.checkRunner) },
    appUpdateCoordinator: { hasPendingAutomaticUpdate: () => Boolean(active.pending) },
    localStorage: {
      getItem: key => stored[key] || null,
      setItem: (key, value) => { storageWrites.push([key, value]); stored[key] = value; }
    },
    document: { getElementById: getElement },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    openUpdateModal: () => { calls.opened += 1; }
  };
  vm.runInNewContext(
    `${postUpdateAnnouncementSource}\nthis.checkPostUpdateAnnouncementForTest = checkPostUpdateAnnouncement;`,
    context
  );
  return { context, calls, elements, timers, storageWrites };
}

function makeActivityHarness({ gameMode = 'ai', gameVisible = false, over = false, replay = false, onlineState = null } = {}) {
  const classes = new Set(gameVisible ? ['sky-game-open'] : ['sky-lobby-open']);
  const context = {
    gameMode,
    isOver: over,
    isReplayMode: replay,
    document: { body: { classList: { contains: name => classes.has(name) } } },
    window: { getOnlineActivityState: onlineState ? () => onlineState : undefined }
  };
  vm.runInNewContext(`${activityBusySource}\nthis.isAppUpdateActivityBusyForTest = isAppUpdateActivityBusy;`, context);
  return context.isAppUpdateActivityBusyForTest;
}

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
    for (const active of [
      { downloading: true },
      { action: true },
      { manifestRequest: true },
      { checkingManifest: true },
      { checkRunner: true },
      { pending: true }
    ]) {
      const harness = makePostUpdateAnnouncementHarness(active);
      harness.context.checkPostUpdateAnnouncementForTest();
      assert.equal(harness.timers.length, 1, 'the production announcement schedules one delayed callback');
      harness.timers[0]();
      assert.equal(harness.elements.updateModalTitle.textContent, '', 'an active update leaves the modal title untouched');
      assert.equal(harness.elements.btnFastDownload.style.display, undefined, 'an active update keeps its download control visible');
      assert.equal(harness.calls.opened, 0, 'an active update does not open the welcome announcement');
      assert.equal(harness.storageWrites.length, 0, 'an active update does not mark the announcement as seen');
    }

    const idleHarness = makePostUpdateAnnouncementHarness();
    idleHarness.context.checkPostUpdateAnnouncementForTest();
    idleHarness.timers[0]();
    assert.equal(idleHarness.elements.updateModalTitle.textContent, '欢迎体验全新版本！',
      'the idle production callback still shows the post-update welcome announcement');
    assert.equal(idleHarness.elements.btnFastDownload.style.display, 'none');
    assert.equal(idleHarness.calls.opened, 1);
    assert.deepEqual(idleHarness.storageWrites, [['gomoku_last_seen_version', 'v1.0.152']]);
  }

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

  {
    const calls = [];
    const apkHash = 'a'.repeat(64);
    const githubManifest = {
      sourceType: 'github',
      tag: 'v1.0.203',
      apkSha256: apkHash,
      apkAssetUrl: 'https://github.com/xnnb04664-afk/gomoku/releases/download/v1.0.203/gomoku.apk'
    };
    const makeNativeRecoveryContext = (bridge) => {
      const context = {
        AndroidNativeApp: bridge,
        activeNativeUpdateFallback: null,
        buildGithubProxyUrls: url => url ? ['https://gh-proxy.com/' + url] : [],
        console: { warn() {} }
      };
      vm.runInNewContext(
        `${githubNativeSource}\n${nativeApkSource}\n${htmlRecoverySource}\n` +
          'this.recoverGithubHtmlAfterProxyFailureForTest = recoverGithubHtmlAfterProxyFailure;',
        context
      );
      return context;
    };

    const successfulBridgeContext = makeNativeRecoveryContext({
      downloadAndInstallGithubReleaseApk(tag, hash) {
        calls.push(`github-apk:${tag}:${hash}`);
      }
    });
    const proxyRecovery = await successfulBridgeContext.recoverGithubHtmlAfterProxyFailureForTest(
      githubManifest,
      async () => {
        calls.push('ecs-html');
        return 'service html';
      }
    );
    assert.equal(proxyRecovery.route, 'github-apk',
      'a valid native GitHub APK handoff happens before ECS HTML');
    assert.deepEqual(calls, [`github-apk:v1.0.203:${apkHash}`],
      'successful native proxy handoff skips ECS HTML and preserves tag/hash');

    calls.length = 0;
    const throwingBridgeContext = makeNativeRecoveryContext({
      downloadAndInstallGithubReleaseApk() {
        calls.push('github-apk-throws');
        throw new Error('bridge start failed');
      }
    });
    const throwingBridgeRecovery = await throwingBridgeContext.recoverGithubHtmlAfterProxyFailureForTest(
      githubManifest,
      async () => {
        calls.push('ecs-html');
        return 'service html';
      }
    );
    assert.equal(throwingBridgeRecovery.route, 'service-html',
      'the production native route catches a synchronous bridge error and keeps ECS HTML fallback');
    assert.equal(throwingBridgeRecovery.html, 'service html');
    assert.deepEqual(calls, ['github-apk-throws', 'ecs-html']);
    assert.equal(throwingBridgeContext.activeNativeUpdateFallback, null,
      'a failed native handoff clears the active APK fallback state');

    calls.length = 0;
    const legacyBridgeContext = makeNativeRecoveryContext({});
    const legacyBridgeRecovery = await legacyBridgeContext.recoverGithubHtmlAfterProxyFailureForTest(
      githubManifest,
      async () => {
        calls.push('ecs-html');
        return 'service html';
      }
    );
    assert.equal(legacyBridgeRecovery.route, 'service-html',
      'a bridge without the GitHub APK method keeps the ticketed HTML fallback');
    assert.equal(legacyBridgeRecovery.html, 'service html');
    assert.deepEqual(calls, ['ecs-html']);

    await assert.rejects(
      legacyBridgeContext.recoverGithubHtmlAfterProxyFailureForTest(githubManifest, async () => {
        throw new Error('service HTML failed');
      }),
      /service HTML failed/,
      'service HTML failure propagates to the existing outer fallback'
    );

    calls.length = 0;
    const invalidHashRecovery = await successfulBridgeContext.recoverGithubHtmlAfterProxyFailureForTest(
      { ...githubManifest, apkSha256: 'invalid' },
      async () => {
        calls.push('ecs-html');
        return 'service html';
      }
    );
    assert.equal(invalidHashRecovery.route, 'service-html',
      'invalid APK metadata fails the production native route validation');
    assert.deepEqual(calls, ['ecs-html']);

    calls.length = 0;
    const ticketedRecovery = await successfulBridgeContext.recoverGithubHtmlAfterProxyFailureForTest(
      { sourceType: 'ticketed', tag: 'v1.0.203' },
      async () => {
        calls.push('ticketed-html');
        return 'ticketed html';
      }
    );
    assert.equal(ticketedRecovery.route, 'service-html',
      'ticketed update sources do not route through GitHub');
    assert.equal(ticketedRecovery.html, 'ticketed html');
    assert.deepEqual(calls, ['ticketed-html']);
  }

  {
    const context = makeUpdateFlowHarness().context;
    const decide = context.resolveUpdateCheckDecisionForTest;
    const newVersion = decide({
      isAndroid: true,
      versionData: { tag: 'v1.0.153' },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: false
    });
    assert.equal(newVersion.shouldUpdate, true, 'Android automatically detects a genuinely newer version');
    assert.equal(newVersion.reason, 'new-version');

    const latest = decide({
      isAndroid: true,
      versionData: { tag: 'v1.0.152' },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: false
    });
    assert.equal(latest.shouldUpdate, false, 'a current version does not trigger an automatic action');
    assert.equal(latest.reason, 'current');

    const apkRequired = decide({
      isAndroid: true,
      versionData: { tag: 'v1.0.152' },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: true
    });
    assert.equal(apkRequired.shouldUpdate, true, 'the native APK floor forces a full APK action even at the same page version');
    assert.equal(apkRequired.forceFullApk, true);
    assert.equal(apkRequired.reason, 'native-apk-required');

    const browser = decide({
      isAndroid: false,
      versionData: { tag: 'v1.0.153' },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: false
    });
    assert.equal(browser.shouldUpdate, false, 'browser checks never trigger an automatic download');
    assert.equal(browser.reason, 'browser');

    const stale = decide({
      isAndroid: true,
      versionData: { tag: 'v1.0.151' },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: true
    });
    assert.equal(stale.shouldUpdate, false, 'an old manifest cannot trigger APK rollback even below the native floor');
    assert.equal(stale.reason, 'stale-manifest');
  }

  {
    const manifest = { tag: 'v1.0.153', apkSha256: 'a'.repeat(64), sourceType: 'github' };
    const harness = makeUpdateFlowHarness();
    const attemptKey = 'v1.0.152:v1.0.153:' + manifest.apkSha256 + ':html';
    const requestAuto = () => harness.context.maybeStartAutomaticUpdateIfNeededForTest({
      isAndroid: true,
      versionData: manifest,
      currentVersion: 'v1.0.152',
      apkUpdateRequired: false,
      attemptKey,
      coordinator: harness.coordinator
    });
    const first = requestAuto();
    assert.equal(first.decision.shouldUpdate, true);
    await first.promise;
    const second = requestAuto();
    assert.equal(second.decision.shouldUpdate, true);
    assert.equal(await second.promise.then(result => result.status), 'attempted');
    assert.equal(harness.calls.length, 1, 'the same automatic update key starts at most once');
    assert.equal(harness.calls[0].options.automatic, true);

    const latestHarness = makeUpdateFlowHarness();
    const noUpdate = latestHarness.context.maybeStartAutomaticUpdateIfNeededForTest({
      isAndroid: true,
      versionData: { tag: 'v1.0.152', apkSha256: 'b'.repeat(64) },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: false,
      attemptKey: 'latest',
      coordinator: latestHarness.coordinator
    });
    assert.equal(noUpdate.decision.shouldUpdate, false);
    assert.equal(noUpdate.promise, null);
    assert.equal(latestHarness.calls.length, 0);

    const forcedHarness = makeUpdateFlowHarness();
    const forced = forcedHarness.context.maybeStartAutomaticUpdateIfNeededForTest({
      isAndroid: true,
      versionData: { tag: 'v1.0.152', apkSha256: 'c'.repeat(64) },
      currentVersion: 'v1.0.152',
      apkUpdateRequired: true,
      attemptKey: 'forced-apk',
      coordinator: forcedHarness.coordinator
    });
    assert.equal(forced.decision.forceFullApk, true);
    await forced.promise;
    assert.equal(forcedHarness.calls.length, 1, 'the native APK floor enters the shared automatic update action');

    const browserHarness = makeUpdateFlowHarness({ android: false });
    const browserAuto = browserHarness.context.maybeStartAutomaticUpdateIfNeededForTest({
      isAndroid: false,
      versionData: manifest,
      currentVersion: 'v1.0.152',
      apkUpdateRequired: false,
      attemptKey: 'browser',
      coordinator: browserHarness.coordinator
    });
    assert.equal(browserAuto.decision.reason, 'browser');
    assert.equal(browserAuto.promise, null);
    assert.equal(browserHarness.calls.length, 0, 'browser mode retains the entry point without starting an automatic download');
  }

  {
    const manifest = {
      tag: 'v1.0.153',
      apkSha256: '9'.repeat(64),
      apkAssetUrl: 'https://github.com/example/gomoku/releases/download/v1.0.153/app.apk',
      sourceType: 'github'
    };
    const harness = makeProductionManualUpdateCheckHarness({ manifest, apkRequired: true });
    const result = await harness.context.runAppUpdateCheckForTest(true);
    assert.equal(result.status, 'update-available', 'the production manual check renders its discovered version');
    assert.equal(harness.calls.manifestCheck, 1, 'the production manual check reads the manifest once');
    assert.equal(harness.calls.modalOpened, 1, 'the manual update details are rendered before automatic handoff');
    assert.equal(typeof harness.elements.btnFastDownload.onclick, 'function', 'manual retry remains available without being clicked');
    assert.ok(harness.calls.actionPromise, 'the production manual check queues the shared update action itself');
    assert.equal(await harness.calls.actionPromise.then(action => action.status), 'native-apk-started');
    assert.equal(harness.calls.coordinatorStart, 1, 'manual discovery starts one update action without a button click');
    assert.equal(harness.actionHarness.calls.nativeStart, 1, 'the shared action starts the native APK bridge exactly once');
    assert.equal(harness.actionHarness.calls.hotWrite, 0, 'the APK floor selects the full APK route');

    const busyHarness = makeProductionManualUpdateCheckHarness({ manifest, apkRequired: true, busy: true });
    const busyResult = await busyHarness.context.runAppUpdateCheckForTest(true);
    assert.equal(busyResult.status, 'update-available');
    assert.equal(busyHarness.calls.deferred, 1, 'manual discovery defers the automatic action while game activity is busy');
    assert.equal(busyHarness.calls.coordinatorStart, 0, 'busy manual discovery does not start the APK immediately');
    assert.equal(busyHarness.actionHarness.calls.nativeStart, 0);
    busyHarness.setBusy(false);
    await busyHarness.context.appUpdateCoordinator.resumeWhenIdle();
    assert.equal(await busyHarness.calls.actionPromise.then(action => action.status), 'native-apk-started');
    assert.equal(busyHarness.actionHarness.calls.nativeStart, 1, 'the deferred manual discovery resumes the APK route once idle');
  }

  {
    let releaseCheck;
    let checkCalls = 0;
    let wasManual = false;
    const gate = new Promise(resolve => { releaseCheck = resolve; });
    const context = makeUpdateFlowHarness().context;
    const runner = context.createUpdateCheckRunnerForTest(async (initialManual, getManualRequested) => {
      checkCalls += 1;
      await gate;
      wasManual = initialManual || getManualRequested();
      return 'checked';
    });
    const automaticCheck = runner.check(false);
    const manualCheck = runner.check(true);
    assert.equal(manualCheck, automaticCheck, 'overlapping manual and automatic checks share one promise');
    await Promise.resolve();
    releaseCheck();
    assert.equal(await automaticCheck, 'checked');
    assert.equal(checkCalls, 1, 'overlapping callers make only one check');
    assert.equal(wasManual, true, 'a manual request joining the check is retained for UI presentation');
  }

  {
    let releaseAction;
    const gate = new Promise(resolve => { releaseAction = resolve; });
    const manifest = { tag: 'v1.0.153', apkSha256: 'd'.repeat(64) };
    const harness = makeUpdateFlowHarness({ startUpdate: () => gate });
    const automatic = harness.coordinator.requestAutomatic(manifest, 'same-key');
    const manual = harness.coordinator.requestManual(manifest, 'same-key');
    assert.equal(manual, automatic, 'manual retry joins an update action already in progress');
    await Promise.resolve();
    assert.equal(harness.calls.length, 1, 'manual and automatic starts do not duplicate the download');
    releaseAction({ status: 'started' });
    await automatic;

    let shouldFail = true;
    const retryHarness = makeUpdateFlowHarness({
      startUpdate: (_data, options) => {
        if (options.automatic && shouldFail) {
          shouldFail = false;
          return Promise.reject(new Error('network failure'));
        }
        return Promise.resolve({ status: 'started' });
      }
    });
    await assert.rejects(retryHarness.coordinator.requestAutomatic(manifest, 'retry-key'), /network failure/);
    assert.equal((await retryHarness.coordinator.requestAutomatic(manifest, 'retry-key')).status, 'attempted');
    assert.equal(retryHarness.calls.length, 1, 'an automatic failure does not cause automatic retry storms');
    await retryHarness.coordinator.requestManual(manifest, 'retry-key');
    assert.equal(retryHarness.calls.length, 2, 'an explicit manual retry remains available after automatic failure');
  }

  {
    let busy = true;
    const manifest = { tag: 'v1.0.153', apkSha256: 'e'.repeat(64) };
    const harness = makeUpdateFlowHarness({ busy: true });
    const deferred = harness.coordinator.requestAutomatic(manifest, 'busy-key');
    assert.equal((await deferred).status, 'deferred');
    assert.equal(harness.calls.length, 0, 'automatic update is deferred while a game or room is active');
    await harness.coordinator.requestAutomatic(manifest, 'busy-key');
    assert.equal(harness.deferredCount, 1, 'repeated busy notifications do not create duplicate pending work');
    harness.setBusy(false);
    await harness.coordinator.resumeWhenIdle();
    assert.equal(harness.calls.length, 1, 'returning to idle resumes the pending update once');
    assert.equal(harness.calls[0].options.automatic, true);
    assert.equal((await harness.coordinator.resumeWhenIdle()).status, 'idle');
    assert.equal(harness.calls.length, 1);
  }

  {
    assert.equal(makeActivityHarness({ gameVisible: true, gameMode: 'ai' })(), true,
      'a visible unfinished AI game defers automatic update');
    assert.equal(makeActivityHarness({ gameVisible: true, gameMode: 'pvp' })(), true,
      'a visible unfinished local PvP game defers automatic update');
    assert.equal(makeActivityHarness({ gameVisible: false, gameMode: 'ai' })(), false,
      'a saved AI checkpoint does not block update after returning to the lobby');
    assert.equal(makeActivityHarness({
      gameVisible: false,
      onlineState: { phase: 'matching', matching: true }
    })(), true, 'active online matching defers automatic update from the lobby');
    assert.equal(makeActivityHarness({
      gameVisible: false,
      onlineState: { phase: 'reconnecting', hasOnlineGame: true }
    })(), true, 'an online game that is reconnecting is not treated as idle');
    assert.equal(makeActivityHarness({
      gameVisible: false,
      onlineState: { phase: 'idle', hasOnlineGame: false }
    })(), false, 'an idle online state permits the pending automatic update');
  }

  {
    let releaseAction;
    const gate = new Promise(resolve => { releaseAction = resolve; });
    const manifestA = { tag: 'v1.0.153', apkSha256: '1'.repeat(64) };
    const manifestB = { tag: 'v1.0.154', apkSha256: '2'.repeat(64) };
    const harness = makeUpdateFlowHarness({ startUpdate: () => gate });
    const active = harness.coordinator.requestAutomatic(manifestA, 'key-a');
    const overlappingNewVersion = harness.coordinator.requestAutomatic(manifestB, 'key-b');
    assert.equal(harness.attempted.has('key-b'), false,
      'a different version key is not marked attempted while another action is active');
    releaseAction({ status: 'started' });
    await active;
    await overlappingNewVersion;
    await harness.coordinator.requestAutomatic(manifestB, 'key-b');
    assert.equal(harness.calls.length, 2, 'the different version remains eligible after the active action ends');
  }

  {
    const hash = 'f'.repeat(64);
    const harness = makeProductionStartUpdateHarness({
      apkRequired: true,
      manifest: { tag: 'v1.0.151', apkTicket: 'ticket', apkSha256: hash, fastUrl: 'https://ecs.test/old.apk', sourceType: 'ticketed' }
    });
    const result = await harness.start({ tag: 'v1.0.152', apkSha256: hash }, { automatic: true });
    assert.equal(result.status, 'failed');
    assert.equal(harness.calls.fetchManifest, 1, 'the production start action refreshes the manifest before download');
    assert.equal(harness.calls.nativeStart, 0, 'a stale manifest cannot start native APK installation or fallback');
    assert.equal(harness.calls.protectedDownload, 0, 'a stale manifest cannot invoke protected APK download');
    assert.equal(harness.calls.hotWrite, 0, 'a stale manifest cannot write HTML hot-update data');
  }
}

run().then(() => console.log('Update routing and automatic update regression checks passed.')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
