const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = __dirname;
const CONFIG_PATH = path.join(ROOT_DIR, '.cloudflare_config.json');
const WORKER_PATH = path.join(ROOT_DIR, 'backend', 'worker.js');
const PAGES_BUILD_DIR = path.join(ROOT_DIR, 'pages_build');
const PAGES_PROJECT_NAME = 'gomoku-api';

function fail(message) {
  throw new Error(message);
}

if (!fs.existsSync(CONFIG_PATH)) {
  fail('缺少 .cloudflare_config.json；部署凭据必须只保存在本机配置文件中。');
}
if (!fs.existsSync(WORKER_PATH)) {
  fail('缺少 backend/worker.js，已停止部署。');
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (error) {
  fail(`.cloudflare_config.json 不是有效 JSON：${error.message}`);
}

const { accountId, d1DatabaseId, scriptName } = config || {};
// 部署令牌只从当前 PowerShell 会话读取，禁止落盘到项目配置文件。
const deployToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!/^[a-f0-9]{32}$/i.test(String(accountId || ''))) {
  fail('Cloudflare accountId 格式无效，已停止部署。');
}
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(d1DatabaseId || ''))) {
  fail('Cloudflare d1DatabaseId 格式无效，已停止部署。');
}
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(String(scriptName || ''))) {
  fail('Cloudflare scriptName 格式无效，已停止部署。');
}
if (deployToken.length < 20) {
  fail('缺少 CLOUDFLARE_API_TOKEN 环境变量或其格式异常，已停止部署。');
}

const workerCode = fs.readFileSync(WORKER_PATH, 'utf8');
fs.mkdirSync(PAGES_BUILD_DIR, { recursive: true });
fs.writeFileSync(
  path.join(PAGES_BUILD_DIR, 'index.html'),
  '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body style="font-family:sans-serif;text-align:center;padding:120px 20px;"><h1>404 Not Found</h1><p>The requested resource was not found on this server.</p><hr/><div style="color:#888;font-size:12px;">nginx</div></body></html>',
  'utf8'
);
fs.writeFileSync(path.join(PAGES_BUILD_DIR, '_worker.js'), workerCode, 'utf8');

async function deployWorker() {
  console.log(`>>> [1/2] 正在部署到 Cloudflare Workers (脚本: ${scriptName})...`);

  const form = new FormData();
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2024-09-03',
    bindings: [
      {
        type: 'd1',
        name: 'DB',
        id: d1DatabaseId
      }
    ]
  };

  form.append('metadata', JSON.stringify(metadata));
  form.append('worker.js', new Blob([workerCode], { type: 'application/javascript+module' }), 'worker.js');

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${deployToken.trim()}` },
    body: form
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    fail(`Worker 部署返回了无法解析的响应（HTTP ${response.status}）。`);
  }
  if (!response.ok || !data || data.success !== true) {
    const detail = Array.isArray(data?.errors) ? data.errors.map(item => item.message || item.code || '未知错误').join('; ') : `HTTP ${response.status}`;
    fail(`Worker 部署失败：${detail}`);
  }
  console.log('✅ [1/2] Cloudflare Worker deployed successfully!');
}

function deployPages() {
  console.log(`>>> [2/2] 正在部署到 Cloudflare Pages (${PAGES_PROJECT_NAME})...`);
  // cwd 已固定为项目根目录，使用相对目录可避免 Windows cmd 在中文绝对路径上的引号转义问题。
  const deployArgs = ['wrangler', 'pages', 'deploy', 'pages_build', '--project-name', PAGES_PROJECT_NAME, '--branch', 'main', '--commit-dirty=true'];
  const command = deployArgs.join(' ');
  const commandName = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npx';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `npx.cmd ${command}`] : deployArgs;
  execFileSync(commandName, commandArgs, {
    cwd: ROOT_DIR,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: deployToken.trim() },
    stdio: 'inherit'
  });
  console.log('✅ [2/2] Cloudflare Pages deployed successfully!');
}

(async () => {
  await deployWorker();
  deployPages();
})().catch(error => {
  console.error(`❌ 云端部署失败：${error.message}`);
  process.exitCode = 1;
});
