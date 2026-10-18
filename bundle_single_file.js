const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createInlineAiWorkerTag, injectAiWorkerSource } = require('./build_ai_worker');

const ROOT_DIR = __dirname;
const SOURCE_HTML = path.join(ROOT_DIR, 'index.html');
const OUTPUT_FILE = path.join(ROOT_DIR, '五子棋大师_单文件版.html');

execSync('npm run build:app', { cwd: ROOT_DIR, stdio: 'inherit' });

console.log('>>> [1/3] 读取当前最新 index.html 母本代码...');
let html = fs.readFileSync(SOURCE_HTML, 'utf8');
html = injectAiWorkerSource(html, ROOT_DIR);
const backendConfigPath = path.join(ROOT_DIR, 'js', 'ecs-config.js');
if (fs.existsSync(backendConfigPath)) {
  const backendConfigContent = fs.readFileSync(backendConfigPath, 'utf8');
  html = html.replace(
    /\s*<script src="js\/ecs-config\.js"><\/script>/i,
    `\n  <script>\n${backendConfigContent.replace(/<\/script/gi, '<\\/script')}\n  </script>`
  );
}
// 单文件版会把 app.min.js 内联，不能留下指向不存在外部资源的 preload。
html = html.replace(/\s*<link rel="preload" href="js\/app\.min\.js" as="script">/i, '');
// 单文件版内联启动页样式、脚本和开场背景/棋台，保持离线开屏完整。
const startupCssPath = path.join(ROOT_DIR, 'js', 'startup-splash.css');
const startupJsPath = path.join(ROOT_DIR, 'js', 'startup-splash.js');
if (fs.existsSync(startupCssPath)) {
  const startupCssContent = fs.readFileSync(startupCssPath, 'utf8');
  const startupStyleTag = '\n  <style id="startup-splash-inline-style">\n'
    + startupCssContent.replace(/<\/style/gi, '<\\/style')
    + '\n  </style>';
  html = html.replace(
    /\s*<link rel="stylesheet" href="js\/startup-splash\.css">/i,
    startupStyleTag
  );
}
if (fs.existsSync(startupJsPath)) {
  const startupJsContent = fs.readFileSync(startupJsPath, 'utf8');
  const startupScriptTag = '\n  <script>\n/* GOMOKU_STARTUP_SPLASH_BOOTSTRAP_V1 */\n(() => {\n'
    + '  const startSplash = () => {\n'
    + startupJsContent.replace(/<\/script/gi, '<\\/script')
    + '\n  };\n'
    + "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSplash, { once: true });\n"
    + '  else startSplash();\n'
    + '})();\n  </script>';
  html = html.replace(
    /\s*<script defer src="js\/startup-splash\.js"><\/script>/i,
    startupScriptTag
  );
}
[
  { source: 'img/startup/sky-cloudsea-v2.webp', filePath: path.join(ROOT_DIR, 'img', 'startup', 'sky-cloudsea-v2.webp') },
  { source: 'img/game/sky-board-cloudstone.webp', filePath: path.join(ROOT_DIR, 'img', 'game', 'sky-board-cloudstone.webp') }
].forEach(asset => {
  if (!fs.existsSync(asset.filePath)) throw new Error('缺少启动动画资源：' + asset.filePath);
  const dataUrl = 'data:image/webp;base64,' + fs.readFileSync(asset.filePath).toString('base64');
  html = html.split(asset.source).join(dataUrl);
});

console.log('>>> [2/3] 准备可按需载入的联机、音频与头像资源...');

const cherryAudioPath = path.join(ROOT_DIR, 'js', 'assets', 'cherry_bomb_audio.js');
let cherryAudioContent = '';
if (fs.existsSync(cherryAudioPath)) {
  cherryAudioContent = fs.readFileSync(cherryAudioPath, 'utf8');
}

