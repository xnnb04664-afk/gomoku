# 🎮 五子棋项目全量交接文档 (Project Handover Document)

> 💡 **新窗口启动开发者指引**：  
> 当在新会话窗口接手本项目时，只需向 AI 发送指令：  
> **“请先阅读根目录下的 PROJECT_HANDOVER.md，然后继续开发”**，  
> AI 即可完整继承项目的所有上下文、架构设计、技术细节和严格红线规则，无需从头摸索思考。

---

## 一、项目全貌与核心特性 (Overview)

本项目是一款高水准、多主题、全功能的精品五子棋 Web 游戏，适配 PC 端与移动端（支持手机全屏自适应手势操作）。项目包含 6 套独立设计风格的前端版本，且具备免服务器的 P2P 联机、智能人机对战、趣味卡牌干扰系统与丝滑的快捷聊天交互。

### 🌟 核心亮点
1. **6 套高颜值前端主题体系**：涵盖现代浮岛、极简暗黑禅意、新中式宣纸、现代奢华毛玻璃、Clean iOS 暖白手机版、以及粉蓝撞色的情侣专属版；
2. **实时无缝换装与棋局持久化**：在主界面对弈中可一键无缝换装，正在对局的每一步棋子坐标与回合进度通过 `sessionStorage` 100% 保持；
3. **免服务器 WebRTC P2P 联机**：基于公用 PeerJS 信令，双方输入 6 位房间码即可直接点对点建连，零后端维护成本；
4. **🃏 干扰牌技能卡池系统**：开局或重开时**从 6 种技能池中随机抽取 3 张卡牌**，支持选点施法、冰冻结界、迷雾遮罩、平移棋子等，并全量支持 P2P 联机双向数据同步；
5. **💬 快捷短语管理与实时插位拖拽**：横栏支持滑动手感，弹窗内短语支持增删改查与**不透明实时插位换序（Live Reordering）**；
6. **💙 情侣专属阵营**：情侣主题中房主默认执**海盐晴空蓝棋 💙**先行，客方执**草莓蜜桃粉棋 💖**后行。

---

## 二、项目文件清单与架构 (File Structure)

项目所有核心前端文件均位于项目根目录下：

| 文件名 | 风格 / 定位 | 核心视觉与交互特色 |
| :--- | :--- | :--- |
| **`index.html`** | **默认官方主版本** | 晴空浮岛草坪风格，猫爪棋子，右侧/浮动常驻聊天框，**内置无缝换肤引擎**（可在当前页实时切为其他 5 套风格） |
| **`theme1_zen_dark.html`** | **极简禅意暗黑版** | 哑光深色胡桃木棋盘，3D 黑曜石与羊脂白玉棋子，Bento Grid 界面排布，沉浸式音效 |
| **`theme2_neo_traditional.html`** | **新中式宣纸榧木版** | 传统榧木纹理与宣纸质感底盘，水墨黑子与象牙白玉棋子，传统印章点缀 |
| **`theme3_luxury_glass.html`** | **现代奢华毛玻璃版** | Apple HIG / Linear 风格，深邃暗黑冷光背景，高斯模糊毛玻璃悬浮，冷光冷紫宝石质感棋子 |
| **`theme4_clean_ios.html`** | **Clean iOS 暖白版** | 9:16 极简手机版，摄影棚自然柔光，悬浮暖白底盘与抽屉式控制栏，原生 iOS 触控手感 |
| **`theme5_sweet_romance.html`** | **草莓海盐情侣对决版** | 倒角圆润厚亚克力与奶茶烤漆木，**房主默认海盐晴空蓝棋 💙，客方草莓蜜桃粉棋 💖**，心形高光，胜利颁发恋爱甜宠券 |

---

## 三、核心技术模块与实现细节 (Key Implementations)

### 1. 棋盘绘制与几何坐标换算
- **棋盘规格**：15 行 × 15 列标准五子棋盘；
- **自适应渲染**：Canvas 随容器动态计算宽度、高度、边距与网格大小（`gridX`, `gridY`），并结合 `window.devicePixelRatio` 保持高清抗锯齿；
- **点击坐标映射**：
  ```javascript
  const rect = cvs.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) * (cWidth / rect.width);
  const clickY = (e.clientY - rect.top) * (cHeight / rect.height);
  const col = Math.floor((clickX - paddingX) / gridX);
  const row = Math.floor((clickY - paddingY) / gridY);
  ```

