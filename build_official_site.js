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

console.log(`官方站游戏资源已同步到 ${path.relative(root, playDir)}`);
