'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = __dirname;
const REPOSITORY = 'xnnb04664-afk/gomoku';
const SITE_ORIGIN = 'https://gomoku-home.pages.dev';
const HTTP_TIMEOUT_MS = 30_000;
const MAX_READ_ATTEMPTS = 3;
const READ_RETRY_DELAYS_MS = [250, 750];
const ACCEPTANCE_CACHE_TTL_MS = 10 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const EXPECTED_SIGNER_SHA256 = '9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e';
const APK_NAME = '五子棋.apk';
const HTML_NAME = '五子棋大师_单文件版.html';

function parseArgs(args) {
  const parsed = { help: false, resume: '' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--resume') {
      if (parsed.resume || !args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error('用法错误：--resume 后必须提供一个本次发布的 run 目录。');
      }
      parsed.resume = args[++i];
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (parsed.help && parsed.resume) throw new Error('--help 不能与 --resume 同时使用。');
  return parsed;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createRunId(date, pid) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${pid}-${crypto.randomBytes(3).toString('hex')}`;
}

function defaultRunner(command, args, options) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let completed = false;
    let timeout = null;
    let killGrace = null;
    let timeoutError = null;
    const finish = result => {
      if (completed) return;
      completed = true;
      if (timeout) clearTimeout(timeout);
      if (killGrace) clearTimeout(killGrace);
      resolve({ stdout, stderr, ...result, error: timeoutError || result.error || null });
    };
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio || 'pipe',
        windowsHide: true
      });
    } catch (error) {
      finish({ status: 1, error });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', error => finish({ status: timeoutError ? 124 : 1, error }));
    child.once('close', (code, signal) => finish({ status: timeoutError ? 124 : Number.isInteger(code) ? code : 1, signal, error: null }));
    if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timeoutError = Object.assign(new Error(`命令超过 ${options.timeoutMs}ms 超时限制。`), {
          name: 'TimeoutError',
          code: 'ETIMEDOUT',
          timedOut: true
        });
        child.kill();
        killGrace = setTimeout(() => {
          try {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          } catch (_) {
            // Keep the timeout result even if the platform rejects the hard-kill signal.
          }
          finish({ status: 124, signal: null, error: timeoutError });
        }, 1000);
        if (typeof killGrace.unref === 'function') killGrace.unref();
      }, options.timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
    }
  });
}

function envValue(env, name) {
  if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) return env[name];
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function redactDiagnostic(value, env) {
  let output = String(value || '');
  for (const [key, secret] of Object.entries(env || {})) {
    if (!/(?:token|secret|password|credential|private.?key)/i.test(key)) continue;
    const text = String(secret || '');
    if (text.length >= 4) output = output.split(text).join('[REDACTED]');
  }
  output = output.replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]');
  return output.trim().slice(-1200);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveRunDirectory(rootDir, inputPath) {
  const expectedBase = path.resolve(rootDir, '.codex-diagnostics', 'official-release');
  const realRoot = fs.realpathSync(rootDir);
  const realBase = fs.realpathSync(expectedBase);
  const canonicalBase = path.resolve(realRoot, '.codex-diagnostics', 'official-release');
  if (process.platform === 'win32'
      ? realBase.toLowerCase() !== canonicalBase.toLowerCase()
      : realBase !== canonicalBase) {
    throw new Error('恢复目录根路径不是项目内 .codex-diagnostics/official-release。');
  }
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(rootDir, inputPath);
  const realCandidate = fs.realpathSync(candidate);
  const sameParent = process.platform === 'win32'
    ? path.dirname(realCandidate).toLowerCase() === realBase.toLowerCase()
    : path.dirname(realCandidate) === realBase;
  if (!sameParent || !/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-\d+-[a-f0-9]{6}$/.test(path.basename(realCandidate))) {
    throw new Error('恢复目录必须是项目 .codex-diagnostics/official-release 下由本入口创建的直接子目录。');
  }
  return realCandidate;
}

function hashDirectory(directory) {
  const root = fs.realpathSync(directory);
  const files = [];
  function visit(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`官网目录含符号链接，无法安全生成指纹：${relPath}`);
      if (stat.isDirectory()) visit(fullPath, relPath);
      else if (stat.isFile()) files.push({ fullPath, relPath });
      else throw new Error(`官网目录含不支持的文件类型：${relPath}`);
    }
  }
  visit(root, '');
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const name = Buffer.from(file.relPath.replace(/\\/g, '/'), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(name.length);
    hash.update(length).update(name).update(fs.readFileSync(file.fullPath));
  }
  return { sha256: hash.digest('hex'), fileCount: files.length };
}

function readVersionSnapshot(rootDir) {
  const manifestPath = path.join(rootDir, 'version.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const version = JSON.parse(manifestBytes.toString('utf8'));
  const tag = String(version.releaseTag || '').trim();
  const build = Number(version.versionCode);
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !Number.isSafeInteger(build) || build < 1) {
    throw new Error('version.json 的 releaseTag/versionCode 无效。');
  }
  if (tag !== `v${version.versionName}`) throw new Error('version.json 的 releaseTag 与 versionName 不一致。');

  const apkPath = path.join(rootDir, APK_NAME);
  const htmlPath = path.join(rootDir, HTML_NAME);
  const apk = fs.readFileSync(apkPath);
  const html = fs.readFileSync(htmlPath);
  const siteTree = hashDirectory(path.join(rootDir, 'official-site'));
  return {
    tag,
    build,
    versionName: String(version.versionName),
    manifestSha256: sha256(manifestBytes),
    apkSha256: sha256(apk),
    apkBytes: apk.length,
    htmlSha256: sha256(html),
    htmlBytes: html.length,
    officialSiteSha256: siteTree.sha256,
    officialSiteFileCount: siteTree.fileCount
  };
}

function sameSnapshot(left, right) {
  const keys = [
    'tag', 'build', 'versionName', 'manifestSha256', 'apkSha256', 'apkBytes',
    'htmlSha256', 'htmlBytes', 'officialSiteSha256', 'officialSiteFileCount'
  ];
  return keys.every(key => left && right && left[key] === right[key]);
}

function resolveAndroidTools(env) {
  const sdkRoot = String(envValue(env, 'ANDROID_SDK_ROOT') || envValue(env, 'ANDROID_HOME') || '').trim();
  if (!sdkRoot || !path.isAbsolute(sdkRoot)) return null;
  let realSdk;
  try {
    realSdk = fs.realpathSync(sdkRoot);
  } catch (_) {
    return null;
  }
  const buildToolsRoot = path.join(realSdk, 'build-tools');
  let versions;
  try {
    versions = fs.readdirSync(buildToolsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => {
        const av = a.split('.').map(Number);
        const bv = b.split('.').map(Number);
        for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
          const diff = (av[i] || 0) - (bv[i] || 0);
          if (diff) return diff;
        }
        return 0;
      }).reverse();
  } catch (_) {
    return null;
  }
  const javaPath = resolveExecutable('java', env);
  if (!javaPath) return null;
  for (const version of versions) {
    const toolsDir = path.join(buildToolsRoot, version);
    const apksignerJar = path.join(toolsDir, 'lib', 'apksigner.jar');
    const zipalignPath = path.join(toolsDir, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
    if (!fs.existsSync(apksignerJar) || !fs.existsSync(zipalignPath)) continue;
    const realApksigner = fs.realpathSync(apksignerJar);
    const realZipalign = fs.realpathSync(zipalignPath);
    if (!isInside(realSdk, realApksigner) || !isInside(realSdk, realZipalign)) continue;
    return { javaPath, apksignerJar: realApksigner, zipalignPath: realZipalign };
  }
  return null;
}

function resolveExecutable(name, env) {
  const candidates = process.platform === 'win32' ? [`${name}.exe`] : [name];
  const pathValue = String(envValue(env, 'PATH') || '');
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const fullPath = path.resolve(directory, candidate);
      try {
        if (fs.statSync(fullPath).isFile()) return fullPath;
      } catch (_) {
        // Continue through PATH entries without logging their contents.
      }
    }
  }
  return null;
}

function defaultEcsVersionUrl(rootDir, env) {
  const override = String(env.GOMOKU_ECS_VERSION_URL || '').trim();
  if (override) return override;
  const configPath = path.join(rootDir, 'js', 'ecs-config.js');
  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/apiBase\s*:\s*['"](https:\/\/[^'"]+)['"]/);
  if (!match) return '';
  return `${match[1].replace(/\/+$/, '')}/api/version`;
}

function validateHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('ECS 验收地址必须是无凭据的 HTTPS URL；使用默认 TLS 证书校验。');
  }
  return url.toString();
}

function httpSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') timeout.unref();
  return controller.signal;
}

async function readHttpBody(fetchFn, url, accept) {
  const response = await fetchFn(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: httpSignal(HTTP_TIMEOUT_MS)
  });
  return response;
}

function responseBytes(response) {
  if (typeof response.arrayBuffer === 'function') return response.arrayBuffer().then(value => Buffer.from(value));
  if (typeof response.buffer === 'function') return response.buffer();
  throw new Error('HTTP mock/response does not provide arrayBuffer().');
}

function responseJson(response) {
  if (typeof response.json === 'function') return response.json();
  if (typeof response.text === 'function') return response.text().then(text => JSON.parse(text));
  throw new Error('HTTP mock/response does not provide json().');
}

function httpStatusError(label, status) {
  const error = new Error(`${label} 返回 HTTP ${status}。`);
  error.httpStatus = Number(status);
  return error;
}

function integrityError(message) {
  const error = new Error(message);
  error.integrityFailure = true;
  return error;
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN',
  'ENETUNREACH', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE',
  'ESOCKETTIMEDOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'
]);

const TLS_CERTIFICATE_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);

function errorChain(error) {
  const chain = [];
  const pending = [error];
  const seen = new Set();
  while (pending.length) {
    const item = pending.shift();
    if (!item || (typeof item !== 'object' && typeof item !== 'function') || seen.has(item)) continue;
    seen.add(item);
    chain.push(item);
    if (item.cause) pending.push(item.cause);
    if (item.errors && Array.isArray(item.errors)) pending.push(...item.errors);
  }
  return chain;
}

function preciseErrorMessage(error) {
  const message = String(error && (error.message || error) || error);
  const code = errorChain(error).map(item => String(item.code || '').toUpperCase()).find(Boolean);
  return code && !message.toUpperCase().includes(code) ? `${message} [${code}]` : message;
}

function isTlsCertificateFailure(error) {
  return errorChain(error).some(item => {
    const code = String(item.code || '').toUpperCase();
    const message = String(item.message || '');
    return TLS_CERTIFICATE_CODES.has(code)
      || /^(?:CERT_|ERR_CERT_|ERR_TLS_CERT_|UNABLE_TO_.*CERT|SELF_SIGNED)/.test(code)
      || /\b(?:certificate|x509)\b/i.test(message)
      || /\b(?:unable to get local issuer certificate|certificate verify failed|self[- ]signed)/i.test(message);
  });
}

function isRetryableTransportText(value) {
  const text = String(value || '');
  return /\b(?:unexpected\s+)?EOF\b/i.test(text)
    || /\bsocket hang up\b/i.test(text)
    || /\bsocket (?:closed|error)\b/i.test(text)
    || /\bconnection (?:reset|refused|aborted)\b/i.test(text)
    || /\bconnection (?:timed out|timeout)\b/i.test(text)
    || /\b(?:request|operation|fetch) (?:timed out|timeout)\b/i.test(text)
    || /\b(?:i\/o|operation) timeout\b/i.test(text)
    || /\bcontext deadline exceeded\b/i.test(text)
    || /\btemporary failure in name resolution\b/i.test(text)
    || /\bgetaddrinfo (?:EAI_AGAIN|ENOTFOUND)\b/i.test(text)
    || /\bno such host\b/i.test(text)
    || /\bnetwork is unreachable\b/i.test(text)
    || /\bfailed to connect\b/i.test(text)
    || /\bTLS handshake timeout\b/i.test(text)
    || /\b(?:ECONNABORTED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|EAI_AGAIN|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT|ERR_STREAM_PREMATURE_CLOSE|ESOCKETTIMEDOUT|UND_ERR_(?:BODY|CONNECT|HEADERS)_TIMEOUT|UND_ERR_SOCKET)\b/i.test(text);
}

function retryableHttpStatus(value) {
  return value === 408 || value === 429 || (value >= 500 && value <= 599);
}

function readErrorType(error) {
  if (error && error.integrityFailure) return 'integrity';
  if (errorChain(error).some(item => item.name === 'SyntaxError')) return 'invalid_json';
  if (isTlsCertificateFailure(error)) return 'tls_certificate';
  const status = Number(error && error.httpStatus);
  if (Number.isInteger(status)) return `http_${status}`;
  for (const item of errorChain(error)) {
    const code = String(item.code || '').toUpperCase();
    if (code) return `network_${code}`;
    if (item.name === 'AbortError' || item.name === 'TimeoutError') return 'timeout';
  }
  if (error && isRetryableTransportText(error.transportText)) return 'network_transport';
  if (errorChain(error).some(item => isRetryableTransportText(item.message))) return 'network_transport';
  if (error && error.integrityFailure) return 'integrity';
  return 'verification';
}

function isRetryableReadError(error) {
  if (!error || error.integrityFailure) return false;
  const chain = errorChain(error);
  if (chain.some(item => item.name === 'SyntaxError')) return false;
  if (isTlsCertificateFailure(error)) return false;
  const status = Number(error.httpStatus);
  if (Number.isInteger(status)) return retryableHttpStatus(status);
  for (const item of chain) {
    const code = String(item.code || '').toUpperCase();
    if (RETRYABLE_NETWORK_CODES.has(code)) return true;
    if (item.name === 'AbortError' || item.name === 'TimeoutError') return true;
  }
  return chain.some(item => isRetryableTransportText(item.message))
    || isRetryableTransportText(error.transportText);
}

function ghHttpStatus(diagnostics) {
  const match = String(diagnostics || '').match(/\bHTTP(?:\s+status)?\s*[:=]?\s*(\d{3})\b/i)
    || String(diagnostics || '').match(/\bstatus\s+code\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function createRuntime(options) {
  const rootDir = path.resolve(options.rootDir || PROJECT_ROOT);
  const env = { ...process.env, ...(options.env || {}) };
  const clock = options.clock || {};
  const now = typeof clock.now === 'function' ? clock.now : () => new Date();
  const monotonic = typeof clock.monotonic === 'function'
    ? clock.monotonic
    : () => Number(process.hrtime.bigint()) / 1e6;
  return {
    rootDir,
    env,
    runCommand: options.runner || defaultRunner,
    fetch: options.fetch || global.fetch,
    loadSecret: options.loadSecret || (() => require('./local_secret_store').loadSecretIntoEnv('CLOUDFLARE_API_TOKEN', 'cloudflare-api-token.dpapi')),
    now,
    monotonic,
    wait: options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    log: options.log || (line => console.log(line)),
    pid: options.pid || process.pid,
    siteOrigin: options.siteOrigin || SITE_ORIGIN,
    runId: options.runId || ''
  };
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function persistRun(run) {
  fs.mkdirSync(run.directory, { recursive: true });
  fs.writeFileSync(path.join(run.directory, 'run.json'), `${JSON.stringify(run.record, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(run.directory, 'timings.json'), `${JSON.stringify({ runId: run.record.runId, timings: run.timings }, null, 2)}\n`, 'utf8');
}

function makeRun(runtime, runId) {
  const date = asDate(runtime.now());
  const base = path.join(runtime.rootDir, '.codex-diagnostics', 'official-release');
  const safeRunId = runId || createRunId(date, runtime.pid);
  if (!/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-\d+-[a-f0-9]{6}$/.test(safeRunId)) {
    throw new Error('run-id 格式无效。');
  }
  const directory = path.join(base, safeRunId);
  if (fs.existsSync(directory)) throw new Error(`run 目录已存在：${safeRunId}`);
  const record = {
    schemaVersion: 1,
    runId: safeRunId,
    createdAt: date.toISOString(),
    state: 'created',
    publishSucceeded: false,
    signatureCheck: { status: 'not_checked', reason: '尚未检查' },
    events: []
  };
  const run = { directory, record, timings: [], runtime };
  persistRun(run);
  return run;
}

function resumeRun(runtime, inputPath) {
  const directory = resolveRunDirectory(runtime.rootDir, inputPath);
  const filePath = path.join(directory, 'run.json');
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (record.schemaVersion !== 1 || !record.runId || path.basename(directory) !== record.runId) {
    throw new Error('run 记录格式无效。');
  }
  if (record.state === 'live_verified') {
    throw new Error('该 run 已完成 LIVE_VERIFIED；--resume 仅处理未完成 run，不会把历史线上验收当作当前状态。');
  }
  if (!record.publishSucceeded || !record.snapshot) {
    throw new Error(`该 run 没有可恢复的成功 publish 快照（状态：${record.state}）。请先人工检查 Git 分支、version.json 和 GitHub Release，再决定下一步；不要对该 run 盲目重跑。`);
  }
  if (record.signatureCheck && record.signatureCheck.status === 'failed') {
    throw new Error('该 run 的 APK 签名/对齐检查已失败；摘要不变时不能恢复部署，请先人工定位发布产物。');
  }
  const timingsPath = path.join(directory, 'timings.json');
  const timingRecord = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  return { directory, record, timings: Array.isArray(timingRecord.timings) ? timingRecord.timings : [], runtime };
}

async function runStage(run, name, action) {
  const { runtime } = run;
  const startDate = asDate(runtime.now());
  const startTick = runtime.monotonic();
  const timing = { name, startedAt: startDate.toISOString(), endedAt: null, durationMs: null, exitCode: null };
  run.timings.push(timing);
  run.record.events.push({ at: startDate.toISOString(), type: 'stage_started', name });
  persistRun(run);
  runtime.log(`开始 ${name}`);
  let exitCode = 0;
  try {
    return await action();
  } catch (error) {
    exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
    timing.error = String(error.message || error).slice(0, 600);
    throw error;
  } finally {
    const endDate = asDate(runtime.now());
    timing.endedAt = endDate.toISOString();
    timing.durationMs = Math.max(0, runtime.monotonic() - startTick);
    timing.exitCode = exitCode;
    run.record.events.push({ at: endDate.toISOString(), type: 'stage_finished', name, exitCode });
    persistRun(run);
    runtime.log(`结束 ${name} ${timing.durationMs.toFixed(0)}ms exit=${exitCode}`);
  }
}

async function checkedCommand(runtime, command, args, options, label) {
  const result = await runtime.runCommand(command, args, options);
  if (result.error || result.status !== 0) {
    const code = Number.isInteger(result.status) ? result.status : 1;
    const redactionEnv = { ...runtime.env, ...(options.env || {}) };
    const diagnostics = [
      redactDiagnostic(result.stderr, redactionEnv),
      redactDiagnostic(result.stdout, redactionEnv)
    ].filter(Boolean).join('\n');
    const detail = diagnostics
      ? `子进程输出（已脱敏）：${diagnostics}`
      : options.stdio === 'inherit' ? '子进程输出已通过终端显示。' : '子进程未返回 stdout/stderr。';
    const error = new Error(`${label}失败，exit=${code}。${detail}`);
    error.exitCode = code;
    if (result.error) error.cause = result.error;
    if (options.retryableNetworkDiagnostics) {
      const status = ghHttpStatus(diagnostics);
      if (status !== null) error.httpStatus = status;
      else error.transportText = diagnostics;
    }
    throw error;
  }
  return result;
}

function currentSnapshot(runtime) {
  return readVersionSnapshot(runtime.rootDir);
}

async function verifySnapshotUnchanged(run) {
  const current = currentSnapshot(run.runtime);
  if (!sameSnapshot(current, run.record.snapshot)) {
    throw new Error('恢复/部署输入已变化：version.json、APK、HTML 或 official-site 目录指纹与成功 publish 时不一致。');
  }
  return current;
}

async function verifyAndroidArtifact(run) {
  const tools = resolveAndroidTools(run.runtime.env);
  if (!tools) {
    run.record.signatureCheck = {
      status: 'not_checked',
      reason: '未能从 ANDROID_SDK_ROOT/ANDROID_HOME 与 PATH 解析 apksigner.jar、zipalign 和 Java。'
    };
    persistRun(run);
    return;
  }
  const apkPath = path.join(run.runtime.rootDir, APK_NAME);
  const env = { ...run.runtime.env };
  try {
    await runStage(run, 'apk.signature_and_alignment', async () => {
      const signerResult = await checkedCommand(run.runtime, tools.javaPath, [
        '-jar', tools.apksignerJar, 'verify', '--verbose', '--print-certs', apkPath
      ], { cwd: run.runtime.rootDir, env, stdio: 'pipe' }, 'apksigner verify');
      const certificateDigests = `${signerResult.stdout || ''}\n${signerResult.stderr || ''}`
        .split(/\r?\n/)
        .map(line => line.match(/Signer\s+#\d+\s+certificate\s+SHA-256\s+digest:\s*([0-9a-f:]+)/i))
        .filter(Boolean)
        .map(match => match[1].replace(/:/g, '').toLowerCase());
      if (certificateDigests.length === 0) throw new Error('apksigner 未报告 APK 证书 SHA-256，不能确认发行证书。');
      if (certificateDigests.some(digest => digest !== EXPECTED_SIGNER_SHA256)) {
        throw new Error(`APK 发行证书 SHA-256 不匹配：期望 ${EXPECTED_SIGNER_SHA256}，检测到 ${certificateDigests.join(', ')}。`);
      }
      await checkedCommand(run.runtime, tools.zipalignPath, [
        '-c', '-P', '16', '-v', '4', apkPath
      ], { cwd: run.runtime.rootDir, env, stdio: 'pipe' }, 'zipalign');
    });
    run.record.signatureCheck = {
      status: 'passed',
      certificateSha256: EXPECTED_SIGNER_SHA256,
      method: 'apksigner verify + zipalign -c -P 16 -v 4'
    };
  } catch (error) {
    run.record.signatureCheck = { status: 'failed', reason: String(error.message || error).slice(0, 600) };
    persistRun(run);
    throw error;
  }
  persistRun(run);
}

async function deployOfficialPages(run) {
  const runtime = run.runtime;
  const binding = sha256(JSON.stringify(run.record.snapshot));
  const previous = run.record.pagesDeployment;
  if (previous && previous.status === 'succeeded' && previous.snapshotBinding === binding) {
    runtime.log('跳过 Pages 部署：此前部署成功，发布快照未变化；仅继续验收。');
    return false;
  }
  await runStage(run, 'pages.deploy_gomoku_home_master', async () => {
    const previousToken = process.env.CLOUDFLARE_API_TOKEN;
    const runtimeToken = runtime.env.CLOUDFLARE_API_TOKEN;
    if (runtimeToken) process.env.CLOUDFLARE_API_TOKEN = runtimeToken;
    else delete process.env.CLOUDFLARE_API_TOKEN;
    let token = '';
    try {
      runtime.loadSecret();
      token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
    } finally {
      if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = previousToken;
    }
    if (token.length < 20) throw new Error('Cloudflare Pages 部署未执行：环境变量或仓库外 DPAPI 中没有有效令牌。');

    const wranglerPath = path.join(runtime.rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (!fs.existsSync(wranglerPath)) throw new Error('找不到 node_modules/wrangler/bin/wrangler.js；请先完成项目依赖安装。');
    const env = { ...runtime.env, CLOUDFLARE_API_TOKEN: token };
    await checkedCommand(
      runtime,
      process.execPath,
      [wranglerPath, 'pages', 'deploy', 'official-site', '--project-name', 'gomoku-home', '--branch', 'master', '--commit-dirty=true'],
      { cwd: runtime.rootDir, env, stdio: 'inherit' },
      'Cloudflare Pages 部署'
    );
  });
  run.record.pagesDeployment = {
    status: 'succeeded',
    succeededAt: asDate(runtime.now()).toISOString(),
    project: 'gomoku-home',
    branch: 'master',
    snapshotBinding: binding
  };
  persistRun(run);
  return true;
}

async function verifyGithubRelease(run) {
  const { runtime } = run;
  const result = await checkedCommand(runtime, 'gh', [
    'api', `repos/${REPOSITORY}/releases/tags/${run.record.snapshot.tag}`
  ], {
    cwd: runtime.rootDir,
    env: runtime.env,
    stdio: 'pipe',
    timeoutMs: HTTP_TIMEOUT_MS,
    retryableNetworkDiagnostics: true
  }, 'GitHub Release API');
  let release;
  try {
    release = JSON.parse(String(result.stdout || ''));
  } catch (_) {
    throw new SyntaxError('GitHub Release API 没有返回有效 JSON。');
  }
  if (release.tag_name !== run.record.snapshot.tag) throw integrityError('GitHub Release tag 与本地版本不一致。');
  if (release.draft === true) throw integrityError('GitHub Release 仍是草稿，不能作为公开发布验收通过。');
  const checks = [
    { name: 'gomoku.apk', sha256: run.record.snapshot.apkSha256 },
    { name: 'gomoku.html', sha256: run.record.snapshot.htmlSha256 }
  ];
  for (const expected of checks) {
    const matches = (release.assets || []).filter(asset => asset.name === expected.name);
    if (matches.length !== 1) throw integrityError(`GitHub Release 缺少唯一附件 ${expected.name}。`);
    if (String(matches[0].digest || '').toLowerCase() !== `sha256:${expected.sha256}`) {
      throw integrityError(`GitHub Release 附件摘要不匹配：${expected.name}。`);
    }
  }
  return {
    tag: release.tag_name,
    assets: checks.map(expected => ({ name: expected.name, digest: `sha256:${expected.sha256}` }))
  };
}

async function verifySiteVersion(run, siteOrigin) {
  const url = `${siteOrigin.replace(/\/+$/, '')}/api/site-version`;
  const response = await readHttpBody(run.runtime.fetch, url, 'application/json');
  if (!response.ok) throw httpStatusError('/api/site-version', response.status);
  const value = await responseJson(response);
  if (value.tag !== run.record.snapshot.tag || Number(value.build) !== run.record.snapshot.build) {
    throw integrityError(`/api/site-version 不匹配：期望 ${run.record.snapshot.tag}/Build ${run.record.snapshot.build}。`);
  }
  return { status: response.status, tag: value.tag, build: Number(value.build) };
}

async function verifySiteApk(run, siteOrigin) {
  const url = `${siteOrigin.replace(/\/+$/, '')}/download/apk`;
  const response = await readHttpBody(run.runtime.fetch, url, 'application/vnd.android.package-archive, application/octet-stream');
  if (!response.ok) throw httpStatusError('/download/apk', response.status);
  const bytes = await responseBytes(response);
  const actual = sha256(bytes);
  if (actual !== run.record.snapshot.apkSha256) throw integrityError('/download/apk 实际 SHA-256 与本地 APK 不一致。');
  return { status: response.status, bytes: bytes.length, sha256: actual };
}

async function verifySiteJavascript(run, siteOrigin) {
  const localPath = path.join(run.runtime.rootDir, 'official-site', 'play', 'js', 'app.min.js');
  const local = fs.readFileSync(localPath);
  const url = `${siteOrigin.replace(/\/+$/, '')}/play/js/app.min.js`;
  const response = await readHttpBody(run.runtime.fetch, url, 'application/javascript, text/javascript, */*');
  if (!response.ok) throw httpStatusError('/play/js/app.min.js', response.status);
  const remote = await responseBytes(response);
  if (!remote.equals(local)) throw integrityError('/play/js/app.min.js 字节内容与本地官网副本不一致。');
  return { status: response.status, bytes: remote.length, sha256: sha256(remote) };
}

function resolveEcsEndpoint(rootDir, env) {
  let value;
  try {
    value = defaultEcsVersionUrl(rootDir, env);
  } catch (_) {
    return `unresolved:${String(env.GOMOKU_ECS_VERSION_URL || '').trim()}`;
  }
  if (!value) return '';
  try {
    return validateHttpsUrl(value);
  } catch (_) {
    return `invalid:${String(value).trim()}`;
  }
}

function uncheckedEcs(reason) {
  return { checked: false, reason };
}

async function verifyEcs(run) {
  let url;
  try {
    url = validateHttpsUrl(defaultEcsVersionUrl(run.runtime.rootDir, run.runtime.env));
  } catch (_) {
    return uncheckedEcs('没有配置可使用标准 HTTPS TLS 校验的 ECS 版本地址。');
  }
  if (!url) return uncheckedEcs('没有配置可使用标准 HTTPS TLS 校验的 ECS 版本地址。');
  let response;
  try {
    response = await readHttpBody(run.runtime.fetch, url, 'application/json');
  } catch (error) {
    if (isRetryableReadError(error)) throw error;
    return uncheckedEcs('ECS 请求或 TLS 校验未完成；未放宽证书校验。');
  }
  if (!response.ok) {
    const error = httpStatusError('ECS 版本接口', response.status);
    if (isRetryableReadError(error)) throw error;
    return uncheckedEcs(`ECS 版本接口返回 HTTP ${response.status}，未纳入验收。`);
  }
  let value;
  try {
    value = await responseJson(response);
  } catch (error) {
    if (isRetryableReadError(error)) throw error;
    return uncheckedEcs('ECS 版本接口不是有效 JSON，未纳入验收。');
  }
  const snapshot = run.record.snapshot;
  if (value.tag !== snapshot.tag
      || String(value.apkSha256 || '').toLowerCase() !== snapshot.apkSha256
      || String(value.htmlSha256 || '').toLowerCase() !== snapshot.htmlSha256) {
    throw integrityError('ECS 版本接口返回了可读取但与本地发布快照不一致的数据。');
  }
  return { checked: true, status: response.status, tag: value.tag, apkSha256: value.apkSha256, htmlSha256: value.htmlSha256 };
}

function acceptanceContext(run) {
  return {
    snapshotSha256: sha256(JSON.stringify(run.record.snapshot)),
    siteOrigin: String(run.runtime.siteOrigin || '').replace(/\/+$/, ''),
    ecsEndpoint: resolveEcsEndpoint(run.runtime.rootDir, run.runtime.env)
  };
}

function canReuseAcceptanceCheck(run, name, binding) {
  const entry = run.record.acceptanceChecks && run.record.acceptanceChecks[name];
  if (!entry || !entry.result || !entry.binding || !entry.checkedAt) return null;
  if (JSON.stringify(entry.binding) !== JSON.stringify(binding)) return null;
  if (name === 'ecs_optional' && entry.result.checked !== true) return null;
  const ageMs = asDate(run.runtime.now()).getTime() - Date.parse(entry.checkedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ACCEPTANCE_CACHE_TTL_MS) return null;
  return entry.result;
}

function appendAcceptanceAttempt(run, name, attempt) {
  if (!run.record.acceptanceAttempts || typeof run.record.acceptanceAttempts !== 'object') {
    run.record.acceptanceAttempts = {};
  }
  if (!Array.isArray(run.record.acceptanceAttempts[name])) run.record.acceptanceAttempts[name] = [];
  run.record.acceptanceAttempts[name].push(attempt);
}

function recoveryCommand(run) {
  const runDirectory = path.relative(run.runtime.rootDir, run.directory);
  return `node release_official.js --resume ${runDirectory}`;
}

function setAcceptanceFailure(run, name, error, attempt) {
  const failures = Array.isArray(run.record.acceptanceFailures) ? run.record.acceptanceFailures : [];
  run.record.acceptanceFailures = failures.filter(item => item.name !== name);
  run.record.acceptanceFailures.push({
    name,
    error: preciseErrorMessage(error).slice(0, 1200),
    attempt
  });
}

async function runAcceptanceCheck(run, name, action, options = {}) {
  const { runtime } = run;
  const binding = acceptanceContext(run);
  const cached = canReuseAcceptanceCheck(run, name, binding);
  if (cached) {
    if (!run.record.acceptance || typeof run.record.acceptance !== 'object') run.record.acceptance = {};
    run.record.acceptance[name] = cached;
    run.record.events.push({ at: asDate(runtime.now()).toISOString(), type: 'acceptance_cache_reused', name });
    persistRun(run);
    runtime.log(`复用验收 ${name}：快照、站点和 ECS 地址一致，成功证据未超过 10 分钟。`);
    return cached;
  }

  if (!run.record.acceptanceChecks || typeof run.record.acceptanceChecks !== 'object') run.record.acceptanceChecks = {};
  if (!run.record.acceptance || typeof run.record.acceptance !== 'object') run.record.acceptance = {};
  delete run.record.acceptance[name];
  delete run.record.acceptanceChecks[name];
  persistRun(run);

  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    const startedAt = asDate(runtime.now()).toISOString();
    const startTick = runtime.monotonic();
    const stageName = attempt === 1 ? `verify.${name}` : `verify.${name}.attempt_${attempt}`;
    try {
      const result = await runStage(run, stageName, action);
      const durationMs = Math.max(0, runtime.monotonic() - startTick);
      const checkedAt = asDate(runtime.now()).toISOString();
      appendAcceptanceAttempt(run, name, {
        attempt,
        status: result && result.checked === false ? 'unchecked' : 'passed',
        startedAt,
        endedAt: checkedAt,
        durationMs,
        delayMs: 0,
        reason: result && result.checked === false ? result.reason : null
      });
      if (!run.record.acceptance || typeof run.record.acceptance !== 'object') run.record.acceptance = {};
      run.record.acceptance[name] = result;
      run.record.acceptanceFailures = (run.record.acceptanceFailures || []).filter(item => item.name !== name);
      if (!(name === 'ecs_optional' && result && result.checked === false)) {
        run.record.acceptanceChecks[name] = { binding, checkedAt, result };
      } else {
        delete run.record.acceptanceChecks[name];
      }
      persistRun(run);
      if (result && result.checked === false) runtime.log(`可选验收项 ${name} 未纳入通过缓存：${result.reason}`);
      else runtime.log(`验收项 ${name} 通过（attempt=${attempt}/${MAX_READ_ATTEMPTS}）。`);
      return result;
    } catch (error) {
      const durationMs = Math.max(0, runtime.monotonic() - startTick);
      const retryable = isRetryableReadError(error);
      const delayMs = retryable && attempt < MAX_READ_ATTEMPTS ? READ_RETRY_DELAYS_MS[attempt - 1] : 0;
      const reason = preciseErrorMessage(error).slice(0, 1200);
      const endedAt = asDate(runtime.now()).toISOString();
      appendAcceptanceAttempt(run, name, {
        attempt,
        status: 'failed',
        startedAt,
        endedAt,
        durationMs,
        delayMs,
        reason,
        failureType: readErrorType(error),
        retryable
      });
      setAcceptanceFailure(run, name, error, attempt);
      run.record.events.push({
        at: endedAt,
        type: 'acceptance_attempt_failed',
        name,
        attempt,
        retryable,
        delayMs,
        durationMs,
        failureType: readErrorType(error),
        error: reason
      });
      persistRun(run);
      runtime.log(`验收项 ${name} 第 ${attempt}/${MAX_READ_ATTEMPTS} 次失败：${reason}`);
      if (delayMs > 0) {
        runtime.log(`重试验收项 ${name}：原因=${reason}，等待 ${delayMs}ms 后进行第 ${attempt + 1}/${MAX_READ_ATTEMPTS} 次。`);
        await runtime.wait(delayMs);
        continue;
      }
      if (options.optional && retryable) {
        const result = uncheckedEcs(`临时请求故障，已尝试 ${attempt} 次；最后错误：${reason}`);
        if (!run.record.acceptance || typeof run.record.acceptance !== 'object') run.record.acceptance = {};
        run.record.acceptance[name] = result;
        delete run.record.acceptanceChecks[name];
        persistRun(run);
        runtime.log(`可选验收项 ${name} 未完成且不阻断发布：${result.reason}`);
        return result;
      }
      runtime.log(`验收失败 ${name}：${reason}；可恢复命令：${recoveryCommand(run)}`);
      throw error;
    }
  }
  throw new Error(`验收项 ${name} 未产生结果。`);
}

async function runConcurrentVerification(run) {
  const siteOrigin = run.runtime.siteOrigin;
  const checks = [
    ['github_release', () => verifyGithubRelease(run)],
    ['pages_site_version', () => verifySiteVersion(run, siteOrigin)],
    ['pages_download_apk', () => verifySiteApk(run, siteOrigin)],
    ['pages_app_js', () => verifySiteJavascript(run, siteOrigin)],
    ['ecs_optional', () => verifyEcs(run), { optional: true }]
  ];
  run.record.acceptanceFailures = [];
  persistRun(run);
  const settled = await Promise.allSettled(checks.map(([name, action, options]) => runAcceptanceCheck(run, name, action, options)));
  const evidence = {};
  const failures = [];
  settled.forEach((item, index) => {
    const name = checks[index][0];
    if (item.status === 'fulfilled') evidence[name] = item.value;
    else failures.push({ name, error: preciseErrorMessage(item.reason).slice(0, 1200) });
  });
  run.record.acceptance = evidence;
  run.record.acceptanceFailures = failures;
  persistRun(run);
  if (failures.length) {
    throw new Error(`线上验收失败：${failures.map(item => `${item.name}：${item.error}`).join('；')}。未输出 LIVE_VERIFIED。`);
  }
  return evidence;
}

function downloadUrls(tag) {
  const encodedTag = encodeURIComponent(tag);
  return {
    officialApk: `${SITE_ORIGIN}/download/apk`,
    githubApk: `https://github.com/${REPOSITORY}/releases/download/${encodedTag}/gomoku.apk`,
    githubHtml: `https://github.com/${REPOSITORY}/releases/download/${encodedTag}/gomoku.html`
  };
}

function createReport(run) {
  const snapshot = run.record.snapshot;
  const acceptance = run.record.acceptance || {};
  const urls = downloadUrls(snapshot.tag);
  const sign = run.record.signatureCheck.status === 'passed'
    ? '已通过 apksigner 与 16 KiB zipalign 检查。'
    : `未自动检查：${run.record.signatureCheck.reason || '工具不可用'}；不能据此宣称签名/对齐通过。`;
  const ecs = acceptance.ecs_optional && acceptance.ecs_optional.checked
    ? `已通过，tag=${acceptance.ecs_optional.tag}。`
    : `未自动验收：${acceptance.ecs_optional && acceptance.ecs_optional.reason || '未配置有效 TLS 地址'}。`;
  return [
    `# ${snapshot.tag} 官方发布验收`,
    '',
    `- Build：${snapshot.build}`,
    `- 本地 APK：${snapshot.apkBytes} bytes，SHA-256：\`${snapshot.apkSha256}\``,
    `- GitHub APK digest：\`${acceptance.github_release.assets.find(asset => asset.name === 'gomoku.apk').digest}\``,
    `- 官网实际 APK：${acceptance.pages_download_apk.bytes} bytes，SHA-256：\`${acceptance.pages_download_apk.sha256}\``,
    `- 本地单文件 HTML：${snapshot.htmlBytes} bytes，SHA-256：\`${snapshot.htmlSha256}\``,
    `- GitHub HTML digest：\`${acceptance.github_release.assets.find(asset => asset.name === 'gomoku.html').digest}\``,
    `- 官网版本接口：${acceptance.pages_site_version.tag} / Build ${acceptance.pages_site_version.build}`,
    `- 官网游戏 JS：${acceptance.pages_app_js.bytes} bytes，SHA-256：\`${acceptance.pages_app_js.sha256}\`，与本地官网副本逐字节一致。`,
    `- APK 签名与对齐：${sign}`,
    `- ECS 匿名版本接口：${ecs}`,
    `- 下载地址：${urls.officialApk}`,
    `- GitHub APK：${urls.githubApk}`,
    `- GitHub HTML：${urls.githubHtml}`,
    '',
    `证据目录：\`.codex-diagnostics/official-release/${run.record.runId}/\``
  ].join('\n');
}

async function finishVerifiedRun(run) {
  const { runtime } = run;
  delete run.record.lastError;
  run.record.state = 'live_verified';
  run.record.liveVerifiedAt = asDate(runtime.now()).toISOString();
  run.record.events.push({ at: run.record.liveVerifiedAt, type: 'live_verified', tag: run.record.snapshot.tag, build: run.record.snapshot.build });
  persistRun(run);

  const urls = downloadUrls(run.record.snapshot.tag);
  runtime.log(`LIVE_VERIFIED tag=${run.record.snapshot.tag} build=${run.record.snapshot.build} APK=${urls.officialApk} GitHubAPK=${urls.githubApk} HTML=${urls.githubHtml}`);

  await runStage(run, 'report.write', async () => {
    fs.writeFileSync(path.join(run.directory, 'report.md'), `${createReport(run)}\n`, 'utf8');
  });
  runtime.log(`证据目录：${path.relative(runtime.rootDir, run.directory)}`);
}

async function continuePublishedRun(run) {
  try {
    await runStage(run, 'release.snapshot_integrity_check', () => verifySnapshotUnchanged(run));
    if (run.record.signatureCheck.status !== 'passed' && run.record.signatureCheck.status !== 'not_checked') {
      throw new Error('之前的 APK 安全检查状态不可恢复。');
    }
    if (run.record.signatureCheck.status !== 'passed') {
      await verifyAndroidArtifact(run);
      if (run.record.signatureCheck.status === 'passed') run.record.signatureCheckAt = asDate(run.runtime.now()).toISOString();
    }
    await runStage(run, 'deploy_inputs.recheck', () => verifySnapshotUnchanged(run));
    await deployOfficialPages(run);
    run.record.acceptance = await runConcurrentVerification(run);
    persistRun(run);
    await finishVerifiedRun(run);
  } catch (error) {
    if (run.record.state !== 'live_verified') {
      run.record.state = run.record.signatureCheck.status === 'failed' ? 'signature_failed' : 'continuation_failed';
      run.record.lastError = String(error.message || error).slice(0, 600);
      run.record.events.push({ at: asDate(run.runtime.now()).toISOString(), type: 'continuation_failed', error: run.record.lastError });
      persistRun(run);
    }
    throw error;
  }
}

async function runRelease(options = {}) {
  const runtime = createRuntime(options);
  if (typeof runtime.fetch !== 'function') throw new Error('当前 Node.js 未提供 fetch；请使用 Node.js 18 或更新版本。');
  let run;
  if (options.resume) {
    run = resumeRun(runtime, options.resume);
    runtime.log(`恢复成功 publish：${run.record.snapshot.tag} / Build ${run.record.snapshot.build}`);
    run.record.events.push({ at: asDate(runtime.now()).toISOString(), type: 'resume_started' });
    persistRun(run);
    await continuePublishedRun(run);
    return run.record;
  }

  const runId = runtime.runId || createRunId(asDate(runtime.now()), runtime.pid);
  run = makeRun(runtime, runId);
  run.record.state = 'publish_running';
  persistRun(run);
  try {
    const publishEnv = { ...runtime.env };
    publishEnv.GOMOKU_DEPLOY_CLOUDFLARE = '0';
    publishEnv.GOMOKU_SKIP_VERSION_BUMP = '0';
    publishEnv.GOMOKU_ALLOW_RELEASE_OVERWRITE = '0';
    delete publishEnv.CLOUDFLARE_API_TOKEN;
    delete publishEnv.CLOUDFLARE_API_TOKEN_FILE;
    await runStage(run, 'publish.github_release', () => checkedCommand(
      runtime,
      process.execPath,
      [path.join(runtime.rootDir, 'publish.js')],
      { cwd: runtime.rootDir, env: publishEnv, stdio: 'inherit' },
      'publish.js'
    ));
  } catch (error) {
    run.record.state = 'publish_failed';
    run.record.lastError = String(error.message || error).slice(0, 600);
    run.record.events.push({ at: asDate(runtime.now()).toISOString(), type: 'publish_failed', error: run.record.lastError });
    persistRun(run);
    throw new Error(`publish.js 未成功；本入口不会自动重跑。请检查 ${path.relative(runtime.rootDir, run.directory)}、Git 分支和 GitHub Release，再手动决定后续操作。原始状态：${run.record.lastError}`);
  }

  run.record.publishSucceeded = true;
  run.record.publishSucceededAt = asDate(runtime.now()).toISOString();
  run.record.state = 'snapshot_pending';
  persistRun(run);
  try {
    run.record.snapshot = await runStage(run, 'publish.snapshot_artifacts', async () => currentSnapshot(runtime));
    run.record.state = 'published_pending_pages';
    run.record.events.push({ at: asDate(runtime.now()).toISOString(), type: 'publish_snapshot_saved' });
    persistRun(run);
  } catch (error) {
    run.record.state = 'publish_succeeded_snapshot_failed';
    run.record.lastError = String(error.message || error).slice(0, 600);
    persistRun(run);
    throw new Error(`publish.js 已成功，但无法保存可恢复的 manifest/APK/HTML/官网树快照；需要人工核对该次 Release。证据：${path.relative(runtime.rootDir, run.directory)}`);
  }

  await continuePublishedRun(run);
  return run.record;
}

function printHelp(log = line => console.log(line)) {
  log('用法：node release_official.js [--resume <run目录>]');
  log('默认顺序执行 publish.js（关闭其 Cloudflare 全量部署）、Cloudflare Pages gomoku-home/master 部署和并行线上只读验收。');
  log('--resume 仅接受本项目 .codex-diagnostics/official-release/ 下 publish 已成功且本地 manifest、APK、HTML、官网目录指纹未变化的未完成 run。');
  log('同一快照、站点地址和 ECS 地址下，10 分钟内成功的验收项可复用；未验收 ECS 不缓存。已 LIVE_VERIFIED 的 run 不接受 resume。');
  log('每次运行证据写入 .codex-diagnostics/official-release/<run-id>/；失败的 publish 不会自动重跑。');
}

async function main(args = process.argv.slice(2), options = {}) {
  const parsed = parseArgs(args);
  const log = options.log || (line => console.log(line));
  if (parsed.help) {
    printHelp(log);
    return 0;
  }
  try {
    await runRelease({ ...options, resume: parsed.resume || options.resume });
    return 0;
  } catch (error) {
    (options.errorLog || (line => console.error(line)))(`❌ ${String(error.message || error)}`);
    return 1;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}

module.exports = {
  main,
  runRelease,
  parseArgs,
  resolveRunDirectory,
  hashDirectory,
  readVersionSnapshot,
  defaultRunner,
  resolveExecutable
};
