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

const cherryAudioPath = path.join(ROOT_DIR, 'js', 'assets', 'cherry_bomb_audio.js');
let cherryAudioContent = '';
if (fs.existsSync(cherryAudioPath)) {
  cherryAudioContent = fs.readFileSync(cherryAudioPath, 'utf8');
}

// 替换外部脚本引用为完全内联脚本
const peerRegex = /<!-- 引入 PeerJS 免服务器外网穿透联机库[\s\S]*?<script src="https:\/\/unpkg\.com\/peerjs[\s\S]*?<\/script>/i;
const cherryRegex = /<script src="js\/assets\/cherry_bomb_audio\.js"><\/script>/i;

let inlinedHeadScripts = '';
if (peerJsContent) {
  inlinedHeadScripts += `\n  <!-- 内联 PeerJS 1.5.4 完整生产库 (零外网依赖，离线秒开) -->\n  <script>\n${peerJsContent}\n  </script>\n`;
}
if (cherryAudioContent) {
  inlinedHeadScripts += `  <!-- 内联 樱桃炸弹 MP3 原声 Base64 数据 -->\n  <script>\n${cherryAudioContent}\n  </script>\n`;
}

// 执行替换
html = html.replace(peerRegex, inlinedHeadScripts.trim());
html = html.replace(cherryRegex, '');

// 更新页面标题为单文件全功能旗舰版
html = html.replace(/<title>.*?<\/title>/i, '<title>五子棋大师 · 单文件全功能旗舰版 🌐🎴💬🌿</title>');

console.log('>>> [3/3] 写入生成单文件版: ' + OUTPUT_FILE);
fs.writeFileSync(OUTPUT_FILE, html, 'utf8');

const stat = fs.statSync(OUTPUT_FILE);
console.log(`✅ 单文件全功能版打包成功！`);
console.log(`📦 文件路径: ${OUTPUT_FILE}`);
console.log(`📏 文件大小: ${(stat.size / 1024).toFixed(2)} KB (包含全套UI、AI、6套换肤、9大干扰卡、命运神抽、果冻HUD、Web Audio合成音效与炸弹音频数据)`);
