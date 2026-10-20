'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = __dirname;
const NOTES_PATH = path.join(ROOT_DIR, 'RELEASE_NOTES.md');
const VERSION_PATH = path.join(ROOT_DIR, 'version.json');

function normalizeBody(value) {
  return String(value || '')
    .replace(/^\s*#.*(?:\r?\n|$)/gm, '')
    .replace(/^\s*(?:状态|status)\s*[:：].*(?:\r?\n|$)/gim, '')
    .replace(/^\s*五子棋云屿晴光\s+v?\d+\.\d+\.\d+\s+官方正式版更新说明\s*:?\s*/gim, '')
    .replace(/\bv?\d+\.\d+\.\d+\b/gi, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

function readReleaseBody({ notesPath = NOTES_PATH, versionPath = VERSION_PATH, allowSameNotes = false } = {}) {
  if (!fs.existsSync(notesPath)) throw new Error(`缺少待发布说明文件：${path.basename(notesPath)}`);
  const body = fs.readFileSync(notesPath, 'utf8')
    .replace(/^\s*#.*(?:\r?\n|$)/gm, '')
    .replace(/^\s*(?:状态|status)\s*[:：].*(?:\r?\n|$)/gim, '')
    .trim();
  if (!body) throw new Error('待发布说明为空，请在 RELEASE_NOTES.md 写明本次实际更新内容。');
  if (/\b(?:TODO|TBD|PLACEHOLDER)\b|待填写|请填写|示例说明|此处填写/i.test(body)) {
    throw new Error('RELEASE_NOTES.md 仍含模板占位文字，请替换为本次实际更新内容。');
  }
  let previous;
  try { previous = JSON.parse(fs.readFileSync(versionPath, 'utf8')); }
  catch (error) { throw new Error(`无法读取当前 version.json：${error.message}`); }
  const oldLog = previous.updateLog || previous.notes || '';
  if (!allowSameNotes && normalizeBody(body) && normalizeBody(body) === normalizeBody(oldLog)) {
    throw new Error('待发布说明与当前已发布版本 updateLog 内容相同；请填写本次实际更新，不能沿用旧文案。');
  }
  return body;
}

function commandResult(runner, command, args, label, errors, timeout = 5000) {
  const result = runner(command, args, timeout);
  if (result.error || result.status !== 0) {
    const timedOut = result.error && (result.error.code === 'ETIMEDOUT' || /timed? ?out/i.test(result.error.message || ''));
    errors.push(`${label} 不可用${timedOut ? '（检查超时）' : ''}。`);
    return '';
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function versionMajor(output) {
  const match = String(output).match(/(?:javac|openjdk|java|jar)?\s*["']?(?:1\.)?(\d+)(?:[.+_\-\s]|$)/i);
  return match ? Number(match[1]) : NaN;
}

function checkEnvironment(options = {}) {
  const root = options.rootDir || ROOT_DIR;
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const exists = options.exists || fs.existsSync;
  const read = options.readFile || ((file, encoding = 'utf8') => fs.readFileSync(file, encoding));
  const readdir = options.readdir || fs.readdirSync;
  const runner = options.runner || ((command, args, timeout) => spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout, windowsHide: true,
    shell: platform === 'win32' && /\.(?:cmd|bat)(?:\s|$)/i.test(command)
  }));
  const errors = [];

  if (!exists(path.join(root, 'node_modules', 'terser'))) errors.push('缺少 node_modules/terser；请先按锁文件安装项目依赖。');
  if (!exists(path.join(root, 'node_modules', 'wrangler'))) errors.push('缺少 node_modules/wrangler；请先按锁文件安装项目依赖。');
  commandResult(runner, platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], 'npm（构建依赖）', errors);
  for (const [cmd, args, label] of [['git', ['--version'], 'Git'], ['gh', ['--version'], 'GitHub CLI']]) commandResult(runner, cmd, args, label, errors);
  if (!errors.some(e => e.startsWith('GitHub CLI'))) commandResult(runner, 'gh', ['auth', 'status'], 'GitHub CLI 登录', errors, 8000);

  const java = commandResult(runner, 'java', ['-version'], 'JDK 17 java', errors);
  const javac = commandResult(runner, 'javac', ['-version'], 'JDK 17 javac', errors);
  const jar = commandResult(runner, 'jar', ['--version'], 'JDK 17 jar', errors);
  for (const [name, output] of [['java', java], ['javac', javac], ['jar', jar]]) {
    if (output && versionMajor(output) !== 17) errors.push(`${name} 必须为 JDK 17，检测到：${output.split(/\r?\n/)[0]}`);
  }
  if (java && javac && jar && (versionMajor(java) !== versionMajor(javac) || versionMajor(javac) !== versionMajor(jar))) errors.push('java、javac、jar 主版本不一致；请统一 JAVA_HOME 与 PATH。');

  const sdk = env.ANDROID_SDK_ROOT || env.ANDROID_HOME || 'C:\\Users\\ZhuanZ1\\AppData\\Local\\Android\\Sdk';
  const buildTools = path.join(sdk, 'build-tools', '35.0.0');
  const required = [
    ['Android SDK Platform 35', path.join(sdk, 'platforms', 'android-35', 'android.jar')],
    ['Build Tools 35.0.0 aapt2', path.join(buildTools, 'aapt2.exe')],
    ['Build Tools 35.0.0 aapt', path.join(buildTools, 'aapt.exe')],
    ['Build Tools 35.0.0 d8', path.join(buildTools, 'd8.bat')],
    ['Build Tools 35.0.0 zipalign', path.join(buildTools, 'zipalign.exe')],
    ['Build Tools 35.0.0 apksigner', path.join(buildTools, 'apksigner.bat')]
  ];
  for (const [label, file] of required) if (!exists(file)) errors.push(`${label} 缺失：${file}`);

  const ndkCandidates = [env.ANDROID_NDK_HOME, env.ANDROID_NDK_ROOT].filter(Boolean).map(value => path.resolve(value));
  const ndkRoot = path.join(sdk, 'ndk');
  if (exists(ndkRoot)) {
    try {
      const installed = readdir(ndkRoot)
        .map(name => path.join(ndkRoot, name))
        .filter(candidate => exists(path.join(candidate, 'toolchains', 'llvm', 'prebuilt')))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      ndkCandidates.push(...installed);
    }
    catch (error) { errors.push(`无法读取 Android SDK NDK 目录：${error.message}`); }
  }
  const host = platform === 'win32' ? 'windows-x86_64' : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64') : 'linux-x86_64';
  const compilers = ['aarch64-linux-android21-clang++', 'armv7a-linux-androideabi21-clang++', 'i686-linux-android21-clang++', 'x86_64-linux-android21-clang++'];
  const ndk = ndkCandidates.find(dir => exists(path.join(dir, 'toolchains', 'llvm', 'prebuilt')));
  if (!ndk) errors.push(`Android NDK 缺失（构建脚本通过 ANDROID_NDK_HOME、ANDROID_NDK_ROOT 或 SDK/ndk 自动发现；SDK 路径 ${sdk}）。`);
  else {
    const bin = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', host, 'bin');
    const missing = [platform === 'win32' ? 'llvm-strip.exe' : 'llvm-strip', ...compilers.map(name => name + (platform === 'win32' ? '.cmd' : ''))]
      .filter(name => !exists(path.join(bin, name)));
    if (missing.length) errors.push(`构建脚本将选择的 NDK 缺少工具：${missing.join(', ')}（${ndk}）。`);
  }

  try {
    const manifest = read(path.join(root, 'android_src', 'AndroidManifest.xml'));
    const app = read(path.join(root, 'js', 'app.js'));
    const version = JSON.parse(read(path.join(root, 'version.json')));
    const code = Number((manifest.match(/android:versionCode="(\d+)"/) || [])[1]);
    const name = (manifest.match(/android:versionName="([\d.]+)"/) || [])[1];
    const appTag = (app.match(/CURRENT_VERSION_TAG\s*=\s*'v([\d.]+)'/) || [])[1];
    if (!name || !Number.isFinite(code) || name !== version.versionName || code !== Number(version.versionCode) || appTag !== name || version.releaseTag !== `v${name}`) {
      errors.push(`版本源不一致：AndroidManifest=${name || '缺失'}/${Number.isFinite(code) ? code : '缺失'}，version.json=${version.versionName || '缺失'}/${version.versionCode ?? '缺失'}，js/app.js=${appTag || '缺失'}。`);
    }
    const thresholds = [...app.matchAll(/\bconst\s+(MINIMUM_APK_BUILD_[A-Z0-9_]+)\s*=\s*([^;]+);/g)];
    const requiredThresholds = [
      'MINIMUM_APK_BUILD_FOR_CURRENT_ICON',
      'MINIMUM_APK_BUILD_FOR_NATIVE_VERSION_CHECK',
      'MINIMUM_APK_BUILD_FOR_NATIVE_AI_ENGINE',
      'MINIMUM_APK_BUILD_FOR_MATCH_NOTIFICATION'
    ];
    const foundNames = new Set(thresholds.map(match => match[1]));
    const missing = requiredThresholds.filter(constant => !foundNames.has(constant));
    if (missing.length) errors.push(`缺少必要的原生最低 Build 常量：${missing.join(', ')}。`);
    const targetCode = code + (String(env.GOMOKU_SKIP_VERSION_BUMP || '').trim() === '1' ? 0 : 1);
    for (const match of thresholds) {
      const value = Number(match[2].trim());
      if (!Number.isInteger(value) || value <= 0) errors.push(`${match[1]} 必须是正整数。`);
      else if (value > targetCode) errors.push(`${match[1]}=${value} 高于本次目标 Android Build ${targetCode}，目标版本无法满足此原生门槛。`);
    }
  } catch (error) { errors.push(`版本源检查失败：${error.message}`); }

  return errors;
}

function preflight(options = {}) {
  const body = readReleaseBody({ ...options, allowSameNotes: options.allowSameNotes === true });
  const errors = checkEnvironment(options);
  if (errors.length) throw new Error(`发布前检查失败：\n- ${errors.join('\n- ')}`);
  return body;
}

if (require.main === module) {
  try {
    const body = preflight();
    console.log('✅ 发布说明和本机发布/Android 构建环境检查通过。');
    console.log(`说明正文：${body.split(/\r?\n/)[0]}`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { normalizeBody, readReleaseBody, checkEnvironment, preflight, versionMajor };
