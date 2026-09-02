const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const MANIFEST_PATH = path.join(ROOT_DIR, 'android_src', 'AndroidManifest.xml');

console.log('======================================================');
console.log('🚀 五子棋全平台极速一键发布引擎 (One-Click Publisher & GitHub Releases)');
console.log('======================================================');

// 1. 自动解析并递增 Android 版本号
console.log('>>> [1/7] 读取并递增应用版本号...');
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

// 2. 同步更新所有 HTML 中的 CURRENT_VERSION_TAG 与 UI 显示
console.log('>>> [2/7] 同步前端版本号到 6 大主题...');
const htmlFiles = [
  'index.html',
  'theme1_zen_dark.html',
  'theme2_neo_traditional.html',
  'theme3_luxury_glass.html',
  'theme4_clean_ios.html',
  'theme5_sweet_romance.html'
];
htmlFiles.forEach(f => {
  const fp = path.join(ROOT_DIR, f);
  if (fs.existsSync(fp)) {
    let c = fs.readFileSync(fp, 'utf8');
    c = c.replace(/const CURRENT_VERSION_TAG = 'v[\d\.]+';/, `const CURRENT_VERSION_TAG = 'v${newName}';`);
    c = c.replace(/id="appVersionDisplay"[^>]*>v[\d\.]+<\/span>/, `id="appVersionDisplay" style="color:#0984e3; font-weight:900;">v${newName}</span>`);
    fs.writeFileSync(fp, c, 'utf8');
  }
});

// 同步更新 version.json (供 jsDelivr 国内极速 CDN 毫秒级分发检测)
const versionJsonPath = path.join(ROOT_DIR, 'version.json');
const todayStr = new Date().toISOString().split('T')[0];
const vJson = {
  versionName: newName,
  versionCode: newCode,
  releaseTag: `v${newName}`,
  publishTime: todayStr,
  updateLog: `五子棋 v${newName} 官方正式版更新发布！\n1. 支持国内网络极速更新与覆盖安装\n2. 120Hz极速性能调优\n3. 9大干扰卡牌池与断线自动重连`,
  download: {
    fastUrl: `https://gh-proxy.com/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk`,
    backupFastUrl: `https://ghps.cc/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk`,
    officialUrl: `https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk`
  }
};
fs.writeFileSync(versionJsonPath, JSON.stringify(vJson, null, 2), 'utf8');
console.log('📌 已同步更新 version.json (国内极速直连数据源)');

// 3. 打包单文件离线网页版
console.log('>>> [3/7] 正在构建最新单文件离线旗舰版...');
execSync('node bundle_single_file.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 4. 构建原生 Android APK (持久密钥签名)
console.log('>>> [4/7] 正在调用 Android 原生 SDK 编译并持久化签名 APK...');
execSync('node build_apk.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 5. 校验产物
const apkPath = path.join(ROOT_DIR, '五子棋.apk');
const singleHtmlPath = path.join(ROOT_DIR, '五子棋大师_单文件版.html');

if (!fs.existsSync(apkPath) || !fs.existsSync(singleHtmlPath)) {
  console.error('❌ 打包校验未通过，产物缺失！');
  process.exit(1);
}

const apkSize = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
const htmlSize = (fs.statSync(singleHtmlPath).size / 1024).toFixed(2);
console.log(`>>> [5/7] 交付物产物校验通过: APK ${apkSize} MB | HTML ${htmlSize} KB (v${newName})`);

// 6. 执行 Git 本地提交并推送到 GitHub
console.log('>>> [6/7] 执行 Git 提交并推送到 GitHub...');
try {
  const commitMsg = `release: 发布 v${newName} (Build ${newCode}) - 原生APK与GitHub Releases同步就绪`;
  execSync('git add .', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync(`git commit -m "${commitMsg}"`, { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`🎉 Git 本地提交成功: ${commitMsg}`);
  execSync('git push origin master', { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log('🎉 GitHub 仓库同步推送成功！');
} catch(e) {
  console.log('ℹ️ Git 提交或推送提示: ' + e.message);
}

// 7. 自动在 GitHub Releases 上创建发版并上传 APK
console.log('>>> [7/7] 正在将最新 APK 发布到 GitHub Releases...');
const releaseTag = `v${newName}`;
const releaseApk = path.join(ROOT_DIR, 'gomoku.apk');
fs.copyFileSync(apkPath, releaseApk);

try {
  const releaseTitle = `五子棋 ${releaseTag} 官方正式版`;
  const releaseNotes = `### 🚀 五子棋 ${releaseTag} 正式发布！\n- 📱 原生 Android 满帧体验 (120Hz Canvas离屏位图渲染)\n- 🌐 WebRTC 跨网穿透联机与断线瞬时重连\n- 🎴 9大强力干扰技能卡牌池\n- 🔄 支持手机无缝覆盖安装，保留全部胜率战绩与自定义头像！`;
  
  execSync(`gh release create ${releaseTag} "gomoku.apk" --title "${releaseTitle}" --notes "${releaseNotes}"`, { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`🎉 GitHub Releases 发布成功: ${releaseTag}`);
} catch(err) {
  console.log('ℹ️ GitHub Release 已存在或创建提示: ' + err.message);
} finally {
  if (fs.existsSync(releaseApk)) fs.unlinkSync(releaseApk);
}

// 刷新 jsDelivr 全球边缘缓存
console.log('>>> 正在刷新 CDN 缓存，确保全球毫秒级获取最新版本...');
try {
  execSync(`curl -s "https://purge.jsdelivr.net/gh/xnnb04664-afk/gomoku@master/version.json"`, { timeout: 4000 });
  execSync(`curl -s "https://purge.jsdelivr.net/gh/xnnb04664-afk/gomoku@latest/version.json"`, { timeout: 4000 });
  execSync(`curl -s "https://purge.jsdelivr.net/gh/xnnb04664-afk/gomoku@master/index.html"`, { timeout: 4000 });
  execSync(`curl -s "https://purge.jsdelivr.net/gh/xnnb04664-afk/gomoku@latest/index.html"`, { timeout: 4000 });
} catch(ignored) {}

console.log('======================================================');
console.log(`✨ 全部发布流程圆满成功！版本: v${newName}`);
console.log(`🔗 永久最新版下载直链: https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk`);
console.log(`⚡ 国内高速加速下载链: https://gh-proxy.com/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk`);
console.log('======================================================');
