const fs = require('fs');
const vm = require('vm');

const files = [
  'index.html',
  'theme1_zen_dark.html',
  'theme2_neo_traditional.html',
  'theme3_luxury_glass.html',
  'theme4_clean_ios.html',
  'theme5_sweet_romance.html'
];

let ok = true;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const scripts = content.match(/<script[\s\S]*?<\/script>/gi) || [];
  scripts.forEach((script, index) => {
    const source = script
      .replace(/^<script[\s\S]*?>/i, '')
      .replace(/<\/script>$/i, '');
    try {
      new vm.Script(source);
    } catch (error) {
      console.error(`ERROR ${file} script #${index}: ${error.message}`);
      ok = false;
    }
  });
}

if (!ok) process.exit(1);
console.log(`ALL_INLINE_SCRIPTS_SYNTAX_OK ${files.length}`);
