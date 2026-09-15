const fs = require('fs');
const path = require('path');

const WORKER_MARKER = '<script id="gomokuAiWorkerSource" type="text/plain"></script>';
const WORKER_SCRIPT_PATTERN = /<script id="gomokuAiWorkerSource" type="text\/plain">[\s\S]*?<\/script>/i;

function escapeInlineScript(source) {
  // 原始脚本中一旦出现 </script>，HTML 解析器会提前结束 text/plain 标签。
  return String(source || '').replace(/<\/script/gi, '<\\/script');
}

function readAiWorkerSource(rootDir = __dirname) {
  const fastEnginePath = path.join(rootDir, 'js', 'ai_fast.js');
  const workerPath = path.join(rootDir, 'js', 'ai_worker.js');
  // Keep the generated inline worker deterministic across Windows and Unix
  // checkouts.  A CR left immediately before the import replacement can make
  // the tracked Android asset differ by more than a line-ending change.
  const fastEngine = fs.readFileSync(fastEnginePath, 'utf8').replace(/\r\n?/g, '\n');
  const worker = fs.readFileSync(workerPath, 'utf8').replace(/\r\n?/g, '\n');
  const importPattern = /^\s*importScripts\(['"]ai_fast\.js['"]\);\s*/m;
  if (!importPattern.test(worker)) {
    throw new Error('ai_worker.js 缺少 ai_fast.js 导入标记，无法生成内嵌 Worker');
  }
  return worker.replace(importPattern, `${fastEngine}\n`);
}

function injectAiWorkerSource(html, rootDir = __dirname) {
  const inlineTag = createInlineAiWorkerTag(rootDir);
  if (WORKER_SCRIPT_PATTERN.test(html)) return html.replace(WORKER_SCRIPT_PATTERN, inlineTag);
  if (html.includes(WORKER_MARKER)) return html.replace(WORKER_MARKER, inlineTag);
  throw new Error('index.html 缺少 gomokuAiWorkerSource 内嵌标记');
}

function createInlineAiWorkerTag(rootDir = __dirname) {
  const source = escapeInlineScript(readAiWorkerSource(rootDir));
  return `<script id="gomokuAiWorkerSource" type="text/plain">${source}</script>`;
}

module.exports = {
  WORKER_MARKER,
  readAiWorkerSource,
  createInlineAiWorkerTag,
  injectAiWorkerSource
};
