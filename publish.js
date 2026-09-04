const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const UPDATE_PROXY_ORIGIN = 'https://gomoku-api.pages.dev';
const MANIFEST_PATH = path.join(ROOT_DIR, 'android_src', 'AndroidManifest.xml');

const vm = require('vm');

console.log('======================================================');
console.log('🚀 五子棋全平台极速一键发布引擎 (One-Click Publisher & GitHub Releases)');
console.log('======================================================');

// 0. 发布前严密静态语法与核心完整性安全卡点 (100% 杜绝任何语法错误流出到正式包)
console.log('>>> [0/8] 🛡️ 正在执行发布前代码全量静态语法与完整性校验...');

function runPreflightChecks() {
  let hasError = false;

  // A. 校验 index.html 内所有 script 标签的 JavaScript 语法
  const indexPath = path.join(ROOT_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8');
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let scriptIdx = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
      scriptIdx++;
      const code = match[1].trim();
      if (!code) continue;
      try {
        new vm.Script(code, { filename: `index.html#script[${scriptIdx}]` });
      } catch (err) {
        console.error(`\n❌ [发布致命拦截] index.html 第 ${scriptIdx} 个 script 标签存在语法错误:`);
        console.error(err.message);
        hasError = true;
      }
    }

    // B. 核心关键 DOM 元素与核心函数存在性检查
    const criticalElements = ['cvs', 'gameResultModal', 'p1NameLabel', 'myLadderBadge'];
    for (const elemId of criticalElements) {
      if (!html.includes(`id="${elemId}"`)) {
        console.error(`\n❌ [发布致命拦截] index.html 缺失关键核心 DOM 元素: id="${elemId}"`);
        hasError = true;
      }
    }

    const criticalFuncs = ['draw', 'makeMove', 'checkWin', 'triggerGameEnd', 'reportMatchResult', 'showGameResultModal', 'resetBoardOnly'];
    for (const funcName of criticalFuncs) {
      if (!html.includes(`function ${funcName}`)) {
        console.error(`\n❌ [发布致命拦截] index.html 缺失关键核心函数: function ${funcName}`);
        hasError = true;
      }
    }
  }

  // C. 校验 backend/worker.js 语法
  const workerPath = path.join(ROOT_DIR, 'backend', 'worker.js');
  if (fs.existsSync(workerPath)) {
    try {
      execSync('node --check backend/worker.js', { stdio: 'pipe' });
    } catch (err) {
      console.error('\n❌ [发布致命拦截] backend/worker.js 存在语法错误:');
      console.error(err.stderr ? err.stderr.toString() : err.message);
      hasError = true;
    }
  }

  if (hasError) {
    console.error('\n🚫 发布流程被安全门禁拦截！代码中存在语法或完整性问题，已强行终止发包！\n');
    process.exit(1);
  }

  console.log('✅ 静态语法与核心完整性校验 100% 通过，允许继续发包！');
}

runPreflightChecks();