### 2. 🃏 干扰牌技能卡池系统 (Skill Card Pool)
- **卡池定义**（包含 6 种技能，在情侣风格中配有专属浪漫名称）：
  1. `rewind`（时空倒流 / 撒娇耍赖）：无需选点，立即回溯撤回上一手棋子（调用 `doUndo`）；
  2. `freeze`（寒冰封禁 / 冷静一下）：需要选空点，对目标点施加 1 回合冰冻结界，双方皆无法落子，Canvas 绘制晶莹冰晶 ❄️；
  3. `double_move`（双星连珠 / 爱的抱抱）：状态卡，激活后本回合落子后赋予额外一次落子特权（连下两子，不切换 `turn`）；
  4. `remove_stone`（虚空陨石 / 奶茶暴击）：需要选点，直接抹除对方一颗棋子；
  5. `shift_stone`（移星换斗 / 偷心盗贼）：两步施法——第一步点击己方一子（金黄光圈高亮），第二步点击相邻 8 格空格，平移棋子并自动重新判定获胜；
  6. `fog_blind`（迷雾遮天 / 蒙上双眼）：需要选点，在指定点释放 3x3 区域半透明云朵遮罩 🌫️，阻挡对手视线 1 回合。
- **抽取与消耗流程**：
  - 开局与每次点击“🔄 重开”时，调用 `drawRandomThreeCards()`：从卡池中随机打乱并抽取前 3 张，渲染到卡槽容器 `#cardSlotsArea`；
  - 卡牌点击后若需选点，进入 `activeSkill` 模式，棋盘上方弹出带有取消按钮的悬浮提示条 `#skillPromptBar`；
  - 使用后打上斜角“已使用”戳印并进入微暗置灰禁用状态。
- **P2P 联机同步**：
  - 通过 `conn.send({ type: 'skill_use' | 'skill_freeze' | 'skill_remove_stone' | 'skill_shift_stone' | 'skill_fog', ... })`，对方收到后立刻同步棋盘状态与特效。

### 3. 💙 情侣风格（`theme5`）房主执蓝机制
- **颜色映射**：`BLACK = 1` 对应海盐芝士晴空蓝（Serenity Blue 💙），`WHITE = 2` 对应草莓蜜桃粉（Peach Pink 💖）；
- **开房逻辑**：
  - 房主建房：分配为 `myOnlineColor = BLACK`，即**房主默认执海盐晴空蓝棋先行**；
  - 客方进房：分配为 `myOnlineColor = WHITE`，即**客方执草莓蜜桃粉棋后行**；
- **玩家卡片与木牌**：
  - P1 设为：`👦 海盐晴空 (房主/蓝棋 💙)`，实体路标木牌指示 `💙 落子中`；
  - P2 设为：`👧 蜜桃草莓 (客方/粉棋 💖)`，实体路标木牌指示 `💖 等待`。

### 4. 💬 快捷聊天与实时插位拖拽系统
- **主界面横栏**：移除了 item 上的 `draggable="true"`，保留纯净的点击快速发送和水平鼠标/触控拖拽浏览（`enableHorizontalDrag`）；
- **自定义短语弹窗**：
  - 支持新增、编辑、删除短语，本地存储于 `localStorage`（键为 `gomoku_chat_custom_phrases` / `gomoku_sweet_chat_custom_phrases`）；
  - **实时换位拖拽**：在弹窗列表内通过 `dragstart` / `dragover` / `dragend` 监听，**拖动项保持 100% 不透明（`opacity: 1`）**并增加浮起阴影；当鼠标滑过相邻项时，利用 `list.insertBefore` 实时换位插位，其他短语丝滑让位，松手后自动同步回数据数组与主界面快捷栏；
  - **默认短语置底**：情侣主题中“`明天外卖奶茶全包啦~ 🧋`”严格排在内置短语最后一位。

