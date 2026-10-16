const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const { loadSecretIntoEnv } = require('./local_secret_store');

const ROOT_DIR = __dirname;
const MANIFEST_PATH = path.join(ROOT_DIR, 'android_src', 'AndroidManifest.xml');
const argv = new Set(process.argv.slice(2));
function readArg(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : '';
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('用法：node publish.js [--deploy-cloudflare] [--target-branch=<branch>] [--allow-release-overwrite]');
  console.log('默认：构建 APK/单文件版、提交推送并发布 GitHub Release，不部署 Cloudflare 生产环境。');
  console.log('显式部署：追加 --deploy-cloudflare，或设置 GOMOKU_DEPLOY_CLOUDFLARE=1。');
  console.log('发布目标分支默认是当前分支；跨分支发布必须同时显式指定 --target-branch 与 GOMOKU_ALLOW_NONMASTER_RELEASE=1。');
  console.log('已有 Release 不会自动覆盖；确需补传时追加 --allow-release-overwrite。');
  process.exit(0);
}
const SHOULD_DEPLOY_CLOUDFLARE = process.argv.includes('--deploy-cloudflare')
  || String(process.env.GOMOKU_DEPLOY_CLOUDFLARE || '').trim() === '1';
const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
const TARGET_BRANCH = readArg('--target-branch') || String(process.env.GOMOKU_PUBLISH_BRANCH || currentBranch).trim() || currentBranch;
if (!/^[A-Za-z0-9._/-]+$/.test(TARGET_BRANCH) || TARGET_BRANCH.startsWith('-') || TARGET_BRANCH.includes('..')) {
  throw new Error(`发布安全门禁拦截：目标分支名不安全：${TARGET_BRANCH}`);
}
const allowNonMasterRelease = String(process.env.GOMOKU_ALLOW_NONMASTER_RELEASE || '').trim() === '1';
const ALLOW_RELEASE_OVERWRITE = argv.has('--allow-release-overwrite')
  || String(process.env.GOMOKU_ALLOW_RELEASE_OVERWRITE || '').trim() === '1';
if (currentBranch !== TARGET_BRANCH && !allowNonMasterRelease) {
  throw new Error(`发布安全门禁拦截：当前分支 ${currentBranch} 不等于目标分支 ${TARGET_BRANCH}。从隔离工作树发布请显式设置 GOMOKU_ALLOW_NONMASTER_RELEASE=1，避免误推送。`);
}
// A failed artifact build may leave the already-prepared version in the tree.
// This flag lets a resumed publish finish that exact version without bumping twice.
const SKIP_VERSION_BUMP = String(process.env.GOMOKU_SKIP_VERSION_BUMP || '').trim() === '1';

execSync('npm run build:app', { cwd: ROOT_DIR, stdio: 'inherit' });

const vm = require('vm');

// Cloudflare 生产部署是显式动作；普通发版只构建、提交并发布 GitHub Release，
// 不读取本机 Cloudflare 凭据，也不触碰线上环境。
if (SHOULD_DEPLOY_CLOUDFLARE) {
  // 发布令牌优先使用当前环境变量；未设置时自动读取仓库外的本机 DPAPI 凭据。
  loadSecretIntoEnv('CLOUDFLARE_API_TOKEN', 'cloudflare-api-token.dpapi');
}

console.log('======================================================');
console.log('🚀 五子棋全平台极速一键发布引擎 (One-Click Publisher & GitHub Releases)');
console.log(`☁️ Cloudflare 生产部署：${SHOULD_DEPLOY_CLOUDFLARE ? '已启用（显式请求）' : '已跳过（默认）'}`);
console.log('======================================================');

// 0. 发布前严密静态语法与核心完整性安全卡点 (100% 杜绝任何语法错误流出到正式包)
console.log('>>> [0/8] 🛡️ 正在执行发布前代码全量静态语法与完整性校验...');

