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
const faviconDataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT_DIR, 'favicon.png')).toString('base64');
html = html.replace(/href="favicon\.png"/g, `href="${faviconDataUrl}"`);
// 单文件版会把 app.min.js 内联，不能留下指向不存在外部资源的 preload。
html = html.replace(/\s*<link rel="preload" href="js\/app\.min\.js" as="script">/i, '');
// 启动动画必须在真正的单文件中离线可用：样式、控制器和四张画面
// 一起内联，普通网页与 Android 页面仍然保留轻量外部资源路径。
html = html.replace(/\s*<link rel="preload" href="img\/startup\/startup-01\.webp"[^>]*>/i, '');
const startupCssPath = path.join(ROOT_DIR, 'js', 'startup-splash.css');
const startupJsPath = path.join(ROOT_DIR, 'js', 'startup-splash.js');
if (fs.existsSync(startupCssPath)) {
  const startupCssContent = fs.readFileSync(startupCssPath, 'utf8');
  html = html.replace(
    /\s*<link rel="stylesheet" href="js\/startup-splash\.css">/i,
    `\n  <style id="startup-splash-inline-style">\n${startupCssContent.replace(/<\/style/gi, '<\\/style')}\n  </style>`
  );
}
if (fs.existsSync(startupJsPath)) {
  const startupJsContent = fs.readFileSync(startupJsPath, 'utf8');
  html = html.replace(
    /\s*<script defer src="js\/startup-splash\.js"><\/script>/i,
    // Inline scripts ignore defer. Wait for the splash DOM just as the
    // external deferred script does on the regular page.
    `\n  <script>\n(() => {\n  const startSplash = () => {\n${startupJsContent.replace(/<\/script/gi, '<\\/script')}\n  };\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSplash, { once: true });\n  else startSplash();\n})();\n  </script>`
  );
}
[
  'startup-01.webp',
  'startup-02.webp',
  'startup-03.webp',
  'startup-04.webp'
].forEach(fileName => {
  const source = `img/startup/${fileName}`;
  const filePath = path.join(ROOT_DIR, 'img', 'startup', fileName);
  if (!fs.existsSync(filePath)) throw new Error(`缺少启动动画资源：${filePath}`);
  const dataUrl = 'data:image/webp;base64,' + fs.readFileSync(filePath).toString('base64');
  html = html.split(source).join(dataUrl);
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
    { source: 'img/anime_avatar_girl.jpg', file: path.join(ROOT_DIR, 'img', 'anime_avatar_girl.jpg') }
  ];
  for (const asset of assets) {
    if (!fs.existsSync(asset.file)) throw new Error(`缺少头像资源：${asset.file}`);
    const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(asset.file).toString('base64');
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

const crossPath = path.join(ROOT_DIR, 'js', 'cross.js');
let crossContent = '';
if (fs.existsSync(crossPath)) {
  crossContent = fs.readFileSync(crossPath, 'utf8');
}

const expeditionPath = path.join(ROOT_DIR, 'js', 'expedition.js');
const expeditionContent = fs.existsSync(expeditionPath) ? fs.readFileSync(expeditionPath, 'utf8') : '';

const skyHubPath = path.join(ROOT_DIR, 'js', 'sky-hub.js');
const skyHubContent = fs.existsSync(skyHubPath) ? fs.readFileSync(skyHubPath, 'utf8') : '';

const skyStylePath = path.join(ROOT_DIR, 'js', 'sky-island.css');
const skyStyleContent = fs.existsSync(skyStylePath) ? fs.readFileSync(skyStylePath, 'utf8') : '';

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
const replayContent = fs.existsSync(replayPath) ? fs.readFileSync(replayPath, 'utf8') : '';
const settingsPath = path.join(ROOT_DIR, 'js', 'settings.min.js');
const settingsContent = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';

const onlinePath = path.join(ROOT_DIR, 'js', 'online.min.js');
let onlineContent = '';
if (fs.existsSync(onlinePath)) {
  onlineContent = fs.readFileSync(onlinePath, 'utf8');
}

const appPath = path.join(ROOT_DIR, 'js', 'app.min.js');
const appContent = fs.readFileSync(appPath, 'utf8');
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
  inlineResourceTag('peer', '内联 PeerJS 联机库（进入联机时载入）', fs.readFileSync(path.join(ROOT_DIR, 'js', 'peerjs.min.js'), 'utf8')),
  inlineResourceTag('p2p', '内联 P2P 网络模块（进入联机时载入）', fs.readFileSync(path.join(ROOT_DIR, 'js', 'p2p-network.js'), 'utf8')),
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
  ,inlineResourceTag('cross', '内联十字棋实验模式（打开实验棋盘时载入）', crossContent)
  ,inlineResourceTag('expedition', '内联天空棋岛残局远征（打开远征时载入）', expeditionContent)
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
html = html.replace(/<title>.*?<\/title>/i, '<title>五子棋大师 · 单文件全功能旗舰版 🌐🎴💬🌿</title>');

console.log('>>> [3/3] 写入生成单文件版: ' + OUTPUT_FILE);
// 生成包统一去除行尾空格，避免单文件构建造成无意义的 diff 噪声。
fs.writeFileSync(OUTPUT_FILE, html.replace(/[ \t]+$/gm, ''), 'utf8');

const stat = fs.statSync(OUTPUT_FILE);
console.log(`✅ 单文件全功能版打包成功！`);
console.log(`📦 文件路径: ${OUTPUT_FILE}`);
console.log(`📏 文件大小: ${(stat.size / 1024).toFixed(2)} KB (包含晴空棋岛UI、AI、残局远征、联机社交与离线资源)`);
