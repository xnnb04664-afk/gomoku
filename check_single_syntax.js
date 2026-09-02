const fs = require('fs');
const vm = require('vm');
const content = fs.readFileSync('五子棋大师_单文件版.html', 'utf8');
const scripts = content.match(/<script[\s\S]*?<\/script>/gi) || [];
scripts.forEach((script, index) => {
  const source = script.replace(/^<script[\s\S]*?>/i, '').replace(/<\/script>$/i, '');
  new vm.Script(source);
  console.log(`OK ${index} ${source.length}`);
});
