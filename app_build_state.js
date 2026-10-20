const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_FILES = [
  'js/app.js',
  'js/account.js',
  'js/replay.js',
  'js/settings.js',
  'js/online.js',
  'js/social.js'
];
const OUTPUT_FILES = SOURCE_FILES.map(file => file.replace(/\.js$/, '.min.js'));
const TOOLCHAIN_FILES = [
  'package.json',
  'package-lock.json'
];
const REUSE_ARG_PREFIX = '--reuse-app-build=';

function readReuseFingerprintArg(argv = process.argv.slice(2)) {
  const values = argv.filter(arg => arg.startsWith(REUSE_ARG_PREFIX));
  if (values.length > 1) throw new Error('只能指定一个 --reuse-app-build 参数。');
  if (!values.length) return '';
  const fingerprint = values[0].slice(REUSE_ARG_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
    throw new Error('--reuse-app-build 必须是 SHA-256 指纹。');
  }
  return fingerprint.toLowerCase();
}

function getAppBuildFingerprint(rootDir = __dirname) {
  const terserRoot = path.join(rootDir, 'node_modules', 'terser');
  const terserFiles = [];
  function collectTerserFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) collectTerserFiles(absolutePath);
      else if (entry.isFile()) terserFiles.push(path.relative(rootDir, absolutePath).replace(/\\/g, '/'));
    }
  }
  if (!fs.existsSync(terserRoot)) throw new Error('计算压缩产物指纹时缺少 node_modules/terser。');
  collectTerserFiles(terserRoot);
  terserFiles.sort();
  const terserShim = path.join('node_modules', '.bin', process.platform === 'win32' ? 'terser.cmd' : 'terser');
  const files = [...TOOLCHAIN_FILES, terserShim, ...terserFiles, ...SOURCE_FILES, ...OUTPUT_FILES];
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }));
  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`计算压缩产物指纹时缺少文件：${relativePath}`);
    const contents = fs.readFileSync(absolutePath);
    hash.update(relativePath);
    hash.update('\0');
    hash.update(String(contents.length));
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function runAppBuild(rootDir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execSync(`${npm} run build:app`, { cwd: rootDir, stdio: 'inherit' });
}

function ensureAppBuild({ rootDir = __dirname, reuseFingerprint = '', runBuild = runAppBuild } = {}) {
  if (reuseFingerprint) {
    const currentFingerprint = getAppBuildFingerprint(rootDir);
    if (currentFingerprint !== reuseFingerprint) {
      throw new Error('拒绝复用发布压缩产物：源码、Terser 配置/工具或 min.js 输出已变化，请重新构建。');
    }
    console.log('✓ 已核验发布压缩产物指纹，复用本轮 min.js');
    return currentFingerprint;
  }

  runBuild(rootDir);
  return getAppBuildFingerprint(rootDir);
}

module.exports = { ensureAppBuild, getAppBuildFingerprint, readReuseFingerprintArg };
