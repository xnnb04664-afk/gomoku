const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// 本机凭据只允许放在仓库外，并使用当前 Windows 用户的 DPAPI 加密。
const REPO_ROOT = path.resolve(__dirname);
const DEFAULT_SECRET_DIR = path.join(
  process.env.USERPROFILE || os.homedir(),
  'Documents',
  'GomokuSecrets'
);

function resolveSecretPath(fileName, explicitPath) {
  const candidate = explicitPath || path.join(
    process.env.GOMOKU_SECRET_DIR || DEFAULT_SECRET_DIR,
    fileName
  );
  const resolved = path.resolve(candidate);
  const repoPrefix = `${REPO_ROOT}${path.sep}`.toLowerCase();
  if (resolved.toLowerCase() === REPO_ROOT.toLowerCase() || resolved.toLowerCase().startsWith(repoPrefix)) {
    throw new Error('本机凭据文件不能位于项目仓库内。');
  }
  return resolved;
}

function decryptWithWindowsDpapi(filePath) {
  if (process.platform !== 'win32') {
    throw new Error('本机 DPAPI 凭据自动读取仅支持 Windows。');
  }

  const script = [
    '$ErrorActionPreference = "Stop"',
    '$encrypted = Get-Content -LiteralPath $env:GOMOKU_DPAPI_FILE -Raw',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$ptr = [IntPtr]::Zero',
    'try {',
    '  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    '  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)',
    '  [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain)))',
    '} finally {',
    '  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }',
    '}'
  ].join('\n');

  const windowsRoot = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const nativeModulePaths = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
    path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  ].join(';');

  // Codex/PowerShell 7 可能会把新版模块路径注入父进程；Windows PowerShell 5.1
  // 加载其中的 Microsoft.PowerShell.Security 会发生类型定义冲突。只给子进程
  // 保留 Windows PowerShell 5.1 的系统模块目录，确保 DPAPI cmdlet 正常加载。
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ],
    {
      env: {
        ...process.env,
        GOMOKU_DPAPI_FILE: filePath,
        PSModulePath: nativeModulePaths
      },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error('无法解密本机凭据，请在当前 Windows 用户下重新运行 setup_gomoku_secret.ps1。');
  }

  const encoded = String(result.stdout || '').replace(/^\uFEFF/, '').trim();
  if (!encoded) {
    throw new Error('本机凭据为空，请重新运行 setup_gomoku_secret.ps1。');
  }

  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch (_) {
    throw new Error('本机凭据文件格式无效，请重新运行 setup_gomoku_secret.ps1。');
  }
}

/**
 * 环境变量优先；环境变量不存在时，从仓库外的 DPAPI 文件加载。
 * 缺少本地文件时返回 false，让调用方继续给出原有的明确错误提示。
 */
function loadSecretIntoEnv(envName, fileName, explicitPath) {
  if (String(process.env[envName] || '').length > 0) return false;

  const filePath = resolveSecretPath(
    fileName,
    explicitPath || process.env[`${envName}_FILE`]
  );
  if (!fs.existsSync(filePath)) return false;

  const value = decryptWithWindowsDpapi(filePath);
  process.env[envName] = value;
  return true;
}

module.exports = {
  DEFAULT_SECRET_DIR,
  loadSecretIntoEnv,
  resolveSecretPath
};