### 5. 🌐 WebRTC 免服 P2P 联机机制
- 使用 CDN 引入的 PeerJS；
- 生成带前缀的 6 位房间码（如 `GOMOKU-888888` 或 `SWEET-666666`）；
- 双方直连建立 DataChannel，数据包类型：
  - `move`：落子 `{ r, c, p }`；
  - `chat`：聊天消息 `{ text }`；
  - `profile_sync`：同步双方昵称和头像；
  - `undo_req` / `undo_res`：悔棋申请与弹窗宠溺/同意；
  - `restart`：重开棋局同步；
  - `skill_*`：干扰牌全量同步。

### 6. 🧠 人机 AI 算法
- 采用智能攻防评分启发式评估算法：
  - 连五评分：100000；活四：10000；冲四：1000；活三：1000；眠三：100；活二：100；
  - 动态计算进攻分与防守分：`score = atk * 1.15 + def * 1.0 + (14 - dist)`，既具杀伤力又具防守反击韧性。

---

## 四、⚠️ 最重要用户规则与绝对红线 (CRITICAL RULES)

> ### 🛑 规则 1：打包指令严格约束（最高优先级）
> **用户原话明确规定：“APK和单文件最后我说打包再打包”**。  
> - **绝对红线**：接手本项目的任何 AI 或开发者，**严禁在用户未明确发送“打包”两字前擅自执行任何打包、构建 APK、合成单文件等操作**；
> - 专注于前端功能、界面美化、逻辑开发与自动化测试，静待用户最终明确发出打包指令。

> ### 📌 规则 2：六大主题同步维护
> 每次添加全局通用玩法特性（如新干扰卡、新规则），需要评估是否需在 `index.html` 以及 5 个主题文件中同步补齐，保持 6 个文件的代码质量与特性一致性。

> ### 📦 规则 3：代码更新即刻 Git 提交 (CRITICAL)
> **用户原话明确规定：“以后有更新就git”**。  
> - 只要对项目代码进行了实质性的修复、新增或优化，在验证测试通过后，**必须自动执行 `git add .` 并进行规范清晰的 `git commit -m "..."` 提交**，确保项目的每一步迭代都完整记录在 Git 版本树中！

---

## 五、自动化测试与语法验证指南 (Verification)

在开发修改任何 HTML 文件后，严禁臆测代码正确性，必须使用 Node.js 编译检查所有 `<script>` 块的语法。

### 1. 全量 6 主题综合验证指令
在项目根目录 `d:\小游戏\五子棋` 下执行：
```bash
node -e "
const fs = require('fs');
const vm = require('vm');
const files = ['index.html', 'theme1_zen_dark.html', 'theme2_neo_traditional.html', 'theme3_luxury_glass.html', 'theme4_clean_ios.html', 'theme5_sweet_romance.html'];
let ok = true;
files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const scripts = c.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi) || [];
  scripts.forEach((s, i) => {
    try {
      new vm.Script(s.replace(/^<script[\s\S]*?>/i, '').replace(/<\/script>$/i, ''));
    } catch(e) {
      console.error('ERROR in', f, 'script #' + i, e.message);
      ok = false;
    }
  });
});
if (ok) console.log('✅ ALL 6 THEMES SYNTAX 100% OK!');
"
```

---

## 六、未来可能的功能扩展与优化点 (Next Steps)

若用户提出后续需求，可参考以下预设扩展方向：
1. **更多干扰卡技能扩充**：
   - 强运护盾 / 免死金牌：抵挡一次对方的五连绝杀；
   - 迷魂颠倒：互换双方下一步棋子的落子权；
2. **音效与视效增强**：
   - 引入 Web Audio API 合成各种材质落子音（如黑胡桃木敲击声、冰霜封印音效）；
3. **联机网络断线重连**：
   - 当某方网络波动时，Peer 重连并在建立后自动回传当前 `history` 重构棋盘。
4. **打包发布（待用户下达指令）**：
   - 使用 Inliner 打包单文件 HTML；
   - 使用 Cordova / Capacitor 将项目打包为原生 Android APK。

---
*交接文档更新时间：2026年9月*  
*当前工程状态：6 大视觉风格主题全部调通，风格切换弹窗层级与选项显示彻底修复，AI人机对弈对局状态持久化异常已根治，全主题语法与标签嵌套100%绿色通过，本地 Git 版本管理已就绪。*
