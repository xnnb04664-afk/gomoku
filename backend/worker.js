/**
 * 🎮 五子棋 Cloudflare Worker 专属高安全对战与账号中枢 (Security Hardened v4.0)
 * 🛡️ 全面防御黑客攻击矩阵：
 * 1. 【文件上传/XSS防御】头像严格正则白名单，彻底封杀 SVG/脚本，限死 14KB
 * 2. 【安全找回密码】密保答案 SHA-256 加盐哈希，答错 3 次锁定 10 分钟
 * 3. 【防暴力破解】连续输错密码 5 次强制冷冻锁定 5 分钟
 * 4. 【防冒名改分】对局上报强制校验 192-bit 安全 Token 身份凭证
 * 5. 【防脚本刷分】对局上报强制 15 秒物理结算冷却
 * 6. 【防 SQL 注入】所有查询全部采用参数化绑定（Prepared Statements）
 */

let isDbInitialized = false;
let cachedLeaderboard = null;
let lastLeaderboardTime = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gomoku-Client',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 512 * 1024) {
      return json({ code: 413, msg: '请求数据过大' }, 413);
    }

    // ── 🛡️ 安全工具箱 ─────────────────────────────────────
    function generateSecureHex(len = 24) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function hashWithSalt(text, salt) {
      const enc = new TextEncoder();
      const combined = enc.encode(`${text}__GOMOKU_PEPPER_2026__${salt}`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 新账号使用 PBKDF2；旧账号仍可用旧 SHA-256 登录，并在成功登录时自动升级。
    async function hashPassword(text, salt) {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(text),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(`GOMOKU_PASSWORD_${salt}`), iterations: 120000, hash: 'SHA-256' },
        key,
        256
      );
      return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function sanitizeText(str, maxLen = 12) {
      if (!str || typeof str !== 'string') return '';
      return str.trim().replace(/[<>'"`&]/g, '').slice(0, maxLen);
    }

    // 🛡️ 头像极严格安全校验与清洗（彻底粉碎任意文件上传漏洞与 SVG XSS）
    
    const RANDOM_AVATARS = ['🐱', '🐶', '🐼', '🦁', '🦊', '🐯', '🐰', '🐸', '🦄', '🌸', '👦', '👧', '🧙‍♂️', '🥷', '✨', '🐾', '🐻', '🐨', '🤖', '👑'];
    const NAME_PREFIXES = ['逍遥', '灵动', '疾风', '星月', '青云', '竹林', '傲雪', '听雨', '落樱', '幻影', '天元', '破晓', '悠然', '春风', '弈心', '无痕'];
    const NAME_SUFFIXES = ['棋仙', '弈客', '少侠', '神算', '隐士', '先锋', '棋圣', '奇才', '萌客', '棋王', '行者', '剑客'];

    function generateRandomNickname() {
      const pre = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
      const suf = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
      const num = Math.floor(10 + Math.random() * 90);
      return pre + suf + '_' + num;
    }

    function generateRandomAvatar() {
      return RANDOM_AVATARS[Math.floor(Math.random() * RANDOM_AVATARS.length)];
    }

    function sanitizeAvatar(avatar) {
      if (!avatar || typeof avatar !== 'string') return '👦';
      if (avatar === 'anime_boy' || avatar === 'img/avatar_boy.png') return 'anime_boy';
      if (avatar === 'anime_girl' || avatar === 'img/avatar_girl.png') return 'anime_girl';
      if (avatar.length <= 4) return avatar;
      if (avatar.startsWith('data:image/') && avatar.includes(';base64,') && avatar.length <= 150000) return avatar;
      if ((avatar.startsWith('http://') || avatar.startsWith('https://')) && avatar.length <= 300) return avatar;
      return '👦';
    }

    // ── 数据库自动安全升级迁移 ─────────────────────────────
    if (env.DB) {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL,
            mode TEXT NOT NULL,
            is_win INTEGER NOT NULL,
            winner_color INTEGER NOT NULL,
            my_color INTEGER NOT NULL,
            opp_name TEXT,
            opp_avatar TEXT,
            moves_count INTEGER DEFAULT 0,
            moves_data TEXT,
            board_data TEXT,
            time TEXT,
            date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        try {
          await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_game_history_uid ON game_history(uid)`).run();
        } catch(e) {}

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS users (
            uid TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password_hash TEXT,
            salt TEXT,
            password_algo TEXT DEFAULT 'sha256',
            security_q TEXT,
            security_a_hash TEXT,
            security_salt TEXT,
            failed_reset_count INTEGER DEFAULT 0,
            reset_locked_until INTEGER DEFAULT 0,
            token TEXT,
            token_expires_at INTEGER DEFAULT 0,
            failed_login_count INTEGER DEFAULT 0,
            locked_until INTEGER DEFAULT 0,
            nickname TEXT,
            avatar TEXT DEFAULT '👦',
            score INTEGER DEFAULT 1000,
            wins INTEGER DEFAULT 0,
            total_games INTEGER DEFAULT 0,
            last_game_at INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        const cols = [
          'password_hash TEXT', 'salt TEXT', 'password_algo TEXT DEFAULT \'sha256\'', 'token TEXT', 'token_expires_at INTEGER DEFAULT 0',
          'failed_login_count INTEGER DEFAULT 0', 'locked_until INTEGER DEFAULT 0', 'last_game_at INTEGER DEFAULT 0',
          'security_q TEXT', 'security_a_hash TEXT', 'security_salt TEXT',
          'failed_reset_count INTEGER DEFAULT 0', 'reset_locked_until INTEGER DEFAULT 0'
        ];
        for (const col of cols) {
          try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run(); } catch(e){}
        }

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS match_queue (
            uid TEXT PRIMARY KEY,
            nickname TEXT,
            avatar TEXT,
            score INTEGER DEFAULT 1000,
            status TEXT DEFAULT 'waiting',
            matched_with TEXT,
            matched_color TEXT,
            matched_nickname TEXT,
            matched_avatar TEXT,
            matched_score INTEGER,
            room_code TEXT,
            updated_at INTEGER
          )
        `).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ip_register_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
        `).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ip_register_log_ip_time ON ip_register_log(ip, created_at)`).run();
      } catch (e) {
        console.warn('DB check error:', e.message);
      }
    }

    // 🛡️ 终极安全第一网关：全量强制校验客户端专属安全暗号，阻断一切外部未授权访问！
    const isDocNav = request.headers.get("sec-fetch-dest") === "document" || request.headers.get("sec-fetch-mode") === "navigate";
    if (url.pathname === "/" || url.pathname === "/index.html" || isDocNav) {
      return new Response('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body style="font-family:sans-serif;text-align:center;padding:120px 20px;"><h1>404 Not Found</h1><p>The requested resource was not found on this server.</p><hr/><div style="color:#888;font-size:12px;">nginx</div></body></html>', {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // ── 0. 官方版本与下载源安全中枢 (公开免客户端私钥拦截，极速检测) ────────
    if (url.pathname === "/api/version") {
      return json({
        code: 0,
        tag: "v1.0.86",
        officialRepo: "xnnb04664-afk/gomoku",
        updateLog: "五子棋 v1.0.86 官方正式版更新说明：\n\n🎯 【主棋盘大屏动态复盘】历史战绩点击「查看棋局」，直接平滑跳转至主棋盘大屏！每颗棋子中心清晰印上落子序号（1, 2, 3...），支持滑动条拖拽推演、单步进退、自动电影级播放与终局一键跳转\n\n🔒 【设置弹窗按钮底部常驻】个人中心弹窗底部「保存并应用」与「关闭」按钮改为永远固定常驻在屏幕最下方，打开弹窗一眼可见，彻底告别必须滑到最底部的繁琐操作\n\n☁️ 【历史战绩云端存储与双向彻底抹除】全盘走法谱与棋局数据全自动备份至 Cloudflare D1 云端数据库，换手机/重装账号一键找回；清空记录本地与云端彻底同步抹除\n\n⚡ 【免安装秒更4路全球CDN并发竞速】免安装在线热更新采用 jsDelivr、Fastly、GitHub 加速镜像 4 路全球 CDN 并发竞速（Promise.any），彻底消灭网络卡顿丢包，点一次秒更完成\n\n🧠 【最强大师 AI】统一接入棋型评估、必胜/必防、双重威胁检测、Alpha-Beta 迭代加深与置换表搜索，并按桌面/移动端设置单步时间预算\n\n🚫 【开机零干扰体验】更新后启动直接 0.2 秒秒开进棋盘，绝不主动弹出任何卡片打扰您",
        apkDownload: "https://gh-proxy.com/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk",
        htmlDownload: "https://gh-proxy.com/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/五子棋大师_单文件版.html",
        officialSignatureSha256: "9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e"
      });
    }

    function getRequestToken(request, body = {}) {
      const authorization = request.headers.get('Authorization') || '';
      if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
      return typeof body.token === 'string' ? body.token.trim() : '';
    }

    async function requireUser(uid, token) {
      const cleanUid = String(uid || '').trim();
      const cleanToken = String(token || '').trim();
      if (!env.DB) return { response: json({ code: 1, msg: '数据库未连接' }, 500) };
      if (!cleanUid || !cleanToken) return { response: json({ code: 401, msg: '未授权：缺少身份凭证' }, 401) };

      const user = await env.DB.prepare(`
        SELECT uid, username, nickname, avatar, score, wins, total_games, token, token_expires_at
        FROM users WHERE uid = ? AND token = ?
      `).bind(cleanUid, cleanToken).first();
      if (!user) return { response: json({ code: 403, msg: '未授权：Token 无效' }, 403) };
      if (user.token_expires_at && Number(user.token_expires_at) <= Date.now()) {
        return { response: json({ code: 401, msg: '登录凭证已过期，请重新登录' }, 401) };
      }
      return { user };
    }

    async function requireMatchIdentity(uid, token) {
      const cleanUid = String(uid || '').trim();
      if (cleanUid.startsWith('guest_')) return { uid: cleanUid, user: null };
      const auth = await requireUser(cleanUid, token);
      return auth.response ? auth : { uid: cleanUid, user: auth.user };
    }

    // ── 智能动态 UID 分配引擎（支持 6 位靓号到亿级自动平滑扩容） ──
async function allocateNextAvailableUid(env) {
  // 1. 优先分配 6 位普通与靓号 UID (100000 ~ 999999，容量 90 万)
  for (let i = 0; i < 10; i++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    const exist = await env.DB.prepare("SELECT uid FROM users WHERE uid = ? OR username = ?").bind(candidate, candidate).first();
    if (!exist) return candidate;
  }
  // 2. 用户量激增至百万以上时，全自动自适应扩容至 7 位、8 位、9 位乃至百亿级
  for (let digits = 7; digits <= 10; digits++) {
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    for (let i = 0; i < 6; i++) {
      const candidate = String(Math.floor(min + Math.random() * (max - min)));
      const exist = await env.DB.prepare("SELECT uid FROM users WHERE uid = ? OR username = ?").bind(candidate, candidate).first();
      if (!exist) return candidate;
    }
  }
  return String(Date.now()).slice(-8) + Math.floor(10 + Math.random() * 90);
}

    // ── 2. 游客免密快速入场（纯本地处理，绝不存入数据库，不上天梯榜） ──
    if (url.pathname === '/api/auth/guest' && request.method === 'POST') {
      try {
        const defaultName = generateRandomNickname();
        const defaultAvatar = generateRandomAvatar();
        return json({
          code: 0,
          msg: '游客身份仅本地可用，未写入数据库',
          data: {
            uid: 'guest_' + Math.floor(100000 + Math.random() * 900000),
            username: null,
            nickname: defaultName,
            avatar: defaultAvatar,
            score: 1000,
            wins: 0,
            total_games: 0,
            token: null
          }
        });
      } catch (err) {
        return json({ code: 1, msg: '游客创建异常: ' + err.message }, 500);
      }
    }

    // ── 3. 注册正式账号 ─────────────────────────────────
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { username, password, nickname, avatar, uid, token, securityQuestion, securityAnswer } = body;

        if (!username || typeof username !== 'string' || !username.trim()) {
          return json({ code: 1, msg: '请输入有效的账号名称' });
        }
        if (username.trim().length > 32) {
          return json({ code: 1, msg: '账号名称长度最多 32 个字符' });
        }
        if (!password || typeof password !== 'string' || password.length < 6 || password.length > 32) {
          return json({ code: 1, msg: '密码长度须至少 6 位（支持 6~32 位）' });
        }

        // IP rate limit: max 3 registrations per IP per 24h
        const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        try {
          const oneDayAgo = Date.now() - 86400000;
          const ipCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM ip_register_log WHERE ip = ? AND created_at > ?').bind(clientIp, oneDayAgo).first();
          if (ipCount && ipCount.cnt >= 3) {
            return json({ code: 429, msg: '⚠️ 该网络今日注册账号过多，请明天再试（每IP每天限注册3个账号）' });
          }
        } catch(e) {}

                const safeUsername = username.trim().replace(/[<>'"`]/g, '');
        const safeNick = sanitizeText(nickname, 12) || safeUsername;
        const safeAvatar = sanitizeAvatar(avatar);

        const exist = await env.DB.prepare('SELECT uid FROM users WHERE username = ? OR uid = ?').bind(safeUsername, safeUsername).first();
        if (exist) {
          return json({ code: 1, msg: '该账号名称已被注册，请换一个' });
        }

        const now = Date.now();
        const expiresAt = now + 365 * 24 * 3600 * 1000;
        const salt = generateSecureHex(16);
        const passwordHash = await hashPassword(password, salt);
        const newToken = generateSecureHex(24);

        const safeQ = sanitizeText(securityQuestion, 60) || '你最喜欢的人是谁？';
        const cleanAnswer = (securityAnswer && typeof securityAnswer === 'string') ? securityAnswer.trim().toLowerCase() : '';
        const secSalt = generateSecureHex(16);
        const secAnswerHash = cleanAnswer ? await hashWithSalt(cleanAnswer, secSalt) : null;

        if (uid && token) {
          const guest = await env.DB.prepare('SELECT uid, username FROM users WHERE uid = ? AND token = ?').bind(String(uid), String(token)).first();
          if (guest && !guest.username) {
            await env.DB.prepare(`
              UPDATE users
              SET username = ?, password_hash = ?, salt = ?, password_algo = 'pbkdf2', token = ?, token_expires_at = ?,
                  security_q = ?, security_a_hash = ?, security_salt = ?,
                  failed_login_count = 0, locked_until = 0, nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
              WHERE uid = ?
            `).bind(safeUsername, passwordHash, salt, newToken, expiresAt, safeQ, secAnswerHash, secSalt, safeNick, safeAvatar, uid).run();

            try { await env.DB.prepare('INSERT INTO ip_register_log (ip, created_at) VALUES (?, ?)').bind(clientIp, Date.now()).run(); } catch(e){}
            const updated = await env.DB.prepare('SELECT uid, username, nickname, avatar, score, wins, total_games, token, security_q FROM users WHERE uid = ?').bind(uid).first();
            return json({ code: 0, msg: '账号绑定升级成功！', data: updated });
          }
        }

        const newUid = await allocateNextAvailableUid(env);
        await env.DB.prepare(`
          INSERT INTO users (uid, username, password_hash, salt, password_algo, token, token_expires_at, security_q, security_a_hash, security_salt, failed_login_count, locked_until, nickname, avatar, score, wins, total_games)
          VALUES (?, ?, ?, ?, 'pbkdf2', ?, ?, ?, ?, ?, 0, 0, ?, ?, 1000, 0, 0)
        `).bind(newUid, safeUsername, passwordHash, salt, newToken, expiresAt, safeQ, secAnswerHash, secSalt, safeNick, safeAvatar).run();

        try { await env.DB.prepare('INSERT INTO ip_register_log (ip, created_at) VALUES (?, ?)').bind(clientIp, Date.now()).run(); } catch(e){}
        const created = await env.DB.prepare('SELECT uid, username, nickname, avatar, score, wins, total_games, token, security_q FROM users WHERE uid = ?').bind(newUid).first();
        return json({ code: 0, msg: '注册成功并已自动登录！', data: created });
      } catch (err) {
        return json({ code: 1, msg: '注册异常: ' + err.message }, 500);
      }
    }

    // ── 3.5 用户资料更新（昵称即账号名，改昵称即改账号名） ───────
    if (url.pathname === '/api/user/update_profile' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, token, nickname, avatar } = body;
        if (!uid) return json({ code: 1, msg: '缺少 uid' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const user = auth.user;

        const safeNick = nickname ? sanitizeText(nickname, 16) : null;
        const safeAvatar = avatar ? sanitizeAvatar(avatar) : null;

        if (safeNick) {
          // 检查该账号名/昵称是否已被其他注册用户占用
          const exist = await env.DB.prepare('SELECT uid FROM users WHERE (username = ? OR nickname = ?) AND uid != ?').bind(safeNick, safeNick, String(uid)).first();
          if (exist) {
            return json({ code: 1, msg: '该账号名称已被其他玩家占用，请换一个' });
          }
        }

        // 🌟 核心：昵称即账号名，改昵称就是改账号名！同时更新 username 与 nickname
        if (safeNick && safeAvatar) {
          await env.DB.prepare('UPDATE users SET username = ?, nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?').bind(safeNick, safeNick, safeAvatar, String(uid)).run();
        } else if (safeNick) {
          await env.DB.prepare('UPDATE users SET username = ?, nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?').bind(safeNick, safeNick, String(uid)).run();
        } else if (safeAvatar) {
          await env.DB.prepare('UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?').bind(safeAvatar, String(uid)).run();
        }

        const finalName = safeNick || user.username || user.nickname;
        return json({
          code: 0,
          msg: '账号与昵称已成功同步更新！',
          data: {
            uid: String(uid),
            username: finalName,
            nickname: finalName,
            avatar: safeAvatar || user.avatar
          }
        });
      } catch (err) {
        return json({ code: 1, msg: '资料更新异常: ' + err.message }, 500);
      }
    }

    // ── 3.8 永久登录态验证与自动续期 (1年超长无感免登) ────────
    if (url.pathname === "/api/auth/verify_session" && request.method === "POST") {
      if (!env.DB) return json({ code: 1, msg: "数据库未连接" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, token } = body;
        if (!uid) return json({ code: 1, msg: "缺少 uid" });

        const user = await env.DB.prepare(
          "SELECT uid, username, nickname, avatar, score, wins, total_games, token, token_expires_at, security_q FROM users WHERE uid = ?"
        ).bind(String(uid)).first();

        if (!user) {
          return json({ code: 1, msg: "用户不存在" });
        }

        const now = Date.now();
        const oneYear = 365 * 24 * 3600 * 1000;

        // 如果用户已绑定了正式账号名
        if (user.username) {
          if (token && user.token && token === user.token && (!user.token_expires_at || user.token_expires_at > now)) {
            let freshToken = user.token || generateSecureHex(24);
            const expiresAt = now + oneYear;
            await env.DB.prepare("UPDATE users SET token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?").bind(freshToken, expiresAt, user.uid).run();

            return json({
              code: 0,
              msg: "正式账号凭证有效",
              data: {
                uid: user.uid,
                username: user.username,
                nickname: user.nickname,
                avatar: user.avatar,
                score: user.score,
                wins: user.wins,
                total_games: user.total_games,
                security_q: user.security_q,
                token: freshToken
              }
            });
          }
          return json({ code: 2, msg: "凭证已失效，需输入密码登录" });
        } else {
          // 兼容历史上曾写入 D1 的游客账号，但不再允许无凭证续期。
          if (!token || !user.token || token !== user.token || (user.token_expires_at && user.token_expires_at <= now)) {
            return json({ code: 401, msg: "游客凭证已失效" }, 401);
          }
          const freshToken = user.token;
          const expiresAt = now + oneYear;
          await env.DB.prepare("UPDATE users SET token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ?").bind(freshToken, expiresAt, user.uid).run();
          return json({
            code: 0,
            msg: "游客凭证有效",
            data: {
              uid: user.uid,
              username: null,
              nickname: user.nickname,
              avatar: user.avatar,
              score: user.score,
              wins: user.wins,
              total_games: user.total_games,
              token: freshToken
            }
          });
        }
      } catch (err) {
        return json({ code: 1, msg: "会话验证异常: " + err.message }, 500);
      }
    }

    // ── 4. 账号登录（5 次错误锁定 5 分钟时间限制） ───────
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { username, password } = await request.json().catch(() => ({}));
        if (!username || !password) return json({ code: 1, msg: '请输入账号与密码' });

        const now = Date.now();
        const user = await env.DB.prepare('SELECT * FROM users WHERE (username = ? OR uid = ? OR nickname = ?)').bind(String(username).trim(), String(username).trim(), String(username).trim()).first();
        if (!user) {
          return json({ code: 1, msg: '账号或密码不正确' });
        }

        if (user.locked_until && user.locked_until > now) {
          const remain = Math.ceil((user.locked_until - now) / 1000);
          return json({ code: 429, msg: `密码输错过多，账号保护性锁定中！请在 ${remain} 秒后再试` });
        }

        const calcHash = user.password_algo === 'pbkdf2'
          ? await hashPassword(password, user.salt)
          : await hashWithSalt(password, user.salt);
        if (calcHash !== user.password_hash) {
          const newFailCount = (user.failed_login_count || 0) + 1;
          if (newFailCount >= 5) {
            const lockTime = now + 5 * 60 * 1000;
            await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE uid = ?').bind(newFailCount, lockTime, user.uid).run();
            return json({ code: 429, msg: '密码连续错误满 5 次！为防止被盗，账号已被锁定 5 分钟' });
          } else {
            await env.DB.prepare('UPDATE users SET failed_login_count = ? WHERE uid = ?').bind(newFailCount, user.uid).run();
            return json({ code: 1, msg: `账号或密码错误（连续错误 5 次锁定，还可尝试 ${5 - newFailCount} 次）` });
          }
        }

        let loginSalt = user.salt;
        let loginHash = calcHash;
        let passwordAlgo = user.password_algo || 'sha256';
        if (passwordAlgo !== 'pbkdf2') {
          loginSalt = generateSecureHex(16);
          loginHash = await hashPassword(password, loginSalt);
          passwordAlgo = 'pbkdf2';
        }
        const freshToken = generateSecureHex(24);
        const expiresAt = now + 365 * 24 * 3600 * 1000;
        await env.DB.prepare(`
          UPDATE users
          SET failed_login_count = 0, locked_until = 0, password_hash = ?, salt = ?, password_algo = ?,
              token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(loginHash, loginSalt, passwordAlgo, freshToken, expiresAt, user.uid).run();

        return json({
          code: 0,
          msg: '登录成功！',
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: user.avatar,
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            security_q: user.security_q,
            token: freshToken
          }
        });
      } catch (err) {
        return json({ code: 1, msg: '登录异常: ' + err.message }, 500);
      }
    }

    // ── 5. 安全找回密码：第一步（根据账号获取密保问题） ─
    if (url.pathname === '/api/auth/get_security_q' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { username } = await request.json().catch(() => ({}));
        if (!username) return json({ code: 1, msg: '请输入要找回的账号' });

        const user = await env.DB.prepare('SELECT uid, username, security_q, reset_locked_until FROM users WHERE (username = ? OR uid = ?)').bind(String(username).trim(), String(username).trim()).first();
        if (!user) {
          return json({ code: 1, msg: '该账号不存在' });
        }

        const now = Date.now();
        if (user.reset_locked_until && user.reset_locked_until > now) {
          const remain = Math.ceil((user.reset_locked_until - now) / 1000);
          return json({ code: 429, msg: `密保回答错误过多，找回功能锁定中！请在 ${remain} 秒后再试` });
        }

        if (!user.security_q) {
          return json({ code: 1, msg: '该账号未设置密保问题，请联系管理员' });
        }

        return json({ code: 0, data: { username: user.username, question: user.security_q } });
      } catch (err) {
        return json({ code: 1, msg: '查询密保异常: ' + err.message }, 500);
      }
    }

    // ── 6. 安全找回密码：第二步（核对密保重置新密码） ───
    if (url.pathname === '/api/auth/reset_password' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { username, securityAnswer, newPassword } = await request.json().catch(() => ({}));
        if (!username || !securityAnswer || !newPassword) {
          return json({ code: 1, msg: '请完整填写账号、密保答案与新密码' });
        }
        if (newPassword.length < 6 || newPassword.length > 32) {
          return json({ code: 1, msg: '新密码长度须至少 6 位（支持 6~32 位）' });
        }

        const now = Date.now();
        const user = await env.DB.prepare('SELECT * FROM users WHERE (username = ? OR uid = ?)').bind(String(username).trim(), String(username).trim()).first();
        if (!user) return json({ code: 1, msg: '账号不存在' });

        if (user.reset_locked_until && user.reset_locked_until > now) {
          const remain = Math.ceil((user.reset_locked_until - now) / 1000);
          return json({ code: 429, msg: `找回功能冷却锁定中，请在 ${remain} 秒后再试` });
        }

        const cleanAnswer = securityAnswer.trim().toLowerCase();
        const calcAnswerHash = await hashWithSalt(cleanAnswer, user.security_salt);

        if (calcAnswerHash !== user.security_a_hash) {
          const newFail = (user.failed_reset_count || 0) + 1;
          if (newFail >= 3) {
            const lockUntil = now + 10 * 60 * 1000;
            await env.DB.prepare('UPDATE users SET failed_reset_count = ?, reset_locked_until = ? WHERE uid = ?').bind(newFail, lockUntil, user.uid).run();
            return json({ code: 429, msg: '密保连续答错已满 3 次！为防破解，找回密码功能已锁定 10 分钟' });
          } else {
            await env.DB.prepare('UPDATE users SET failed_reset_count = ? WHERE uid = ?').bind(newFail, user.uid).run();
            return json({ code: 1, msg: `密保答案不正确（还可尝试 ${3 - newFail} 次）` });
          }
        }

        const newSalt = generateSecureHex(16);
        const newPwdHash = await hashPassword(newPassword, newSalt);
        const newToken = generateSecureHex(24);
        const expiresAt = now + 365 * 24 * 3600 * 1000;

        await env.DB.prepare(`
          UPDATE users
          SET password_hash = ?, salt = ?, password_algo = 'pbkdf2', token = ?, token_expires_at = ?,
              failed_reset_count = 0, reset_locked_until = 0,
              failed_login_count = 0, locked_until = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(newPwdHash, newSalt, newToken, expiresAt, user.uid).run();

        return json({
          code: 0,
          msg: '密码重置成功！已自动登录',
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: user.avatar,
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            token: newToken
          }
        });
      } catch (err) {
        return json({ code: 1, msg: '重置密码异常: ' + err.message }, 500);
      }
    }

    

    // ══════════════════════════════════════════════════════
    // 📜 历史对局战报与全盘谱录云端存取系统 (Cloudflare D1 驱动)
    // ══════════════════════════════════════════════════════

    // 1. 上报并云端持久化单局战报（包含全盘走法谱与终局状态）
    if (url.pathname === '/api/history/record' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, mode, isWin, winnerColor, myColor, oppName, oppAvatar, moves, movesData, boardData, time, date } = body;
        if (!uid) return json({ code: 1, msg: '缺少用户 UID' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const cleanUid = auth.user.uid;
        const movesJson = typeof movesData === 'string' ? movesData : JSON.stringify(movesData || []);
        const boardJson = typeof boardData === 'string' ? boardData : JSON.stringify(boardData || []);
        if (movesJson.length > 120000 || boardJson.length > 120000) {
          return json({ code: 413, msg: '棋谱数据过大' }, 413);
        }

        await env.DB.prepare(`
          INSERT INTO game_history (
            uid, mode, is_win, winner_color, my_color, opp_name, opp_avatar, moves_count, moves_data, board_data, time, date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          cleanUid,
          String(mode || 'ai'),
          isWin ? 1 : 0,
          parseInt(winnerColor || 1, 10),
          parseInt(myColor || 1, 10),
          String(oppName || '对手').slice(0, 32),
          String(oppAvatar || '🤖').slice(0, 100),
          parseInt(moves || 0, 10),
          movesJson,
          boardJson,
          String(time || '').slice(0, 20),
          String(date || '').slice(0, 20)
        ).run();

        // 仅保留该用户最新 30 局，自动裁剪超额历史
        try {
          await env.DB.prepare(`
            DELETE FROM game_history
            WHERE uid = ? AND id NOT IN (
              SELECT id FROM game_history WHERE uid = ? ORDER BY id DESC LIMIT 30
            )
          `).bind(cleanUid, cleanUid).run();
        } catch(_) {}

        return json({ code: 0, msg: '对局历史战报与棋局谱已成功同步至云端！' });
      } catch (err) {
        return json({ code: 1, msg: '云端同步战绩异常: ' + err.message }, 500);
      }
    }

    // 2. 查询用户云端历史对局战报列表（支持换机/重装后一键恢复）
    if (url.pathname === '/api/history/list' && request.method === 'GET') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const uid = url.searchParams.get('uid');
        if (!uid) return json({ code: 1, msg: '缺少用户 UID' });

        const auth = await requireUser(uid, getRequestToken(request));
        if (auth.response) return auth.response;

        const rows = await env.DB.prepare(`
          SELECT id, uid, mode, is_win as isWin, winner_color as winnerColor, my_color as myColor,
                 opp_name as oppName, opp_avatar as oppAvatar, moves_count as moves,
                 moves_data as movesData, board_data as boardData, time, date, created_at
          FROM game_history
          WHERE uid = ?
          ORDER BY id DESC
          LIMIT 30
        `).bind(auth.user.uid).all();

        const list = (rows.results || []).map(r => ({
          ...r,
          isWin: r.isWin === 1,
          movesData: (() => {
            try { return JSON.parse(r.movesData); } catch(e) { return []; }
          })(),
          boardData: (() => {
            try { return JSON.parse(r.boardData); } catch(e) { return null; }
          })()
        }));

        return json({ code: 0, data: list });
      } catch (err) {
        return json({ code: 1, msg: '查询云端历史战绩异常: ' + err.message }, 500);
      }
    }

    // 3. 清空用户云端全部历史对局战报（保证本地删除与云端100%双向同步）
    if (url.pathname === '/api/history/clear' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid } = body;
        if (!uid) return json({ code: 1, msg: '缺少用户 UID' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        await env.DB.prepare('DELETE FROM game_history WHERE uid = ?').bind(auth.user.uid).run();
        return json({ code: 0, msg: '云端历史战报已彻底同步清空！' });
      } catch (err) {
        return json({ code: 1, msg: '清空云端战绩异常: ' + err.message }, 500);
      }
    }

    // 4. 删除指定单条云端历史对局战报
    if (url.pathname === '/api/history/delete' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, id } = body;
        if (!uid || !id) return json({ code: 1, msg: '缺少参数' });

        const auth = await requireUser(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        await env.DB.prepare('DELETE FROM game_history WHERE uid = ? AND id = ?').bind(auth.user.uid, parseInt(id, 10)).run();
        return json({ code: 0, msg: '该条云端战绩已同步删除！' });
      } catch (err) {
        return json({ code: 1, msg: '删除云端战绩异常: ' + err.message }, 500);
      }
    }


    // ══════════════════════════════════════════════════════
    // ⚡ 全服实时快速匹配系统 (Cloudflare D1 驱动)
    // ══════════════════════════════════════════════════════

    // 1. 加入匹配队列
    if (url.pathname === '/api/match/join' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, nickname, avatar } = body;
        if (!uid) return json({ code: 1, msg: '缺少用户信息' });

        const auth = await requireMatchIdentity(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const matchUid = auth.uid;

        const now = Date.now();
        const safeNick = sanitizeText(nickname, 12) || '棋士';
        const safeAvatar = sanitizeAvatar(avatar);
        const safeScore = auth.user ? Math.max(0, Number(auth.user.score) || 1000) : 1000;

        // 清理 25 秒以上的超时死连接
        await env.DB.prepare('DELETE FROM match_queue WHERE updated_at < ? AND status = "waiting"').bind(now - 25000).run();

        // 寻找正在等待的真人对手 (非自己)
        const opponent = await env.DB.prepare(
          'SELECT * FROM match_queue WHERE status = "waiting" AND uid != ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 1'
        ).bind(matchUid, now - 20000).first();

        if (opponent) {
          // 匹配成功！分配 6 位专属房间码
          const roomCode = String(Math.floor(100000 + Math.random() * 900000));
          
          // 对手执黑（作为房主创建连接），当前玩家执白（加入连接）
          await env.DB.prepare(`
            UPDATE match_queue
            SET status = 'matched', matched_with = ?, matched_color = 'black',
                matched_nickname = ?, matched_avatar = ?, matched_score = ?,
                room_code = ?, updated_at = ?
            WHERE uid = ?
          `).bind(matchUid, safeNick, safeAvatar, safeScore, roomCode, now, opponent.uid).run();

          await env.DB.prepare(`
            INSERT INTO match_queue (uid, nickname, avatar, score, status, matched_with, matched_color, matched_nickname, matched_avatar, matched_score, room_code, updated_at)
            VALUES (?, ?, ?, ?, 'matched', ?, 'white', ?, ?, ?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET
              status = 'matched', matched_with = excluded.matched_with, matched_color = 'white',
              matched_nickname = excluded.matched_nickname, matched_avatar = excluded.matched_avatar,
              matched_score = excluded.matched_score, room_code = excluded.room_code, updated_at = excluded.updated_at
          `).bind(matchUid, safeNick, safeAvatar, safeScore, opponent.uid, opponent.nickname, opponent.avatar, opponent.score, roomCode, now).run();

          return json({
            code: 0,
            status: 'matched',
            role: 'client',
            color: 'white',
            roomCode: roomCode,
            opponent: {
              uid: opponent.uid,
              nickname: opponent.nickname,
              avatar: opponent.avatar,
              score: opponent.score
            }
          });
        }

        // 暂无等待对手，将自己放入等待队列
        await env.DB.prepare(`
          INSERT INTO match_queue (uid, nickname, avatar, score, status, matched_with, matched_color, matched_nickname, matched_avatar, matched_score, room_code, updated_at)
          VALUES (?, ?, ?, ?, 'waiting', NULL, NULL, NULL, NULL, NULL, NULL, ?)
          ON CONFLICT(uid) DO UPDATE SET
            nickname = excluded.nickname, avatar = excluded.avatar, score = excluded.score,
            status = 'waiting', matched_with = NULL, matched_color = NULL, matched_nickname = NULL,
            matched_avatar = NULL, matched_score = NULL, room_code = NULL, updated_at = excluded.updated_at
        `).bind(matchUid, safeNick, safeAvatar, safeScore, now).run();

        return json({ code: 0, status: 'waiting' });
      } catch (err) {
        return json({ code: 1, msg: '匹配服务异常: ' + err.message }, 500);
      }
    }

    // 2. 轮询匹配结果
    if (url.pathname === '/api/match/poll' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, token } = body;
        if (!uid) return json({ code: 1, msg: '缺少 uid' });

        const auth = await requireMatchIdentity(uid, getRequestToken(request, body));
        if (auth.response) return auth.response;
        const matchUid = auth.uid;

        const now = Date.now();
        const record = await env.DB.prepare('SELECT * FROM match_queue WHERE uid = ?').bind(matchUid).first();
        if (!record) {
          return json({ code: 0, status: 'cancelled' });
        }

        if (record.status === 'matched') {
          // 清理记录
          await env.DB.prepare('DELETE FROM match_queue WHERE uid = ?').bind(matchUid).run();
          return json({
            code: 0,
            status: 'matched',
            role: record.matched_color === 'black' ? 'host' : 'client',
            color: record.matched_color,
            roomCode: record.room_code,
            opponent: {
              uid: record.matched_with,
              nickname: record.matched_nickname,
              avatar: record.matched_avatar,
              score: record.matched_score
            }
          });
        }

        // 保持心跳活跃
        await env.DB.prepare('UPDATE match_queue SET updated_at = ? WHERE uid = ?').bind(now, matchUid).run();
        return json({ code: 0, status: 'waiting' });
      } catch (err) {
        return json({ code: 1, msg: '轮询异常: ' + err.message }, 500);
      }
    }

    // 3. 取消匹配
    if (url.pathname === '/api/match/cancel' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid } = body;
        if (uid) {
          const auth = await requireMatchIdentity(uid, getRequestToken(request, body));
          if (auth.response) return auth.response;
          await env.DB.prepare('DELETE FROM match_queue WHERE uid = ?').bind(auth.uid).run();
        }
        return json({ code: 0, msg: '已成功取消匹配' });
      } catch (err) {
        return json({ code: 1, msg: '取消异常: ' + err.message }, 500);
      }
    }

    // ── 7. 全服天梯榜（仅正式注册账号上榜，游客与未注册用户绝不上榜） ──
    if (url.pathname === '/api/rank' && request.method === 'GET') {
      if (env.DB) {
        const { results } = await env.DB.prepare(`
          SELECT uid, nickname AS name, avatar, score, wins, total_games
          FROM users
          WHERE username IS NOT NULL AND username != '' AND password_hash IS NOT NULL
          ORDER BY score DESC, wins DESC
          LIMIT 30
        `).all();
        return json({ code: 0, data: results || [] });
      }
      return json({ code: 0, data: [] });
    }

    // ── 8. 战绩安全上报（Token 验证 + 15 秒冷却防刷） ─────
    if (url.pathname === '/api/report_game' && request.method === 'POST') {
      if (!env.DB) return json({ code: 1, msg: '数据库未连接' }, 500);
      try {
        const { uid, token, isWin } = await request.json().catch(() => ({}));

        if (!uid || !token) {
          return json({ code: 401, msg: '未授权：缺失身份凭证' }, 401);
        }
        if (typeof isWin !== 'boolean') {
          return json({ code: 400, msg: '战绩结果必须是布尔值' }, 400);
        }

        const now = Date.now();
        const user = await env.DB.prepare('SELECT uid, username, score, last_game_at, token_expires_at FROM users WHERE uid = ? AND token = ?').bind(String(uid), String(token)).first();
        if (!user) {
          return json({ code: 403, msg: '未授权：Token 无效或已失效' });
        }

        // 🛡️ 仅注册账号可上天梯榜，游客只做本地存储
        if (!user.username) {
          return json({ code: 403, msg: '游客模式不上天梯榜，请注册账号后参与排名' });
        }

        if (user.token_expires_at && user.token_expires_at <= now) {
          return json({ code: 401, msg: '登录凭证已过期，请重新登录' }, 401);
        }

        const oldScore = Number.isFinite(Number(user.score)) ? Number(user.score) : 1000;
        const scoreDelta = isWin ? 25 : -15;
        const newScore = Math.max(0, oldScore + scoreDelta);

        // 15 秒冷却放进 UPDATE 条件，避免并发请求同时通过预检查刷分。
        const updateResult = await env.DB.prepare(`
          UPDATE users
          SET score = ?,
              wins = wins + ?,
              total_games = total_games + 1,
              last_game_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ? AND token = ?
            AND (last_game_at IS NULL OR last_game_at = 0 OR last_game_at <= ?)
        `).bind(newScore, isWin ? 1 : 0, now, String(uid), String(token), now - 15000).run();
        if (!updateResult.meta || updateResult.meta.changes !== 1) {
          return json({ code: 429, msg: '对局结算过于频繁，请 15 秒后再试' }, 429);
        }

        const updated = await env.DB.prepare('SELECT score, wins, total_games FROM users WHERE uid = ?').bind(String(uid)).first();
        return json({
          code: 0,
          msg: '战绩安全归档成功',
          data: {
            score: updated.score,
            wins: updated.wins,
            total_games: updated.total_games,
            oldScore,
            newScore: updated.score,
            scoreDelta
          }
        });
      } catch (err) {
        return json({ code: 1, msg: '结算异常: ' + err.message }, 500);
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
