const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { loadSecretIntoEnv } = require('./local_secret_store');
const { injectAiWorkerSource } = require('./build_ai_worker');

function run(cmd, args, options = {}) {
  console.log(`> [EXEC] ${path.basename(cmd)} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  const spawnOptions = { stdio: 'inherit', ...options };
  // Node 25 on Windows can return EINVAL when launching .cmd/.bat directly.
  // Let ComSpec resolve these launcher scripts while keeping all arguments intact.
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(String(cmd))) {
    spawnOptions.shell = true;
    spawnOptions.windowsHide = true;
  }
  const res = spawnSync(cmd, args, spawnOptions);
  if (res.error) {
    console.error('Execution error:', res.error);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`Command failed with exit code: ${res.status}`);
    process.exit(res.status || 1);
  }
  return res;
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  if (!exists) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      // 过滤非 ASCII 文件名以兼容 Windows 下 aapt2 编译
      if (/[\u4e00-\u9fa5]/.test(child) && child.endsWith('.mp3')) return;
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    });
  } else {
    if (/[\u4e00-\u9fa5]/.test(path.basename(src)) && src.endsWith('.mp3')) return;
    fs.copyFileSync(src, dest);
  }
}

const ROOT_DIR = __dirname;

function isEnabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

// APK 默认只携带当前入口实际会加载的运行资源。旧 MQTT/P2P/PeerJS 仍保留在
// 源码和 android_src/assets 同步镜像中，但不再因为历史兼容代码被无条件打入生产包。
// 如果需要验收旧主题或迁移旧客户端，可显式使用 GOMOKU_APK_RESOURCE_MODE=conservative；
// 若要完整复刻旧的全量 assets，则使用 GOMOKU_APK_RESOURCE_MODE=all。
const requestedResourceMode = String(process.env.GOMOKU_APK_RESOURCE_MODE || '').trim().toLowerCase();
const legacyCompatRequested = isEnabled(process.env.GOMOKU_APK_INCLUDE_LEGACY_COMPAT)
  || isEnabled(process.env.GOMOKU_APK_INCLUDE_LEGACY_MQTT);
const allAssetsRequested = isEnabled(process.env.GOMOKU_APK_INCLUDE_ALL_ASSETS);
const APK_RESOURCE_MODE = allAssetsRequested
  ? 'all'
  : (requestedResourceMode || (legacyCompatRequested ? 'conservative' : 'minimal'));
if (!['minimal', 'conservative', 'all'].includes(APK_RESOURCE_MODE)) {
  throw new Error(`GOMOKU_APK_RESOURCE_MODE 仅支持 minimal、conservative 或 all，当前值：${APK_RESOURCE_MODE}`);
}

const APK_REQUIRED_ASSETS = Object.freeze([
  // 首屏和延迟功能的压缩运行包。
  'js/app.min.js',
  'js/account.min.js',
  'js/replay.min.js',
  'js/settings.min.js',
  'js/online.min.js',
  'js/social.min.js',
  // AI Worker 的内嵌源、Worker 不可用时的本地回退和强力引擎回退。
  'js/ai_fast.js',
  'js/ai.js',
  'js/ai_worker.js',
  // 当前入口仍按需加载的语音、十字棋、音效和头像资源。
  'js/voice.js',
  'js/cross.js',
  'js/assets/anime_avatars.js',
  'js/assets/cherry_bomb_audio.js',
  // 标准对局、P2P 与实验室模式仍按需使用这些联机适配层，不能在 APK 中裁掉。
  'js/mqtt.min.js',
  'js/p2p-network.js',
  'js/peerjs.min.js',
  'img/anime_avatar_boy.jpg',
  'img/anime_avatar_girl.jpg',
  'img/avatar_boy.png',
  'img/avatar_girl.png',
  // 晴空浮岛大厅与残局远征是新的首屏体验，必须随包提供。
  'js/sky-hub.js',
  'js/expedition.js',
  'js/sky-island.css'
]);

const APK_LEGACY_COMPAT_ASSETS = Object.freeze([
  // 这些文件仅用于旧版 standalone 主题之外的迁移和显式自动化测试。
  'js/app.js',
  'js/account.js',
  'js/online.js',
  'js/replay.js',
  'js/settings.js',
  'js/social.js'
]);

function listFilesRecursive(dir, relativePrefix) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativePrefix, entry.name);
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFilesRecursive(absolutePath, relativePath));
    else if (entry.isFile()) result.push(relativePath);
  }
  return result;
}

function getApkResourceManifest(mode = APK_RESOURCE_MODE) {
  let files;
  if (mode === 'all') {
    files = [
      'favicon.png',
      ...listFilesRecursive(path.join(ROOT_DIR, 'js'), 'js'),
      ...listFilesRecursive(path.join(ROOT_DIR, 'img'), 'img')
    ];
  } else {
    files = [...APK_REQUIRED_ASSETS];
    if (mode === 'conservative') files.push(...APK_LEGACY_COMPAT_ASSETS);
  }
  const uniqueFiles = [...new Set(files)].sort();
  const missing = uniqueFiles.filter(file => !fs.existsSync(path.join(ROOT_DIR, file)));
  const bytes = uniqueFiles.reduce((total, file) => {
    const absolutePath = path.join(ROOT_DIR, file);
    return total + (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? fs.statSync(absolutePath).size : 0);
  }, 0);
  return {
    mode,
    entry: 'index.html',
    files: uniqueFiles,
    missing,
    sourceBytes: bytes
  };
}

function copyAssetManifest(files, destRoot) {
  let copiedFiles = 0;
  let copiedBytes = 0;
  for (const relativeFile of files) {
    const normalizedFile = String(relativeFile || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedFile || normalizedFile.includes('..') || path.posix.isAbsolute(normalizedFile)) {
      throw new Error(`APK 资源清单包含非法路径：${relativeFile}`);
    }
    const sourcePath = path.join(ROOT_DIR, ...normalizedFile.split('/'));
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`APK 资源清单缺少文件：${normalizedFile}`);
    }
    const targetPath = path.join(destRoot, ...normalizedFile.split('/'));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    copiedFiles++;
    copiedBytes += fs.statSync(sourcePath).size;
  }
  return { copiedFiles, copiedBytes };
}

if (process.argv.includes('--print-resource-manifest')) {
  process.stdout.write(JSON.stringify(getApkResourceManifest(), null, 2) + '\n');
  process.exit(0);
}

// Prefer the relocated SDK path from the environment; keep the historical C:\\ path
// as a fallback for other machines that have not configured ANDROID_SDK_ROOT yet.
const SDK_DIR = process.env.ANDROID_SDK_ROOT
  || process.env.ANDROID_HOME
  || 'C:\\Users\\ZhuanZ1\\AppData\\Local\\Android\\Sdk';
const BUILD_TOOLS = path.join(SDK_DIR, 'build-tools', '35.0.0');
const ANDROID_JAR = path.join(SDK_DIR, 'platforms', 'android-35', 'android.jar');

const AAPT2 = path.join(BUILD_TOOLS, 'aapt2.exe');
const AAPT = path.join(BUILD_TOOLS, 'aapt.exe');
const D8 = path.join(BUILD_TOOLS, 'd8.bat');
const ZIPALIGN = path.join(BUILD_TOOLS, 'zipalign.exe');
const APKSIGNER = path.join(BUILD_TOOLS, 'apksigner.bat');

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:app'], { cwd: ROOT_DIR });
const SRC_DIR = path.join(ROOT_DIR, 'android_src');
const OUTPUT_APK = path.join(ROOT_DIR, '五子棋.apk');
const SYNC_ONLY = process.argv.includes('--sync-only');

// 签名密钥必须位于仓库之外。保留同一份证书即可覆盖升级，但绝不再把密钥或密码写进源码。
const USER_PROFILE = process.env.USERPROFILE || '';
const DEFAULT_SECRET_DIR = USER_PROFILE ? path.join(USER_PROFILE, 'Documents', 'GomokuSecrets') : '';
const KEYSTORE_INPUT = process.env.GOMOKU_KEYSTORE_PATH || (DEFAULT_SECRET_DIR ? path.join(DEFAULT_SECRET_DIR, 'release.keystore') : '');
const KEYSTORE = KEYSTORE_INPUT ? path.resolve(KEYSTORE_INPUT) : '';
const KEY_ALIAS = (process.env.GOMOKU_KEY_ALIAS || 'gomoku').trim();
const KEYSTORE_PASSWORD_ENV = 'GOMOKU_KEYSTORE_PASSWORD';
const KEY_PASSWORD_ENV = 'GOMOKU_KEY_PASSWORD';

function loadSigningConfig() {
  if (!KEYSTORE) {
    throw new Error('未找到签名密钥路径。请设置 GOMOKU_KEYSTORE_PATH，或将密钥放入用户目录 Documents\\GomokuSecrets。');
  }
  const repoRoot = path.resolve(ROOT_DIR).replace(/[\\/]$/, '') + path.sep;
  if (KEYSTORE.toLowerCase().startsWith(repoRoot.toLowerCase())) {
    throw new Error('签名密钥路径不能位于项目仓库内，请迁移到仓库外的安全目录。');
  }
  if (!fs.existsSync(KEYSTORE)) {
    throw new Error(`签名密钥不存在：${KEYSTORE}。为避免破坏覆盖升级，脚本不会自动生成新密钥。`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(KEY_ALIAS)) {
    throw new Error('GOMOKU_KEY_ALIAS 只能包含字母、数字、点、下划线或连字符。');
  }
  if (!process.env[KEYSTORE_PASSWORD_ENV]) {
    loadSecretIntoEnv(KEYSTORE_PASSWORD_ENV, 'keystore-password.dpapi');
  }
  const storePassword = process.env[KEYSTORE_PASSWORD_ENV] || '';
  const keyPassword = process.env[KEY_PASSWORD_ENV] || storePassword;
  if (!storePassword || !keyPassword) {
    throw new Error(`缺少签名密码，请先运行 powershell -ExecutionPolicy Bypass -File .\\setup_gomoku_secret.ps1 -Type Signing，或在当前会话设置 ${KEYSTORE_PASSWORD_ENV}（可选 ${KEY_PASSWORD_ENV}）。密码不会写入 Git。`);
  }
  return { storePassword, keyPassword };
}

const signingConfig = SYNC_ONLY ? null : loadSigningConfig();
const signingEnv = SYNC_ONLY ? null : {
  ...process.env,
  [KEYSTORE_PASSWORD_ENV]: signingConfig.storePassword,
  [KEY_PASSWORD_ENV]: signingConfig.keyPassword
};

// 使用纯 ASCII 临时目录以避免 aapt2 对中文字符路径的兼容性问题
const TEMP_BUILD = path.join(os.tmpdir(), 'gomoku_apk_build');

console.log('>>> [1/7] 初始化纯英文环境临时构建目录: ' + TEMP_BUILD);
if (fs.existsSync(TEMP_BUILD)) {
  fs.rmSync(TEMP_BUILD, { recursive: true, force: true });
}
fs.mkdirSync(path.join(TEMP_BUILD, 'gen'), { recursive: true });
fs.mkdirSync(path.join(TEMP_BUILD, 'classes'), { recursive: true });
fs.mkdirSync(path.join(TEMP_BUILD, 'dex'), { recursive: true });
fs.mkdirSync(path.join(TEMP_BUILD, 'res'), { recursive: true });
fs.mkdirSync(path.join(TEMP_BUILD, 'assets'), { recursive: true });
fs.mkdirSync(path.join(TEMP_BUILD, 'src'), { recursive: true });

console.log('>>> [2/7] 准备与同步源码和 Web 资源...');
const resourceManifest = getApkResourceManifest();
if (resourceManifest.missing.length) {
  throw new Error(`APK 资源清单缺少文件：${resourceManifest.missing.join(', ')}`);
}
console.log(`>>> [资源裁剪] 模式=${resourceManifest.mode}，入口=${resourceManifest.entry}，清单文件=${resourceManifest.files.length}，源文件合计=${resourceManifest.sourceBytes} bytes`);
copyRecursiveSync(path.join(SRC_DIR, 'res'), path.join(TEMP_BUILD, 'res'));
copyRecursiveSync(path.join(SRC_DIR, 'src'), path.join(TEMP_BUILD, 'src'));
fs.copyFileSync(path.join(SRC_DIR, 'AndroidManifest.xml'), path.join(TEMP_BUILD, 'AndroidManifest.xml'));

// ⚡ 极速离线秒开关键优化：将内联完整的单文件版置入 assets/index.html，彻底解除一切外部网络依赖与 document.write 阻塞
// 保持主 index.html 与当前仍在使用的 assets (js, img) 完整协同
const runtimeIndexHtml = injectAiWorkerSource(
  fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8'),
  ROOT_DIR
).replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(TEMP_BUILD, 'assets', 'index.html'), runtimeIndexHtml, 'utf8');
fs.writeFileSync(path.join(SRC_DIR, 'assets', 'index.html'), runtimeIndexHtml, 'utf8');

// 同步完整的 js, img 目录到 android_src/assets，保证本地微型服务器绝对不报 404；
// 产品已统一为官方晴空视觉，不再复制独立主题页面。APK 临时 staging 目录
// 则严格按上面的生产清单复制，避免把开发副本带入安装包。
['js', 'img'].forEach(dir => {
  const srcD = path.join(ROOT_DIR, dir);
  if (fs.existsSync(srcD)) {
    copyRecursiveSync(srcD, path.join(SRC_DIR, 'assets', dir));
  }
});

const stagedAssets = copyAssetManifest(resourceManifest.files, path.join(TEMP_BUILD, 'assets'));
console.log(`>>> [资源裁剪] staging 已复制 ${stagedAssets.copiedFiles} 个文件，源文件合计 ${stagedAssets.copiedBytes} bytes`);
// 不再用未内嵌的母本覆盖 Android assets；上面的 runtimeIndexHtml 才是可热更新的完整页面。

if (SYNC_ONLY) {
  fs.rmSync(TEMP_BUILD, { recursive: true, force: true });
  console.log('✅ Android WebView assets 已同步（--sync-only）；未编译、未签名、未生成 APK。');
  process.exit(0);
}

console.log('>>> [3/7] 编译 Android 资源 (aapt2 compile & link)...');
const resZip = path.join(TEMP_BUILD, 'resources.zip');
run(AAPT2, ['compile', '--dir', path.join(TEMP_BUILD, 'res'), '-o', resZip]);

const unalignedApk = path.join(TEMP_BUILD, 'unaligned.apk');
run(AAPT2, [
  'link',
  '-I', ANDROID_JAR,
  '--manifest', path.join(TEMP_BUILD, 'AndroidManifest.xml'),
  '-o', unalignedApk,
  '-A', path.join(TEMP_BUILD, 'assets'),
  '--java', path.join(TEMP_BUILD, 'gen'),
  resZip,
  '--auto-add-overlay'
]);

console.log('>>> [4/7] 编译 Java 源代码 (javac)...');
function getFiles(dir, ext) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(filePath, ext));
    } else if (file.endsWith(ext)) {
      results.push(filePath);
    }
  });
  return results;
}

const javaFiles = [
  ...getFiles(path.join(TEMP_BUILD, 'src'), '.java'),
  ...getFiles(path.join(TEMP_BUILD, 'gen'), '.java')
];

run('javac', [
  '-encoding', 'UTF-8',
  '-source', '1.8',
  '-target', '1.8',
  '-cp', ANDROID_JAR,
  '-d', path.join(TEMP_BUILD, 'classes'),
  ...javaFiles
]);

console.log('>>> [5/7] 生成 Dalvik Executable (d8)...');
const classFiles = getFiles(path.join(TEMP_BUILD, 'classes'), '.class');
run('cmd.exe', [
  '/c',
  D8,
  '--output', path.join(TEMP_BUILD, 'dex'),
  ...classFiles,
  '--lib', ANDROID_JAR,
  '--min-api', '21'
]);

console.log('>>> [6/7] 合并 Dex 并 4 字节对齐 (zipalign)...');
const withDexApk = path.join(TEMP_BUILD, 'with_dex.apk');
fs.copyFileSync(unalignedApk, withDexApk);

run(AAPT, ['add', withDexApk, 'classes.dex'], { cwd: path.join(TEMP_BUILD, 'dex') });

// 🌟 核心跨平台兼容修复：规范化 APK 内部 assets 的 Windows 反斜杠为标准 Linux 正斜杠
function normalizeApkZipEntrySlashes(apkPath) {
  let buf = fs.readFileSync(apkPath);
  let count = 0;
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
      const nameLen = buf.readUInt16LE(i + 26);
      for (let j = 0; j < nameLen; j++) {
        if (buf[i + 30 + j] === 0x5C) {
          buf[i + 30 + j] = 0x2F;
          count++;
        }
      }
    }
  }
  for (let i = 0; i < buf.length - 46; i++) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x01 && buf[i+3] === 0x02) {
      const nameLen = buf.readUInt16LE(i + 28);
      for (let j = 0; j < nameLen; j++) {
        if (buf[i + 46 + j] === 0x5C) {
          buf[i + 46 + j] = 0x2F;
          count++;
        }
      }
    }
  }
  fs.writeFileSync(apkPath, buf);
  if (count > 0) {
    console.log(`>>> [路径规范化] 成功将 APK 中 ${count} 处 Windows 反斜杠转换为标准 Linux 正斜杠 (杜绝 assets 404)`);
  }
}
normalizeApkZipEntrySlashes(withDexApk);

const alignedApk = path.join(TEMP_BUILD, 'aligned.apk');
run(ZIPALIGN, ['-f', '-p', '4', withDexApk, alignedApk]);

console.log('>>> [7/7] 对 APK 进行数字签名 (apksigner)...');
const keystorePath = KEYSTORE;
console.log('>>> [持久签名] 复用仓库外安全目录中的正式签名密钥 (保证手机可无缝覆盖安装更新): ' + keystorePath);

const tempSignedApk = path.join(TEMP_BUILD, 'signed.apk');
run('cmd.exe', [
  '/c',
  APKSIGNER,
  'sign',
  '--ks', keystorePath,
  '--ks-pass', `env:${KEYSTORE_PASSWORD_ENV}`,
  '--ks-key-alias', KEY_ALIAS,
  '--key-pass', `env:${KEY_PASSWORD_ENV}`,
  '--out', tempSignedApk,
  alignedApk
], { env: signingEnv });

// 复制最终产物回项目根目录
fs.copyFileSync(tempSignedApk, OUTPUT_APK);

// 清理临时目录
fs.rmSync(TEMP_BUILD, { recursive: true, force: true });

const stats = fs.statSync(OUTPUT_APK);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('=================================================');
console.log('🎉 Android APK 打包成功！');
console.log(`📁 安装包路径: ${OUTPUT_APK}`);
console.log(`📦 安装包大小: ${sizeMB} MB`);
console.log('=================================================');
