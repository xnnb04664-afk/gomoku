'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readReleaseBody, normalizeBody, checkEnvironment } = require('../release_preflight');

const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-release-preflight-parent-'));
const root = path.join(tempParent, 'fixture-root');
fs.mkdirSync(root);
const files = new Map();
const put = (relative, content = '') => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  files.set(path.resolve(absolute), content);
  return absolute;
};
const putAbsolute = (absolute, content = '') => {
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  files.set(path.resolve(absolute), content);
  return absolute;
};
const sdk = path.join(root, 'sdk');
const ndk = path.join(root, 'ndk-alias');
const required = [
  'build-tools/35.0.0/aapt2.exe', 'build-tools/35.0.0/aapt.exe',
  'build-tools/35.0.0/d8.bat', 'build-tools/35.0.0/zipalign.exe',
  'build-tools/35.0.0/apksigner.bat', 'platforms/android-35/android.jar'
];
for (const item of required) put(path.join('sdk', item));
put('node_modules/terser/package.json', '{}');
put('node_modules/wrangler/package.json', '{}');
put('android_src/AndroidManifest.xml', '<manifest android:versionCode="153" android:versionName="1.0.152">');
put('js/app.js', "const CURRENT_VERSION_TAG = 'v1.0.152';\nconst MINIMUM_APK_BUILD_FOR_CURRENT_ICON = 140;\nconst MINIMUM_APK_BUILD_FOR_NATIVE_VERSION_CHECK = 142;\nconst MINIMUM_APK_BUILD_FOR_NATIVE_AI_ENGINE = 151;\nconst MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 153;");
put('version.json', JSON.stringify({ versionName: '1.0.152', versionCode: 153, releaseTag: 'v1.0.152', updateLog: '五子棋云屿晴光 v1.0.152 官方正式版更新说明：\n\n修复旧代理查询流程' }));
put('RELEASE_NOTES.md', '状态：待发布\n\n修复旧代理查询流程');
const ndkBin = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin');
const ndkTools = ['llvm-strip.exe', 'aarch64-linux-android21-clang++.cmd', 'armv7a-linux-androideabi21-clang++.cmd', 'i686-linux-android21-clang++.cmd', 'x86_64-linux-android21-clang++.cmd'];
for (const name of ndkTools) putAbsolute(path.join(ndkBin, name));
putAbsolute(path.join(ndk, 'source.properties'), 'Pkg.Revision = 27.2.12479018');

const base = {
  rootDir: root,
  env: { ANDROID_SDK_ROOT: sdk, ANDROID_NDK_HOME: ndk },
  platform: 'win32', arch: 'x64',
  exists: file => fs.existsSync(file),
  readFile: (file, encoding = 'utf8') => fs.readFileSync(file, encoding),
  readdir: dir => fs.readdirSync(dir),
  runner: (command, args) => {
    if (command === 'java') return { status: 0, stderr: 'openjdk version "17.0.13"' };
    if (command === 'javac') return { status: 0, stderr: 'javac 17.0.13' };
    if (command === 'jar') return { status: 0, stdout: 'jar 17.0.13' };
    return { status: 0, stdout: command === 'gh' ? 'gh version 2.60.0' : 'ok' };
  }
};

