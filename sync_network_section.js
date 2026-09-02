const fs = require('fs');

const sourceFile = 'index.html';
const targetFiles = [
  'theme1_zen_dark.html',
  'theme2_neo_traditional.html',
  'theme3_luxury_glass.html',
  'theme4_clean_ios.html',
  'theme5_sweet_romance.html'
];

const source = fs.readFileSync(sourceFile, 'utf8');
const startMarker = '    // 🌐 极速秒开房间联机核心引擎';
const endMarker = '    function switchOnlineTab';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('未找到主页面联机代码边界');
const networkSection = source.slice(start, end);

for (const file of targetFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const targetStart = content.indexOf(startMarker);
  const targetEnd = content.indexOf(endMarker, targetStart);
  if (targetStart < 0 || targetEnd < 0) throw new Error(`未找到 ${file} 联机代码边界`);
  const updated = content.slice(0, targetStart) + networkSection + content.slice(targetEnd);
  fs.writeFileSync(file, updated, 'utf8');
  console.log(`同步联机代码: ${file}`);
}
