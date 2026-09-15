const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadSecretIntoEnv } = require('./local_secret_store');

const ROOT_DIR = __dirname;
// The deployment config is intentionally kept outside Git.  A worktree may
// point at the operator's existing local config without copying it into the
// checkout (and without changing the main project directory).
const CONFIG_PATH = path.resolve(
  process.env.GOMOKU_CLOUDFLARE_CONFIG || path.join(ROOT_DIR, '.cloudflare_config.json'),
);
const WORKER_PATH = path.join(ROOT_DIR, 'backend', 'worker.js');
const PAGES_BUILD_DIR = path.join(ROOT_DIR, 'pages_build');
const PAGES_PROJECT_NAME = 'gomoku-api';
const CLOUDFLARE_REQUEST_TIMEOUT_MS = 30000;

function fail(message) {
  throw new Error(message);
}

async function fetchWithTimeout(resource, init = {}, timeoutMs = CLOUDFLARE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 部署令牌优先使用当前环境变量；未设置时自动读取仓库外的本机 DPAPI 凭据。
loadSecretIntoEnv('CLOUDFLARE_API_TOKEN', 'cloudflare-api-token.dpapi');

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
// 部署令牌只从当前会话或仓库外 DPAPI 凭据读取，禁止落盘到项目配置文件。
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

function deployWorker() {
  console.log(`>>> [1/2] 正在部署到 Cloudflare Workers (脚本: ${scriptName})...`);
  // 由 Wrangler 管理 Durable Object migration tag，避免重复执行同一个迁移时
  // 被 Cloudflare 拒绝；同时保留本机 API Token 自动注入和非交互部署能力。
  const deployArgs = ['wrangler', 'deploy', '--config', 'wrangler.worker.toml'];
  const command = deployArgs.join(' ');
  const commandName = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npx';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `npx.cmd ${command}`] : deployArgs;
  execFileSync(commandName, commandArgs, {
    cwd: ROOT_DIR,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: deployToken.trim() },
    input: 'y\n',
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 120000
  });
  console.log('✅ [1/2] Cloudflare Worker deployed successfully!');
}

function deployPages() {
  console.log(`>>> [2/2] 正在部署到 Cloudflare Pages (${PAGES_PROJECT_NAME})...`);
  // cwd 已固定为项目根目录，使用相对目录可避免 Windows cmd 在中文绝对路径上的引号转义问题。
  const deployArgs = [
    'wrangler', 'pages', 'deploy', 'pages_build',
    '--project-name', PAGES_PROJECT_NAME,
    '--branch', 'main',
    '--commit-dirty=true'
  ];
  const command = deployArgs.join(' ');
  const commandName = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npx';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `npx.cmd ${command}`] : deployArgs;
  execFileSync(commandName, commandArgs, {
    cwd: ROOT_DIR,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: deployToken.trim() },
    stdio: 'inherit',
    timeout: 120000
  });
  console.log('✅ [2/2] Cloudflare Pages deployed successfully!');
}

(async () => {
  deployWorker();
  deployPages();
})().catch(error => {
  console.error(`❌ 云端部署失败：${error.message}`);
  process.exitCode = 1;
});
