# 人机 AI 升级计划

## Goal

升级五子棋人机 AI，使主网页、单文件版和 Android 资源统一使用更强的棋力引擎，同时保持联机、禁手和技能干扰流程不变。

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

### Phase 5: AI 引擎审计与统一接入

**Status:** completed

- [x] 确认主网页使用内嵌 AI，旧 `js/ai.js` 未接入
- [x] 确认单文件版由 `index.html` 生成，Android 页面与主网页同源
- [x] 设计棋型评估、强制应手搜索和置换表方案

### Phase 6: 实现最强人机引擎

**Status:** completed

- [x] 重写 `js/ai.js` 为统一强力引擎
- [x] 接入主网页 AI 入口并保留禁手/禁止落点参数
- [x] 同步 Android 资源并更新单文件生成器

### Phase 7: 回归验证与提交

**Status:** completed

- [x] 运行棋力单元测试、网页脚本检查和 Playwright 实际落子测试
- [x] 检查主网页、Android 资源和单文件版同步
- [x] 更新交接文档并提交代码

## Next Step

AI 升级及 v1.0.86 全平台发布均已完成；首屏启动优化和客户端私有仓库更新中转已完成源码验证，待配置 `GITHUB_READ_TOKEN`、部署 Worker 后再打包安装下一 APK。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| PowerShell 变量后紧跟冒号导致解析错误 | 1 | 使用 `${f}` 明确变量边界后重试成功 |
| `PRAGMA table_info` 被只读 SQL 白名单拦截 | 1 | 将常见只读结构 PRAGMA 加入白名单 |
| Playwright 测试脚本首次使用错误的 shell here-string 写法 | 1 | 改用 `apply_patch` 创建脚本后运行成功 |
