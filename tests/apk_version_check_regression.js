const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runTest() {
  const root = path.resolve(__dirname, '..');
  const appJsSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const skyHubSource = fs.readFileSync(path.join(root, 'js', 'sky-hub.js'), 'utf8');

  // Verify functions and constants exist in source
  assert.ok(appJsSource.includes('function isAndroidApkUpdateRequired'), 'isAndroidApkUpdateRequired must be defined');
  assert.ok(appJsSource.includes('function getInstalledAndroidBuildCode'), 'getInstalledAndroidBuildCode must be defined');
  assert.ok(appJsSource.includes('MINIMUM_APK_BUILD_FOR_NATIVE_AI_ENGINE = 151'), 'Native optimization requires APK Build 151 or newer');
  assert.ok(appJsSource.includes('MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 153'), 'Match notifications require APK Build 153 or newer');
  assert.ok(appJsSource.includes('const androidApkUpdateRequired = isAndroidApkUpdateRequired();'), 'checkAppUpdate must check isAndroidApkUpdateRequired');
  assert.ok(appJsSource.includes('const forceFullApk = isAndroidApkUpdateRequired();'),
    'the shared update action must honor the installed Android APK build floor');
  assert.ok(appJsSource.includes('function startAppUpdate(updateData, options = {})'),
    'automatic and manual update entry points must use the shared action');

  const start = appJsSource.indexOf('    const MINIMUM_APK_BUILD_FOR_CURRENT_ICON = 140;');
  assert.notStrictEqual(start, -1, 'MINIMUM_APK_BUILD_FOR_CURRENT_ICON start exists');
  const end = appJsSource.indexOf('\n    window.isAndroidApkUpdateRequired = isAndroidApkUpdateRequired;', start);
  assert.notStrictEqual(end, -1, 'apk check slice end exists');
  const targetCode = appJsSource.slice(start, end + '\n    window.isAndroidApkUpdateRequired = isAndroidApkUpdateRequired;'.length);

  function createEnv(options = {}) {
    const sandbox = {
      window: {},
      console: { log() {}, warn() {}, error() {} }
    };
    sandbox.window = sandbox;

    if (options.nativeBridge) {
      sandbox.AndroidNativeApp = options.nativeBridge;
    }

    return sandbox;
  }

  // Test 1: Web environment (no AndroidNativeApp)
  {
    const env = createEnv();
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.getInstalledAndroidBuildCode(), 0, 'Web environment must return build code 0');
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), false, 'Web environment must not require APK update');
  }

  // Test 2: Legacy Android APK without getAppVersionCode
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.getInstalledAndroidBuildCode(), 0, 'Legacy APK without getAppVersionCode must return 0');
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), true, 'Legacy APK must require full APK update');
  }

  // Test 3: Android APK with older build (e.g. Build 142 or 147)
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true, getAppVersionCode: () => 147 } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.getInstalledAndroidBuildCode(), 147, 'Must read installed build code 147');
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), true, 'Build 147 must require full APK update');
  }

  // Test 4: The original C++ APK still needs the native optimization update.
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true, getAppVersionCode: () => 148 } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.getInstalledAndroidBuildCode(), 148, 'Must read installed build code 148');
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), true, 'Build 148 must require the optimized full APK even after HTML updates');
  }

  // Test 5: Build 150 must install the full APK to receive Build 151 native update code.
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true, getAppVersionCode: () => 150 } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.getInstalledAndroidBuildCode(), 150, 'Must read installed build code 150');
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), true, 'Build 150 must require the full APK for Build 151 native update code');
  }

  // Test 6: Build 151 contains the native update code but needs Build 153 for match notifications.
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true, getAppVersionCode: () => 151 } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.getInstalledAndroidBuildCode(), 151, 'Must read installed build code 151');
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), true, 'Build 151 must require the full APK for match notifications');
  }

  // Build 152 remains below the matchmaking notification bridge requirement.
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true, getAppVersionCode: () => 152 } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), true, 'Build 152 must require the full APK for match notifications');
  }

  // Build 153 contains the matchmaking notification bridge.
  {
    const env = createEnv({ nativeBridge: { isNativeApp: () => true, getAppVersionCode: () => 153 } });
    vm.runInNewContext(targetCode, env);
    assert.strictEqual(env.window.isAndroidApkUpdateRequired(), false, 'Build 153 must satisfy the match notification requirement');
  }

  // Test 7: Verify checkAppUpdate UI & download routing
  assert.ok(appJsSource.includes('需要安装完整 APK'), 'Modal must guide user to full APK');
  assert.ok(appJsSource.includes('startNativeApkUpdateWithFallback(clickVersionData)'), 'Hot update button must route to native APK download');
  assert.ok(appJsSource.includes('window.GOMOKU_UPDATE_BADGE_TEXT = badgeText;'), 'app.js must persist badge text');
  assert.ok(skyHubSource.includes('window.GOMOKU_UPDATE_BADGE_TEXT'), 'sky-hub.js must respect persisted badge text');
  assert.ok(skyHubSource.includes('<article class="sky-me-update" data-sky-action="update" style="cursor:pointer">'), 'entire update row must be clickable');

  console.log('✅ All APK version check regression tests passed successfully!');
}

runTest();