try {
  const notesPath = path.join(root, 'RELEASE_NOTES.md');
  const versionPath = path.join(root, 'version.json');
  assert.throws(() => readReleaseBody({ notesPath, versionPath }), /与当前已发布版本/);
  assert.match(readReleaseBody({ notesPath, versionPath, allowSameNotes: true }), /旧代理查询/);
  put('RELEASE_NOTES.md', '状态：待发布\n\n调整更新内容展示，并修复 Native 资源同步诊断。');
  assert.match(readReleaseBody({ notesPath, versionPath }), /调整更新内容展示/);
  put('RELEASE_NOTES.md', 'TODO：请填写本次说明');
  assert.throws(() => readReleaseBody({ notesPath, versionPath }), /占位文字/);
  put('RELEASE_NOTES.md', '状态：待发布\n\n');
  assert.throws(() => readReleaseBody({ notesPath, versionPath }), /为空/);
  put('RELEASE_NOTES.md', '说明正文');

  assert.deepStrictEqual(checkEnvironment(base), []);
  let npmCall;
  checkEnvironment({ ...base, runner: (command, args, timeout) => {
    if (command === 'npm.cmd') npmCall = { command, args };
    return base.runner(command, args, timeout);
  } });
  assert.deepStrictEqual(npmCall, { command: 'npm.cmd', args: ['--version'] });
  const noTool = checkEnvironment({ ...base, exists: file => !file.endsWith('aapt2.exe') && fs.existsSync(file) });
  assert(noTool.some(item => item.includes('aapt2')));
  const timeout = checkEnvironment({ ...base, runner: (command, args) => command === 'gh' ? { status: null, error: { code: 'ETIMEDOUT' } } : base.runner(command, args) });
  assert(timeout.some(item => item.includes('检查超时')));
  const jre = checkEnvironment({ ...base, runner: (command, args) => command === 'java' ? { status: 0, stderr: 'openjdk version "21.0.2"' } : base.runner(command, args) });
  assert(jre.some(item => item.includes('java 必须为 JDK 17')));
  const deps = checkEnvironment({ ...base, exists: file => !file.includes(`${path.sep}node_modules${path.sep}wrangler`) && fs.existsSync(file) });
  assert(deps.some(item => item.includes('node_modules/wrangler')));
  putAbsolute(path.join(ndk, 'source.properties'), 'Pkg.Revision = 26.3.11579264');
  assert.deepStrictEqual(checkEnvironment(base), [], 'an aliased NDK with required compilers must not be version-rejected');
  const missingNdkCompiler = checkEnvironment({ ...base, exists: file => !file.endsWith('aarch64-linux-android21-clang++.cmd') && fs.existsSync(file) });
  assert(missingNdkCompiler.some(item => item.includes('构建脚本将选择的 NDK 缺少工具')));

  const sdkNdk = path.join(sdk, 'ndk', '27.3.13750724');
  const sdkNdkBin = path.join(sdkNdk, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin');
  for (const name of ndkTools) putAbsolute(path.join(sdkNdkBin, name));
  const damagedExplicit = path.join(root, 'explicit-damaged-ndk');
  putAbsolute(path.join(damagedExplicit, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin', 'llvm-strip.exe'));
  const badExplicit = checkEnvironment({ ...base, env: { ...base.env, ANDROID_NDK_HOME: damagedExplicit } });
  assert(badExplicit.some(item => item.includes('构建脚本将选择的 NDK 缺少工具') && item.includes(damagedExplicit)), 'must fail the builder-selected explicit NDK rather than skip to a valid SDK NDK');

  const fallbackSdk = 'C:\\Users\\ZhuanZ1\\AppData\\Local\\Android\\Sdk';
  const fallbackCheck = checkEnvironment({
    ...base,
    env: {},
    exists: file => file.startsWith(fallbackSdk + path.sep)
      ? fs.existsSync(path.join(sdk, file.slice((fallbackSdk + path.sep).length)))
      : fs.existsSync(file),
    readdir: dir => dir.startsWith(fallbackSdk + path.sep)
      ? fs.readdirSync(path.join(sdk, dir.slice((fallbackSdk + path.sep).length)))
      : fs.readdirSync(dir)
  });
  assert.deepStrictEqual(fallbackCheck, [], 'must probe the same default SDK fallback as build_apk.js');

  const originalApp = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const threshold = 'MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 153';
  put('js/app.js', originalApp.replace(threshold, 'MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 154'));
  assert.deepStrictEqual(checkEnvironment(base), [], 'normal next build 154 satisfies the threshold');
  put('js/app.js', originalApp.replace(threshold, 'MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 155'));
  assert(checkEnvironment(base).some(item => item.includes('高于本次目标 Android Build 154')));
  const skipEnv = { ...base.env, GOMOKU_SKIP_VERSION_BUMP: '1' };
  put('js/app.js', originalApp.replace(threshold, 'MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 153'));
  assert.deepStrictEqual(checkEnvironment({ ...base, env: skipEnv }), [], 'prepared-version recovery may target current Build 153');
  put('js/app.js', originalApp.replace(threshold, 'MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION = 154'));
  assert(checkEnvironment({ ...base, env: skipEnv }).some(item => item.includes('高于本次目标 Android Build 153')));
  put('js/app.js', originalApp);
  put('version.json', JSON.stringify({ versionName: '1.0.151', versionCode: 152, releaseTag: 'v1.0.151' }));
  assert(checkEnvironment(base).some(item => item.includes('版本源不一致')));
  assert.strictEqual(normalizeBody('五子棋云屿晴光 v1.0.153 官方正式版更新说明：\n\n同一内容。'), normalizeBody('五子棋云屿晴光 v1.0.152 官方正式版更新说明： 同一内容。'));
  console.log('release_preflight fixtures: PASS');
} finally {
  const resolvedTempParent = fs.realpathSync(tempParent);
  const resolvedRoot = fs.realpathSync(root);
  if (path.dirname(resolvedTempParent) !== fs.realpathSync(os.tmpdir()) || path.basename(resolvedTempParent).startsWith('gomoku-release-preflight-parent-') !== true || path.dirname(resolvedRoot) !== resolvedTempParent) {
    throw new Error(`Refusing fixture cleanup outside validated temp path: ${resolvedTempParent}`);
  }
  fs.rmSync(resolvedTempParent, { recursive: true, force: true });
}
