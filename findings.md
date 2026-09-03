# 管理员工具升级发现

- 当前工具文件为 `admin.js`，通过 Cloudflare D1 REST API 执行管理操作。
- 现有命令：`users`、`user`、`set-pwd`、`sql`。
- `users` 当前查询并显示 `avatar`、`security_q`，输出容易过宽并被终端截断。
- `user` 当前使用 `SELECT *`，会显示 `password_hash` 前缀和完整 `salt`，不应继续输出。
- `set-pwd` 当前使用旧版 SHA-256 + salt + pepper，并把新密码直接打印出来；服务器已支持 PBKDF2，并保留旧 SHA-256 登录兼容升级逻辑。
- `sql` 当前可以直接执行任意 SQL，存在误写风险。
- `.cloudflare_config.json` 是本地未跟踪配置，管理员工具需要继续读取它，但不能把 token 输出到日志或提交到仓库。
