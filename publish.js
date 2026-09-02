const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const MANIFEST_PATH = path.join(ROOT_DIR, 'android_src', 'AndroidManifest.xml');

console.log('======================================================');
console.log('🚀 五子棋全平台极速一键发布引擎 (One-Click Publisher)');
console.log('======================================================');

// 1. 自动解析并递增 Android 版本号
console.log('>>> [1/5] 读取并递增 Android 应用版本号...');
let manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
const codeMatch = manifestContent.match(/android:versionCode="(\d+)"/);
const nameMatch = manifestContent.match(/android:versionName="([\d\.]+)"/);

let newCode = 2;
let newName = '1.0.1';

if (codeMatch && nameMatch) {
  const currentCode = parseInt(codeMatch[1], 10);
  newCode = currentCode + 1;

  const parts = nameMatch[1].split('.').map(n => parseInt(n, 10));
  if (parts.length === 3) {
    parts[2] += 1;
    newName = parts.join('.');
  } else {
    newName = `1.0.${newCode}`;
  }

  manifestContent = manifestContent.replace(/android:versionCode="\d+"/, `android:versionCode="${newCode}"`);
  manifestContent = manifestContent.replace(/android:versionName="[\d\.]+"/, `android:versionName="${newName}"`);
  fs.writeFileSync(MANIFEST_PATH, manifestContent, 'utf8');
  console.log(`📌 版本号自增完成: ${nameMatch[1]} (Build ${codeMatch[1]}) ➔ v${newName} (Build ${newCode})`);
}

// 2. 打包单文件离线网页版
console.log('>>> [2/5] 正在构建最新单文件离线旗舰版...');
execSync('node bundle_single_file.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 3. 构建原生 Android APK
console.log('>>> [3/5] 正在调用 Android 原生 SDK 编译并持久化签名 APK...');
execSync('node build_apk.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 4. 校验产物
const apkPath = path.join(ROOT_DIR, '五子棋.apk');
const singleHtmlPath = path.join(ROOT_DIR, '五子棋大师_单文件版.html');

if (fs.existsSync(apkPath) && fs.existsSync(singleHtmlPath)) {
  const apkSize = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
  const htmlSize = (fs.statSync(singleHtmlPath).size / 1024).toFixed(2);

  console.log('>>> [4/5] 交付物产物校验通过:');
  console.log(`   📱 五子棋.apk: ${apkSize} MB (版本: v${newName}, 手机支持无缝覆盖更新)`);
  console.log(`   🌐 五子棋大师_单文件版.html: ${htmlSize} KB`);

  // 5. 自动执行 Git 提交
  console.log('>>> [5/5] 执行 Git 自动提交发布记录...');
  try {
    const commitMsg = `release: 发布 v${newName} (Build ${newCode}) - 单文件版与原生APK全平台就绪`;
    execSync('git add .', { cwd: ROOT_DIR, stdio: 'inherit' });
    execSync(`git commit -m "${commitMsg}"`, { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log(`🎉 Git 提交成功: ${commitMsg}`);
  } catch(e) {
    console.log('ℹ️ 工作区无文件变动或已是最新状态。');
  }

  console.log('======================================================');
  console.log(`✨ 全部更新构建成功！用户手机直接安装【五子棋.apk】即可覆盖更新！`);
  console.log('======================================================');
} else {
  console.error('❌ 打包校验未通过，产物缺失！');
  process.exit(1);
}
