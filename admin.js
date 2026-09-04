/**
 * 🛠️ 五子棋大师 - 开发者专用云端数据管理工具（Cloudflare D1）
 *
 * 只在受信任的开发机上运行。本工具读取项目根目录的
 * .cloudflare_config.json；Cloudflare API Token 只从当前进程环境变量读取，绝不落盘。
 *
 * 常用命令：
 *   node admin.js users [--json]
 *   node admin.js user <UID 或用户名> [--json]
 *   node admin.js set-pwd <UID 或用户名>
 *   node admin.js set-nickname <UID 或用户名> <新昵称>
 *   node admin.js set-score <UID 或用户名> <积分>
 *   node admin.js lock <UID 或用户名> [分钟]
 *   node admin.js unlock <UID 或用户名>
 *   node admin.js sql "SELECT ..."
 *   node admin.js sql --write "UPDATE ..." [--yes]
 *
 * 写操作默认要求输入 CONFIRM；自动化场景可显式追加 --yes。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const CONFIG_FILE = path.join(__dirname, '.cloudflare_config.json');
// 必须与 Cloudflare Worker 保持一致；Workers WebCrypto 不接受超过 100000 的迭代次数。
const PBKDF2_ITERATIONS = 100000;
const MAX_NAME_LENGTH = 16;
const MAX_SCORE = 99999;

function fail(message) {
  throw new Error(message);
}

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('❌ 缺少 .cloudflare_config.json 配置文件！');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (err) {
  console.error('❌ .cloudflare_config.json 不是有效 JSON。');
  process.exit(1);
}

const { accountId, d1DatabaseId } = config;
const deployToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!accountId || !deployToken || !d1DatabaseId) {
  console.error('❌ Cloudflare 配置或 CLOUDFLARE_API_TOKEN 环境变量不完整。');
  process.exit(1);
}

function parseFlags(rawArgs) {
  const flags = { json: false, write: false, yes: false };
  const args = [];
  for (const arg of rawArgs) {
    if (arg === '--json') flags.json = true;
    else if (arg === '--write') flags.write = true;
    else if (arg === '--yes') flags.yes = true;
    else args.push(arg);
  }
  return { args, flags };
}

function printHelp() {
  console.log(`
🛠️ 五子棋开发者数据管理命令指南：
  node admin.js users [--json]                         - 列出用户（不显示敏感字段）
  node admin.js user <UID或用户名> [--json]            - 查看指定用户安全档案
  node admin.js set-pwd <UID或用户名>                  - 交互式重置密码（PBKDF2）
  node admin.js set-pwd <UID或用户名> <新密码>          - 重置密码（不回显密码）
  node admin.js set-nickname <UID或用户名> <新昵称>    - 同步修改用户名和昵称
  node admin.js set-score <UID或用户名> <积分>         - 修改天梯积分
  node admin.js lock <UID或用户名> [分钟]              - 临时锁定账号（默认 60 分钟）
  node admin.js unlock <UID或用户名>                   - 解锁账号并清除登录失败计数
  node admin.js feedback [--json]                     - 查看玩家提交的意见与Bug反馈
  node admin.js sql "SELECT ..."                      - 执行只读 SQL
  node admin.js sql --write "UPDATE ..." [--yes]      - 明确授权后执行写 SQL

⚠️ 所有写操作默认要求输入 CONFIRM；自动化使用 --yes 时请确认命令来源可靠。
`);
}

function cleanName(value, label = '名称') {
  if (typeof value !== 'string') fail(`${label}必须是文本。`);
  const cleaned = value.trim().replace(/[<>'"`&]/g, '').slice(0, MAX_NAME_LENGTH);
  if (!cleaned) fail(`${label}不能为空。`);
  return cleaned;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(
    password,
    `GOMOKU_PASSWORD_${salt}`,
    PBKDF2_ITERATIONS,
    32,
    'sha256'
  ).toString('hex');
}

function generateSecureHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function queryD1(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1DatabaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${deployToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const errorDetail = (data.errors && data.errors[0] && data.errors[0].message) ? data.errors[0].message : 'D1 执行错误，请检查网络、权限或 SQL。';
    throw new Error(errorDetail);
  }
  return data.result && data.result[0] ? data.result[0].results : [];
}

function promptLine(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('操作已取消。'));
    });
  });
}

function promptSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return promptLine(question);
  }

  return new Promise((resolve, reject) => {
    let answer = '';
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };

    const onData = chunk => {
      const input = chunk.toString('utf8');
      for (const char of input) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('操作已取消。'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(answer);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          answer = answer.slice(0, -1);
        } else if (char >= ' ') {
          answer += char;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function confirmMutation(description, flags) {
  if (flags.yes) return true;
  const answer = await promptLine(`⚠️ ${description}\n请输入 CONFIRM 确认，其他输入取消：`);
  if (answer === 'CONFIRM') return true;
  console.log('已取消，数据库未修改。');
  return false;
}

const BASE_USER_COLUMNS = `uid, username, nickname, avatar, score, wins, total_games,
  locked_until, created_at, updated_at`;
let usersTableColumns = null;

async function getUsersTableColumns() {
  if (usersTableColumns) return usersTableColumns;
  const rows = await queryD1('PRAGMA table_info(users)');
  usersTableColumns = new Set(rows.map(row => String(row.name)));
  return usersTableColumns;
}

async function getSafeUserColumns() {
  const columns = await getUsersTableColumns();
  const extraColumns = [];
  if (columns.has('password_algo')) extraColumns.push('password_algo');
  return extraColumns.length ? `${BASE_USER_COLUMNS}, ${extraColumns.join(', ')}` : BASE_USER_COLUMNS;
}

async function findUser(identifier) {
  if (!identifier) fail('请输入 UID 或账号用户名。');
  const safeUserColumns = await getSafeUserColumns();
  const rows = await queryD1(
    `SELECT ${safeUserColumns} FROM users WHERE uid = ? OR username = ? LIMIT 1`,
    [String(identifier), String(identifier)]
  );
  return rows[0] || null;
}

function safeUserView(user) {
  if (!user) return null;
  const lockedUntil = Number(user.locked_until) || 0;
  return {
    uid: user.uid,
    username: user.username,
    nickname: user.nickname,
    avatar: typeof user.avatar === 'string' && user.avatar.length > 16 ? '[自定义头像]' : user.avatar,
    score: Number(user.score) || 0,
    wins: Number(user.wins) || 0,
    total_games: Number(user.total_games) || 0,
    password_algo: user.password_algo || '未设置（需管理员重置）',
    status: lockedUntil > Date.now() ? `锁定至 ${new Date(lockedUntil).toISOString()}` : '正常',
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

async function listUsers(flags) {
  const safeUserColumns = await getSafeUserColumns();
  const rows = await queryD1(`
    SELECT ${safeUserColumns}
    FROM users
    ORDER BY score DESC, created_at ASC
  `);
  const users = rows.map(safeUserView);
  if (flags.json) {
    console.log(JSON.stringify(users, null, 2));
    return;
  }
  console.log(`\n📊 全服已注册玩家总数: ${users.length} 位\n`);
  console.table(users.map((u, index) => ({
    '序号': index + 1,
    '玩家 UID': u.uid,
    '用户名': u.username,
    '昵称': u.nickname,
    '积分': u.score,
    '胜场/总场': `${u.wins}/${u.total_games}`,
    '状态': u.status,
    '密码策略': u.password_algo
  })));
}

async function getUserDetail(identifier, flags) {
  const user = await findUser(identifier);
  if (!user) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }
  const safeUser = safeUserView(user);
  if (flags.json) {
    console.log(JSON.stringify(safeUser, null, 2));
    return;
  }
  console.log('\n📄 玩家安全档案：');
  console.table([safeUser]);
  console.log('🔒 已隐藏密码哈希、Salt、Token、密保问题和密保答案。\n');
}

async function resetUserPassword(identifier, suppliedPassword, flags) {
  const user = await findUser(identifier);
  if (!user) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }

  const tableColumns = await getUsersTableColumns();
  const needsPasswordAlgoMigration = !tableColumns.has('password_algo');
  const migrationHint = needsPasswordAlgoMigration ? '，并补齐旧数据库缺少的密码策略字段' : '';
  if (!(await confirmMutation(`将重置玩家 ${user.uid}（${user.username}）的密码${migrationHint}，并使现有登录凭证失效。`, flags))) return;

  const password = suppliedPassword || await promptSecret('请输入新密码（不显示输入内容）：');
  const confirmPassword = suppliedPassword ? password : await promptSecret('请再次输入新密码：');
  if (password !== confirmPassword) fail('两次输入的密码不一致。');
  if (password.length < 6 || password.length > 32) fail('新密码长度须为 6~32 位。');

  const salt = generateSecureHex(16);
  const passwordHash = hashPassword(password, salt);
  if (needsPasswordAlgoMigration) {
    await queryD1("ALTER TABLE users ADD COLUMN password_algo TEXT DEFAULT 'pbkdf2'");
    tableColumns.add('password_algo');
  }
  await queryD1(`
    UPDATE users
    SET password_hash = ?, salt = ?, password_algo = 'pbkdf2',
        token = NULL, token_expires_at = 0,
        failed_login_count = 0, locked_until = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE uid = ?
  `, [passwordHash, salt, user.uid]);

  console.log(`✅ UID ${user.uid} 的密码已重置，已使用 PBKDF2，并已使旧登录凭证失效。`);
}

async function setNickname(identifier, newNickname, flags) {
  const user = await findUser(identifier);
  if (!user) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }
  const nickname = cleanName(newNickname, '昵称');
  const conflict = await queryD1(
    'SELECT uid FROM users WHERE (username = ? OR nickname = ?) AND uid != ? LIMIT 1',
    [nickname, nickname, user.uid]
  );
  if (conflict.length) fail(`昵称【${nickname}】已被其他用户占用。`);
  if (!(await confirmMutation(`将把 UID ${user.uid} 的用户名和昵称同步改为【${nickname}】。`, flags))) return;

  await queryD1(
    'UPDATE users SET username = ?, nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?',
    [nickname, nickname, user.uid]
  );
  console.log(`✅ UID ${user.uid} 的用户名和昵称已同步为：${nickname}`);
}

async function setScore(identifier, scoreText, flags) {
  const user = await findUser(identifier);
  if (!user) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }
  if (!/^-?\d+$/.test(String(scoreText || ''))) fail('积分必须是整数。');
  const score = Number(scoreText);
  if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) {
    fail(`积分范围必须是 0~${MAX_SCORE}。`);
  }
  if (!(await confirmMutation(`将把 UID ${user.uid} 的积分从 ${user.score} 改为 ${score}。`, flags))) return;
  await queryD1(
    'UPDATE users SET score = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?',
    [score, user.uid]
  );
  console.log(`✅ UID ${user.uid} 的积分已更新为 ${score}。`);
}

async function lockUser(identifier, minutesText, flags) {
  const user = await findUser(identifier);
  if (!user) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }
  const rawMinutes = minutesText || '60';
  if (!/^\d+$/.test(rawMinutes)) fail('锁定时长必须是正整数分钟。');
  const minutes = Number(rawMinutes);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 43200) {
    fail('锁定时长范围必须是 1~43200 分钟。');
  }
  if (!(await confirmMutation(`将锁定 UID ${user.uid} ${minutes} 分钟，并使现有登录凭证失效。`, flags))) return;
  const lockedUntil = Date.now() + minutes * 60 * 1000;
  await queryD1(`
    UPDATE users
    SET locked_until = ?, failed_login_count = 5,
        token = NULL, token_expires_at = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE uid = ?
  `, [lockedUntil, user.uid]);
  console.log(`✅ UID ${user.uid} 已锁定至 ${new Date(lockedUntil).toISOString()}。`);
}

async function unlockUser(identifier, flags) {
  const user = await findUser(identifier);
  if (!user) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }
  if (!(await confirmMutation(`将解锁 UID ${user.uid} 并清除登录失败计数。`, flags))) return;
  await queryD1(`
    UPDATE users
    SET locked_until = 0, failed_login_count = 0, updated_at = CURRENT_TIMESTAMP
    WHERE uid = ?
  `, [user.uid]);
  console.log(`✅ UID ${user.uid} 已解锁。`);
}

function normalizeSql(sql) {
  if (!sql) fail('请提供 SQL 语句。');
  const normalized = String(sql).trim().replace(/;+\s*$/, '');
  if (!normalized || normalized.includes(';')) fail('只允许执行单条 SQL 语句。');
  return normalized;
}

function isReadOnlySql(sql) {
  if (/^(select|explain)\b/i.test(sql)) return true;
  if (/^pragma\s+(table_info|table_xinfo|index_list|foreign_key_list)\b/i.test(sql)) return true;
  if (/^with\b/i.test(sql) && !/\b(insert|update|delete|replace|alter|drop|create)\b/i.test(sql)) return true;
  return false;
}

async function runCustomSql(sql, flags) {
  const normalized = normalizeSql(sql);
  const readOnly = isReadOnlySql(normalized);
  if (!readOnly && !flags.write) {
    fail('SQL 默认仅允许 SELECT/EXPLAIN；写操作请使用：node admin.js sql --write "..." [--yes]');
  }
  if (!readOnly && !(await confirmMutation('即将执行写入型 SQL，这可能修改或删除云端数据。', flags))) return;

  const results = await queryD1(normalized);
  console.log(flags.write && !readOnly ? '✅ SQL 写操作已完成，返回结果：' : '📄 查询结果：');
  if (flags.json) console.log(JSON.stringify(results, null, 2));
  else console.table(results);
}

async function listFeedback(flags) {
  try {
    const rows = await queryD1('SELECT id, uid, nickname, feedback_type, content, contact, client_version, created_at FROM feedback ORDER BY id DESC LIMIT 50;');
    if (flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (!rows || rows.length === 0) {
      console.log('💬 暂无用户提交的反馈信息。');
      return;
    }
    console.log(`\n💬 用户意见反馈列表（共 ${rows.length} 条）：\n`);
    console.table(rows.map(r => ({
      ID: r.id,
      时间: r.created_at,
      类型: r.feedback_type,
      昵称: r.nickname || '匿名',
      UID: r.uid || '-',
      内容: r.content,
      联系方式: r.contact || '-',
      版本: r.client_version || '-'
    })));
  } catch (err) {
    if (err.message.includes('no such table')) {
      console.log('💬 反馈数据表暂未创建（将在接收到首条反馈时由 Worker 自动生成）。');
    } else {
      throw err;
    }
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const cmd = rawArgs.shift();
  const { args, flags } = parseFlags(rawArgs);

  switch (cmd) {
    case 'users':
    case 'list':
      await listUsers(flags);
      break;
    case 'user':
    case 'get':
      await getUserDetail(args[0], flags);
      break;
    case 'set-pwd':
    case 'reset-pwd':
      await resetUserPassword(args[0], args[1], flags);
      break;
    case 'set-nickname':
      await setNickname(args[0], args[1], flags);
      break;
    case 'set-score':
      await setScore(args[0], args[1], flags);
      break;
    case 'lock':
      await lockUser(args[0], args[1], flags);
      break;
    case 'unlock':
      await unlockUser(args[0], flags);
      break;
    case 'feedback':
    case 'feedbacks':
      await listFeedback(flags);
      break;
    case 'sql':
      await runCustomSql(args[0], flags);
      break;
    case '--help':
    case '-h':
    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch(err => {
  console.error(`❌ 执行失败：${err.message}`);
  process.exitCode = 1;
});