function runPreflightChecks() {
  let hasError = false;

  // A. 校验 index.html 内所有 script 标签的 JavaScript 语法
  const indexPath = path.join(ROOT_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8');
    const appPath = path.join(ROOT_DIR, 'js', 'app.js');
    const appSource = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';
    const applicationSource = html + '\n' + appSource;
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
    // These three elements are static in index.html. The leaderboard badge is
    // rendered by the lazy-loaded Sky Hub module, so validate it at its source.
    const criticalElements = ['cvs', 'gameResultModal', 'p1NameLabel'];
    for (const elemId of criticalElements) {
      if (!html.includes(`id="${elemId}"`)) {
        console.error(`\n❌ [发布致命拦截] index.html 缺失关键核心 DOM 元素: id="${elemId}"`);
        hasError = true;
      }
    }
    const skyHubPath = path.join(ROOT_DIR, 'js', 'sky-hub.js');
    if (!fs.existsSync(skyHubPath) || !fs.readFileSync(skyHubPath, 'utf8').includes('id="myLadderBadge"')) {
      console.error('\n❌ [发布致命拦截] js/sky-hub.js 缺失天梯分数元素: id="myLadderBadge"');
      hasError = true;
    }

    const criticalFuncs = ['draw', 'makeMove', 'checkWin', 'triggerGameEnd', 'reportMatchResult', 'showGameResultModal', 'resetBoardOnly'];
    for (const funcName of criticalFuncs) {
      if (!applicationSource.includes(`function ${funcName}`)) {
        console.error(`\n❌ [发布致命拦截] index.html 缺失关键核心函数: function ${funcName}`);
        hasError = true;
      }
    }

  for (const relativePath of ['js/app.js', 'js/app.min.js', 'js/account.js', 'js/account.min.js', 'js/replay.js', 'js/replay.min.js', 'js/settings.js', 'js/settings.min.js', 'js/online.js', 'js/online.min.js', 'js/social.js', 'js/social.min.js', 'js/voice.js', 'js/sky-hub.js']) {
      const scriptPath = path.join(ROOT_DIR, relativePath);
      if (!fs.existsSync(scriptPath)) {
        console.error(`\n❌ [发布致命拦截] 缺失应用脚本: ${relativePath}`);
        hasError = true;
        continue;
      }
      try {
        new vm.Script(fs.readFileSync(scriptPath, 'utf8'), { filename: relativePath });
      } catch (err) {
        console.error(`\n❌ [发布致命拦截] ${relativePath} 存在语法错误: ${err.message}`);
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

// 发布前阻断签名密钥、凭据文件误入仓库；密码/令牌只允许通过环境变量、本机 DPAPI 或云端 Secret 注入。
function runSecretFileGuard() {
  if (SHOULD_DEPLOY_CLOUDFLARE && String(process.env.CLOUDFLARE_API_TOKEN || '').trim().length < 20) {
    throw new Error('发布安全门禁拦截：请先运行 setup_gomoku_secret.ps1 -Type Cloudflare，或在当前 PowerShell 会话设置 CLOUDFLARE_API_TOKEN。令牌不会从项目配置文件读取。');
  }
  const sensitivePath = /(^|[\\/])(?:\.env(?:\.[^\\/]+)?|[^\\/]+\.(?:keystore|jks|p12|pfx|pem))$/i;
  const tracked = execSync('git ls-files', { cwd: ROOT_DIR, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const untracked = execSync('git ls-files --others --exclude-standard', { cwd: ROOT_DIR, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const candidates = [...new Set([...tracked, ...untracked])];
  const blocked = candidates.filter(file => {
    if (!sensitivePath.test(file)) return false;
    const baseName = path.basename(file);
    return !/^\.env\.(?:example|sample)$/i.test(baseName);
  });
  if (blocked.length > 0) {
    throw new Error(`发布安全门禁拦截：以下敏感文件不能进入 Git：${blocked.join(', ')}`);
  }
  const rootKey = path.join(ROOT_DIR, 'release.keystore');
  if (fs.existsSync(rootKey)) {
    throw new Error('发布安全门禁拦截：项目根目录仍存在 release.keystore，请使用仓库外签名密钥。');
  }

  // 文件名过滤挡不住把令牌/私钥写进普通源码；对可读文本做内容扫描，命中时只报告路径，不回显秘密。
  const credentialPatterns = [
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i,
    /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/i,
    /\bAKIA[0-9A-Z]{16}\b/i,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i
  ];
  const binaryExtensions = /\.(?:apk|aab|class|gif|ico|jpeg?|jpg|mp3|mp4|png|svg|webp|woff2?|zip)$/i;
  const credentialFiles = [];
  for (const file of candidates) {
    if (binaryExtensions.test(file)) continue;
    const fullPath = path.join(ROOT_DIR, file);
    try {
      if (!fs.existsSync(fullPath)) continue; // 已删除文件会由 git add 记录删除，不应阻断本次发布。
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      const content = fs.readFileSync(fullPath);
      if (content.includes(0)) continue;
      const text = content.toString('utf8');
      if (credentialPatterns.some(pattern => pattern.test(text))) credentialFiles.push(file);
    } catch (error) {
      throw new Error(`发布安全门禁无法读取待发布文件 ${file}：${error.message}`);
    }
  }
  if (credentialFiles.length > 0) {
    throw new Error(`发布安全门禁拦截：普通文件内容疑似包含令牌或私钥，请检查：${credentialFiles.join(', ')}`);
  }
  console.log('✅ 发布安全门禁通过：未发现可提交的签名密钥或凭据文件。');
}

runSecretFileGuard();

if (SHOULD_DEPLOY_CLOUDFLARE) {
  console.log('>>> [安全前置] 正在将生产 D1 完整备份到仓库外目录...');
  execSync('node backup_d1.js', { cwd: ROOT_DIR, stdio: 'inherit' });
}

// 官方版本只保留一套晴空浮岛视觉；发布前解析主页面，避免内联脚本截断。
function runAllThemeSyntaxChecks() {
  const files = ['index.html'];
  for (const file of files) {
    const html = fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    scripts.forEach((script, index) => {
      const code = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
      if (code) new vm.Script(code, { filename: `${file}#script[${index + 1}]` });
    });
  }
  execSync('node --check deploy_worker.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check publish.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check build_official_site.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check official-site/_worker.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check build_ai_worker.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check js/ai_fast.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check js/ai_worker.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  console.log('✅ 官方晴空页面、发布脚本、部署脚本和 AI Worker 语法校验通过。');
}

try {
  runAllThemeSyntaxChecks();
} catch (error) {
  console.error(`\n❌ [发布致命拦截] 官方页面/发布链路语法校验失败：${error.message}`);
  process.exit(1);
}

// 1. 自动解析并递增 Android 版本号
console.log('>>> [1/8] 读取并递增应用版本号...');
let manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
const codeMatch = manifestContent.match(/android:versionCode="(\d+)"/);
const nameMatch = manifestContent.match(/android:versionName="([\d\.]+)"/);

let newCode = 2;
let newName = '1.0.1';

if (codeMatch && nameMatch) {
  const currentCode = parseInt(codeMatch[1], 10);
  newCode = SKIP_VERSION_BUMP ? currentCode : currentCode + 1;

  if (SKIP_VERSION_BUMP) {
    newName = nameMatch[1];
  } else {
    const parts = nameMatch[1].split('.').map(n => parseInt(n, 10));
    if (parts.length === 3) {
      parts[2] += 1;
      newName = parts.join('.');
    } else {
      newName = `1.0.${newCode}`;
    }
  }

  manifestContent = manifestContent.replace(/android:versionCode="\d+"/, `android:versionCode="${newCode}"`);
  manifestContent = manifestContent.replace(/android:versionName="[\d\.]+"/, `android:versionName="${newName}"`);
  fs.writeFileSync(MANIFEST_PATH, manifestContent, 'utf8');
  console.log(`📌 版本号自增完成: ${nameMatch[1]} (Build ${codeMatch[1]}) ➔ v${newName} (Build ${newCode})`);
}

// 2. 同步更新所有 HTML 中的 CURRENT_VERSION_TAG 与 UI 显示
console.log('>>> [2/8] 同步前端版本号到官方晴空页面...');
function formatDisplayVersionName(versionName) {
  const match = String(versionName || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return `v${versionName}`;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch) || patch < 100) {
    return `v${match[1]}.${match[2]}.${match[3]}`;
  }
  return `v${major}.${Math.max(0, Math.floor(patch / 10) - 10)}.${patch % 10}`;
}
const displayVersionTag = formatDisplayVersionName(newName);
const htmlFiles = [
  'index.html',
  path.join('android_src', 'assets', 'index.html')
];
htmlFiles.forEach(f => {
  const fp = path.join(ROOT_DIR, f);
  if (fs.existsSync(fp)) {
    let c = fs.readFileSync(fp, 'utf8');
    c = c.replace(/data-build-version="v[0-9.]+"/g, 'data-build-version="v' + newName + '"');
    c = c.replace(/const CURRENT_VERSION_TAG = 'v[\d\.]+';/, `const CURRENT_VERSION_TAG = 'v${newName}';`);
    c = c.replace(/id="appVersionDisplay"[^>]*>v[\d\.]+<\/(?:div|span)>/g, `id="appVersionDisplay" style="font-size:12px; font-weight:900; color:#0284c7; margin-top:2px;">${displayVersionTag}</div>`);
    c = c.replace(/id="feedbackAppVer">v[\d\.]+<\/span>/g, `id="feedbackAppVer">${displayVersionTag}</span>`);
    fs.writeFileSync(fp, c, 'utf8');
  }
});

// 主应用逻辑已从 index.html 拆到独立源码；版本比较必须继续使用内部版本号。
const appSourcePath = path.join(ROOT_DIR, 'js', 'app.js');
if (fs.existsSync(appSourcePath)) {
  let appSource = fs.readFileSync(appSourcePath, 'utf8');
  appSource = appSource.replace(/const CURRENT_VERSION_TAG = 'v[\d\.]+';/, `const CURRENT_VERSION_TAG = 'v${newName}';`);
  fs.writeFileSync(appSourcePath, appSource, 'utf8');
}

// 同步更新 version.json（兼容旧客户端；新客户端依次尝试 GitHub 代理、ECS 与 Cloudflare 应急备用）
const versionJsonPath = path.join(ROOT_DIR, 'version.json');
const todayStr = new Date().toISOString().split('T')[0];
const releaseHighlights = [
  `🎬 【主题启动】Android 启动过渡匹配晴空棋岛；云海棋台渐显，黑白棋子逐颗落位组成爱心`,
  `🔗 【联机主备】游戏数据和房间连接优先使用 ECS；Cloudflare 只在 ECS 故障时作为备用`,
  `🛠️ 【匹配修复】修正 ECS SQLite 快速匹配状态查询，避免将 waiting 误读为列名引发 HTTP 500`,
  `📦 【更新通道】依次尝试多个 GitHub 反向代理节点、ECS 更新服务，Cloudflare 仅作应急备用；下载仍校验 SHA-256 与 APK 签名`,
  `🔔 【更新反馈】点击检查更新后立即显示检查中状态、进度与按钮反馈`,
  `⚡ 【匹配稳定性】等待中的匹配定时续接，降低并发匹配漏配；进房时校验房间状态，避免误进过期棋盘`,
  `💬 【好友与私聊】邀请、私聊刷新和复制房间号增加即时反馈，社交数据读取统一使用 ECS 主库`,
  `🔌 【联机恢复】应用回到前台时恢复实时连接，并清理旧会话残留，降低好友与房间状态错乱`,
  `👤 【头像一致性】固定账号头像映射覆盖好友、邀请、排行、匹配与棋谱，人机头像不再借用情侣头像`,
  `🧭 【复盘体验】修正结束后返回棋盘复盘入口，并移除复盘画面中的终局与技能临时特效`
];
const releaseUpdateLog = [
  `五子棋 v${newName} 官方正式版更新说明：`,
  ...releaseHighlights
].join('\n\n');
const vJson = {
  versionName: newName,
  versionCode: newCode,
  releaseTag: `v${newName}`,
  publishTime: todayStr,
  updateLog: releaseUpdateLog,
  notes: releaseUpdateLog,
  updateTransport: 'github-proxies-then-ecs-then-cloudflare-emergency'
};
fs.writeFileSync(versionJsonPath, JSON.stringify(vJson, null, 2), 'utf8');
console.log('📌 已同步更新 version.json (GitHub 多节点优先，ECS 与 Cloudflare 票据备用)');

// 官网游戏页与版本回退文本必须和本次客户端发布保持一致；这里只生成仓库产物，
// 是否部署 Cloudflare 仍由显式 --deploy-cloudflare 选项控制。
execSync('node build_official_site.js', { cwd: ROOT_DIR, stdio: 'inherit' });

// 同步更新 backend/worker.js 中的版本号与更新日志
const workerJsPath = path.join(ROOT_DIR, 'backend', 'worker.js');
if (fs.existsSync(workerJsPath)) {
  let wCode = fs.readFileSync(workerJsPath, 'utf8');
  wCode = wCode.replace(/tag:\s*["']v[\d\.]+["']/, `tag: "v${newName}"`);
  wCode = wCode.replace(/updateLog:\s*["'`][\s\S]*?["'`]\s*,/, `updateLog: ${JSON.stringify(vJson.updateLog)},`);
  fs.writeFileSync(workerJsPath, wCode, 'utf8');
  console.log(`📌 已同步更新 backend/worker.js 版本与精准更新日志为 v${newName}`);

  // Pages Worker 是 backend/worker.js 的派生副本。即使本次不部署生产环境，
  // 也保持仓库内派生文件与源文件一致，避免下次显式部署时带入旧代码。
  const pagesBuildDir = path.join(ROOT_DIR, 'pages_build');
  fs.mkdirSync(pagesBuildDir, { recursive: true });
  fs.writeFileSync(path.join(pagesBuildDir, '_worker.js'), wCode, 'utf8');
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

// 6. 执行 Git 本地提交并推送到 GitHub。发布时只暂存明确的发布文件，
// 不允许用 git add . 把截图、临时诊断文件或其他工作树内容带入提交。
  console.log(`>>> [6/8] 执行 Git 提交并推送到 GitHub（目标分支 ${TARGET_BRANCH}）...`);
try {
  const commitMsg = `release: 发布 v${newName} (Build ${newCode}) - 原生APK与GitHub Releases同步就绪`;
  const alreadyStaged = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only'], {
    cwd: ROOT_DIR,
    encoding: 'utf8'
  }).trim();
  if (alreadyStaged) {
    throw new Error(`发布安全门禁拦截：提交前发现已有暂存文件，请先清理暂存区：${alreadyStaged}`);
  }
  const explicitFiles = [
    'PROJECT_HANDOVER.md',
    'android_src/AndroidManifest.xml',
    'android_src/assets/img/startup/sky-cloudsea-v2.webp',
    'android_src/res/drawable/splash_heart_icon.xml',
    'android_src/res/values/strings.xml',
    'android_src/res/values/styles.xml',
    'android_src/src/com/gomoku/master/GomokuSplashView.java',
    'android_src/src/com/gomoku/master/MainActivity.java',
    'backend/worker.js',
    'backend/ecs-host/README.md',
    'backend/ecs-host/server.mjs',
    'build_official_site.js',
    'bundle_single_file.js',
    'build_apk.js',
    'create_html_delta.js',
    'deploy_worker.js',
    'index.html',
    'img/startup/sky-cloudsea-v2.webp',
    'img/startup/startup-01.webp',
    'img/startup/startup-02.webp',
    'img/startup/startup-03.webp',
    'img/startup/startup-04.webp',
    'js/account.js',
    'js/account.min.js',
    'js/app.js',
    'js/app.min.js',
    'js/ecs-config.js',
    'js/online.js',
    'js/online.min.js',
    'js/p2p-network.js',
    'js/replay.js',
    'js/replay.min.js',
    'js/sky-hub.js',
    'js/sky-island.css',
    'js/social.js',
    'js/social.min.js',
    'js/startup-splash.css',
    'js/startup-splash.js',
    'js/voice.js',
    'official-site/index.html',
    'official-site/privacy/index.html',
    'official-site/site.js',
    'official-site/styles.css',
    'official-site/_worker.js',
    'official-site/version.json',
    'pages_build/_worker.js',
    'publish.js',
    'tests/android_splash_smoke.py',
    'tests/api_failover_policy_regression.js',
    'tests/apk_asset_manifest_smoke.py',
    'tests/game_feature_panel_inspect.py',
    'tests/game_social_variants_smoke.py',
    'tests/github_update_proxy_browser_smoke.py',
    'tests/official_site_live_audit.py',
    'tests/official_site_smoke.py',
    'tests/official_site_worker_smoke.py',
    'tests/online_reconnect_smoke.py',
    'tests/online_match_race_smoke.py',
    'tests/match_queue_sqlite_regression.mjs',
    'tests/social_worker_unit.js',
    'tests/worker_unit.js',
    'version.json',
    '五子棋.apk',
    '五子棋大师_单文件版.html'
  ];
  const trackedFiles = new Set(execFileSync('git', ['ls-files'], { cwd: ROOT_DIR, encoding: 'utf8' }).split(/\r?\n/));
  const selectedExplicitFiles = explicitFiles.filter(file => fs.existsSync(path.join(ROOT_DIR, file)) || trackedFiles.has(file));
  execFileSync('git', ['add', '--all', '--', ...selectedExplicitFiles], { cwd: ROOT_DIR, stdio: 'inherit' });
  // Generated trees are scoped to tracked files only; untracked screenshots/diagnostics stay out.
  for (const generatedPath of ['android_src/assets', 'official-site/play']) {
    const trackedGeneratedFiles = execFileSync('git', ['ls-files', '--', generatedPath], {
      cwd: ROOT_DIR,
      encoding: 'utf8'
    }).trim();
    if (trackedGeneratedFiles) {
      execFileSync('git', ['add', '-u', '--', generatedPath], { cwd: ROOT_DIR, stdio: 'inherit' });
    }
  }
  const stagedFiles = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only'], {
    cwd: ROOT_DIR,
    encoding: 'utf8'
  })
    .split(/\r?\n/).map(file => file.trim()).filter(Boolean);
  const allowedGenerated = file => file.startsWith('android_src/assets/') || file.startsWith('official-site/play/');
  const unexpectedFiles = stagedFiles.filter(file => !selectedExplicitFiles.includes(file) && !allowedGenerated(file));
  if (unexpectedFiles.length > 0) {
    throw new Error(`发布安全门禁拦截：发现未授权暂存文件：${unexpectedFiles.join(', ')}`);
  }
  console.log(`✅ 显式暂存文件检查通过，共 ${stagedFiles.length} 个文件。`);
  execFileSync('git', ['commit', '-m', commitMsg], { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`🎉 Git 本地提交成功: ${commitMsg}`);
   // 只允许把本次刚提交的精确 HEAD 推到显式目标分支，并在推送前拒绝覆盖远端新提交。
   const releaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
   const remoteRef = `refs/remotes/origin/${TARGET_BRANCH}`;
   try {
     execFileSync('git', ['show-ref', '--verify', '--quiet', remoteRef], { cwd: ROOT_DIR, stdio: 'ignore' });
     execFileSync('git', ['merge-base', '--is-ancestor', remoteRef, releaseCommit], { cwd: ROOT_DIR, stdio: 'ignore' });
   } catch (_) {
     throw new Error(`发布安全门禁拦截：origin/${TARGET_BRANCH} 含有当前提交未包含的历史，请先 fetch/merge 后再发布。`);
   }
   execFileSync('git', ['push', 'origin', `${releaseCommit}:refs/heads/${TARGET_BRANCH}`], { cwd: ROOT_DIR, stdio: 'inherit' });
   console.log('🎉 GitHub 仓库同步推送成功！');
} catch(e) {
  console.error('❌ Git 提交或推送失败，已停止后续发版与部署：' + e.message);
  process.exit(1);
}

// 7. 自动在 GitHub Releases 上创建发版并上传 APK
console.log('>>> [7/8] 正在将最新 APK 发布到 GitHub Releases...');
const releaseTag = `v${newName}`;
const releaseApk = path.join(ROOT_DIR, 'gomoku.apk');
const releaseHtml = path.join(ROOT_DIR, 'gomoku.html');
fs.copyFileSync(apkPath, releaseApk);
fs.copyFileSync(singleHtmlPath, releaseHtml);

let deltaTempDir = '';
let deltaAssetPath = '';
try {
  const previousTag = execFileSync('gh', ['release', 'view', '--json', 'tagName', '--jq', '.tagName'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  if (previousTag && previousTag !== releaseTag) {
    deltaTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-html-delta-'));
    execFileSync('gh', ['release', 'download', previousTag, '--pattern', 'gomoku.html', '--dir', deltaTempDir], {
      cwd: ROOT_DIR,
      stdio: 'pipe'
    });
    const previousHtml = path.join(deltaTempDir, 'gomoku.html');
    if (fs.existsSync(previousHtml)) {
      const baseSha256 = crypto.createHash('sha256').update(fs.readFileSync(previousHtml)).digest('hex');
      const candidatePath = path.join(deltaTempDir, `gomoku-html-${baseSha256}.gmd`);
      try {
        const summary = execFileSync(process.execPath, [path.join(ROOT_DIR, 'create_html_delta.js'), previousHtml, releaseHtml, candidatePath], {
          cwd: ROOT_DIR,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        deltaAssetPath = candidatePath;
        console.log(`🧩 已生成按上一版精确摘要匹配的 HTML 增量包：${summary}`);
      } catch (error) {
        if (error.status === 2) {
          console.log('ℹ️ 本次 HTML 变动较大，保留完整热更新，不附加增量包。');
        } else {
          console.warn(`⚠️ 增量包生成失败，完整 HTML 更新仍可用：${error.stderr ? error.stderr.toString().trim() : error.message}`);
        }
      }
    }
  }
} catch (error) {
  console.warn(`⚠️ 未能读取上一版 HTML，当前发行仍使用完整热更新：${error.stderr ? error.stderr.toString().trim() : error.message}`);
}

try {
  const releaseTitle = `五子棋 ${releaseTag} 官方正式版 (APK + 单文件HTML双发布)`;
  const deltaNote = deltaAssetPath ? `\n- 🧩 Android 热更新增量包：\`${path.basename(deltaAssetPath)}\` (${(fs.statSync(deltaAssetPath).size / 1024).toFixed(1)} KB；仅匹配上一版 HTML 摘要的设备使用)` : '';
  const releaseNotes = `### 🚀 五子棋 ${releaseTag} 官方全平台正式发布！\n\n${vJson.updateLog}\n\n- 📱 原生 Android 安装包：\`gomoku.apk\` (${apkSize} MB)\n- 💻 全平台浏览器单文件版：\`gomoku.html\` (${htmlSize} KB)${deltaNote}`;
  const releaseNotesPath = path.join(ROOT_DIR, `.release-notes-${releaseTag}.md`);
  fs.writeFileSync(releaseNotesPath, releaseNotes, 'utf8');

   const releaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
   const releaseAssets = ['gomoku.apk', 'gomoku.html', ...(deltaAssetPath ? [deltaAssetPath] : [])];
   execFileSync('gh', ['release', 'create', releaseTag, ...releaseAssets, '--target', releaseCommit, '--title', releaseTitle, '--notes-file', releaseNotesPath], { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`🎉 GitHub Releases 发布成功 (双产物 APK + HTML): ${releaseTag}`);
} catch(err) {
  if (!ALLOW_RELEASE_OVERWRITE) {
    throw new Error(`GitHub Release 创建失败，已禁止自动覆盖既有 Release：${err.message}。如确认需要补传，请显式追加 --allow-release-overwrite。`);
  }
  console.log('⚠️ 已显式允许覆盖，尝试补传当前 Release 资产。');
  const releaseAssets = ['gomoku.apk', 'gomoku.html', ...(deltaAssetPath ? [deltaAssetPath] : [])];
  execFileSync('gh', ['release', 'upload', releaseTag, ...releaseAssets, '--clobber'], { cwd: ROOT_DIR, stdio: 'inherit' });
} finally {
  if (fs.existsSync(releaseApk)) fs.unlinkSync(releaseApk);
  if (fs.existsSync(releaseHtml)) fs.unlinkSync(releaseHtml);
  const releaseNotesPath = path.join(ROOT_DIR, `.release-notes-${releaseTag}.md`);
  if (fs.existsSync(releaseNotesPath)) fs.unlinkSync(releaseNotesPath);
  if (deltaTempDir && fs.existsSync(deltaTempDir)) fs.rmSync(deltaTempDir, { recursive: true, force: true });
}

// Cloudflare 生产部署必须显式开启，避免每次普通发版都触碰线上环境。
if (SHOULD_DEPLOY_CLOUDFLARE) {
  console.log('>>> 正在同步部署 Cloudflare Pages & Worker 官方安全中枢...');
  try {
    execSync('node deploy_worker.js', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('>>> 正在部署天空棋岛官方站（gomoku-home）...');
    // Pages is configured with `master` as the production branch. Supplying
    // the branch is required; omitting it creates a preview deployment even
    // when the release itself was pushed to master.
    execSync('npx wrangler pages deploy official-site --project-name gomoku-home --branch master --commit-dirty=true', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('🎉 官方站 gomoku-home 部署成功！');
  } catch(e) {
    console.error('❌ Worker/Pages 部署失败，发布流程未完成：', e.message);
    process.exit(1);
  }
} else {
  console.log('>>> 已跳过 Cloudflare 生产部署；如需部署，请使用 node publish.js --deploy-cloudflare');
}

console.log('======================================================');
console.log(`✨ 全部发布流程圆满成功！版本: v${newName}`);
console.log('🔒 更新顺序：GitHub 多反向代理节点 → ECS 短时票据 → Cloudflare 应急备用；APK 下载校验哈希与签名');
console.log('======================================================');
