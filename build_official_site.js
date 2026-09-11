const fs = require('fs');
const path = require('path');

const root = __dirname;
const outDir = path.join(root, 'official-site');
const playDir = path.join(outDir, 'play');

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourcePath, destinationPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

fs.rmSync(playDir, { recursive: true, force: true });
fs.mkdirSync(playDir, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(playDir, 'index.html'));
fs.copyFileSync(path.join(root, 'favicon.png'), path.join(playDir, 'favicon.png'));
fs.copyFileSync(path.join(root, 'favicon.png'), path.join(outDir, 'favicon.png'));
fs.copyFileSync(path.join(root, 'version.json'), path.join(playDir, 'version.json'));
fs.copyFileSync(path.join(root, 'version.json'), path.join(outDir, 'version.json'));
copyTree(path.join(root, 'js'), path.join(playDir, 'js'));
copyTree(path.join(root, 'img'), path.join(playDir, 'img'));

// 官网的游戏页是从根目录单页同步而来；只给官网副本补一个回站入口，
// 不改原始游戏页，因此 APK、单文件版和其他部署入口保持完全不变。
function injectOfficialSiteReturnLink(filePath) {
  const marker = '<!-- official-site-return:v1 -->';
  let source = fs.readFileSync(filePath, 'utf8');
  if (source.includes(marker)) return;
  const style = `${marker}
  <style id="official-site-return-style">
    .official-return-strip {
      position: relative;
      z-index: 100;
      width: min(calc(100% - 24px), 460px);
      margin: 6px auto 0;
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-start;
      pointer-events: none;
    }
    .official-return-strip a {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 10px;
      border: 1px solid rgba(90, 56, 24, .22);
      border-radius: 999px;
      background: rgba(255, 255, 255, .82);
      color: #5a3818;
      box-shadow: 0 2px 8px rgba(90, 56, 24, .12);
      font: 800 11px/1.2 system-ui, -apple-system, "Microsoft YaHei", sans-serif;
      text-decoration: none;
      backdrop-filter: blur(8px);
    }
    .official-return-strip a:focus-visible {
      outline: 3px solid rgba(14, 165, 233, .55);
      outline-offset: 2px;
    }
  </style>`;
  const link = `${marker}\n  <div class="official-return-strip"><a href="/" aria-label="返回五子棋官方站">← 官网</a><a href="/social/" aria-label="打开独立好友中心">👥 好友</a></div>`;
  source = source.replace('</head>', `${style}\n</head>`).replace('<body>', `<body>\n  ${link}`);
  fs.writeFileSync(filePath, source);
}

injectOfficialSiteReturnLink(path.join(playDir, 'index.html'));

console.log(`官方站游戏资源已同步到 ${path.relative(root, playDir)}`);
