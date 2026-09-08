const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadSecretIntoEnv } = require('./local_secret_store');

const ROOT_DIR = __dirname;
const backupRoot = path.resolve(
  process.env.GOMOKU_D1_BACKUP_DIR ||
  path.join(process.env.USERPROFILE || os.homedir(), 'Documents', 'GomokuBackups')
);
const repoPrefix = path.resolve(ROOT_DIR).toLowerCase() + path.sep;
if (backupRoot.toLowerCase() === path.resolve(ROOT_DIR).toLowerCase() ||
    backupRoot.toLowerCase().startsWith(repoPrefix)) {
  throw new Error('D1 备份目录必须位于项目仓库之外。');
}

loadSecretIntoEnv('CLOUDFLARE_API_TOKEN', 'cloudflare-api-token.dpapi');
if (String(process.env.CLOUDFLARE_API_TOKEN || '').trim().length < 20) {
  throw new Error('缺少 Cloudflare 本机凭据，无法执行生产 D1 备份。');
}

fs.mkdirSync(backupRoot, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(backupRoot, `gomoku-db-${stamp}.sql`);
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, [
  'wrangler', 'd1', 'export', 'gomoku-db',
  '--remote', '--skip-confirmation',
  '--config', 'wrangler.worker.toml',
  '--output', outputPath
], {
  cwd: ROOT_DIR,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  windowsHide: true,
  shell: true
});

if (result.error || result.status !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
  const detail = result.error ? `${result.error.code || 'spawn'} ${result.error.message || ''}` : `退出码 ${result.status ?? 'unknown'}`;
  throw new Error(`D1 备份失败（${detail.trim()}）。`);
}
console.log(`✅ D1 生产备份完成：${outputPath}`);