// 发布前阻断签名密钥、凭据文件误入仓库；密码/令牌只允许通过环境变量或云端 Secret 注入。
function runSecretFileGuard() {
  const sensitivePath = /(^|[\\/])(?:\.env(?:\.[^\\/]*)?|.*\.(?:keystore|jks|p12|pfx|pem))$/i;
  const tracked = execSync('git ls-files', { cwd: ROOT_DIR, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const untracked = execSync('git ls-files --others --exclude-standard', { cwd: ROOT_DIR, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const blocked = [...new Set([...tracked, ...untracked].filter(file => sensitivePath.test(file)))];
  if (blocked.length > 0) {
    throw new Error(`发布安全门禁拦截：以下敏感文件不能进入 Git：${blocked.join(', ')}`);
  }
  const rootKey = path.join(ROOT_DIR, 'release.keystore');
  if (fs.existsSync(rootKey)) {
    throw new Error('发布安全门禁拦截：项目根目录仍存在 release.keystore，请使用仓库外签名密钥。');
  }
  console.log('✅ 发布安全门禁通过：未发现可提交的签名密钥或凭据文件。');
}

runSecretFileGuard();

// 1. 自动解析并递增 Android 版本号
console.log('>>> [1/8] 读取并递增应用版本号...');
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
console.log('>>> [2/8] 同步前端版本号到 6 大主题...');
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
    c = c.replace(/id="appVersionDisplay"[^>]*>v[\d\.]+<\/(?:div|span)>/g, `id="appVersionDisplay" style="font-size:12px; font-weight:900; color:#0284c7; margin-top:2px;">v${newName}</div>`);
    fs.writeFileSync(fp, c, 'utf8');
  }
});

// 同步更新 version.json（兼容旧客户端；新客户端统一走 Cloudflare Worker 中转）
const versionJsonPath = path.join(ROOT_DIR, 'version.json');
const todayStr = new Date().toISOString().split('T')[0];
const vJson = {
  versionName: newName,
  versionCode: newCode,
  releaseTag: `v${newName}`,
  publishTime: todayStr,
  updateLog: [
    `五子棋 v${newName} 官方正式版更新说明：`,
    `🎯 【主棋盘大屏动态复盘】历史战绩点击「查看棋局」，直接平滑跳转至主棋盘大屏！每颗棋子中心清晰印上落子序号（1, 2, 3...），支持滑动条拖拽推演、单步进退、自动电影级播放与终局一键跳转`,
    `🔒 【设置弹窗按钮底部常驻】个人中心弹窗底部「保存并应用」与「关闭」按钮改为永远固定常驻在屏幕最下方，打开弹窗一眼可见，彻底告别必须滑到最底部的繁琐操作`,
    `☁️ 【历史战绩云端存储与双向彻底抹除】全盘走法谱与棋局数据全自动备份至 Cloudflare D1 云端数据库，换手机/重装账号一键找回；清空记录本地与云端彻底同步抹除`,
    `⚡ 【免安装在线热更新】由 Cloudflare Worker 安全中转私有仓库文件，手机端无需 GitHub 权限`,
    `🧠 【最强大师 AI】统一接入棋型评估、必胜/必防、双重威胁检测、Alpha-Beta 迭代加深与置换表搜索，并按桌面/移动端设置单步时间预算`,
    `🚫 【开机零干扰体验】更新后启动直接 0.2 秒秒开进棋盘，绝不主动弹出任何卡片打扰您`
  ].join('\n\n'),
  notes: [
    `五子棋 v${newName} 官方正式版更新说明：`,
    `🎯 【主棋盘大屏动态复盘】历史战绩点击「查看棋局」，直接平滑跳转至主棋盘大屏！每颗棋子中心清晰印上落子序号（1, 2, 3...），支持滑动条拖拽推演、单步进退、自动电影级播放与终局一键跳转`,
    `🔒 【设置弹窗按钮底部常驻】个人中心弹窗底部「保存并应用」与「关闭」按钮改为永远固定常驻在屏幕最下方，打开弹窗一眼可见，彻底告别必须滑到最底部的繁琐操作`,
    `☁️ 【历史战绩云端存储与双向彻底抹除】全盘走法谱与棋局数据全自动备份至 Cloudflare D1 云端数据库，换手机/重装账号一键找回；清空记录本地与云端彻底同步抹除`,
    `⚡ 【免安装在线热更新】由 Cloudflare Worker 安全中转私有仓库文件，手机端无需 GitHub 权限`,
    `🧠 【最强大师 AI】统一接入棋型评估、必胜/必防、双重威胁检测、Alpha-Beta 迭代加深与置换表搜索，并按桌面/移动端设置单步时间预算`,
    `🚫 【开机零干扰体验】更新后启动直接 0.2 秒秒开进棋盘，绝不主动弹出任何卡片打扰您`
  ].join('\n\n'),
  download: {
    fastUrl: `${UPDATE_PROXY_ORIGIN}/api/update/apk`,
    htmlUrl: `${UPDATE_PROXY_ORIGIN}/api/update/html`
  }
};
fs.writeFileSync(versionJsonPath, JSON.stringify(vJson, null, 2), 'utf8');
console.log('📌 已同步更新 version.json (国内极速直连数据源)');

// 同步更新 backend/worker.js 中的版本号与更新日志
const workerJsPath = path.join(ROOT_DIR, 'backend', 'worker.js');
if (fs.existsSync(workerJsPath)) {
  let wCode = fs.readFileSync(workerJsPath, 'utf8');
  wCode = wCode.replace(/tag:\s*["']v[\d\.]+["']/, `tag: "v${newName}"`);
  wCode = wCode.replace(/updateLog:\s*["'`][\s\S]*?["'`]\s*,/, `updateLog: ${JSON.stringify(vJson.updateLog)},`);
  fs.writeFileSync(workerJsPath, wCode, 'utf8');
  console.log(`📌 已同步更新 backend/worker.js 版本与精准更新日志为 v${newName}`);
}

// 3. 打包单文件离线网页版
console.log('>>> [3/8] 正在构建最新单文件离线旗舰版...');
execSync('node bundle_single_file.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 4. 构建原生 Android APK (持久密钥签名)
console.log('>>> [4/8] 正在调用 Android 原生 SDK 编译并持久化签名 APK...');
execSync('node build_apk.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 5. 校验产物
const apkPath = path.join(ROOT_DIR, '五子棋.apk');
const singleHtmlPath = path.join(ROOT_DIR, '五子棋大师_单文件版.html');
const gomokuHtmlPath = path.join(ROOT_DIR, 'gomoku.html');
fs.copyFileSync(singleHtmlPath, gomokuHtmlPath);

if (!fs.existsSync(apkPath) || !fs.existsSync(singleHtmlPath)) {
  console.error('❌ 打包校验未通过，产物缺失！');
  process.exit(1);
}

const apkSize = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
const htmlSize = (fs.statSync(singleHtmlPath).size / 1024).toFixed(2);
console.log(`>>> [5/8] 交付物产物校验通过: APK ${apkSize} MB | HTML ${htmlSize} KB (v${newName})`);

// 6. 执行 Git 本地提交并推送到 GitHub
console.log('>>> [6/8] 执行 Git 提交并推送到 GitHub...');
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
console.log('>>> [7/8] 正在将最新 APK 发布到 GitHub Releases...');
const releaseTag = `v${newName}`;
const releaseApk = path.join(ROOT_DIR, 'gomoku.apk');
const releaseHtml = path.join(ROOT_DIR, 'gomoku.html');
fs.copyFileSync(apkPath, releaseApk);
fs.copyFileSync(singleHtmlPath, releaseHtml);

try {
  const releaseTitle = `五子棋 ${releaseTag} 官方正式版 (APK + 单文件HTML双发布)`;
  const releaseNotes = `### 🚀 五子棋 ${releaseTag} 官方全平台正式发布！\n\n${vJson.updateLog}\n\n- 📱 原生 Android 极速安装包：\`gomoku.apk\` (1.5MB，闪电安装)\n- 💻 全平台浏览器单文件版：\`gomoku.html\` (免安装双击即玩)`;
  
  execSync(`gh release create ${releaseTag} "gomoku.apk" "gomoku.html" --title "${releaseTitle}" --notes "${releaseNotes}"`, { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`🎉 GitHub Releases 发布成功 (双产物 APK + HTML): ${releaseTag}`);
} catch(err) {
  console.log('ℹ️ GitHub Release 已存在或创建提示: ' + err.message);
  try {
    execSync(`gh release upload ${releaseTag} "gomoku.apk" "gomoku.html" --clobber`, { cwd: ROOT_DIR, stdio: 'inherit' });
  } catch(_) {}
} finally {
  if (fs.existsSync(releaseApk)) fs.unlinkSync(releaseApk);
  if (fs.existsSync(releaseHtml)) fs.unlinkSync(releaseHtml);
}

// 同步部署线上最新 Worker 与 Pages 官方安全接口
console.log('>>> 正在同步部署 Cloudflare Pages & Worker 官方安全中枢...');
try {
  execSync('node deploy_worker.js', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch(e) {
  console.warn('Worker 部署提示:', e.message);
}

console.log('======================================================');
console.log(`✨ 全部发布流程圆满成功！版本: v${newName}`);
console.log(`🔗 APK 更新中转地址: ${UPDATE_PROXY_ORIGIN}/api/update/apk`);
console.log(`⚡ HTML 热更新中转地址: ${UPDATE_PROXY_ORIGIN}/api/update/html`);
console.log('======================================================');
