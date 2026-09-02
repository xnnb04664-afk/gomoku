const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function run(cmd, args, options = {}) {
  console.log(`> [EXEC] ${path.basename(cmd)} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options });
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
  const stats = exists && fs.statSync(src);
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

const SDK_DIR = 'C:\\Users\\ZhuanZ1\\AppData\\Local\\Android\\Sdk';
const BUILD_TOOLS = path.join(SDK_DIR, 'build-tools', '35.0.0');
const ANDROID_JAR = path.join(SDK_DIR, 'platforms', 'android-35', 'android.jar');

const AAPT2 = path.join(BUILD_TOOLS, 'aapt2.exe');
const AAPT = path.join(BUILD_TOOLS, 'aapt.exe');
const D8 = path.join(BUILD_TOOLS, 'd8.bat');
const ZIPALIGN = path.join(BUILD_TOOLS, 'zipalign.exe');
const APKSIGNER = path.join(BUILD_TOOLS, 'apksigner.bat');

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'android_src');
const OUTPUT_APK = path.join(ROOT_DIR, '五子棋大师.apk');
const KEYSTORE = path.join(ROOT_DIR, 'release.keystore');

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
copyRecursiveSync(path.join(SRC_DIR, 'res'), path.join(TEMP_BUILD, 'res'));
copyRecursiveSync(path.join(SRC_DIR, 'src'), path.join(TEMP_BUILD, 'src'));
fs.copyFileSync(path.join(SRC_DIR, 'AndroidManifest.xml'), path.join(TEMP_BUILD, 'AndroidManifest.xml'));

// 同步 HTML/CSS/JS 到 assets
fs.copyFileSync(path.join(ROOT_DIR, 'index.html'), path.join(TEMP_BUILD, 'assets', 'index.html'));
['theme1_zen_dark.html', 'theme2_neo_traditional.html', 'theme3_luxury_glass.html', 'theme4_clean_ios.html', 'theme5_sweet_romance.html'].forEach(f => {
  const p = path.join(ROOT_DIR, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(TEMP_BUILD, 'assets', f));
});
copyRecursiveSync(path.join(ROOT_DIR, 'css'), path.join(TEMP_BUILD, 'assets', 'css'));
copyRecursiveSync(path.join(ROOT_DIR, 'js'), path.join(TEMP_BUILD, 'assets', 'js'));

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

const alignedApk = path.join(TEMP_BUILD, 'aligned.apk');
run(ZIPALIGN, ['-f', '-p', '4', withDexApk, alignedApk]);

console.log('>>> [7/7] 对 APK 进行数字签名 (apksigner)...');
const tempKeystore = path.join(TEMP_BUILD, 'release.keystore');
run('keytool', [
  '-genkeypair',
  '-v',
  '-keystore', tempKeystore,
  '-storepass', '123456',
  '-alias', 'gomoku',
  '-keypass', '123456',
  '-keyalg', 'RSA',
  '-keysize', '2048',
  '-validity', '10000',
  '-dname', 'CN=GomokuMaster, OU=Game, O=ZhuanZ1, L=BJ, ST=BJ, C=CN'
]);

const tempSignedApk = path.join(TEMP_BUILD, 'signed.apk');
run('cmd.exe', [
  '/c',
  APKSIGNER,
  'sign',
  '--ks', tempKeystore,
  '--ks-pass', 'pass:123456',
  '--ks-key-alias', 'gomoku',
  '--key-pass', 'pass:123456',
  '--out', tempSignedApk,
  alignedApk
]);

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
