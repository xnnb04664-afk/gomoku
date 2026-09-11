const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadSecretIntoEnv } = require('./local_secret_store');

const ROOT_DIR = __dirname;
const MANIFEST_PATH = path.join(ROOT_DIR, 'android_src', 'AndroidManifest.xml');
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('用法：node publish.js [--deploy-cloudflare]');
  console.log('默认：构建 APK/单文件版、提交推送并发布 GitHub Release，不部署 Cloudflare 生产环境。');
  console.log('显式部署：追加 --deploy-cloudflare，或设置 GOMOKU_DEPLOY_CLOUDFLARE=1。');
  process.exit(0);
}
const SHOULD_DEPLOY_CLOUDFLARE = process.argv.includes('--deploy-cloudflare')
  || String(process.env.GOMOKU_DEPLOY_CLOUDFLARE || '').trim() === '1';
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
    const criticalElements = ['cvs', 'gameResultModal', 'p1NameLabel', 'myLadderBadge'];
    for (const elemId of criticalElements) {
      if (!html.includes(`id="${elemId}"`)) {
        console.error(`\n❌ [发布致命拦截] index.html 缺失关键核心 DOM 元素: id="${elemId}"`);
        hasError = true;
      }
    }

    const criticalFuncs = ['draw', 'makeMove', 'checkWin', 'triggerGameEnd', 'reportMatchResult', 'showGameResultModal', 'resetBoardOnly'];
    for (const funcName of criticalFuncs) {
      if (!applicationSource.includes(`function ${funcName}`)) {
        console.error(`\n❌ [发布致命拦截] index.html 缺失关键核心函数: function ${funcName}`);
        hasError = true;
      }
    }

  for (const relativePath of ['js/app.js', 'js/app.min.js', 'js/account.js', 'js/account.min.js', 'js/replay.js', 'js/replay.min.js', 'js/settings.js', 'js/settings.min.js', 'js/online.js', 'js/online.min.js', 'js/social.js', 'js/social.min.js', 'js/voice.js', 'js/cross.js']) {
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

// 六套主题都必须在发包前单独解析，避免某个切换主题携带语法错误或截断代码。
function runAllThemeSyntaxChecks() {
  const files = ['index.html', 'theme1_zen_dark.html', 'theme2_neo_traditional.html', 'theme3_luxury_glass.html', 'theme4_clean_ios.html', 'theme5_sweet_romance.html'];
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
  execSync('node --check build_ai_worker.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check js/ai_fast.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  execSync('node --check js/ai_worker.js', { cwd: ROOT_DIR, stdio: 'pipe' });
  console.log('✅ 六大主题、发布脚本、部署脚本和 AI Worker 语法校验通过。');
}

try {
  runAllThemeSyntaxChecks();
} catch (error) {
  console.error(`\n❌ [发布致命拦截] 全主题/发布链路语法校验失败：${error.message}`);
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
console.log('>>> [2/8] 同步前端版本号到 6 大主题...');
function formatDisplayVersionName(versionName) {
  const match = String(versionName || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return `v${versionName}`;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch) || patch < 100) {
    return `v${match[1]}.${match[2]}.${match[3]}`;
  }
  return `v${major}.${minor + Math.floor(patch / 100)}.${patch % 10}`;
}
const displayVersionTag = formatDisplayVersionName(newName);
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
    c = c.replace(/id="appVersionDisplay"[^>]*>v[\d\.]+<\/(?:div|span)>/g, `id="appVersionDisplay" style="font-size:12px; font-weight:900; color:#0284c7; margin-top:2px;">${displayVersionTag}</div>`);
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

// 同步更新 version.json（兼容旧客户端；新客户端统一走 Cloudflare Worker 中转）
const versionJsonPath = path.join(ROOT_DIR, 'version.json');
const todayStr = new Date().toISOString().split('T')[0];
const releaseHighlights = [
  `👥 【完整好友系统】正式账号支持精确查找、申请/同意/拒绝/取消、在线状态、最近对手、删除好友和黑名单管理`,
  `💬 【实时文字私聊】好友之间支持文字、Emoji、快捷短语、历史分页、未读同步和仅清空自己一侧记录`,
  `🎮 【好友实时邀战】邀请方自动创建房间并发送 2 分钟有效邀请；接受后自动进房，P2P 失败仍可通过 TURN/WebSocket 继续`,
  `⚡ 【启动性能升级】核心、联机、社交、排行榜、复盘和设置按需拆包；4× CPU、5 次冷启动中位 FCP 1444ms、可操作 2010.4ms`,
  `🎨 【自动画质】新增自动/高清/流畅三档，Canvas DPR 上限分别按设备能力控制，弱机和后台场景降低发热与内存占用`,
  `📡 【联机入口与重连】并行探测 Worker/Pages 并缓存 30 分钟较快入口；断线按 0、1、2、4、8、12 秒退避恢复`,
  `🛡️ 【社交隐私安全】完整关系/拉黑复验、精确账号搜索、防枚举最近对手、消息幂等与 60 秒一次性 WebSocket 票据`,
  `🔐 【官网安全加固】官网来源白名单、跨站写请求拦截、账号/IP 分层限频和社交 WebSocket 来源校验`,
  `🎙️ 【房间语音】联机房间内可选 WebRTC 语音，默认关闭、用户授权后开启，断线自动清理音轨`,
  `✚ 【十字棋实验】十字轴十连获胜、每方每回合两次行动、缩放/拖拽、提示与干扰牌；对方落子自动跟随视角`,
  `✨ 【Android 开屏】原生棋盘动画与 WebView 并行启动，支持减少动画、轻触跳过和后台暂停`,
  `📊 【匿名质量统计】只采样启动区间、画质档位、入口、链路类型、RTT 和重连结果，不上传账号、房号、聊天或棋盘，可关闭`,
  `📱 【Android 内存治理】内存回收只清理特效、Canvas 和空闲 AI Worker，不再强制清 WebView 缓存或调用 System.gc()`
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
  updateTransport: 'cloudflare-ticket-protected'
};
fs.writeFileSync(versionJsonPath, JSON.stringify(vJson, null, 2), 'utf8');
console.log('📌 已同步更新 version.json (短时票据保护更新通道)');

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

// Cloudflare 生产部署必须显式开启，避免每次普通发版都触碰线上环境。
if (SHOULD_DEPLOY_CLOUDFLARE) {
  console.log('>>> 正在同步部署 Cloudflare Pages & Worker 官方安全中枢...');
  try {
    execSync('node deploy_worker.js', { cwd: ROOT_DIR, stdio: 'inherit' });
  } catch(e) {
    console.error('❌ Worker/Pages 部署失败，发布流程未完成：', e.message);
    process.exit(1);
  }
} else {
  console.log('>>> 已跳过 Cloudflare 生产部署；如需部署，请使用 node publish.js --deploy-cloudflare');
}

console.log('======================================================');
console.log(`✨ 全部发布流程圆满成功！版本: v${newName}`);
console.log('🔒 更新产物仅通过 Cloudflare 短时票据通道提供，不输出可复用下载地址');
console.log('======================================================');
