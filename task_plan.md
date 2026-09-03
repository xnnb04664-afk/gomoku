# 管理员工具升级计划

## Goal

升级项目管理员工具，使其与当前服务器鉴权和 PBKDF2 密码策略一致，减少敏感信息泄露与误操作风险，并补充常用的安全管理能力。

## Phases

### Phase 1: 审计现状与设计命令边界

**Status:** completed

- [x] 记录现有命令、数据库字段和服务器密码兼容逻辑
- [x] 确定安全输出与写操作确认规则

### Phase 2: 实现安全基础与密码重置升级

**Status:** completed

- [x] 改用 PBKDF2 密码哈希并维护 password_algo
- [x] 移除详情中的密码哈希、Salt、密保答案等敏感输出
- [x] 重置密码不再回显明文密码

### Phase 3: 增加安全的用户管理命令

**Status:** completed

- [x] 增加用户资料修改命令
- [x] 增加积分/封禁等命令前的参数校验与确认
- [x] 保留 SQL 能力但默认限制为只读，写 SQL 明确确认

### Phase 4: 验证、文档与提交

**Status:** completed

- [x] 运行语法、帮助、模拟请求和安全扫描
- [x] 更新交接文档中的管理员工具说明
- [x] 提交代码并确认工作区状态

## Next Step

任务已完成；后续如需启用 Worker 端的自动迁移，再单独安排部署。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| PowerShell 变量后紧跟冒号导致解析错误 | 1 | 使用 `${f}` 明确变量边界后重试成功 |
| `PRAGMA table_info` 被只读 SQL 白名单拦截 | 1 | 将常见只读结构 PRAGMA 加入白名单 |