const animeAvatarsPath = path.join(ROOT_DIR, 'js', 'assets', 'anime_avatars.js');
let animeAvatarsContent = '';
if (fs.existsSync(animeAvatarsPath)) {
  animeAvatarsContent = fs.readFileSync(animeAvatarsPath, 'utf8');
}

// 单文件版必须离线可用，因此只在这里把外部头像路径替换为 data URL；
// 普通网页和 Android 页面仍保留外部 JPG，打开头像设置时才请求图片。
function inlineAvatarAssets(content) {
  let result = String(content || '');
  const assets = [
    { source: 'img/anime_avatar_boy.jpg', file: path.join(ROOT_DIR, 'img', 'anime_avatar_boy.jpg') },
    { source: 'img/anime_avatar_girl.jpg', file: path.join(ROOT_DIR, 'img', 'anime_avatar_girl.jpg') },
    { source: 'img/game/ai-opponent-avatars.webp', file: path.join(ROOT_DIR, 'img', 'game', 'ai-opponent-avatars.webp') }
  ];
  for (const asset of assets) {
    if (!fs.existsSync(asset.file)) throw new Error(`缺少头像资源：${asset.file}`);
    const mimeType = asset.source.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,` + fs.readFileSync(asset.file).toString('base64');
    result = result.split(`'${asset.source}'`).join(`'${dataUrl}'`);
    result = result.split(`"${asset.source}"`).join(`"${dataUrl}"`);
  }
  return result;
}
const animeAvatarsInlineContent = inlineAvatarAssets(animeAvatarsContent);

const aiEnginePath = path.join(ROOT_DIR, 'js', 'ai.js');
let aiEngineContent = '';
if (fs.existsSync(aiEnginePath)) {
  aiEngineContent = fs.readFileSync(aiEnginePath, 'utf8');
}

const aiFastPath = path.join(ROOT_DIR, 'js', 'ai_fast.js');
let aiFastContent = '';
if (fs.existsSync(aiFastPath)) {
  aiFastContent = fs.readFileSync(aiFastPath, 'utf8');
}

const socialPath = path.join(ROOT_DIR, 'js', 'social.min.js');
let socialContent = '';
if (fs.existsSync(socialPath)) {
  socialContent = fs.readFileSync(socialPath, 'utf8');
}
const coupleBadgePath = path.join(ROOT_DIR, 'img', 'social', 'couple-badge.png');
if (!fs.existsSync(coupleBadgePath)) {
  throw new Error(`缺少情侣徽章资源：${coupleBadgePath}`);
}
const coupleBadgeDataUrl = 'data:image/png;base64,' + fs.readFileSync(coupleBadgePath).toString('base64');
socialContent = socialContent.replaceAll('img/social/couple-badge.png', coupleBadgeDataUrl);

const skyHubPath = path.join(ROOT_DIR, 'js', 'sky-hub.js');
const skyHubContent = fs.existsSync(skyHubPath) ? fs.readFileSync(skyHubPath, 'utf8') : '';

const skyStylePath = path.join(ROOT_DIR, 'js', 'sky-island.css');
let skyStyleContent = fs.existsSync(skyStylePath) ? fs.readFileSync(skyStylePath, 'utf8') : '';
const matchBackgroundPath = path.join(ROOT_DIR, 'img', 'game', 'sky-island-match-background.png');
if (fs.existsSync(matchBackgroundPath)) {
  const matchBackgroundDataUrl = 'data:image/png;base64,' + fs.readFileSync(matchBackgroundPath).toString('base64');
  skyStyleContent = skyStyleContent.replace(
    /\.\.\/img\/game\/sky-island-match-background\.png/g,
    matchBackgroundDataUrl
  );
}
const inlineImageDataUrl = (filePath, mimeType) => fs.existsSync(filePath)
  ? `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`
  : '';
const lobbyBackgroundDataUrl = inlineImageDataUrl(
  path.join(ROOT_DIR, 'img', 'game', 'sky-island-lobby-background-v2.webp'),
  'image/webp'
);
const panelTextureDataUrl = inlineImageDataUrl(
  path.join(ROOT_DIR, 'img', 'game', 'sky-cloudstone-panel-texture.webp'),
  'image/webp'
);
if (lobbyBackgroundDataUrl) {
  skyStyleContent = skyStyleContent.replaceAll(
    '../img/game/sky-island-lobby-background-v2.webp',
    lobbyBackgroundDataUrl
  );
}
if (panelTextureDataUrl) {
  skyStyleContent = skyStyleContent.replaceAll(
    '../img/game/sky-cloudstone-panel-texture.webp',
    panelTextureDataUrl
  );
}

const voicePath = path.join(ROOT_DIR, 'js', 'voice.js');
let voiceContent = '';
if (fs.existsSync(voicePath)) {
  voiceContent = fs.readFileSync(voicePath, 'utf8');
}

const accountPath = path.join(ROOT_DIR, 'js', 'account.min.js');
let accountContent = '';
if (fs.existsSync(accountPath)) {
  accountContent = fs.readFileSync(accountPath, 'utf8');
}

const replayPath = path.join(ROOT_DIR, 'js', 'replay.min.js');
let replayContent = fs.existsSync(replayPath) ? fs.readFileSync(replayPath, 'utf8') : '';
const settingsPath = path.join(ROOT_DIR, 'js', 'settings.min.js');
const settingsContent = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';

const onlinePath = path.join(ROOT_DIR, 'js', 'online.min.js');
let onlineContent = '';
if (fs.existsSync(onlinePath)) {
  onlineContent = fs.readFileSync(onlinePath, 'utf8');
}

const appPath = path.join(ROOT_DIR, 'js', 'app.min.js');
let appContent = fs.readFileSync(appPath, 'utf8');
replayContent = inlineAvatarAssets(replayContent);
appContent = inlineAvatarAssets(appContent);
const boardArtworkDataUrl = inlineImageDataUrl(
  path.join(ROOT_DIR, 'img', 'game', 'sky-board-cloudstone.webp'),
  'image/webp'
);
if (boardArtworkDataUrl) {
  appContent = appContent.replaceAll('img/game/sky-board-cloudstone.webp', boardArtworkDataUrl);
}
html = html.replace(
  /\s*<script defer src="js\/app\.min\.js"><\/script>/i,
  `\n  <script>\n${appContent.replace(/<\/script/gi, '<\\/script')}\n  </script>`
);
if (skyHubContent) {
  html = html.replace(
    /\s*<script defer src="js\/sky-hub\.js"><\/script>/i,
    `\n  <script>\n${skyHubContent.replace(/<\/script/gi, '<\\/script')}\n  </script>`
  );
}
if (skyStyleContent) {
  html = html.replace(
    /\s*<link rel="stylesheet" href="js\/sky-island\.css">/i,
    `\n  <style id="sky-island-inline-style">\n${skyStyleContent.replace(/<\/style/gi, '<\\/style')}\n  </style>`
  );
}

// 压缩库可能包含 </script> 字符串；内联时必须转义，否则浏览器会提前结束脚本标签。
const escapeInlineScript = content => content.replace(/<\/script/gi, '<\\/script');

const mqttJsPath = path.join(ROOT_DIR, 'js', 'mqtt.min.js');
let mqttJsContent = '';
if (fs.existsSync(mqttJsPath)) {
  mqttJsContent = fs.readFileSync(mqttJsPath, 'utf8');
}

// 单文件保留资源文本但不让浏览器在首屏把它们当作 JavaScript 执行；
// gomokuResourceLoader 会在进入联机、首次操作或打开头像设置时按需注入。
const inlineResourceTag = (name, label, content) => content ? `
  <!-- ${label}（按需载入） -->
  <script type="text/plain" id="gomoku-inline-resource-${name}">
${escapeInlineScript(content)}
  </script>
` : '';

const aiEngineTag = aiEngineContent
  ? `  <!-- 内联强力五子棋 AI 引擎（按需回退） -->\n  <script>\n${escapeInlineScript(aiEngineContent)}\n  </script>\n`
  : '';
const aiExternalTag = /\s*<script defer src="js\/ai\.js"><\/script>/i;
if (aiEngineTag) html = html.replace(aiExternalTag, `\n${aiEngineTag}`);

const styleStartMarker = '  <style>';
const styleStart = html.indexOf(styleStartMarker);
if (styleStart < 0) {
  throw new Error('无法定位页面样式区域');
}
const inlineOptionalResources = [
  inlineResourceTag('mqtt', '内联 MQTT 极速联机引擎（进入联机时载入）', mqttJsContent),
  inlineResourceTag('aiFast', '内联快速五子棋 AI 引擎（Worker 异常时按需回退）', aiFastContent),
  inlineResourceTag('aiCore', '内联兼容五子棋 AI 引擎（双重异常时按需回退）', aiEngineContent),
  inlineResourceTag('audio', '内联樱桃炸弹 MP3 原声 Base64 数据（首次操作时载入）', cherryAudioContent),
  inlineResourceTag('avatars', '内联压缩二次元情侣动漫头像数据（打开头像设置时载入）', animeAvatarsInlineContent)
  ,inlineResourceTag('account', '内联账号扩展、排行榜与反馈模块（首次使用时载入）', accountContent)
  ,inlineResourceTag('replay', '内联战绩与复盘模块（首次查看时载入）', replayContent)
  ,inlineResourceTag('settings', '内联扩展设置模块（首次打开时载入）', settingsContent)
  ,inlineResourceTag('online', '内联联机状态机（进入联机或好友邀战时载入）', onlineContent)
  ,inlineResourceTag('social', '内联好友与私聊模块（登录或打开好友中心时载入）', socialContent)
  ,inlineResourceTag('voice', '内联房间语音模块（用户开启语音时载入）', voiceContent)
].join('');
html = html.slice(0, styleStart) + inlineOptionalResources + '\n' + html.slice(styleStart);

// 内联 img/avatar_boy.png 与 img/avatar_girl.png 的 src
const boyImgPath = path.join(ROOT_DIR, 'img', 'avatar_boy.png');
const girlImgPath = path.join(ROOT_DIR, 'img', 'avatar_girl.png');
if (fs.existsSync(boyImgPath)) {
  const boyB64 = 'data:image/png;base64,' + fs.readFileSync(boyImgPath).toString('base64');
  html = html.replace(/src="img\/avatar_boy\.png"/g, `src="${boyB64}"`);
}
if (fs.existsSync(girlImgPath)) {
  const girlB64 = 'data:image/png;base64,' + fs.readFileSync(girlImgPath).toString('base64');
  html = html.replace(/src="img\/avatar_girl\.png"/g, `src="${girlB64}"`);
}

// 更新页面标题为单文件全功能旗舰版
html = html.replace(/<title>.*?<\/title>/i, '<title>五子棋云屿晴光 · 单文件版</title>');

const updateCompatibilityTags = [
  '<meta name="gomoku-startup-splash-bootstrap" content="dom-ready-v1">',
  // Older installed clients used this marker while validating hot updates.
  '<meta name="gomoku-expedition-level-count" content="48">'
].join('\n  ');
html = html.replace(/<\/head>/i, `  ${updateCompatibilityTags}\n</head>`);

console.log('>>> [3/3] 写入生成单文件版: ' + OUTPUT_FILE);
// 生成包统一去除行尾空格，避免单文件构建造成无意义的 diff 噪声。
fs.writeFileSync(OUTPUT_FILE, html.replace(/[ \t]+$/gm, ''), 'utf8');

const stat = fs.statSync(OUTPUT_FILE);
console.log(`✅ 单文件全功能版打包成功！`);
console.log(`📦 文件路径: ${OUTPUT_FILE}`);
console.log(`📏 文件大小: ${(stat.size / 1024).toFixed(2)} KB (包含五子棋云屿晴光、AI、联机社交与离线资源)`);
