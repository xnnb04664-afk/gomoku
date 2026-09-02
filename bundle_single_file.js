const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const SOURCE_HTML = path.join(ROOT_DIR, 'index.html');
const OUTPUT_FILE = path.join(ROOT_DIR, '五子棋大师_单文件版.html');

console.log('>>> [1/3] 读取当前最新 index.html 母本代码...');
let html = fs.readFileSync(SOURCE_HTML, 'utf8');

console.log('>>> [2/3] 读取并内联 PeerJS 与 樱桃炸弹音频 Base64 数据...');
const peerJsPath = path.join(ROOT_DIR, 'js', 'peerjs.min.js');
let peerJsContent = '';
if (fs.existsSync(peerJsPath)) {
  peerJsContent = fs.readFileSync(peerJsPath, 'utf8');
}

const p2pNetworkPath = path.join(ROOT_DIR, 'js', 'p2p-network.js');
let p2pNetworkContent = '';
if (fs.existsSync(p2pNetworkPath)) {
  p2pNetworkContent = fs.readFileSync(p2pNetworkPath, 'utf8');
}

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

// 压缩库可能包含 </script> 字符串；内联时必须转义，否则浏览器会提前结束脚本标签。
const escapeInlineScript = content => content.replace(/<\/script/gi, '<\\/script');

const mqttJsPath = path.join(ROOT_DIR, 'js', 'mqtt.min.js');
let mqttJsContent = '';
if (fs.existsSync(mqttJsPath)) {
  mqttJsContent = fs.readFileSync(mqttJsPath, 'utf8');
}

// 替换外部脚本引用为完全内联脚本
const peerRegex = /<!-- 引入 PeerJS 免服务器外网穿透联机库[\s\S]*?<script src="https:\/\/fastly\.jsdelivr\.net\/npm\/mqtt[\s\S]*?<\/script>/i;
const cherryRegex = /<script src="js\/assets\/cherry_bomb_audio\.js"><\/script>/i;
const animeRegex = /<script src="js\/assets\/anime_avatars\.js"><\/script>/i;

let inlinedHeadScripts = '';
if (peerJsContent) {
  inlinedHeadScripts += `\n  <!-- 内联 PeerJS 1.5.4 完整生产库 (零外网依赖，离线秒开) -->\n  <script>\n${escapeInlineScript(peerJsContent)}\n  </script>\n`;
}
if (p2pNetworkContent) {
  inlinedHeadScripts += `  <!-- 内联 P2P 优先联机兼容层 -->\n  <script>\n${escapeInlineScript(p2pNetworkContent)}\n  </script>\n`;
}
if (mqttJsContent) {
  inlinedHeadScripts += `  <!-- 内联 MQTT 极速联机引擎 (国内直连，秒级穿透) -->\n  <script>\n${escapeInlineScript(mqttJsContent)}\n  </script>\n`;
}
if (cherryAudioContent) {
  inlinedHeadScripts += `  <!-- 内联 樱桃炸弹 MP3 原声 Base64 数据 -->\n  <script>\n${escapeInlineScript(cherryAudioContent)}\n  </script>\n`;
}
if (animeAvatarsContent) {
  inlinedHeadScripts += `  <!-- 内联 专属二次元情侣动漫头像 Base64 数据 -->\n  <script>\n${escapeInlineScript(animeAvatarsContent)}\n  </script>\n`;
}

// 执行替换：按 head 边界替换，避免 CDN fallback 中嵌套的 <script> 字符串干扰正则。
const headStartMarker = '  <!-- 引入 PeerJS 免服务器外网穿透联机库';
const styleStartMarker = '  <style>';
const headStart = html.indexOf(headStartMarker);
const styleStart = html.indexOf(styleStartMarker, headStart);
if (headStart < 0 || styleStart < 0) {
  throw new Error('无法定位页面 head 脚本区域');
}
html = html.slice(0, headStart) + inlinedHeadScripts.trim() + '\n' + html.slice(styleStart);
html = html.replace(cherryRegex, '');
html = html.replace(animeRegex, '');

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
fs.writeFileSync(OUTPUT_FILE, html, 'utf8');

const stat = fs.statSync(OUTPUT_FILE);
console.log(`✅ 单文件全功能版打包成功！`);
console.log(`📦 文件路径: ${OUTPUT_FILE}`);
console.log(`📏 文件大小: ${(stat.size / 1024).toFixed(2)} KB (包含全套UI、AI、6套换肤、9大干扰卡、命运神抽、果冻HUD、Web Audio合成音效与炸弹音频数据)`);
