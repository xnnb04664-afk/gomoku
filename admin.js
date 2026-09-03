/**
 * 🛠️ 五子棋大师 - 开发者专用云端数据管理系统 (Cloudflare D1 后台)
 * 
 * 使用方式：
 *   1. 查看全服所有玩家数据：
 *      node admin.js users
 * 
 *   2. 查看指定玩家详细信息：
 *      node admin.js user <UID 或 账号用户名>
 * 
 *   3. 开发者为指定玩家重置密码：
 *      node admin.js set-pwd <UID 或 账号用户名> <新密码>
 * 
 *   4. 执行自定义 D1 SQL 查询：
 *      node admin.js sql "SELECT * FROM users LIMIT 10;"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '.cloudflare_config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('❌ 缺少 .cloudflare_config.json 配置文件！');
  process.exit(1);
}

const { accountId, deployToken, d1DatabaseId } = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const PEPPER = '__GOMOKU_PEPPER_2026__';

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hashWithSalt(text, salt) {
  return sha256Hex(text + ':' + salt + ':' + PEPPER);
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
  const data = await res.json();
  if (!data.success) {
    throw new Error('D1 执行错误: ' + JSON.stringify(data.errors));
  }
  return data.result && data.result[0] ? data.result[0].results : [];
}

async function listUsers() {
  console.log('\n🔍 正在从 Cloudflare D1 云端数据库拉取全服玩家数据...\n');
  const rows = await queryD1(`
    SELECT uid, username, nickname, avatar, score, wins, total_games, security_q, created_at
    FROM users
    ORDER BY created_at DESC
  `);

  if (!rows || rows.length === 0) {
    console.log('⚠️ 暂无玩家注册记录。');
    return;
  }

  console.log(`📊 全服已注册玩家总数: ${rows.length} 位\n`);
  console.table(rows.map((u, i) => ({
    '序号': i + 1,
    '玩家 UID': u.uid,
    '账号用户名': u.username,
    '游戏昵称': u.nickname,
    '头像': u.avatar,
    '天梯积分': u.score,
    '胜场/总场': `${u.wins}/${u.total_games}`,
    '密保问题': u.security_q || '未设置',
    '注册时间': u.created_at
  })));
  console.log('\n💡 提示：运行 `node admin.js user <UID>` 可查看该用户的详细档案。');
  console.log('💡 提示：运行 `node admin.js set-pwd <UID> <新密码>` 可为该用户直接重设密码。\n');
}

async function getUserDetail(identifier) {
  if (!identifier) {
    console.error('❌ 请输入要查询的 UID 或账号用户名，例如: node admin.js user 661713');
    return;
  }

  const rows = await queryD1(`
    SELECT * FROM users WHERE uid = ? OR username = ? LIMIT 1
  `, [String(identifier), String(identifier)]);

  if (!rows || rows.length === 0) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }

  const u = rows[0];
  console.log('\n======================================================');
  console.log(`👤 玩家档案详情：【${u.nickname}】(${u.username})`);
  console.log('======================================================');
  console.log(`🆔 唯一 UID:        ${u.uid}`);
  console.log(`🔑 账号用户名:      ${u.username}`);
  console.log(`🏷️ 游戏昵称:        ${u.nickname}`);
  console.log(`🎭 玩家头像:        ${u.avatar}`);
  console.log(`🏆 天梯积分:        ${u.score}`);
  console.log(`⚔️ 战绩统计:        胜 ${u.wins} 场 / 共 ${u.total_games} 场 (胜率: ${u.total_games ? ((u.wins/u.total_games)*100).toFixed(1) : 0}%)`);
  console.log(`🛡️ 密保问题:        ${u.security_q || '无'}`);
  console.log(`🔒 密码加密特征:    ${u.password_hash ? u.password_hash.substring(0, 16) + '...' : '未设置'}`);
  console.log(`🧂 密码加盐 Salt:   ${u.salt || '无'}`);
  console.log(`📅 注册时间:        ${u.created_at}`);
  console.log(`🔄 最后更新:        ${u.updated_at}`);
  console.log('======================================================\n');
}

async function resetUserPassword(identifier, newPassword) {
  if (!identifier || !newPassword) {
    console.error('❌ 参数不足！正确用法: node admin.js set-pwd <UID 或 账号用户名> <新密码>');
    return;
  }

  if (newPassword.length < 6) {
    console.error('❌ 安全规范：新密码长度至少为 6 位！');
    return;
  }

  const rows = await queryD1(`
    SELECT uid, username, nickname FROM users WHERE uid = ? OR username = ? LIMIT 1
  `, [String(identifier), String(identifier)]);

  if (!rows || rows.length === 0) {
    console.log(`❌ 未找到 UID 或用户名为【${identifier}】的玩家！`);
    return;
  }

  const user = rows[0];
  const newSalt = generateSecureHex(16);
  const newHash = hashWithSalt(newPassword, newSalt);

  await queryD1(`
    UPDATE users
    SET password_hash = ?, salt = ?, failed_login_count = 0, locked_until = 0, updated_at = CURRENT_TIMESTAMP
    WHERE uid = ?
  `, [newHash, newSalt, user.uid]);

  console.log('\n======================================================');
  console.log(`✅ 密码重置成功！`);
  console.log(`👤 目标玩家: 【${user.nickname}】(UID: ${user.uid} / 账号: ${user.username})`);
  console.log(`🔑 已将密码更新为: ${newPassword}`);
  console.log('======================================================\n');
}

async function runCustomSql(sql) {
  if (!sql) {
    console.error('❌ 请提供 SQL 语句，例如: node admin.js sql "SELECT count(*) FROM users;"');
    return;
  }

  console.log(`\n⚙️ 正在执行 SQL: ${sql}\n`);
  const results = await queryD1(sql);
  console.log('📄 查询结果:');
  console.table(results);
}

const [,, cmd, arg1, arg2] = process.argv;

(async () => {
  try {
    switch (cmd) {
      case 'users':
      case 'list':
        await listUsers();
        break;
      case 'user':
      case 'get':
        await getUserDetail(arg1);
        break;
      case 'set-pwd':
      case 'reset-pwd':
        await resetUserPassword(arg1, arg2);
        break;
      case 'sql':
        await runCustomSql(arg1);
        break;
      default:
        console.log(`
🛠️ 五子棋开发者数据管理命令指南：
  node admin.js users                     - 列出全服所有玩家档案与数据
  node admin.js user <UID或用户名>        - 查看指定玩家详情
  node admin.js set-pwd <UID或用户名> <新密码> - 快速修改/重置任意玩家密码
  node admin.js sql "<SQL语句>"           - 在云端 D1 数据库执行自定义 SQL
`);
        break;
    }
  } catch (err) {
    console.error('❌ 执行失败:', err.message);
  }
})();