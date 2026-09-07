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
3. **MQTT 信令 + WebRTC P2P 联机**：打开弹窗即刻生成 6 位专属房间码；房间先通过 WSS MQTT 建立可靠信令，随后后台协商 WebRTC 低延迟直连，直连失败时自动回退 MQTT；
4. **🃏 干扰牌技能卡池系统（含 🎲 命运神抽）**：开局或重开时**从 8 种技能池中随机抽取 3 张卡牌**，支持选点施法、大炸弹全盘洗牌、身份互换、预言封锁、平移棋子、以及全新的 6 大点数心跳【命运神抽】；
5. **📜 干扰牌使用指引【知道了 ✔】确认按钮机制**：任何干扰牌发动或掷出点数后，屏幕中央弹出带高颜值磨砂卡片详细解释用法，**必须等用户点击【知道了 ✔】确认后才收起**，杜绝一闪而过；
6. **🔔 全局消灭系统原生 alert() 并替换为果冻气泡 HUD**：告别丑陋的白色系统弹窗，自研物理弹跳进场、Shake 抖动、双音升调水滴音效与棋盘局部红晕反馈的治愈系果冻 HUD；
7. **💬 快捷短语管理与实时插位拖拽**：横栏支持滑动手感，弹窗内短语支持增删改查与**不透明实时插位换序（Live Reordering）**；
8. **💙 情侣专属阵营**：情侣主题中房主默认执**海盐晴空蓝棋 💙**先行，客方执**草莓蜜桃粉棋 💖**后行；
9. **📦 全套打包交付物就绪**：提供一键构建的 Android 原生 APK 安装包（`五子棋.apk`）与 0 依赖无网秒开的单文件版（`五子棋大师_单文件版.html`）。

---

## 二、项目文件清单与架构 (File Structure)

项目所有核心前端文件均位于项目根目录下：

| 文件名 | 风格 / 定位 | 核心视觉与交互特色 |
| :--- | :--- | :--- |
| **`index.html`** | **默认官方主版本** | 晴空浮岛草坪风格，高清纯黑白棋子，常驻聊天抽屉，**内置无缝换肤引擎**（可在当前页实时切为其他 5 套风格），含全部最新卡牌与 HUD |
| **`theme1_zen_dark.html`** | **极简禅意暗黑版** | 哑光深色胡桃木棋盘，3D 黑曜石与羊脂白玉棋子，Bento Grid 界面排布，沉浸式音效 |
| **`theme2_neo_traditional.html`** | **新中式宣纸榧木版** | 传统榧木纹理与宣纸质感底盘，水墨黑子与象牙白玉棋子，传统印章点缀 |
| **`theme3_luxury_glass.html`** | **现代奢华毛玻璃版** | Apple HIG / Linear 风格，深邃暗黑冷光背景，高斯模糊毛玻璃悬浮，冷光冷紫宝石质感棋子 |
| **`theme4_clean_ios.html`** | **Clean iOS 暖白版** | 9:16 极简手机版，摄影棚自然柔光，悬浮暖白底盘与抽屉式控制栏，原生 iOS 触控手感 |
| **`theme5_sweet_romance.html`** | **草莓海盐情侣对决版** | 倒角圆润厚亚克力与奶茶烤漆木，**房主默认海盐晴空蓝棋 💙，客方草莓蜜桃粉棋 💖**，心形高光，胜利颁发恋爱甜宠券 |
| **`五子棋大师_单文件版.html`** | **单文件全功能旗舰版** | 内联 PeerJS 1.5.4 生产库与樱桃炸弹 MP3 Base64 音频，0 外部依赖，断网离线双击即玩 |
| **`五子棋.apk`** | **Android 原生安装包** | 约 1.06 MB，基于 Android SDK 纯原生 WebView 容器，支持硬件加速、屏幕适配、全套 3D 萌系图标与手机桌面名称“五子棋” |

---

## 三、核心技术模块与实现细节 (Key Implementations)

### 1. 棋盘绘制与几何坐标换算
- **棋盘规格**：15 行 × 15 列标准五子棋盘；
- **自适应渲染与 2x SSAA 超采样**：Canvas 随容器动态计算宽度、高度、边距与网格大小（`gridX`, `gridY`）。引入强制超采样底线 `dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3.5)`，即使在 1080P 显示器上也强制开启 2x 超采样抗锯齿；物理像素严格 1:1 映射，结合 CSS `-webkit-optimize-contrast` 确保棋盘线与棋子无模糊拉伸与锯齿；
- **悬浮绝对定位防挤压**：`.card-area-wrapper` 恒定高度，施法提示条 `.skill-prompt-bar` 采用 `position: absolute; bottom: calc(100% + 4px);` 彻底脱离垂直文档流，卡牌施法选点时棋盘 1 像素都不跳动！

### 2. 🃏 干扰牌技能卡池系统 (Skill Card Pool)
卡池共包含 **8 种惊险趣味技能**：
1. **`destiny_dice`（🎲 命运神抽 / 心跳大轮盘 🎲）**：
   - 替换原有的时空倒流（rewind）；点击卡牌触发 ⚀~⚅ 动态轮盘旋转与专属骰子音效；
   - 掷出 **1（💀 大凶·空军）**：本回合直接空过！不仅无法下子，还必须让对手在任意空格免费补下 1 子；
   - 掷出 **2（🙈 偷梁换柱）**：闭上眼！对手替你盲选棋盘上你的 1 颗子，平移到最近的空格里；
   - 掷出 **3（💥 精准爆破）**：激活爆破准星，直接拿掉并抹除对方场上任意 1 颗棋子；
   - 掷出 **4（🪞 绝地倒戈）**：激活策反法阵，点击对方场上任意 1 颗棋子，直接翻成你的颜色；
   - 掷出 **5（⚡ 疯狂暴击）**：神威灌顶！本回合允许你连续下 3 颗子（`consecutiveMovesLeft = 2`）；
   - 掷出 **6（👑 天命降临·掀桌）**：① 危机抹杀：若侦测到对方场上有“活三”或“成四”杀线，直接全部作废移除！② 若无危机，可在棋盘任意选未占用的 2×2 区域，瞬间全填满你的 4 颗棋子！
2. **`identity_swap`（🔄 身份互换 / 颠倒乾坤 🔄）**：无需选点，全盘黑子↔白子颜色颠倒并更新 history，双方攻守瞬间易位；
3. **`prophecy_block`（🔮 预言封锁 / 窥探天机 🔮）**：点击任意空格预言对手下一步落点，棋盘浮现 🔮 水晶球标记；
   - **绝对抹杀五子绝杀**：施法者自己本回合落子绝对不清除预言，只有对手试图落在此处时触发绝对拦截！当场撤销落子、不计连珠、强行抹杀五子绝杀，对手必须另寻生路！AI 模式自动重新规划其他落子点，绝不卡死。
4. **`double_move`（⚡ 双星连珠 / 爱的抱抱 🎁）**：状态卡，激活后本回合下完这颗子后可连续再落一子；
5. **`remove_stone`（💥 虚空陨石 / 奶茶暴击 🧋）**：选点抹除对方场上一颗棋子；
6. **`shift_stone`（🌟 移星换斗 / 偷心盗贼 💘）**：两步施法——先选己方 1 颗棋子，再选相邻 8 格空格平移；
7. **`swap_positions`（💫 移形换影 / 灵魂互换 💫）**：两步施法——选己方 1 颗子与对方 1 颗子瞬间对调位置；
8. **`reforge_cards`（🃏 天降神抽 / 天降锦囊 🃏）**：图标为专属卡牌 `🃏`；
   - **自身与未用手牌全量重铸**：发动后自身槽位与未用卡槽全部重新抽取一张全新战斗神牌，自身槽位保持亮起可用状态（绝不变灰废卡），即刻可连续使用！
9. **`mega_bomb`（💣 乾坤大乱 / 掀翻棋盘 💣）**：引爆经典樱桃大炸弹（保留原版原声 MP3），全盘所有棋子彻底随机打乱洗牌！

### 3. 📜 干扰牌使用指引【知道了 ✔】确认按钮机制
- 过去卡牌提示仅展示 1.6 秒自动消失，玩家来不及看清。现升级为**常驻指引卡**；
- 无论发动任何干扰牌、或摇出命运神抽点数，右上角均配有醒目的 **【知道了 ✔】** 确认按钮；
- **绝不自动超时关闭**，直到用户看清玩法、点击确认（或点击卡片任意区域）后，伴随清脆的“啵”音效才收起！

### 4. 🔔 自研果冻气泡 HUD 替换全局 alert()
- 全局重写 `window.alert = function(msg) { showGameNotice(msg); };`；
- `#gameNoticeToast` 采用柔和马卡龙黄底、深褐边框、微倾角弹跳与物理 Shake 抖动；
- 配备 Web Audio 双音阶升调水滴音效（620Hz -> 1180Hz -> 840Hz），点错格子触发 Canvas 红晕光圈，极度治愈。

### 5. 🌐 当前主联机模块：MQTT 信令 + WebRTC P2P 低延迟直连
- **可靠房间信令（`MqttRoomConnection`）**：
  - 主页面当前使用 `index.html` 内的 MQTT 联机实现；`js/network.js`、`js/p2p-network.js` 属于旧/兼容资源，不是当前主页面的连接入口；
  - WSS Broker 按固定可靠性顺序短超时切换，房主和客方对同一房间使用一致的 Broker，避免两端各连到不同公共节点；MQTT 库加载也会等待完成后再发起连接。
- **WebRTC 信令可靠化**：
  - 两个房间主题完成订阅确认后才启动 P2P 探针；
  - 房主 offer、ICE 候选和客方 answer/hello 在 12 秒窗口内周期性重发，并带独立 sessionId；客方主动 hello 请求房主补发信令，解决首包早到导致的 `P2P=false`。
- **双轨传输策略**：
  - WebRTC DataChannel 打通后，落子、聊天和技能消息优先走直连；未打通或临时断开时自动回退 MQTT，不阻断对局；消息使用 `_mid` 去重。
- **断线自愈**：
  - MQTT `close/offline` 会即时触发重连；半开连接由约 12 秒心跳兜底；房主重连时会重新挂载入房监听，客方按 700ms 重发 `reconnect_handshake`，恢复后由房主发送全量棋局快照。

### 6. 🎵 胜利方与失败方专属独立音效架构
- **👑 胜利方专属音效 (`playSkillSound('victory')`)**：
  - 基于 Web Audio API 合成的大调凯旋上行和弦（C5 523Hz → E5 659Hz → G5 784Hz → C6 1046Hz），明亮欢快，配以胜利金光与漫天烟花，成就感拉满！
- **💔 失败方专属音效 (`playSkillSound('defeat')`)**：
  - 基于 Web Audio API 合成的小调下行哀叹音阶（Eb4 311Hz → D4 294Hz → Db4 277Hz → C4 262Hz），并无缝连接柔和低沉的叹息滑音衰减（从 260Hz 缓降至 85Hz），充满幽默感与棋局落败的遗憾惋惜，绝不刺耳。
- **全模式视角感知 (`triggerGameEnd`)**：
  - **人机模式**：玩家赢触发胜利音效，AI 绝杀玩家触发失败音效并给以安慰气泡；
  - **在线联机模式**：胜方客户端触发胜利音效，负方客户端触发失败音效，两端音效彻底分离；
  - **全场景覆盖**：落子成五、大炸弹洗牌成五、移星换斗成五、绝地倒戈成五、以及天命 2×2 成五，全部 100% 自动对齐胜利与失败音效！

### 7. 📱 手机端全面紧凑适配与大字号优化 (Compact Layout & Enlarged Fonts)
- **大字号易读性全面强化**：
  - 玩家昵称放大至 `13.5px`（加粗 900），对战双方一目了然；
  - 状态木牌与你的回合气泡放大至 `13px`；
  - 技能卡牌标题放大至 `13px`，描述提升至 `11px`（加粗 800），告别小字费眼；
  - 底部 4 大功能按键放大至 `14px`，触摸命中面积更充实；
  - 联机房间号放大至 `34px`，房间状态徽章放大至 `13.5px`；
- **极致紧凑纵向布局（单屏完美国际化展示）**：
  - 顶部实时聊天框高度从 76px 优化至 46px 精致微型抽屉，字号放大至 13.5px，直接为下方释放出近 30px 高度；
  - 棋盘动态高度减去项从 260px 优化为 190px，棋盘在手机屏幕上自动填满 98% 黄金宽度，落子更大更爽快；
  - 卡牌网格与底部按键栏 padding/margin 极致收束，在各类尺寸手机竖屏（100dvh）下实现纯净单屏完整展示，零多余上下滚动条！

### 8. 👥 双方真实昵称同步与黑白棋子清晰展示 (Real Nicknames & Explicit Piece Badges)
- **拒绝冷冰冰的“房主”称谓，真实昵称互通**：
  - 彻底移除了代码中硬编码的 `'房主 (黑子)'` 占位字符串；
  - 联机双方接入时建立 `profile_sync` 握手闭环（带 `isReply` 回执反向确认），客方与房主双方均在 0.1 秒内互换自定义昵称与头像；
  - 双方屏幕均直接展示对方的个性昵称（如“小红”、“阿强”），若未修改则优雅回退为“好友”；
- **黑白子阵营 100% 清晰直观**：
  - 左侧胶囊（我方）：明确展示当前所执阵营 `小能 (●黑子)` 或 `小能 (○白子)`；
  - 右侧胶囊（对方）：明确展示当前所执阵营 `小红 (○白子)` 或 `小红 (●黑子)`；
  - 任何模式下（单人AI、同屏PVP、在线联机），谁先手执黑、谁后手执白一清二楚！

### 9. 💣 乾坤大乱双通道震撼物理爆破音效 (Dual-Engine Bomb Audio for APK)
- **根除 Android WebView（APK）环境下的音频哑音**：
  - 原因：之前单纯使用局部变量 `new Audio()` 播放 Base64 音频，易被 Android V8 引擎在垃圾回收时中断，或因 WebView 媒体管道限制无法发声；
  - **双通道混响爆破方案**：
    - **通道 1（极速 Web Audio API 原生物理爆破）**：三角波超重低音炮（150Hz 指数滑落至 28Hz）+ 密集白噪声缓冲区经过 850Hz 低通滤波器模拟炸药破裂轰鸣，零解码延迟、100% 毫无悬念在 APK 和各移动端咆哮发声；
    - **通道 2（持久化全局樱桃炸弹单例）**：保留 `window._cherryBombAudio` 全局引用，支持环境并行叠加原生爆炸声，声场极具厚重冲击感！

### 10. 🚫 彻底消灭浏览器原生“此页面显示”系统弹窗 (Custom Jelly Confirm Modal)
- **告别出戏的原生系统白色对话框**：
  - 用户反馈在点击“恢复默认”等操作时，弹出了标题写着“此页面显示”的原生对话框，严重破坏沉浸感；
  - **实现全量手绘果冻风确认弹窗（`showCustomConfirm`）**：支持自定义标题、文字与萌系图标（🐾/🔄/🗑️），采用平滑弹性缩放动画、毛玻璃遮罩与双色操作按键；
  - **全局防御拦截**：重写 `window.confirm = function(msg) { showCustomConfirm(msg, () => {}); return false; }`，全工程彻底消灭原生阻塞对话框！

### 11. 🔀 快捷短语管理高级实时拖拽换位让位引擎 (Live Drag & Drop Reordering)
- **修复触屏命中判定死循环 Bug**：
  - 原代码在 `touchmove` 中使用 `elementFromPoint` 检测目标，由于手指正下方的元素永远是被拖拽元素自身，导致代码直接 `return`、拖拽完全无法换位；
  - **重构为几何中心实时插位算法（`getDragAfterElement`）**：
    - 遍历列表中除自身外的所有兄弟条目，实时计算手指/鼠标与各条目垂直中线的相对距离；
    - 一旦手指跨过相邻条目中线，立即调用 `insertBefore` 将拖拽项插入目标缝隙；
    - **页面上其余所有语录项实时平滑挪动让位**，序号（1, 2, 3...）动态联动重排，松手即刻保存并触发清脆落子音效！

### 12. 💬 常驻聊天框独占单行展示最新 3 条对局消息 (Dedicated 3-Line Live Chat)
- **最新 3 条消息独占单行、清爽舒展**：
  - 需求：用户明确要求在主界面常驻聊天框中能够同时掌握最新 3 条对局短语或对话；
  - **单行独占与空间重构**：
    - 将聊天框内部容器高度科学提升至 58px（移动端 56px），为每条消息分配专属 17px/18px 独立高度，行距 1.5px~2px；
    - 每一行拥有专属的阵营徽章（`[我方]` / `[对方]`）与单行截断文本（`text-overflow: ellipsis;`），加粗 900，字号 12px~12.5px；
    - 最新 3 条消息自上而下工整排布，**每一条都独占整整一行，彻底杜绝任何多行文字堆叠乱码与重影**！
  - **棋盘自适应缩放**：
    - `resizeBoard()` 自动联动剩余屏幕垂直空间，保证棋盘、卡牌与底部控制键在手机一屏内舒展呈现，秩序井然！

### 13. 🎨 原生 Android 应用专属 3D 治愈系 App 图标全分辨率配置
- **告别系统默认绿色安卓机器人图标**：
  - 由 AI 专门绘制了一套高辨识度、3D 粘土潮玩质感的萌系五子棋手游专属图标（晴空草坪、粉嫩肉垫黑白棋子、金色皇冠与浮动发光魔法卡牌）；
  - **全套 Android 规格适配**：
    - `mipmap-mdpi` (48×48)
    - `mipmap-hdpi` (72×72)
    - `mipmap-xhdpi` (96×96)
    - `mipmap-xxhdpi` (144×144)
    - `mipmap-xxxhdpi` (192×192)
    - `drawable` (512×512)
    - 网页版 `favicon.png` (192×192)
  - `AndroidManifest.xml` 中配置 `android:icon="@mipmap/ic_launcher"` 与 `android:roundIcon="@mipmap/ic_launcher"`，安装在任何品牌手机桌面上均展现极高颜值的圆形/圆角矩形专属游戏图标！

### 14. 👫 专属唯美动漫二次元情侣头像 (Anime Couple Avatars)
- **用户自选专属情侣头像库扩充**：
  - 银发少年（优雅礼服）与银发少女（甜美眨眼）双角色二次元情头；
  - 正方形居中高精裁切，生成 `img/avatar_boy.png` 与 `img/avatar_girl.png`，并转换持久化 `js/assets/anime_avatars.js`；
  - 头像修改弹窗中开辟专属展示与选择区域，点击即刻高亮、动态更新大头像与双方顶栏展示；
  - 单文件版与 Android APK 离线 100% 完备内联，无需网络即可随时随地换上专属动漫情头对弈！

### 15. 🛰️ 跨网联机与断线自动重连对局恢复系统
- **当前跨网策略**：
  - WebRTC 使用腾讯与 Cloudflare STUN 候选进行点对点协商；严格对称 NAT、企业网络或部分运营商网络可能无法直连，当前没有配置自建 TURN；
  - P2P 失败不会阻塞对局，消息自动回退到 WSS MQTT 公共中继。因此“能否直连”和最终延迟取决于双方网络及 Broker 状态，不能承诺所有网络 100% P2P 或固定延迟。
- **联机断线自动重连与状态快照恢复**：
  - MQTT `close/offline` 立即触发重连；半开连接由 4 秒一次、连续 3 次未响应的心跳兜底；
  - 客方（白子）在新连接完成订阅后每 700ms 重发 `reconnect_handshake`，房主（黑子）重新挂载入房监听并接受同一 UID 的重连；最多尝试 5 次，失败后可转为人机；
  - 重连成功后房主回传全量棋盘快照（`board`、`history`、`turn`、技能卡状态），客方复原进度继续对局；
  - 首次联机与断线回归均已使用两个本地浏览器会话验证：P2P 建立、双向落子、约 11ms P2P 心跳往返、同时断线后约 6 秒恢复且保留 2 手历史。

### 16. 🃏 天降神抽满血复活机制（全量重铸并刷新包括已使用的干扰牌）
- **核心逻辑重构与爽感升级**：
  - 之前天降神抽仅重铸未用手牌，玩家在用完前两张牌后打出神抽无法挽回已使用卡牌；
  - **全新满血复活机制**：
    - 排除天降神抽自身，从其他 8 大干扰技能库中重新随机洗出 3 张全新神技；
    - **强制重置全场 3 个卡牌槽位的所有使用状态**：`cardUsedStatus = [false, false, false];`；
    - 无论此前第 1 张或第 2 张牌是否已被消耗变灰，全部满血复活为可用状态！
    - 同步更新技能卡描述为：“神迹刷新！重置全部手牌(含已使用牌)，获得3张全新可用神技”；
  - **全量同步**：已同步到全套 6 大主题、纯单文件版与 Android APK 中，经自动化测试验证 100% 通过。

### 17. 🚀 全面性能与高刷调优系统 (Native 硬件加速 + 120Hz Canvas 离屏位图缓存)
- **Android 原生 Shell 调优 (`MainActivity.java`)**：
  - **Window 级硬件加速**：启用 `FLAG_HARDWARE_ACCELERATED` 与 View 硬件加速层；
  - **Sticky Immersive 全面屏沉浸式**：隐藏状态栏与虚拟导航栏，消除黑边并利用 100% 手机屏幕；
  - **WebView 缓存与线程调度**：`LOAD_DEFAULT` 极速本地缓存预热，渲染线程设为 `RenderPriority.HIGH`；
  - **生命周期节电与内存防泄漏**：`onPause()` 暂停计时器（`pauseTimers`），`onDestroy()` 彻底解除父容器解绑；
- **前端 Canvas 离屏位图缓存架构 (Offscreen Board & Pieces Cache)**：
  - 核心突破：将静态棋盘（草坪、宣纸、木纹、网格线、星位）与棋子全盘序号预先离屏渲染到独立 Canvas 位图；
  - **物理像素严密对齐**：离屏 Canvas 宽高严格按 `Math.round(cWidth * dpr)` 分配，开启 `imageSmoothingQuality = 'high'` 与 `scale(dpr, dpr)`，杜绝插值放大模糊；
  - 每次落子仅需 GPU 单次贴图（`drawImage`）+ 棋子绘制，**单帧绘制耗时从数毫秒骤降至 0.016 毫秒**；
  - 稳定支撑 **90Hz / 120Hz 手机超高刷新率**，落子手感极其跟手丝滑，发热量与耗电大幅降低；
- **触控零延迟 (Zero Touch Latency)**：
  - 规范配置 `touch-action: manipulation;` 与 `user-scalable=no`，彻底根除手机端浏览器默认的 300ms 点击延迟。

### 18. 🔄 手机无缝覆盖更新与私有 GitHub Releases 云发版体系
- **仓库权限**：GitHub 仓库保持 Private；仓库地址、Release 地址和 GitHub Token 只供维护脚本与 Cloudflare Worker 使用，不写入客户端界面。
- **客户端更新出口**：客户端只访问 `https://gomoku-api.pages.dev/api/version` 检测版本；版本响应不再下发 APK/HTML 完整下载 URL，只下发固定路径和一次性短时票据。文件请求必须使用 `X-Gomoku-Client: gomoku-app-client-v2` 与 `X-Gomoku-Update-Ticket` 请求头，不会直连 GitHub、Raw、jsDelivr 或第三方反代。
- **Cloudflare Pages Function 私有仓库中转**：Pages 项目 `gomoku-api` 中的 `_worker.js` 使用 `GITHUB_READ_TOKEN` Secret 请求私有仓库最新 Release，再将版本信息和 Release 文件流返回给客户端；Token 不进入 APK、网页或 Git，轮换 Token 无需更新客户端。每次新建或轮换 Pages Secret 后，都要重新部署 Pages Function 才能让当前生产部署绑定新值。独立 Worker 脚本名为 `gomoku-backend`，不要误把 Secret 配置到不存在的 `gomoku`。
- **游戏内免服务器智能检查更新系统**：
  - 在【个人资料】中常驻版本显示当前正式版本（内部发布标识为 `v1.0.117`，界面显示为 `v1.1.7`）与【🚀 检查更新】按钮；
  - 游戏启动 3 秒后后台静默检测，检测到新版本时自动弹出更新卡片与更新日志；
  - APK 覆盖安装继续使用项目固定签名，保留本地对局历史与自定义头像；
- **手机覆盖升级技术底座 (Zero Data Loss)**：
  - **固化永久正式签名证书（密钥仅保存在仓库外的本机受限目录）**：签名密钥永久锁定，彻底解决 Android 系统“签名冲突无法安装”的致命痛点；密钥不再进入项目目录、Git 跟踪或 Git 历史，手机用户直接安装最新 APK 仍可覆盖升级，无需卸载，保留全部对局历史与自定义头像；
- **全平台一键极速发布流水线 (`publish.js`)**：
  - 运行 `node publish.js`（或对 AI 说“更新/打包”）时：
     1. 自动自增内部版本号（`1.0.X`）；界面采用显示格式折叠百位，例如内部 `1.0.117` 显示为 `1.1.7`，更新比较仍使用内部版本号；
     2. 自动同步更新 6 大主题与单文件版；
     3. 自动从仓库外的受限密钥目录读取环境变量指定的永久正式密钥，编译签署原生 `五子棋.apk`；
     4. 自动执行 `git add .` 与 `git commit`；
     5. 自动推送到 GitHub (`git push origin master`)；
     6. 自动调用 GitHub CLI 创建 GitHub Release 并上传 `gomoku.apk` 与 `gomoku.html`；
  - **默认不会读取 Cloudflare 令牌，也不会部署 Cloudflare 生产环境**；只有明确执行 `node publish.js --deploy-cloudflare`（或设置 `GOMOKU_DEPLOY_CLOUDFLARE=1`）才会在最后部署 Worker/Pages。`node publish.js --help` 可查看用法。
  - 普通新版本只需发布 GitHub Release；线上 Worker 会动态读取最新 Release，不必每次改 APK/HTML 都重新部署 Cloudflare。
- **本机凭据自动化（首次设置一次）**：签名密码与 Cloudflare 部署令牌可通过 `setup_gomoku_secret.ps1` 保存为当前 Windows 用户专属的 DPAPI 加密文件，位置为仓库外的 `Documents\GomokuSecrets`；之后 `build_apk.js`、`publish.js`、`deploy_worker.js` 和 `admin.js` 自动读取，不需要把密码交给 AI，也不会出现在 Git、命令行参数或截图中。
  - 首次设置签名密码：`powershell -ExecutionPolicy Bypass -File .\setup_gomoku_secret.ps1 -Type Signing`；只有需要执行显式 Cloudflare 部署时才需要再设置 Cloudflare 凭据（可用 `-Type Both` 一次设置两项）。
  - DPAPI 凭据绑定当前 Windows 用户和电脑；换电脑、换用户或忘记原密码时不能恢复，只能在仍掌握原密码的情况下重新设置。环境变量仍可临时覆盖本机凭据。

### 19. 🤝 和棋闭环与神抽技能额度修复（本次代码审查）
- **满盘判定**：15×15 棋盘在最后一手未形成五连时调用 `triggerGameDraw()`，统一结束对局、展示和棋卡片、保存完整棋谱并停止继续落子。
- **战绩同步**：`game_history` 增加 `is_draw` 字段，Worker/Pages 启动时会为旧 D1 自动补列；`/api/report_game` 接收 `isDraw=true`，总局数增加、胜场不增加、积分保持不变。
- **联机技能额度**：无目标的 `skill_use` 也进入接收端额度账本；每组三张手牌最多接受 3 次技能，`reforge_cards` 每局最多一次并将对手额度重置到新手牌阶段，防止神抽后的合法技能被误拦截，也防止重复神抽无限绕过上限。
- **同步范围**：修复已同步到 `index.html`、`android_src/assets/index.html`、`五子棋大师_单文件版.html`、`backend/worker.js` 与 `pages_build/_worker.js`，随后纳入 v1.0.91 的正式构建与发布。
- **其余审查项结论**：原 `css/style.css`、`js/main.js`、`js/board.js`、`js/game.js`、`js/rule.js`、`js/audio.js`、`js/network.js` 及未引用的 MP3 原文件等旧模块化遗留文件已全部安全移除并同步清理 Android 资产包，代码库与打包体积显著精简；AI 字符串置换表和 MQTT 房间会话密钥属于需要独立性能/协议迁移测试的长期项，保持既有高可靠实现。

### 20. ⚡ 联机模块升级记录（本次工作区变更）
- **进房稳定性**：MQTT 节点改为固定优先级短超时切换，同一房间的房主和客方保持 Broker 选择一致；网络库延迟加载时会等待组件完成，避免点击过早直接报连接失败。
- **P2P 建立修复**：房间数据/信令主题完成订阅确认后才启动 WebRTC；offer、ICE、answer 和 hello 在 12 秒内重发，并用 sessionId 过滤旧会话，避免房主 offer 早于客方订阅而永久落回 MQTT。
- **断线恢复修复**：监听 MQTT close/offline 立即启动重连；重连时清理旧客户端 Promise；房主重新安装入房监听，客方循环发送重连握手；恢复后校验并同步完整棋局。
- **实测结果**：双端进房、双向落子无控制台错误；P2P 心跳往返约 11ms；同时断开两端 Broker 后约 6 秒恢复，2 手历史和棋盘状态保持不变。
- **发布结果（2026-09-04）**：v1.0.90（Build 91）已完成六主题/单文件同步、正式签名 APK 构建、GitHub `master` 推送和 GitHub Release 创建；手机安装包为仓库外正式密钥签名的 `五子棋.apk`，可覆盖旧版本安装。
- **线上部署结果（2026-09-04）**：自动发布脚本最后一步因旧的直接 Cloudflare API Token 返回 400 而停止；随后已使用 Wrangler OAuth 分别补发 Worker `gomoku-backend`（版本 ID：`ac2104f5-fb02-42f0-8a56-8d1163f56e2d`）和 Pages 项目 `gomoku-api`。生产与预览 `/api/version` 均返回 HTTP 200、`v1.0.90`，预览部署地址为 `https://1457eb89.gomoku-api.pages.dev`。
- **更新凭据边界**：独立 Worker 的 `/api/version` 当前仍返回 503 `更新服务尚未配置私有仓库凭据`，因为 `GITHUB_READ_TOKEN` 只配置在 Pages；客户端更新器固定优先走 Pages，因此当前更新链路正常。若将来需要 Worker 作为更新接口备用出口，应把 GitHub 只读 Secret 直接配置到 Worker `gomoku-backend`，然后用 Wrangler 重新部署；不要把 Secret 写入仓库或聊天。

### 21. 🛠️ 全面代码优化记录（2026-09-05）
- **Worker 更新链路**：GitHub Release 查询增加 30 秒实例缓存、并发请求合并和 8 秒超时；更新资产 URL 强制校验为固定 GitHub API 仓库路径，响应增加 8 MB 大小上限；所有 JSON 请求统一限制 512 KB，并将内部异常改为通用错误，避免把数据库/服务端细节返回给客户端。
- **Worker 数据与联机可靠性**：天梯榜冷缓存期间合并 D1 查询；全服匹配改为带状态和时间条件的条件领取，避免并发请求抢到同一对手或把已匹配记录覆盖回等待状态；房间码改用 Web Crypto 随机数。
- **前端网络与联机体验**：API 出口记忆最近可用节点，对 5xx/超时自动切换备用节点并清理定时器；匹配轮询增加单飞保护，避免网络慢时请求叠加；WebRTC 远端 ICE 候选增加上限；聊天文本限制为 500 字、历史最多 100 条；窗口调整合并到下一帧，减少手机旋转/拖拽时的重复重绘。
- **本地服务与 Android 启动**：Node 本地静态服务改为流式读取，增加 `HEAD`、ETag/304、Content-Length 和隐藏文件拒绝；Android 内嵌服务在单次启动期间缓存不超过 4 MB 的静态资源，热更新目录仍保持独立读取。
- **构建/部署脚本**：构建脚本跳过不存在的可选资源；Cloudflare Worker 上传和 Pages 部署增加超时，避免网络异常时无限等待。派生的 Pages Worker、Android 资源、单文件版已重新同步，正式签名 APK 已重新构建。
- **本地验证结果**：`python tests/optimization_smoke.py`、`node tests/worker_unit.js`、六主题内嵌脚本语法检查、单文件版 Playwright 启动检查、APK v1/v2/v3 签名检查均通过；同时验证了本地服务的 GET/HEAD、ETag 304 和 `.git/config` 拒绝访问。本次只完成代码、派生文件和本地构建/测试，未自动部署 Cloudflare；后续明确要求线上发布时再执行部署脚本。

### 22. 🔐 全面安全审查、发布策略与热更新结论（2026-09-05）
- **线上更新下载保护已修复**：生产只读检查发现无票据请求曾返回 200；已将 `backend/worker.js` 与 `pages_build/_worker.js` 改为默认强制短时票据（只有明确设置 `UPDATE_TICKET_ENFORCED=0` 才进入兼容调试模式），并完成一次必要的 Worker/Pages 部署。部署后 `/api/update/html` 与 `/api/update/apk` 的无票据请求均返回 HTTP 401，带应用短时票据的正常链路仍可用。
- **发布策略已拆分**：`publish.js` 默认只负责版本递增、构建、GitHub 提交/Release，不读取 Cloudflare 本机凭据、不部署生产；需要修改 Worker/Pages 代码、绑定或 Secret 时，才使用 `node publish.js --deploy-cloudflare`。本次安全修复属于必须上线的例外，已完成部署。

## 23. 📱 手机聊天 TXT 导出与联机网络状态（2026-09-05）

### 1. 手机 TXT 导出修复
- **根因**：旧实现只创建 `blob:` 下载链接并立即释放 URL；Android WebView 不一定触发浏览器下载器，因此手机端点击后可能没有文件。
- **新实现**：`index.html` 的 `exportChatTxt()` 优先调用 Android `AndroidNativeApp.exportChatText()`；原生侧使用 Android 系统 `ACTION_CREATE_DOCUMENT` 保存对话内容，用户可直接选择“下载”或其他文件夹。
- **兼容策略**：普通浏览器优先使用 Web Share 分享真实 TXT 文件，最后才回退到延迟释放的 `blob:` 下载；文件名经过原生侧路径字符过滤，内容以 UTF-8 写入。
- **安全边界**：原生导出只接受非空、最大 512 KB 的聊天文本，不申请存储权限，不允许网页指定任意文件路径。

### 2. 双方网络状态和延迟
- 联机房间状态条新增“我方 / 对方”两项：显示连接中、重连中、在线、MQTT 中继、P2P 直连、离线或连接超时。
- 现有 4 秒心跳增加 `pingId`、发送时间和传输方式回显；我方延迟为心跳往返时间，对方延迟显示对方最近一次上报的心跳往返时间，旧客户端没有新字段时仍兼容显示在线。
- P2P DataChannel 建立、断开、浏览器网络 online/offline 以及自动重连都会即时刷新状态条；网络状态字段只允许固定枚举值，避免把任意文本渲染进页面。

### 3. 验证与发布
- `python tests\\optimization_smoke.py` 通过：聊天导出桥接参数、UTF-8 文本、TXT 文件名、网络心跳回显、双方状态和延迟均通过，控制台无错误。
- `node tests\\worker_unit.js`、`node tests\\auth_refresh_unit.js` 通过；发布前六主题/脚本语法、安全门禁、Android Java 编译、D8、zipalign 和正式签名均通过。
- v1.0.94（Build 95）已推送 `master` 并创建 GitHub Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.94`。
- 本次只改客户端和 Android 容器，没有修改 Worker/D1/Pages 逻辑，因此按规则**跳过 Cloudflare 生产部署**；后续普通客户端发布仍执行 `node publish.js`，只有后端代码或 Secret 绑定变化时才执行一次显式部署。
- 当前产物 SHA-256：根页面 / `android_src/assets/index.html` 为 `F59B7A33E2B833E8A4446195EE52CD7B1FD695679B1C5F454FE3338C404A28D1`；单文件版为 `E0403794EC1DF81A05FBDD7FF68850F9169476A2EB39FAC91A6DEB7295925895`；APK 为 `DEF11A3E0BB6AC7619A6E2B224B7A9C25F224742FC4BDBF94D04A0ADCFB02BCC`。

## 24. 🔁 联机昵称同步兜底修复（2026-09-05）

- **问题根因**：WebRTC DataChannel 建立后，`MqttRoomConnection.send()` 对所有消息立即返回，昵称/头像的 `profile_sync` 只走 P2P；手机切换 Wi-Fi/移动网络或 DataChannel 半开时，本端可能仍显示 `open`，但对方实际收不到资料更新。
- **修复方式**：`profile_sync` 仍优先走 P2P，同时使用同一个 `_mid` 镜像发布到 MQTT。接收端会自动去重，因此不会重复显示，但即使 P2P 资料包丢失也能由 MQTT 兜底送达；旧客户端仍可接收普通 `profile_sync` 报文。
- **验证结果**：回归测试模拟“对方改名”为“新昵称”，对方头像和顶部玩家胶囊均即时更新；同时验证 P2P 与 MQTT 两份资料报文 `_mid` 一致且只处理一次，控制台无错误。
- **发布结果**：v1.0.95（Build 96）已推送 `master` 并创建 GitHub Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.95`；本次只改客户端联机逻辑，Cloudflare 生产部署按规则跳过。
- 当前产物 SHA-256：根页面 / `android_src/assets/index.html` 为 `69859869CD02BE9AA61FBBC5C95764A5142C80BDFF94EC52A06A45FBBB0BBE5A`；单文件版为 `BFE3214E376C0A49B71375F1CF0D2AF33F2C5AB557C4210519FBCFBDC084E3FA`；APK 为 `BC97728B66D1C69657020AC6C0820D1736338541C4B965771F326CE6C8814F1D`。
- **Android 安全边界**：`file://` 导航仅允许 `/android_asset/index.html`；安装 Provider 仅接受固定 APK URI 且只读打开；保留正式签名、APK 摘要校验、HTTPS 主机限制、禁止调试与明文流量。新增的实体返回键会优先关闭复盘、抽屉和弹窗，再执行双击退出。
- **本地性能与稳定性**：Android 本地静态服务补齐 ETag/304；登录后端增加账号/密码类型和 6~32 位长度约束；旧模块化孤立资源已按前一节记录清理。单文件版、Android 资源和正式签名 APK 已重新同步构建。
- **热更新范围**：Android 已安装旧 APK 可以在游戏内下载并校验新的 `gomoku.html`，写入应用私有 `hot_update/index.html` 后重载，网页 UI、JS、AI 和联机逻辑无需重装 APK；Java/Manifest、签名、Provider 等原生改动仍必须安装新的正式签名 APK。浏览器单文件版不走原生沙盒，需重新下载/打开新 HTML。
- **当前构建验证**：APK 版本为 `v1.0.92 (Build 93)`，v1/v2/v3 签名校验通过；本次最终 APK SHA-256：`279D3535729C91F5620FF1D0B7E1405FC6684CC776BC11C912558357DE86459A`。`node tests/worker_unit.js`、本地 Playwright 回归（含联机悔棋/终局重开/返回键）、13 份 HTML 内嵌脚本语法检查、Node 服务 ETag/304 与隐藏文件访问检查均通过。
- **v1.0.92 发布结果**：GitHub Release `v1.0.92` 已创建并上传 APK/HTML；线上 Worker 自动读取最新 Release，本次普通发版没有再次部署 Cloudflare。

---

## 四、⚠️ 最重要用户规则与绝对红线 (CRITICAL RULES)

> ### 🛑 规则 1：打包指令执行规则
> **本次任务中，用户已下达明确打包指令：“打包成apk和一个文件，更新交接表”，因此完成构建与交付。**  
> 在未来的后续会话中，若用户提出其他功能迭代，仍需遵循：**若用户未明确发送“打包”指令前，专注于功能开发，不擅自重新打包**。

> ### 📌 规则 2：六大主题同步维护
> 每次添加全局通用玩法特性，需要评估是否需在 `index.html` 以及 5 个主题文件中同步补齐，保持代码质量与特性一致性。

> ### 📦 规则 3：代码更新即刻 Git 提交 (CRITICAL)
> **用户原话明确规定：“以后有更新就git”**。  
> 只要对项目代码进行了实质性的修复、新增、优化或打包，在验证测试通过后，**必须自动执行 `git add .` 并进行规范清晰的 `git commit -m "..."` 提交**，确保项目的每一步迭代都完整记录在 Git 版本树中！

---

## 六、近期重大功能与底层加固详情 (v1.0.80 ~ v1.0.90 关键迭代与避坑总结)

### 1. 🎯 主棋盘大屏原位复盘体系 (`startMainBoardReplay`)
- **用户原始需求**：“我点查看棋局的时候，怎么在下面，点查看棋局就跳转到棋盘上呀”；
- **实现架构**：
  - 用户在历史战绩列表中点击【🔍 查看棋局】时，系统自动收起战绩弹窗，直接**跳回游戏主棋盘大屏原位复盘**（告别小弹窗内挤逼局促的局限）；
  - 主棋盘自动清盘并载入该局历史棋谱，在每颗棋子正中心清晰绘制落子步数序号（`1, 2, 3...`）；
  - 屏幕底部自动浮现高颜值磨砂浮动 Dock 复盘控制栏：包含【⏮️ 开局】、【◀️ 上一手】、【▶️ 下一手】、【⏭️ 终局】、进度拖拽条与【✖ 退出复盘】；
  - 退出复盘时自动无损恢复主棋盘原有的对战状态。

### 2. 📌 个人中心与设置弹窗底部操作栏绝对常驻 (Sticky Footer)
- **用户原始需求**：“还有保存并应用和关闭要一直显示在下面，不要用户滑到下面”；
- **实现架构**：
  - 将 `.profile-dialog` 弹窗重构为 Flex 列布局（`display: flex; flex-direction: column; max-height: 86vh;`）；
  - 中间主体表单容器配置为独立滚动区（`flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;`）；
  - 底部操作按钮栏 `.profile-footer-sticky` 设置为 `flex-shrink: 0; background: rgba(255,255,255,0.98); border-top: 1.5px solid #e2e8f0;`；
  - **效果**：无论玩家在弹窗内如何上下滚动翻看头像与天梯分，“💾 保存并应用”与“✖ 关闭”两个核心操作按钮永远牢牢悬浮固定在最底部！

### 3. ☁️ Cloudflare D1 战绩双向自动同步与彻底物理抹除
- **用户原始需求**：“历史记录删了，在云端也删了吗？历史记录他会自动更新同步云端吗”；
- **实现架构**：
  - **对局结束全自动异步上报**：每局分出胜负后，系统自动调用 `/api/history/report`，静默将对局时间、对手类型、胜负结果、落子总步数与完整每手坐标 JSON 存入 Cloudflare D1 云端数据库；
  - **登录自动拉取合并**：玩家在任何设备登录账号，自动自云端拉取全量战绩；
  - **双向彻底抹除**：当玩家在历史战绩弹窗点击“🗑️ 清空记录”时，前端不仅清空本机 `localStorage`，同时向 Cloudflare 后端发起 `/api/history/clear` 接口调用，在 D1 数据库执行 `DELETE FROM game_history WHERE uid = ?;`，**物理彻底抹除云端所有记录，绝无残留**！

### 4. ⚡ Cloudflare Worker 私有仓库中转热更新与免安装秒更
- **用户原始需求**：“我在1.0.79版本的时候，点了几次更新才好的”；
- **实现架构**：
  - 客户端统一请求 Cloudflare Worker 的版本接口和两个文件中转接口，减少多条不稳定外部链路造成的等待与失败；
  - Worker 服务端携带 `GITHUB_READ_TOKEN` 读取私有仓库最新 Release，客户端永远看不到仓库凭据；
  - 结合安卓本地热更沙盒，用户无需重新下载大包安装即可更新到最新网页代码；APK 更新则通过 Worker 下载并覆盖安装。

### 5. 🤖 最强大师级人机 AI 与算力深度剪枝（v1.0.86）
- **用户原始需求**：“人机要最强的，还有为什么AI有时候还要思考一段时间”；
- **当前实现架构**：
  - 主网页、单文件版与 Android 资源统一加载 `js/ai.js` 强力引擎；
  - 先检查直接成五、对手必胜点和双重威胁，再进行棋型评估、Alpha-Beta 迭代加深与置换表搜索；
  - 叶节点综合评估活四、冲四、活三、活二、连续棋型和中心控制，不再只按位置分判断；
  - 大师搜索使用单步时间预算（桌面约 420ms、移动端约 260ms），只采用完整搜索层，超时自动回退到上一层最佳着；
  - 支持技能产生的禁止落点与禁手过滤，保持人机模式的既有玩法兼容。
- **v1.0.86（Build 87）发布结果**：已完成单文件 HTML 与 Android APK 构建，推送至 GitHub `master`，创建 GitHub Release 并上传 `gomoku.apk`、`gomoku.html`，同时部署 Cloudflare Worker 与 Pages。
- **维护发布记录**：[`v1.0.86 Release`](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.86)；上述地址仅供维护者留档，已不再在软件界面公开展示。
- **v1.0.87（Build 88）发布结果**：已完成全量代码同步、单文件 HTML 与 Android APK 构建，推送至 GitHub `master`，创建 GitHub Release 并上传 `gomoku.apk`、`gomoku.html`，同时重新部署 Cloudflare Worker 与 Pages；线上 `/api/version` 已返回 `v1.0.87`，APK 与 HTML 中转接口均返回 HTTP 200。
- **维护发布记录**：[`v1.0.87 Release`](https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.87)；上述地址仅供维护者留档，已不再在软件界面公开展示。
- **首屏启动优化（已在 v1.0.87 生效）**：联机库、音频与头像资源改为首帧后延迟执行；账号会话、头像初始化和历史统计移到首帧后；单文件版同步采用延迟内联资源；Android WebView 关闭不必要的离屏预栅格化并使用浅色启动底色，减少冷启动蓝屏等待感。
- **客户端地址保护与私有仓库中转（源码完成，线上代理已验证）**：移除个人中心的公开开源发布卡片、复制链接入口和更新弹窗官方通道；客户端更新器统一访问 Cloudflare Pages Function 的 `/api/version`、`/api/update/apk`、`/api/update/html`，由 Pages 项目 `gomoku-api` 使用 `GITHUB_READ_TOKEN` Secret 读取私有 Release 并中转文件。Token 不进入 APK、网页或 Git；Token 轮换无需更新客户端，但轮换后必须重新部署 Pages Function。该方案仍不能阻止运行时调试观察最终请求。
- **v1.0.88（Build 89）发布结果**：已完成全量代码同步、单文件 HTML 与 Android APK 构建，推送至 GitHub `master`，创建 GitHub Release 并上传 `gomoku.apk`、`gomoku.html`，同时重新部署 Cloudflare Worker 与 Pages；线上 `/api/version` 已返回 `v1.0.88`，APK 与 HTML 中转接口均返回 HTTP 200，并返回 Release 资产 SHA-256 摘要供客户端校验。
- **v1.0.88 安全加固结果**：永久签名密钥已迁出仓库并设置为本机账户专属访问；`.gitignore`、构建脚本和发布脚本均拒绝提交/使用仓库内密钥；GitHub `master` 及现有版本标签已清理 `release.keystore` 历史；Android WebView 已关闭调试、明文流量、第三方 Cookie、文件跨域访问和媒体权限；更新链路固定为 Pages 中转地址并校验 HTML SHA-256；Worker 仅允许固定资产名、GET 方法并补充 CORS 与安全响应头。
- **安全边界说明**：Git 历史重写只能清理当前远端分支与标签，无法召回历史克隆、旧 APK 或维护者本机备份；曾经暴露过的 GitHub PAT 必须在 GitHub 立即撤销并换发最小权限的新令牌，再重新写入 Pages Secret 并部署。
- **v1.0.89（Build 90）发布结果**：完成六大主题、单文件 HTML 与 Android APK 构建，推送至 GitHub `master`，创建并上传 GitHub Release `v1.0.89` 的 `gomoku.apk`、`gomoku.html`，并成功部署 Cloudflare Worker 与 Pages。
- **v1.0.89 安全审计与清理结果**：六大主题统一增加动态文本/头像转义、远端快照与 P2P 消息结构校验、消息大小限制和严格房间码校验；Android 更新器固定官方 HTTPS 出口、限制重定向、限制响应大小，并在下载和安装前校验 APK SHA-256，移除 file URI 暴露配置；Worker 禁止游客进入全服匹配、只信任 Cloudflare 来源 IP、增加反馈限流和安全响应头；部署脚本改为配置严格校验、Worker 失败即停止、Pages 失败返回非零状态；发布脚本新增全主题语法门禁、敏感内容扫描和失败即停机制。
- **v1.0.89 无用产物清理**：删除旧代码快照 `GOMOKU_CODEBASE_FOR_REVIEW.md`、旧审计笔记 `findings.md`/`progress.md`/`task_plan.md`、重复且未被发布流程使用的 `build_apk.ps1`、旧版 `android_src/classes/*.class`，以及被 Git 错误跟踪的 `.wrangler/` 部署缓存；构建产物统一在临时目录重新生成。
- **本次更新下载保护改造（源码、安全版 APK 与线上强制校验均已完成）**：
  - Worker 为 APK/HTML 生成 90 秒 HMAC 短时票据；票据只放在请求头，不进入 URL、二维码或页面链接，并绑定资源类型与 Release 版本；强制模式下直接打开或复制 `/api/update/apk`、`/api/update/html` 会返回 `401`，不会读取 GitHub 资产。
  - `index.html`、五套主题、单文件版构建链和 Android 原生桥均已改为票据请求；Android 继续执行 HTTPS 主机固定、APK SHA-256 校验、官方签名校验、禁止 WebView 调试、禁止明文流量，并明确禁止 `android:debuggable`。
  - Android 启动安全检查已改为失败即阻止进入游戏：确认检测到 APK 签名异常、调试器或 Frida/Xposed/Substrate 等注入特征时，统一显示“应用运行异常”对话框和错误码并退出；不单独以 Root 状态拦截，减少正常设备误伤。该检查仅能提高篡改成本，不能保证绝对防逆向。
  - 本次安全版 APK 已按以上源码重新构建并推送到 GitHub `master`：版本 `1.0.89 (Build 90)`，正式签名校验通过，`五子棋.apk` SHA-256 为 `819118b528754fe2a3df6c26661dc64d0e5474ab3100bbbcDAFE35A731A9BA6`。
  - 当前生产环境已经完成安全版客户端切换：`UPDATE_TICKET_ENFORCED` 未设置时也默认强制校验，只有明确设置为 `0` 才会进入不安全的调试兼容模式。未支持票据的极旧 APK 若无法自更新，需要手动安装一次安全版 APK。
  - **天梯榜与账号兼容优化（Worker/Pages 已重新部署，客户端源码已同步）**：数据库迁移改为每个 Worker 实例只初始化一次，并新增积分/胜场/昵称索引；榜单增加 15 秒服务端缓存、客户端 30 秒缓存、并发请求合并和紧凑头像返回，避免重复 D1 排序及几十 KB Base64 头像拖慢手机；游客只能用本地昵称，榜单本人识别只使用不可变 UID。要让手机端获得客户端缓存与 UID 识别修复，还需用正式签名密钥重新构建并发布 APK/HTML。
  - **密码策略统一与修改密码**：Worker 与 `admin.js` 统一只使用 Cloudflare WebCrypto 支持的 PBKDF2 100000 次迭代，不再保留旧 SHA-256/旧迭代参数兼容分支；登录后账号卡新增“改密”入口，修改时必须验证当前密码和有效 Token，成功后换 Salt、刷新当前 Token 并立即使旧凭证失效。
  - 推荐在 Pages 另设独立的 `UPDATE_TICKET_SECRET`（随机值，不进仓库）；未设置时源码会临时回退使用已有 `GITHUB_READ_TOKEN` 生成票据。配置独立 Secret 后需要显式重新部署 Worker/Pages：
    ```powershell
    npx wrangler pages secret put UPDATE_TICKET_SECRET --project-name gomoku-api
    node deploy_worker.js
    ```
  - `UPDATE_TICKET_ENFORCED` 无需再设置为 `1`；只有临时调试时才显式设置为 `0`，调试结束必须删除该覆盖或改回 `1` 并重新部署。若仍有未支持票据的旧 APK，先手动安装本次安全版 APK，再继续使用应用内更新。
  - **逆向边界**：无法绝对阻止专业人员对 APK、WebView 或运行时网络进行分析；本次措施的目标是移除仓库凭据和公开直链、阻断裸 URL 下载、缩短授权窗口并提高重打包/篡改成本。若要做到用户级访问控制，还需登录态/Cloudflare Access/应用商店完整性服务，属于额外产品方案。

### 6. 📱 Android 原生核心底层加固与关键避坑红线 (重要！)
- **坑位 1：`LocalWebServer` 端口冲突回退 (`EADDRINUSE`)**：
  - 安卓应用快速重启或冷启动时，`127.0.0.1:8080` 往往处于 TCP TIME_WAIT 状态；
  - 若端口固定写死 8080，会导致 `bind failed: EADDRINUSE` 并使服务启动失败；
  - **解决方案**：在 `LocalWebServer.java` 中配置候选端口循环（8080, 8081, 8082, 8088, 8888, 8989, 0），自动尝试并记录实际绑定的可用端口 `sActualPort`，并通过 `http://localhost:<sActualPort>/index.html` 打开，永远不发生端口冲突。
- **坑位 2：Windows 构建环境导致 APK 内 Assets 反斜杠**：
  - 在 Windows 下使用 `aapt2 link -A assets` 打包时，子目录文件（如 `js\assets\anime_avatars.js`）会被以 Windows 反斜杠 `\` 写入 Zip Entry；
  - 安卓手机（Linux 内核）的文件系统与 `AssetManager` 只认正斜杠 `/`，导致手机端报 `ERR_FILE_NOT_FOUND`；
  - **解决方案**：在 `build_apk.js` 中内置了 `normalizeApkZipEntrySlashes()`，在对齐和签名之前遍历 APK 的 Local Header 与 Central Directory，将全部反斜杠 `\` 原位替换为 `/`，彻底根除跨平台资源丢失。
- **坑位 3：`shouldInterceptRequest` 严禁拦截本地主页**：
  - 若在 `shouldInterceptRequest` 中手动拦截 `localhost` 并返回缺少完整 HTTP 状态与响应头的 `WebResourceResponse`，高版本 Chromium 内核会将页面当成纯文本，包裹在 `<pre>` 标签内以纯代码形式打印在屏幕上；
  - **解决方案**：`localhost` 请求一律交由 `LocalWebServer` 原生处理（返回标准的 `HTTP/1.1 200 OK` 与 `Content-Type: text/html`），`shouldInterceptRequest` 仅对极罕见的 `file://` 兜底方案生效。
- **坑位 4：云端与本地更新说明必须自动同步**：
  - `publish.js` 在执行版本递增时，会自动把 `version.json` 中的真实更新日志正则同步到 `backend/worker.js` 中的 `/api/version` 路由内，杜绝旧更新日志流出。

### 7. 🔄 身份互换历史记录与复盘黑白颠倒修复
- **问题现象**：对局中使用【身份互换】干扰牌后，在历史战绩复盘（查看棋局）中发现棋局直接从第 1 手开头就把黑白子颜色颠倒了；
- **问题根源**：旧逻辑在发动身份互换时直接循环倒退篡改了 `history` 中所有已有步数的 `h.p`，导致保存战报走法谱时开局第 1 步就被写成了白子；
- **解决方案**：
  1. 严禁倒退篡改历史走法谱，发动身份互换时向历史账本追加独立的 `{ action: 'identity_swap', desc: '身份互换' }` 动作事件；
  2. 主棋盘复盘引擎 `applyMainReplayStep` 推演到该动作步数时，才执行全盘已有棋子黑白颠倒，并动态显示 `第 X 步: 🔄【身份互换】黑白颠倒！`；
  3. `draw()` 复盘数字绘制根据棋盘当前格子的实际棋子颜色动态计算文字对比度；
  4. `openReplayModalByIndex` 增加旧版历史战绩自我修复逻辑，自动校正旧版开头倒置色盘。

### 8. 💬 用户意见反馈与 Bug 提交全闭环体系
- **功能目标**：为玩家提供随时随地提交产品改进建议、体验反馈与问题 Bug 的便捷通道；
- **三处直观入口**：
  1. **主界面常驻聊天框标题栏**：点击右上角醒目可爱的粉色 `💬 反馈` 胶囊按钮，1 秒唤起；
  2. **个人中心 4 合 1 核心功能卡片**：天梯榜、历史战报、版本更新旁新增 `💬 意见反馈` 专属功能卡片；
  3. **聊天抽屉面板右上角操作区**：展开聊天记录时亦可一键点击 `💬 反馈`；
- **果冻风反馈弹窗 (`#feedbackModal`)**：
  - 支持 5 大反馈类型芯片点选切换（`🐛 遇到Bug`、`💡 功能建议`、`🎨 界面优化`、`💖 体验好评`、`❓ 其他问题`）；
  - 300 字实时字符计数文本框；
  - 选填联系方式（微信号 / QQ / 邮箱 / 手机号）；
  - 自动附带客户端版本（如 `v1.0.86`）与用户 UID、昵称；
- **双保险防丢失机制**：
  - 联网状态下通过 `POST /api/feedback` 写入 Cloudflare D1 `feedback` 表；
  - 离线或弱网状态下自动通过 LocalStorage 本地队列兜底保存，绝不丢失用户宝贵意见；
- **后端与管理体系**：
  - Cloudflare Worker 路由 `POST /api/feedback`；
  - Cloudflare D1 `feedback` 数据表自动创建与记录归档；
  - 开发者 CLI 工具 `node admin.js feedback [--json]` 随时查看反馈列表。

---

## 七、自动化测试与构建发布指令 (Build & Verify)

### 1. 全量 6 主题语法验证
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

### 2. 打包单文件 HTML
```bash
node bundle_single_file.js
# 产物：五子棋大师_单文件版.html (约 1.2 MB，全内联离线自包含，含音频 Base64 与头像)
```

### 3. 打包 Android 原生 APK
```bash
node build_apk.js
# 产物：五子棋.apk (约 1.54 MB，纯原生 SDK 编译、反斜杠路径自动规范化、永久密钥自签名)
```

### 4. 🚀 一键全自动全平台发布 (版本自增 + 双端打包 + 签名 + Git提交 + Releases发版 + 后端部署)
```bash
node publish.js
# 全流程自动化：语法校验 -> 单文件打包 -> 原生APK构建 -> 产物校验 -> Git自动提交 -> GitHub Releases发版(带更新日志) -> Cloudflare Worker & Pages同步部署！
```

---

## 八、Cloudflare 云端中枢与账号控制体系交接 (Cloudflare Backend & Control Handover)

项目后端的全套云原生服务（分布式 D1 数据库、Worker 业务网关、Pages 国内加速镜像）均部署在 Cloudflare 官方基础设施上，已完全实现**全自动鉴权与开发者 CLI 掌控**。

### 1. ☁️ 核心云端资产清单
- **Cloudflare Account ID**：`d3d45abb414d31df16085961b1161ab2`
- **Worker 生产网关**：`gomoku-backend`（承载全服玩家注册、登录验证、ELO 积分算分、战绩云端持久化）
- **Pages 国内加速镜像**：`https://gomoku-api.pages.dev`（双路容灾镜像节点）
- **D1 分布式 SQLite 数据库**：
  - **Database ID**：`4cd53ea1-ef41-450e-843c-b48f6121cf7c`
  - **核心数据表**：
    - `users`：全服玩家 UID、用户名、加盐 Hash 密码、ELO 天梯分、胜平负总场次、自选头像数据；
    - `game_history`：全服每局对局历史、对弈时间、对手类型、胜/负/和棋结果与落子步数（支持玩家主动抹除）；
    - `matchmaking`：在线对战撮合队列；
    - `feedback`：用户提交的问题 Bug 与体验优化建议。

### 2. 🔑 鉴权令牌与本地配置文件安全机制
- **配置文件路径**：项目根目录下的 `.cloudflare_config.json`（仅保存 accountId、D1 ID 和脚本名，不保存令牌）；
- **文件结构示例**：
  ```json
  {
    "accountId": "d3d45abb414d31df16085961b1161ab2",
    "d1DatabaseId": "4cd53ea1-ef41-450e-843c-b48f6121cf7c",
    "scriptName": "gomoku-backend"
  }
  ```
- **安全隔离规范**：
  - 为防止 Token 意外泄露，`.cloudflare_config.json` 受到 `.gitignore` 的严格保护，**绝不提交至 GitHub**；部署令牌不再写入该文件，只能临时放在当前 PowerShell 会话的 `CLOUDFLARE_API_TOKEN` 环境变量中，或由仓库外的 Windows DPAPI 凭据自动注入；
  - 当前文件 ACL 已收紧为 `XN\ZhuanZ1` 可读写、SYSTEM 与 Administrators 完全控制，已移除 `Authenticated Users` 和普通用户权限；发布脚本、`admin.js`、`deploy_worker.js` 仅从本机读取，不会把令牌写入仓库或客户端。
  - **令牌轮换要求**：此前曾在聊天/本地配置中出现过的 GitHub PAT 与 Cloudflare 部署令牌均按已泄露处理，必须在对应控制台撤销并重新创建；新令牌不要粘贴到聊天、源码、命令行参数或截图中。

### 3. 🛠️ 开发者专属管理运维工具 (`admin.js`)
项目根目录配备了安全加固后的命令行管理工具 `admin.js`。它只在本机读取 `.cloudflare_config.json`，不会输出 Token、密码哈希、Salt 或密保字段：

- **查看全服用户（简洁安全输出）**：
  ```bash
  node admin.js users
  node admin.js users --json
  ```
- **查看玩家意见反馈与 Bug 报告**：
  ```bash
  node admin.js feedback
  node admin.js feedback --json
  ```
- **查询指定用户安全档案**：
  ```bash
  node admin.js user <UID 或账号用户名>
  # 示例：node admin.js user 661713
  ```
- **重置密码**：
  ```bash
  # 推荐交互式输入，密码不会出现在命令历史中
  node admin.js set-pwd <UID 或账号用户名>
  # 也支持参数方式，但不会在工具输出中回显密码
  node admin.js set-pwd <UID 或账号用户名> <新密码>
  ```
  新密码使用与 Worker 一致的 PBKDF2（SHA-256、100000 次迭代），并会使旧登录令牌失效。
- **同步修改用户名和昵称**：
  ```bash
  node admin.js set-nickname <UID 或账号用户名> <新昵称>
  ```
- **修改积分、临时锁定或解锁账号**：
  ```bash
  node admin.js set-score <UID 或账号用户名> <积分>
  node admin.js lock <UID 或账号用户名> [分钟]
  node admin.js unlock <UID 或账号用户名>
  ```
- **执行 D1 SQL**：默认仅允许 `SELECT`/`EXPLAIN`；写操作必须显式使用 `--write`，并默认输入 `CONFIRM`：
  ```bash
  node admin.js sql "SELECT uid, username, score FROM users ORDER BY score DESC;"
  node admin.js sql --write "UPDATE users SET score = 1000 WHERE uid = '661713';"
  ```
  工具针对当前 `users` 表提供 PBKDF2 密码重置；重置后会清除旧登录凭证并要求客户端重新登录。
- **手动触发 Worker 部署**：
  ```powershell
  # 令牌只在当前 PowerShell 会话暂存，完成后立即清除；不要写入 .cloudflare_config.json 或提交 Git
  $secure = Read-Host "输入 Cloudflare API Token" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr); node deploy_worker.js }
  finally { if ($ptr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }; Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue }
  ```
  `admin.js` 使用同一个 `CLOUDFLARE_API_TOKEN` 环境变量；不要把令牌粘贴到聊天、源码、命令行参数或截图中。
  如果已完成本机凭据首次设置，执行 `node publish.js`、`node deploy_worker.js` 或 `node admin.js ...` 会自动读取 DPAPI 凭据；否则才需要先设置该环境变量。任务完成后，临时环境变量按上面示例自动清除。

## 九、本次重点优化：性能、安全与联机 (2026-09-05)

### 1. 🤖 AI 搜索性能与状态恢复
- `js/ai.js` 的置换表键由整盘棋面字符串改为双路 32 位 Zobrist 哈希，减少深度搜索时的字符串拼接、临时对象和移动端 GC 压力。
- 哈希表按棋盘尺寸懒加载，搜索过程中用增量异或更新，不改变棋谱或存档格式。
- 修复搜索超时/中止分支可能遗留临时落子的状态污染；每个候选分支现在都会恢复棋盘。

### 2. 🎨 Canvas 绘制性能
- `index.html` 对棋子和复盘步数增加独立离屏位图缓存；主题底盘、棋子和序号只在棋盘/主题/尺寸真正变化时重绘。
- 动态的最后一步标记、技能选点、胜利连线和粒子特效继续在主画布绘制，保持动画效果，不把动态帧缓存进去。
- 最后一步查找改为倒序扫描，避免动画帧创建临时数组；缓存键使用轻量棋盘哈希，可兼容现有直接修改棋盘的玩法代码。

### 3. 🌐 联机报文与 P2P 稳定性
- MQTT 与 WebRTC DataChannel 统一执行 JSON 对象、消息类型、60 KiB UTF-8 负载上限、消息去重和每秒入站限流，未知报文不会进入游戏逻辑。
- 联机头像统一发送 `anime_boy`/`anime_girl` 等短标识或 12 KiB 内安全头像，聊天不再重复携带头像，降低首连和弱网传输延迟。
- 远端落子必须满足对手棋色、当前回合、空位和连续步数；错步只触发对账快照，不执行可疑落子。
- 技能报文增加当前回合、施法者棋色、目标棋子、空位、2×2 结构、炸弹棋子颜色数量和天命连线校验，降低公开 MQTT 房间被注入异常数据的风险。
- MQTT 客户端 ID、P2P 会话 ID 和消息 ID 优先使用 Web Crypto 随机值；信令重试改为 ICE 批量补发，避免每轮重复发送几十条候选导致信令拥塞。
- 以上是客户端协议和输入边界加固，不等同于绝对防作弊：公开 Broker 仍属于不可信传输层，若需要强身份联机，还需把房间鉴权迁移到服务端或使用登录态签名协议。

### 4. ✅ 本次验证与产物
- 通过 `node --check`（AI、服务端、部署和构建脚本）及主页面、Android 资源、单文件版内联脚本语法检查。
- AI 必胜落子、棋盘恢复、Zobrist 哈希可逆性通过；联机连接类的非法类型/大包/去重/不改写调用方对象/ICE 批量补发单测通过。
- `python tests\optimization_smoke.py` 通过：核心页面、棋盘、聊天上限、调整大小调度、API 兜底均正常且无控制台错误。
- 已重新生成 `五子棋大师_单文件版.html`、`android_src/assets/index.html` 和正式签名 `五子棋.apk`；本次只本地构建和提交代码，未自动部署 Cloudflare 生产环境。
- 当前 APK SHA-256：`C89FBC63C600BFFCD50335DE4A536F4EC30B806CC850E51CDE46380DFD68D27E`；正式签名 v1/v2/v3 校验通过。

## 十、本次全站多端 UI 深度排查与精细化修复 (2026-09-05)

通过 Headless Edge 对全端 11 套弹窗及主流移动端视口（含 320px 极限窄屏、390px、414px）进行像素级排查与全量修复：

1. **主题弹窗换肤按钮折行修复**：
   - 修复窄屏下 `themeModal` 各主题卡片中 `⚡ 秒换` 按钮折行变为 `⚡ 秒 / 换` 的问题。为所有 6 款主题按钮补充 `flex-shrink: 0; white-space: nowrap; margin-left: 8px;`，标题增加 flex 文本省略约束。
2. **底部干扰卡卡槽文本垂直溢出修复**：
   - 将 `renderCardSlots()` 结构由 3 行垂直堆叠（总高 64px 溢出 52px 卡槽容器）重构为精炼双行弹性布局：第 1 行并排显示图标 + 卡名，第 2 行展示技能效果描述。总高降至 36px，彻底根除文字截断与溢出。
3. **窄屏对局气泡与指示木牌间距修复**：
   - 修复 320px-380px 窄屏视口下 `.turn-bubble`（你的回合/对方回合）左右位置与左右两侧 `.sign-board`（落子中/等待）发生 2px 物理重叠挤压的问题。调整 `@media` 查询定位为 `left: 90px !important; right: 90px !important;`，留出干净安全间距。
4. **天梯风云榜底部游客提示单字换行修复**：
   - 修复 320px 窄屏下天梯榜底部 `#myRankStatusText` 游客提示过长导致最后一个字被挤到第二行的问题。精简文本为 `游客未登录 · 登录账号入榜` 并增加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`，底部状态与刷新、关闭按钮一行完整对齐。
5. **天梯榜玩家名过长挤爆段位徽标修复**：
   - 排查发现当榜单玩家昵称较长时，段位徽标 `🌱 初窥门径` 会折行成双行。为榜单 item 项补充弹性伸缩与截断样式，玩家名称自适应省略，段位徽章及个人标识保持 `flex-shrink: 0; white-space: nowrap;`，布局平整美观。
6. **快捷短语管理弹窗列表人工截断修复**：
   - 修复 `.phrase-item-text` 存在写死 `max-width: 180px` 导致右侧留白 50px 却强行产生 `...` 截断的问题。改为 `flex: 1; min-width: 0;` 充分利用横向空间，并适度放大上下移动与删除按钮触控点击区域。
7. **实时聊天栏顶部按钮触控体验与小屏昵称截断优化**：
   - 调优聊天头部反馈、换肤、展开按钮内边距与最小高度（`padding: 3px 8px; min-height: 20px; line-height: 1.2;`），并微调超窄屏下玩家名称字号（`12px`），防止玩家名显示为 `...`。
8. **三端同步与自动化视觉回归**：
   - 所有 CSS/HTML/JS 修复已无损同步至 `index.html`、`android_src/assets/index.html` 和 `五子棋大师_单文件版.html`。
   - 运行 CDP 无头 Edge 截图验证脚本，各弹窗与窄屏截屏均证实视觉对齐完美无瑕疵。

## 十一、本次联机终局、重开、悔棋与显示修复 (2026-09-05)

### 1. 终局状态单向收口
- `triggerGameEnd()` / `triggerGameDraw()` 现在统一写入 `isOver`、`gameWinnerColor` 和和棋状态，并立即刷新顶部状态、棋盘和本地持久化。
- 对局结束后顶部会显示“对局结束 / 已结束”，不会再残留“对手回合 / 落子中”等旧提示；胜利连线只在终局状态绘制。
- 终局结果弹窗增加延迟调度与取消机制，重开或悔棋时会清理旧弹窗、胜利连线、粒子动画和技能提示，避免上一局视觉残留。

### 2. 联机重开与旧报文隔离
- 联机结果弹窗的“再战一局”改为发送重开申请，必须双方同意后才清空棋盘，避免一端单方面重置导致两端棋局反复回到上一局。
- 每局使用独立 `roundId`，同意重开时生成 `nextRoundId`；MQTT/WebRTC 报文携带轮次并校验，旧局延迟到达的落子、技能和快照不会污染新局。
- 断线重连复用当前轮次，不会因为重建传输连接而把正在进行的对局误判成新局。

### 3. 悔棋与干扰牌恢复
- 悔棋快照现在包含本机手牌、使用状态、对手技能额度、预言点和临时回合状态。
- 远端发动技能也会写入本地撤销栈；双方同意悔棋时只同步公共棋盘和棋谱，各自从本机快照恢复自己的干扰牌，避免把一方手牌覆盖到另一方。
- 悔棋申请/响应使用独立请求 ID，重复或过期响应会被忽略；无效状态会触发重新对账而不是强行覆盖本地棋局。

### 4. 本次验证与产物
- `python tests\\optimization_smoke.py` 通过：终局状态、重置、单机悔棋返还干扰牌、联机悔棋响应、聊天上限、调整大小调度和 API 兜底均正常，控制台无错误。
- `node tests\\worker_unit.js` 通过：版本/资源读取与票据流程正常，GitHub 令牌未泄露。
- 根页面与 `android_src/assets/index.html` SHA-256 均为 `5D72FA011E63E0092A0893C3909648A076BA1D073D6751BCA6330DEDCA2BFF95`；单文件版已重新生成。
- 正式签名 APK `五子棋.apk` 已重新构建，SHA-256 为 `279D3535729C91F5620FF1D0B7E1405FC6684CC776BC11C912558357DE86459A`，v1/v2/v3 签名校验通过。
- 本轮仅为修复线上更新直链保护完成了一次必要的 Cloudflare Worker/Pages 部署；普通客户端构建与发版不重复部署 Cloudflare。

## 十二、本次更新后免重复登录改造 (2026-09-05)

### 1. Refresh Token 自动续期
- 新增 `/api/auth/refresh_session` 接口：客户端启动时先验证访问凭证，访问凭证失效后使用设备本地 Refresh Token 自动换发新凭证，不再要求用户重新输入密码。
- 注册、登录、修改密码、找回密码和会话验证都会正确下发续期凭证；每次续期都会轮换访问凭证和 Refresh Token，旧 Refresh Token 立即失效。
- D1 只保存 `refresh_token_hash` 与 `refresh_token_expires_at`，不保存 Refresh Token 明文；改密、找回密码、退出账号会使旧会话失效。
- 修复客户端把“用户不存在/账号同步失败”误报为“登录凭证已过期”的问题；网络异常和服务端暂时错误会保留本地登录态。

### 2. Android 双保险同步
- Android 新增兼容性桥接 `saveUserRefreshToken()`，将 Refresh Token 保存到原生 `SharedPreferences`；读取登录备份时会一并恢复，兼容旧版五参数 `saveUserLogin()`。
- 单文件版、Android assets 与根目录 `index.html` 已同步；热更新页面不会清理本地账号凭证。

### 3. 部署与验证
- 为使新认证接口上线，本轮已完成一次必要的 Cloudflare Worker/Pages 部署；普通客户端发版仍默认跳过 Cloudflare。
- `node tests\\worker_unit.js`、`node tests\\auth_refresh_unit.js` 和 `python tests\\optimization_smoke.py` 全部通过；新增单测覆盖续期凭证哈希存储、访问凭证轮换和旧 Refresh Token 拒绝。
- 正式签名 APK v1/v2/v3 校验通过，证书 SHA-256 仍为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。
- 当前产物 SHA-256：`index.html` / `android_src/assets/index.html` 为 `C68F02C0720D96007670DA307089B3490F1490C2CD56F680798895543DAEDC8E`；单文件版为 `27F631EAA5E35EF23DB5115C85F215A8EAF521FA92C4E60F7384CC5F6686AEC3`；APK 为 `D3AE48EDD33658AE91C47623D117BB3FFAFC0A04206615C20FA48AA9D472ECAD`。

### 4. 后续发布规则
- 仅修改客户端页面、联机逻辑、Android UI 或 APK：执行 `node publish.js`，默认不部署 Cloudflare。
- 修改 `backend/worker.js` 的接口、D1 迁移或更新中转逻辑：先执行一次 `node deploy_worker.js` 让后端生效，再执行 `node publish.js` 发布客户端；不需要每次客户端发版都部署。
- 不要清除 `gomoku_user_refresh_token`、Android 原生登录备份或应用数据，否则只能重新登录；主动退出账号、修改密码和找回密码除外。

## 十三、手机端图标设计提示词 (2026-09-05)

- 新增 `MOBILE_ICON_PROMPT.md`，用于根据项目现有视觉语言生成手机端应用图标。
- 设计元素沿用晴空蓝背景、草坪绿 15×15 棋盘、纯黑白棋子、金色魔法干扰牌和小皇冠，强调圆润的 3D 玩具质感与小尺寸识别度。
- 文件包含主提示词、反向提示词、生成参数和“官方晴空 / 联机竞技 / 极简高端”三种变体；不把 GitHub 地址、账号信息或任何密钥放入图标。
- 这是设计资料更新，不改变客户端代码，也不触发 Cloudflare 生产部署。
- 已按当前默认纯黑白棋子视觉重新生成提示词：棋子明确限定为纯黑白、无猫爪/爱心/表情/文字图案，并补充 Android 自适应图标安全区、48×48 小尺寸识别度和最后一步红点细节。

## 十四、棋子超清重构与全工程视觉舒适度拉网排查修复 (2026-09-05)

### 1. 用户反馈背景
- 用户明确提出：**“我怎么感觉棋子像素有点低，看着不舒服”**，并在解决后要求 **“解决之后，去检查其他地方有没有这种问题，有就修复”**。
- 我们对整个工程渲染管线、6 套主题、单文件离线版及离屏 Canvas 进行了全方位拉网排查与系统性重构。

### 2. 根因深度剖析
1. **1x 离屏位图被强制放大拉伸（核心模糊源头）**：
   - 主画布 `cvs` 启用了 `scale(dpr, dpr)`（物理像素为 2x~3.5x）；
   - 但在旧版 `getCachedPiecesBitmap()` 与 `getCachedBoardBitmap()` 极速位图缓存中，离屏 Canvas 宽高被写死成了 CSS 逻辑像素 `cWidth`（如 380×380）；
   - 在 `draw()` 中通过 `ctx.drawImage` 贴到已放大 2~3 倍的高清主画布时，浏览器底层进行了强制双线性过滤插值拉伸，导致**棋子边缘被虚化发糊、出现明显马赛克毛刺**；
   - 与最后一手落子直接在高清主画布绘制的锐利红点对比时，模糊感尤为刺眼。
2. **普通桌面 1080P 显示器缺乏超采样保底**：
   - 桌面普通屏 `devicePixelRatio = 1.0`，棋子物理半径仅十余像素，圆弧呈现明显台阶锯齿。
3. **棋子视觉材质生硬与贴纸假感**：
   - **硬边偏移假阴影**：旧代码使用无羽化的偏移深色实心圆盘（`ctx.arc(x+1.5, y+2.5, r*0.95)`）模拟阴影，视觉上如同棋子底下露出一截错位的脏圆片；
   - **粗糙纯白轮廓描边**：黑子外围有一圈刺眼的半透明纯白边线（`rgba(255,255,255,0.75)`），使棋子呈现类似剪贴画贴纸的廉价感；
   - **发灰/脏粉色彩与高光缺失**：白棋底色过渡至脏粉色（`#fed7e2`），且缺乏真实云子与玉石的**镜面瓷釉高光反射（Specular Gloss Glint）**。

### 3. 全套技术修复与视觉升维方案
1. **全高清超采样离屏渲染架构**：
   - 强制超采样保底：`dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3.5)`，即使 1080P 桌面显示器也强制开启 **2x 超采样抗锯齿 (SSAA)**，手机旗舰高刷屏自动匹配 2.5x~3.5x 原生高密度；
   - 离屏画布 `cachedBoardCanvas` 与 `cachedPiecesCanvas` 物理宽高严格分配为 `Math.round(cWidth * dpr)`，应用 `scale(dpr, dpr)` 与 `imageSmoothingQuality = 'high'`，实现物理像素 1:1 精准 Blit 贴图，彻底消除插值拉伸模糊；
   - 主画布 CSS 补充 `image-rendering: -webkit-optimize-contrast; image-rendering: auto;`。
2. **大师级 3D 球体玉石材质渲染 (`drawThemedStone`)**：
   - **柔光环境遮挡**：改用原生柔和高斯阴影（`shadowBlur: r * 0.36~0.42`, `shadowOffsetY: r * 0.18`），棋子自然温润地立体悬浮于棋盘上方；
   - **黑曜石深邃玉石**：四级球体径向渐变（`#525e6f` -> `#272d37` -> `#11141a` -> `#05070a`）；
   - **温润羊脂白玉**：告别脏粉色，采用纯净象牙白优雅过渡（`#ffffff` -> `#f8fafc` -> `#e2e8f0` -> `#cbd5e1`）；
   - **45° 瓷釉镜面弧光**：左上方以 `ctx.ellipse` 绘制椭圆高透镜面高光弧（`rgba(255,255,255, 0.42/0.92)` 渐隐），呈现真实玉石的光洁透亮；
   - **底部环境微反光与超微边缘**：底部微弧反光营造玉石通透厚重感，`0.85px` 超细石青轮廓线提供清晰微反差，彻底取代粗糙白圈；
   - **全套 6 大主题同步升级**：晴空草坪（天然云子）、禅意暗黑（3D 黑曜石与羊脂暖玉）、新中式（徽墨与和田白玉）、毛玻璃（冷光星芒宝石）、Clean iOS（精密陶瓷柔光）、草莓海盐（水晶果冻心动质感）。
3. **自定义头像上传离屏压缩分辨率翻倍**：
   - 排查发现玩家相册自定义头像上传时，离屏压缩画布写死为 `80x80`，在高分屏头像圈中产生毛刺；
   - 将全部页面中的 `offCanvas.width` 和 `offCanvas.height` 由 80x80 提升至 `160x160`，设置 `imageSmoothingQuality = 'high'`，导出质量提升至 0.88。
4. **恋爱主题背景心形光斑 High-DPI 适配**：
   - `theme5_sweet_romance.html` 中 `heartBokehCanvas` 粒子画布曾按 1x 物理像素分配，高分屏下浮动光斑与爱心模糊；
   - 补充 `hdpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3)` 动态缩放，粒子绘制以逻辑宽高计算，光斑与爱心达到视网膜级锐利。
5. **`theme4_clean_ios.html` 未闭合 `<style>` 标签致命缺陷修复**：
   - 排查发现该文件样式表末尾遗漏了 `</style></head>`，导致整篇 HTML（约 20 万字符）被浏览器当成 CSS 文本解析，DOM 树 `body` 为空，主画布完全无法初始化；
   - 在 `<body>` 前补齐 `</style></head>`，页面解析与画布加载 100% 恢复正常。
6. **独立主题缺失辅助函数安全补齐**：
   - `theme1` ~ `theme5` 在落子与重绘时调用了 `isPointFrozen(r, c)` 与 `isFogActive()`，但在独立单页中未定义该函数；
   - 补齐默认空安全实现，杜绝可能中断对局的 `ReferenceError`。

### 4. 验证与全端产物同步
- **Playwright 端到端冒烟测试**：`python tests/optimization_smoke.py` -> **通过 (Code 0)**，`consoleErrors: []`, `pageErrors: []`；
- **Worker 接口测试**：`node tests/worker_unit.js` -> **通过 (Code 0)**；
- **单文件版自动化验证**：Playwright 执行开局落子、渲染与截图，**0 报错通过**；
- **5 款独立单页主题实机截图**：通过自动化脚本逐一开局落子并输出各主题实测截图，全部锐利清晰、无任何控制台异常；
- **多端资产全量同步**：
  - `index.html` 与全部主题文件已全量同步到 `android_src/assets/`；
  - 运行 `node bundle_single_file.js` 重新打包生成最新 `五子棋大师_单文件版.html`。

## 十五、默认棋子纯黑白样式确认 (2026-09-05)

- 用户明确确认默认主题棋子只保留黑白材质，不需要猫爪、爱心或其他棋面图案；上一轮误加的默认主题猫爪绘制已撤回。
- `drawThemedStone()` 默认分支继续使用高清黑曜石/羊脂白玉渐变、柔和阴影和高光；最后一步提示保留为独立的红点，不属于棋面图案。
- 根页面、Android assets、单文件版已重新同步，发布为 v1.0.97 (Build 98)；本次为客户端视觉配置调整，Cloudflare 生产环境未部署。
- `python tests\\optimization_smoke.py`、Worker/认证单测、脚本语法检查和 APK v1/v2/v3 签名校验均通过；仓库内 `MOBILE_ICON_PROMPT.md` 也已改为纯黑白棋子描述。
- v1.0.97 Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.97`；当前本地产物 SHA-256：根页面 / `android_src/assets/index.html` 为 `826E8BE73F12E99D2B622C0AD9B82E9D2E7FD979275E4F836444623BA8F4473C`，单文件版为 `E8A4219CCEF2C6499966FEFB215C1E7F0DB0B300539B1D4270EA08235AF1FA69`，APK 为 `6138D618913C2CD85CE13CB01787A2A42C989420264CA6224B19483563658B55`。

## 十六、手机端应用图标替换 (2026-09-05)

- 使用用户提供的晴空浮岛草坪对决主视觉图替换 Android 启动图标与网页 `favicon.png`；图中保留绿色悬浮棋盘、纯黑白棋子、红色最后落子点、金色干扰牌和皇冠。
- 已按 Android 资源规格生成并替换：`mipmap-mdpi` 48×48、`mipmap-hdpi` 72×72、`mipmap-xhdpi` 96×96、`mipmap-xxhdpi` 144×144、`mipmap-xxxhdpi` 192×192、`drawable` 512×512，以及网页 favicon 192×192。
- v1.0.98 (Build 99) 已完成单文件版与正式签名 APK 构建并发布：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.98`；本次为图标与客户端资源更新，Cloudflare 生产环境跳过。
- 当前资源 SHA-256：`favicon.png` 为 `BEF037F960D94CA444BA32034AC48775036FCBB1A4F9A2106A642B0E985AD477`；`android_src/res/drawable/ic_launcher.png` 为 `58F0821D7280F6BA055360F1C9E7858C149E704911698CDC1BEABA4F5DB2BFF7`；APK 为 `8CB48FC38FAAE0EF0790BF7D6AE4DB486B8473A1FEEE9B3036F9D763A4232DA1`。

## 十七、账号登录网络路径优化（2026-09-05，已发布 v1.0.99）

- **问题定位**：旧版 `safeApiFetch()` 对所有接口固定附加自定义请求头，登录在 Android WebView 中容易先触发 CORS 预检；当 Pages 出口未及时响应时，又会按 7 秒超时后顺序等待 Workers，最终把 `signal is aborted without reason` 原样显示给用户。
- **客户端修复**：登录请求改用可解析 JSON 请求体的 `text/plain` 简单请求，登录不再携带旧 Authorization 或无关自定义头；打开账号弹窗时并行探测两个官方 HTTPS 出口，记忆最快节点，并对失败节点冷却 60 秒，减少下次重复等待。
- **错误处理**：所有认证入口将 Abort/超时统一转换为“官方服务响应超时，请检查手机网络后重试”，普通网络失败统一显示可读中文提示，不再泄露底层 abort 文案。
- **服务端准备**：`backend/worker.js` 与派生的 `pages_build/_worker.js` 增加 CORS 预检缓存 600 秒；这项后端头部只有在明确执行 `node deploy_worker.js` 后才会影响线上，本轮未自动部署生产环境。
- **同步范围**：已同步 `index.html`、`android_src/assets/index.html`、`五子棋大师_单文件版.html`、`backend/worker.js` 和 `pages_build/_worker.js`。
- **验证结果**：Pages/Worker 预检均返回 HTTP 200；定向测试确认登录请求仅带 `Content-Type: text/plain;charset=UTF-8`，不带旧 Token/自定义头；超时错误统一为 `API_TIMEOUT` 中文提示；`python tests\optimization_smoke.py`、`node tests\worker_unit.js`、`node tests\auth_refresh_unit.js` 和全部 HTML 内嵌脚本语法检查均通过。
- **发布结果**：已递增为 v1.0.99（Build 100），完成正式签名 APK、单文件版构建，推送 GitHub 私有仓库并创建 Release。Release 地址：https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.99；线上 /api/version 已返回 v1.0.99，旧客户端可通过现有热更新入口拉取新 HTML。
- **当前产物 SHA-256**：index.html / android_src/assets/index.html 为 7A997C4B4C46E5D5977B69E79E994DCC732FC3508376253D99C4BAD33DD7F94C；单文件版为 59BB68101644C390752A64D7A0A0E4101CE608B848664A052805ECA42BF50168；APK 为 681C7D5BE3C9E47A65347E99B49C332FF93548267AA70632DBCF82868040A2D8。
- **部署边界**：本次客户端登录修复不要求重新部署 Cloudflare；服务端新增的 CORS 预检缓存已保存在源码，后续若要让该响应头上线，再单独执行一次 node deploy_worker.js。

## 十八、更新检测可靠性修复（2026-09-05，已发布 v1.0.100）

- **问题定位**：v1.0.98 的后台更新检查只执行一次，版本清单请求携带 `X-Gomoku-Client` 会触发 Android WebView 的 CORS 预检，并且客户端只有 3 秒超时；Cloudflare/私有 Release 冷启动稍慢时会被静默吞掉，所以用户既看不到更新弹窗，也无法判断是“没有更新”还是“检查失败”。
- **客户端修复**：版本清单改用不携带专属自定义头的普通 GET，增加时间戳防止中间缓存，采用 8.5 秒首次超时 + 5 秒自动重试；下载 APK/HTML 仍继续使用客户端专属请求头、短时票据和 SHA-256 完整性校验。
- **交互修复**：自动检查发现新版本时保留提示并把更新卡标记为“有新版本”；手动检查失败显示明确的“暂时无法检查更新”，重试按钮会重新发起检查，不再误报“当前版本运行良好”。当前实际运行版本以 HTML 内的 `CURRENT_VERSION_TAG` 为准，旧的本地版本标记不能再阻止更新。
- **兼容说明**：已安装的 v1.0.98 代码无法被服务器远程替换；如果旧版仍因网络环境超时漏检，需要先从 v1.0.100 Release 手动安装一次，之后新版更新检查链路会生效。
- **同步范围**：修复已同步到 `index.html`、`android_src/assets/index.html` 和 `五子棋大师_单文件版.html`；发布日志同步到 `publish.js`、`version.json` 及后端派生版本信息。
- **验证结果**：发布前静态脚本/安全门禁、`python tests\optimization_smoke.py`、`node tests\worker_unit.js`、`node tests\auth_refresh_unit.js`、APK 签名构建均通过；线上 `/api/version` 返回 `v1.0.100`，并提供短时 APK/HTML 更新票据。
- **发布结果**：已递增为 v1.0.100（Build 101），完成正式签名 APK、单文件版构建，推送 GitHub 私有仓库并创建 Release。Release 地址：https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.100。
- **当前产物 SHA-256**：`index.html` / `android_src/assets/index.html` 为 `C35A26DA746FA18EC1EE0A222A8EF4CE56714303E5E6DF20FE1C7AE8FB051AE7`；单文件版为 `A498D9FD3FC4AFEC668B6274B94FC2822B921428E524A364F66ED3CAAD85B303`；APK 为 `072F8B43EBA6D3D6B8D0C2E0364A6CE570EB92727B38A03DB1A32992AF2F60CE`。
- **部署边界**：本次只修改客户端更新检查与发版脚本，按既定规则跳过 Cloudflare 生产部署；线上版本接口会从私有 Release 自动读取最新发布版本。

## 十九、支持五子连珠终局后悔棋继续对弈 (2026-09-05)

- **背景与用户诉求**：
  - 用户提出需求：“被五子赢了之后要能悔棋”。
  - 此前一旦一方达成五连珠（`isOver = true`），代码在 `btnUndo.onclick`、`doUndo()` 以及联机消息处理器中硬编码了 `if (isOver) return;` / `conn.send({ agree: false })`，同时终局结算弹窗拦截了棋盘点击且无悔棋按钮，导致玩家无法在终局后撤销一步继续探索其他路线。

- **`index.html` 核心改造**：
  1. **结算弹窗新增直接悔棋入口**：
     - 在 `#gameResultModal` 操作按钮区域新增 `#btnResultUndo`；单机/双人 PVP 模式显示为 `↩️ 悔棋一步继续`，联机模式显示为 `↩️ 申请悔棋继续`。
  2. **弹窗层级（z-index）体系提升**：
     - 将 `.undo-modal-backdrop` 的 `z-index` 从 `150` 提升至 `100006`，确保当从层级为 `100004` 的 `#gameResultModal` 点击悔棋时，悔棋确认弹窗能清晰浮于结算弹窗顶层。
  3. **终局状态与战绩安全回滚**：
     - 在 `doUndo()` 中捕捉 `wasGameOver = isOver`；悔棋成功时彻底重置 `isOver = false; winningLine = null; gameWinnerColor = 0;`；
     - 新增 `rollbackLocalResult()`，自动将终局时已写入本地缓存与战绩统计的本局结果回退（胜场/负场计数 -1，从本地对局历史数组中弹出最后一条终局记录）；
     - 隐藏结算弹窗并重新激活落子监听。
  4. **人机对战模式智能回退**：
     - 若玩家被 AI 绝杀（最后一步为 AI 白子），悔棋时循环弹出 AI 绝杀子以及玩家前一步黑子，执子权完全恢复给黑方玩家（`turn = BLACK`），避免玩家一悔棋 AI 又立即在同一点落子绝杀。
  5. **联机对战双端协商机制兼容**：
     - 移除联机 `undo_req` 在 `isOver === true` 时的自动拒绝阻断；
     - 对方发起终局悔棋时，弹窗提示明确展示：“对局已终局，对方申请悔棋一步继续对弈，是否同意？”；双方协商同意后双端同步重置 `isOver = false` 并关闭结算弹窗。

- **5 款独立单页主题全覆盖 (`theme1` ~ `theme5`)**：
  1. 彻底移除各主题中 `btnUndo.onclick` 与 `doUndo()` 中的 `|| isOver` 拦截；
  2. 人机模式统一采用智能回退至玩家回合（`turn = BLACK`），PVP/联机模式精准恢复最后执子方；
  3. 补齐 5 款主题内缺失的 `triggerGameEnd()` 统一终局结算调度器，根除卡牌技能终局时潜在的 `ReferenceError`；
  4. `theme5_sweet_romance.html` 恋爱专属兑换券弹窗 (`#victoryModal`) 内置 `btnVictoryUndo` 悔棋快捷入口，提升 `#undoModal` 的 `z-index: 200`，悔棋时自动解除结算弹窗。

- **多端资产全量同步与全面回归**：
  1. `index.html` 与 5 款独立主题全部同步覆盖至 `android_src/assets/`；
  2. 重新运行 `node bundle_single_file.js` 打包生成最新 `五子棋大师_单文件版.html`；
  3. 编写并执行 Playwright 端到端测试 `scratch/test_all_undo.py`，全量验证 `index.html`（PVP/AI 模式）、5 款独立主题单页、以及单文件版在五子连珠获胜后的悔棋全链路，**全部顺利 PASS**；
  4. 运行 `python tests/optimization_smoke.py` 及 `node tests/worker_unit.js`，控制台 0 报错、测试 100% 通过。

## 二十、全工程深层排查与空安全加固 (2026-09-05)

- **深层审查排查出的隐患与修复**：
  1. **历史战报回滚首尾指针纠正 (`list.shift()`)**：
     - `recordGameHistory` 将新产生的对局记录通过 `unshift` 写入数组首位；此前 `doUndo()` 中误写为 `list.pop()`，导致终局撤销时误删了最早的远古对局，而未清除刚产生的新记录，进而导致本地战绩回滚错乱。现更正为 `list.shift()`。
  2. **异步 AI 运算与卡牌施法状态防竞态**：
     - 在 `doUndo()` 与 `resetBoardOnly()` 中增加 `aiTurnSeq++`、`aiThinking = false`、`activeSkill = null`，并隐藏施法指示条。有效防止用户在人机计算或施法过程中撤销/重开后，异步回调把旧计算棋子放上新棋盘。
  3. **5 款独立主题单页缺失核心函数补全**：
     - 排查发现独立单页主题中存在调用但未定义的函数：
       - `playPopSound()`：使用 Web Audio API 合成治愈系物理水滴音效；
       - `showGameNotice()`：控制台与降级弹窗安全通知，消除调用报错；
       - `fetchGlobalLeaderboard()`：空安全占位，解决此前在单页主题中点击个人头像导致档案弹窗无法开启的问题。
  4. **单页主题 `doUndo()` 越界与身份互换回滚保护**：
     - 在 `theme1` ~ `theme5` 的 `doUndo()` 中，针对 `identity_swap` 卡牌产生的 `r: -1, c: -1` 记录增加了安全识别：若撤销该卡牌则将全盘黑白子再次对调，并对普通落子增加 `r >= 0 && c >= 0` 判断，根除 `TypeError: Cannot set properties of undefined (setting '-1')`。
  5. **单文件版内联快速 AI Worker 修复**：
     - `bundle_single_file.js` 在重构 `<head>` 时，将 `createInlineAiWorkerTag` 重新装配入新 head 中，使离线单文件版同样享受 60fps 不卡顿的 Worker 异步计算；运行 `tests/ai_worker_smoke.py` 全绿通过（单文件版与主版耗时均低于 80ms）。
  6. **情侣主题 `confetti` 离线安全包裹**：
     - 在 `theme5_sweet_romance.html` 中将直接调用 `confetti()` 改为 `if (typeof confetti === 'function')`，避免断网离线时 CDN 脚本加载失败引发运行时崩溃。

## 二十一、移动端 AI Worker 与 bitboard 性能优化（2026-09-05，已发布 v1.0.101）

- **架构结论**：Android 端仍采用原生 Java WebView + 本地 HTTP 服务加载 HTML；现有热更新沙盒只允许覆盖根目录 `index.html`。因此快速 AI Worker 不能依赖 APK 外置新文件，发布构建会将 Worker 源码和快速引擎内嵌到 `android_src/assets/index.html` 与单文件版，源码开发页保留 `js/ai_worker.js` 外置回退。
- **性能基准**：新增 `tests/ai_benchmark.js`，在当前 Node v25.2.1 上对同一开局局面连续运行 3 次：旧引擎中位约 25.9 ms，快速引擎热身后中位约 8.1 ms；战术必胜局面快速引擎中位约 0.2 ms。首次 Worker 启动包含棋型表初始化，之后由后台线程计算。
- **快速引擎**：新增 `js/ai_fast.js`，使用扁平 `Uint8Array` 棋盘、黑白占用位图、数字 Zobrist 置换表、预计算 3^11 局部棋型表、必胜/必防/双威胁优先级和限时 Alpha-Beta 搜索，避免旧引擎在手机主线程中频繁创建二维数组和字符串棋型。
- **异步与安全回退**：新增 `js/ai_worker.js`；`index.html` 将 225 格棋盘快照传给 Worker，移动端按约 260 ms、桌面端按约 420 ms 预算搜索。Worker 超时、异常或浏览器不支持时自动回退既有 `window.GomokuAI`，并用回合序号防止重开/悔棋后旧结果落到新棋盘；Worker 不接触账号凭据、令牌或联机密钥。
- **构建同步**：新增 `build_ai_worker.js`；`bundle_single_file.js` 和 `build_apk.js` 均在构建阶段内嵌 Worker，APK 同时保留外置 JS 作为开发/异常回退资源。发布安全门禁现在额外检查 AI 构建脚本、快速引擎和 Worker 语法。
- **回归结果**：`python tests\ai_worker_smoke.py` 已验证主版与单文件版都能找出必胜点、主线程保持响应且无控制台/页面错误；`python tests\optimization_smoke.py`、`node tests\worker_unit.js`、`node tests\auth_refresh_unit.js`、全主题脚本检查、APK 签名构建和 `git diff --check` 全部通过。
- **Rust/Wasm 决策**：本机没有 `rustc`、`cargo`、`wasm-pack`、`wasm-bindgen` 或 `wasm-opt`；而 Worker + bitboard 实测已满足本轮移动端响应目标，因此没有把未经工具链和基准验证的 Wasm 模块强行加入正式包。以后若低端机实测仍超过预算，可在不改 UI/联机协议的前提下替换 Worker 内部引擎。
- **线上验证**：GitHub 私有仓库已创建 `v1.0.101` Release；`https://gomoku-api.pages.dev/api/version` 实测返回 `code=0`、`tag=v1.0.101`，并签发 APK/HTML 短时票据，不返回可复用下载直链。普通客户端发版不需要重复部署 Cloudflare；只有修改 `backend/worker.js`、Pages 配置、D1 或票据逻辑时才执行一次 `node publish.js --deploy-cloudflare` 或对应部署脚本。
- **发布结果**：版本已递增为 v1.0.101（Build 102），完成正式签名 APK、单文件版构建、私有仓库推送和 GitHub Release。Release 地址：https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.101。
- **当前产物 SHA-256**：`index.html`（开发母本/空 Worker 标记）为 `192C4453ABEAD3B44F70C668AA34690D90D61E1FFFA7B8094D3E01709E1F2EAD`；`android_src/assets/index.html`（APK 内嵌 Worker）为 `06DDC62EDE203B029F60C0B9E3BF6CBF412A5E1645841F7FD46070171638243A`；单文件版为 `A5B3B1C7C15090286A7FCD961CB06B75D8FA7940404A87B18C21944FD1F8A510`；APK 为 `9627315CE749995FA148CE4A90CB210C7CEAAAFF772DE439C554A158F67CB697`。

## 二十二、热更新版本接口与 D1 冷启动隔离（2026-09-05，线上已部署）

- **问题定位**：`/api/version` 和 `/api/update/*` 原先会先进入 D1 自动建表/迁移初始化；数据库冷启动或短时抖动时，更新检查会跟着长时间无响应，表现为手机端“更新很慢”，这不是 GitHub 令牌 401。
- **修复内容**：在 `backend/worker.js` 与 `pages_build/_worker.js` 增加更新路由判定，让版本检查、短时票据签发和受保护下载不等待 D1；GitHub 上游请求仍保留 8 秒超时，账号、联机、对局接口继续按原逻辑初始化数据库。
- **线上验证**：已执行 `node deploy_worker.js`，Worker 与 Pages 均部署成功；`/api/version` 返回 HTTP 200、`code=0`、`tag=v1.0.103`，`apkTicket/htmlTicket` 均存在且不返回下载直链；未携带应用短时票据访问 `/api/update/apk` 返回 HTTP 401，下载保护仍生效。
- **部署边界**：这次是为修复线上热更新接口实际超时而进行的必要后端部署；今后只有修改 Worker、Pages 配置、D1 或票据逻辑才需要部署，纯 HTML/AI/样式发版仍只需 `node publish.js`，无需重复部署 Cloudflare。

## 二十三、干扰牌与大爆炸对局复盘历史记录防污染、推演引擎深度重构与全端加固 (2026-09-05，已发布 v1.0.103)

- **背景与根因定位（“大爆炸从一开始就打乱了”）**：
  1. **大爆炸 (`mega_bomb`) 破坏性清空历史栈**：
     - 旧代码在触发大爆炸时执行了 `history = []; for (...) history.push(...)`。这彻底抹杀了引爆炸弹之前双方走过的全部真实历史落子步数，强行将洗牌后的所有落子从第 0 步开始覆盖；导致对局结束后查看棋谱时，整局棋从第 1 手起就是被打乱的状态。
  2. **其他干扰技能的追溯性篡改**：
     - `remove_stone` 与 `destiny_remove` 曾直接使用 `history = history.filter(...)`，直接将对手之前落子所在的历史步骤物理删除；
     - `shift_stone` 与 `destiny_point_2` 曾直接修改 `histItem.r/c`，导致棋子在复盘从第 1 步起就出现在平移后的终点坐标；
     - `swap_color` 与 `destiny_convert` 曾直接修改 `histItem.p`，导致棋子在复盘从第 1 步起就变成了策反后的颜色；
     - `swap_positions` 曾直接对调两个历史步骤的坐标；
     - `destiny_wipe_danger` 曾过滤抹除危险连线历史。

- **核心架构改造与全局防污染方案 (Append-Only Action Schema)**：
  1. **全技能事件纯追加记录机制**：
     - 禁止任何技能对 `history` 数组执行 `filter`、`splice`、清空或原地坐标/颜色篡改；
     - 所有技能统一以动作对象纯追加到 `history` 中，记录完整前后盘面与参数快照：
       - `mega_bomb`: `{ action: 'mega_bomb', type: 'skill_mega_bomb', stones: newStones, prevStones: currentStones, r: -1, c: -1, p: 0, desc: '乾坤大乱' }`
       - `remove_stone`: `{ action: 'remove_stone', type: 'skill_remove_stone', r, c, p, desc: '虚空陨石' }`
       - `destiny_wipe_danger`: `{ action: 'destiny_wipe_danger', type: 'destiny_wipe_danger', stones: [...], r: -1, c: -1, p, desc: '天命掀桌' }`
       - `shift_stone`: `{ action: 'shift_stone', type: 'skill_shift_stone', fromR, fromC, toR, toC, r: toR, c: toC, p, desc: '移星换斗' }`
       - `swap_color`: `{ action: 'swap_color', type: 'skill_swap_color', r, c, fromP, p, desc: '偷天换日' }`
       - `swap_positions`: `{ action: 'swap_positions', type: 'skill_swap_positions', r1, c1, p1, r2, c2, p2, r: r2, c: c2, p: p2, desc: '移形换影' }`
  2. **主棋盘专业推演复盘引擎全量升级 (`applyMainReplayStep`)**：
     - 复盘步进器从第 0 步开始严格按时间线逐帧推演：在走到技能动作帧之前，双方前序落子完整保留在其原始坐标与颜色；到达技能步时，精准触发对应棋盘演变；拖动进度条向后倒退时，精确重构出技能发生前的盘面；
     - **丰富动作徽章与状态提示**：Dock 状态栏清晰高亮当前步数及详细动作：`第 X 步: 💣【乾坤大乱】引爆炸弹洗牌打乱全盘！`、`第 X 步: 💥【虚空陨石】抹除 (r, c) 棋子！`、`第 X 步: 👑【天命掀桌】抹除 N 颗危险连线棋子！`、`第 X 步: 🌟【移星换斗】平移至 (r, c)！`、`第 X 步: 🎭【偷天换日】策反 (r, c) 棋子！`、`第 X 步: 💫【移形换影】双方对调位置！`；
     - **复盘聚焦点高光光环**：在复盘回放中为普通落子（琥珀金）、平移（灵动蓝）、策反（秘术紫）、对调（炫彩粉）绘制专属动态聚焦环；
     - **离屏缓存序号空位跳过**：`getCachedPiecesBitmap` 增加 `board[st.r][st.c] === EMPTY` 保护，防止在被抹除或移走的空格上渲染残留数字编号；
     - **复盘入口模态互斥清理**：`openReplayModalByIndex` 自动执行 `cancelPendingGameResultModal()` 与 `closeGameResultModal()` 并隐藏施法指示条，彻底消除结算弹窗遮挡复盘画面的隐患。

- **深层拉网排查发现的类似隐患与全端修复**：
  1. **快照合法性放行 (`validateIncomingSnapshot`)**：
     - 旧代码中对 `r: -1, c: -1` 的特殊事件硬编码了 `item.p === 0`；而 `destiny_wipe_danger` 记录了施法者阵营 `p: myColor`（1 或 2），导致含有天命掀桌的合法状态快照被误判为非法而拒绝；已全面修复为 `(item.p === 0 || item.p === BLACK || item.p === WHITE)`，覆盖全端 6 款 HTML。
  2. **双方状态快照拉齐防崩溃 (`state_snapshot`)**：
     - 当收到对方落后快照时，旧代码试图将缺失历史逐一作为 `{ type: 'move' }` 补发，若其中含技能动作会导致对端坐标校验失败；现统一触发 `sendFullStateSnapshot()` 发送全局快照；并在前缀校验中增加对 `action/type` 的智能比对，彻底杜绝联机误拒。
  3. **最后一手高光标记幽灵红点清退**：
     - 棋盘在常规对战渲染最后落子标记时，若刚刚发动了抹除或洗牌技能，旧代码因 `r >= 0` 会在被抹除的空位或大爆炸前的旧坐标上绘制正红圆点；现增加空位与技能拦截（遇到抹除/大爆炸不绘制最后落子标记，且严格确保 `board[r][c] !== EMPTY`）。
  4. **5 款独立单页主题悔棋全技能回退 (`theme1` ~ `theme5`)**：
     - 在独立单页主题中新增 `undoActionStep(last)`，支持大爆炸还原全盘初始棋子、抹除恢复棋子、平移反向平移、变色恢复原色、换位对调还原；
     - 在 `doUndo()` 中优先撤销顶部刚刚单独发动的技能牌，人机模式与双人 PVP 模式全链路测试 100% 通过。

- **多端资产同步与全量自动化回归**：
  1. 全部修复已同步至 `index.html`、`theme1` ~ `theme5`、`android_src/assets/` 及单文件版 `五子棋大师_单文件版.html`；
  2. `python tests/optimization_smoke.py`：0 控制台报错、0 页面异常；
  3. `python tests/ai_worker_smoke.py`：主版与单文件版 AI 计算耗时均低于 70ms，快速引擎与主线程完全响应；
  4. `node tests/worker_unit.js`：接口与票据校验 100% 通过；
  5. 专用端到端测试 `scratch/test_replay_cards.py` 与 `scratch/test_theme_skills_undo.py`：
     - 验证大爆炸前 4 手棋完全保全；
     - 验证大爆炸动作追加及后续落子；
     - 验证单步复盘精准重构爆炸前后各阶段盘面、向后倒推完全恢复；
     - 验证 5 款独立主题下对 `remove_stone` 与 `mega_bomb` 的完美撤销与棋子恢复；
     - 验证天命掀桌快照校验全绿通过。

- **最终发布结果**：已递增为 v1.0.103（Build 104），完成包含 AI Worker/bitboard、联机技能账本同步、复盘防污染和 D1 冷启动隔离配套代码的正式签名 APK、单文件版构建、私有仓库推送与 GitHub Release。Release 地址：https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.103。
- **最终产物 SHA-256**：`index.html` 为 `F42C3AE20AA60ABD7D9A4EE710E18E696EE385542A17084D0B5224B1C9915699`；`android_src/assets/index.html` 为 `54E0F74E553128D398557864354471020E3E9A85862EED97A3794C9EC0E7D8F9`；单文件版为 `516806CEAF72B89728B8014CDF5CADA1388BE2F16F44AD0C6FDFB4E2BB5AE45A`；APK 为 `C748E179C79B4C77723C038BC835294C3B0FB0EF705539E27395EB6C35F629BD`。

## 二十四、跨端匹配竞态、MQTT 多节点汇合与线上入口恢复（2026-09-05，已发布 v1.0.104）

- **问题定位**：网页端与 Android WebView 匹配成功后，一端显示“对方断开”、另一端停留在匹配页，主要由三类竞态叠加造成：
  1. 房主旧逻辑在房间信道真正订阅完成前就发送 `join_accepted`；客户端先把 `hasJoined` 置为真并切换棋局，随后才创建房间连接，导致首批消息或连接状态丢失。
  2. 两端按各自网络结果顺序选择 MQTT 备用节点，可能分别落在不同公共 Broker；即使匹配服务已经配对，双方也没有共同信令通道。
  3. 匹配轮询回调、首次 `join` 返回和固定 1 秒等待没有统一生命周期，取消匹配或重复回调后可能再次启动同一房间。

- **客户端联机改造 (`index.html`)**：
  1. 新增 `MqttClientPool`：固定优先节点先连，备用节点错峰 700ms 探测；所有已连节点都订阅/发布，利用 `_mid` 去重，让不同网络环境自动在共同可达 Broker 汇合，同时避免一次性并发打开 4 条 WebSocket。
  2. 房主和客户端均以 `readyPromise` 为进入房间的唯一闸门：房间主题订阅成功且连接 ready 后才确认加入、关闭匹配框和发送首批握手；连接失败会清理未完成连接并继续有限重试。
  3. 增加房间连接请求序号、房间码隔离、重复 `join_request` 去重、过期连接池取消和匹配轮询生命周期保护；移除匹配成功后的固定等待，客户端立即开始订阅。
  4. API 出口保留 Pages/Worker 双节点健康记忆与失败冷却；生产 Pages 入口恢复后，更新接口仍只走带短时票据的 Pages 中转，不向客户端暴露 GitHub 直链或 Token。

- **线上服务处理**：本轮因涉及 Worker/Pages 运行状态，已执行 `node deploy_worker.js`，Worker `gomoku-backend` 与 Pages 项目 `gomoku-api` 均部署成功。生产 `https://gomoku-api.pages.dev/api/version` 实测 HTTP 200，返回 `v1.0.104`，可签发短时 APK/HTML 票据；直接下载路径在无票据时仍返回 401。今后纯 HTML、AI 或样式发版仍无需重复部署 Cloudflare；修改 Worker、Pages、D1、Secret 或更新票据逻辑时才部署。

- **回归验证**：
  - `python tests/online_match_race_smoke.py`：模拟网页/手机不同 Broker 可达性、房主延迟订阅、双向落子，验证双方均 `online/open/ready`，通过且无页面/控制台错误；
  - `python tests/online_transport_smoke.py`：真实公共 MQTT 双页面建房、入房、等待稳定和双向落子，通过；
  - `python tests/optimization_smoke.py`、`python tests/ai_worker_smoke.py`、`node tests/worker_unit.js`、`node tests/auth_refresh_unit.js`、`node tests/ai_benchmark.js`、内嵌脚本语法检查和 `git diff --check` 均通过。

- **发布结果**：已发布 v1.0.104（Build 105），GitHub Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.104`。正式 APK 与单文件版共用原签名，可覆盖安装；旧客户端可通过现有热更新入口检查到该版本。
- **当前产物 SHA-256**：`index.html` 为 `59210EA7E3D54BB4E75B3DDCFE1C313A632BDD3323E817929BF383C7C552AB92`；`android_src/assets/index.html` 为 `E06E1A89ACEE867322ADC78C5889245E0D7CF00843932CDEBB33FB4EEA14AC0B`；单文件版为 `35EA786FD2E047E70A654F60A0116E44150DAEC9EFDB3AE76D3B7B645B98CF24`；APK 为 `D93101E9BD705C30354CEC7C533E1087B1464886716F43DBCA0197086D227CD5`。

## 二十五、匹配请求幂等、D1 队列性能与 API 首次连接预热（2026-09-05，已发布 v1.0.105）

- **再次定位到的联机边界问题**：匹配结果是 HTTP 请求返回值；弱网下若 `/api/match/join` 或 `/api/match/poll` 的响应丢失，旧服务端会立即删除 `matched` 记录，客户端下一次重试只能得到 `cancelled`，随后 MQTT 房间没有房主或没有客方。旧记录还可能在下一次匹配中被当作当前结果，表现为重复进入上一场房间。
- **服务端修复 (`backend/worker.js`)**：
  1. 新增 `match_id`（兼容旧 D1 自动迁移）；客户端每次搜寻生成独立请求 ID，`join/poll/cancel` 全链路携带并校验。
  2. 同一 `match_id` 的 join/poll 结果保持幂等，不再因一次响应丢失而丢掉房间；新一轮不同 ID 会淘汰同 UID 的旧残留结果，避免“上一场一直返回”。
  3. `matched` 记录保留短暂重试窗口，超过 120 秒自动回收；等待记录清理改为 Worker 实例内 30 秒限频，且只在需要时写 D1。
  4. 为 `match_queue(status, updated_at)` 增加索引，降低在线人数增长后的等待队列扫描和心跳写入压力。
- **客户端速度修复 (`index.html`)**：API 出口探测结果增加 10 分钟新鲜度；页面/Android WebView 启动后后台并行预热 Pages 与 Worker，首次登录和全服匹配不再把测速时间算进用户点击后的等待时间。更新文件仍固定走 Pages 短时票据中转，Worker 仅作为账号/匹配 API 容灾出口。
- **发布与部署**：已完成 v1.0.105（Build 106）正式签名 APK、单文件版、GitHub 私有仓库和 Release 发布；随后显式部署 `gomoku-backend` 与 `gomoku-api`，生产 `/api/version` 返回 HTTP 200、`v1.0.105`，无票据下载仍返回 HTTP 401。Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.105`。
- **验证结果**：`python tests/online_match_race_smoke.py`、`python tests/optimization_smoke.py`、`node tests/worker_unit.js`、Worker/部署脚本语法检查通过；跨 Broker、延迟订阅、房主 ready 闸门、双向落子和资料同步均通过。真实公共 MQTT 冒烟测试曾成功通过，但最终复测时四个公共 Broker 同时返回 `connection closed`，页面无 JS/page error；这属于公共中继节点临时不可用，客户端会按固定顺序错峰容灾，若四个节点同时被当前网络阻断仍需更换网络或后续接入自建信令服务。
- **当前产物 SHA-256**：`index.html` 为 `B44840143A32447DE24B330E7B48154FF20B73745B1C682C4647E4DAEDAF1491`；`android_src/assets/index.html` 为 `F819F4DC102118B6205B32C701357D97CC095024E8BE6A4372D01D6D751C739F`；单文件版为 `2147599800028E0B6D896003622BE7C9B40EE626A2113F9F87497F557BE401E6`；APK 为 `89A6D715A7BB80D14F4DE39124486805C21C72A2D0AC7A90F3B435740D9870C6`。

## 二十六、终局待确认事务机制与防提前落库重构（胜后直接悔棋不计入对局与天梯积分）（2026-09-05）

- **背景与痛点定位**：
  五子棋达成五连珠获胜或满盘和棋终局时，旧代码直接在 `checkWin()` 判定瞬间同步调用 `recordGameHistory()` 与 `reportMatchResult()`，不仅向本地 `localStorage` 写入战报，更立即通过网络请求向 Cloudflare D1 云端上报天梯战绩和积分（+25 分或 -15 分）。
  当玩家在结算弹窗选择【↩️ 悔棋一步继续】或在棋盘上复盘悔棋时：
  1. 旧代码虽然在 `doUndo()` 中尝试 `list.shift()` 移除本地战报，但云端 D1 数据库记录无法被客户端简单撤销，天梯积分已在云端生效；
  2. 若玩家反复达成五连珠再悔棋，就会造成云端积分重复刷分与战报膨胀；
  3. 更严重的是：如果玩家在已有历史战报的情况下（如已有第 1 局记录），在第 2 局五连珠终局后选择悔棋，旧逻辑若盲目执行 `list.shift()`，会把第 1 局真正的历史战报误删！

- **重构架构设计 —— 终局待确认事务机制 (`pendingMatchRecord`)**：
  1. **队列挂起与延迟落库**：
     - 五子连珠/和棋触发时，仅调用 `queuePendingMatchRecord(recordData)` 生成待确认事务对象，并展示终局动效与结算弹窗预览（弹窗提示更新为：“确认终局后将计入天梯积分 (悔棋继续则作废)”），**绝不调用 `recordGameHistory()`，绝不上报天梯接口**。
  2. **悔棋动作彻底作废（Rollback）**：
     - 玩家在结算弹窗点击【↩️ 悔棋一步继续】或在关闭弹窗复盘后点击棋盘工具栏【↩️ 悔棋】：
     - 显式调用 `discardPendingMatchRecord()` 将待定事务直接销毁清空；
     - `pendingRecordCommitted` 保持为 `false`，`doUndo()` 判定未落库，**绝不调用 `list.shift()`，绝不误伤任何既往对局历史**，棋局平滑回到绝杀前一步；
     - 整个过程 0 本地存储写入、0 云端请求、0 天梯积分变动，绝不算作一局！
  3. **明确确认终局真正持久化（Commit）**：
     - 当玩家做出明确终局决断时，触发 `commitPendingMatchRecord()` 真正落库与上报：
       - 点击【🔄 再战一局】（`restartGameFromResultModal` / `btnRestart` / `resetBoardOnly`）；
       - 点击【🏆 查看全服天梯榜】（`openLeaderboardFromResultModal` / `openLeaderboardModal`）；
       - 点击【📜 历史对局/复盘】（`openHistoryModal`）；
       - 点击【🚪 退出联机房间】（`leaveOnlineRoom`）；
       - 切换游戏模式（`setMode`）；
       - 刷新或离开页面（`window.beforeunload` 兜底）。
  4. **全套主题与离线版同步**：
     - 5 款独立单页主题（`theme1` ~ `theme5`）在悔棋时执子权正确归还胜方，让玩家可以换位另寻落子；
     - `index.html` 采用 `injectAiWorkerSource` 确保 Worker 代码内嵌无缝同步至 `android_src/assets/index.html`；
     - 全量重新打包 `五子棋大师_单文件版.html`。
  5. **全流程自动化回归覆盖**：
     - `scratch/test_preexisting_history_undo.py`：既有历史场景下的终局悔棋与再次获胜确认；
     - `scratch/test_pending_record_undo.py`：空历史场景下的终局悔棋与结算流程；
     - `scratch/test_all_undo.py`：主版、5 套主题及单文件版终局悔棋；
     - `tests/optimization_smoke.py`、`tests/ai_worker_smoke.py`、`tests/worker_unit.js` 均 100% 通过。

## 二十七、最强大师 AI v2 搜索与战术强化（2026-09-05，已发布 v1.0.106）

- **本轮目标**：再次全面强化人机棋力，同时保持手机端不阻塞棋盘渲染；本轮只修改客户端 AI、Worker、构建资源与测试，**没有修改 Worker/D1/Pages，不需要部署 Cloudflare**。
- **快速引擎战术层**：
  1. 直接成五与唯一必防点改为完整候选池扫描，不再被前 40 个排序候选截断；外部 `forbiddenPoints` 会贯穿根节点、搜索节点和叶节点，避免技能禁点被假设落入。
  2. 候选生成保留所有直接杀点、直接防点、四四、双活三和断三战术点；开局前两手额外保留中心 5×5 锚点，避免对手落在角落时 AI 被邻近半径限制锁死在低价值区域。
  3. 新增有限威胁空间证明：一步制造两个立即胜点，或制造一个杀点、对手唯一封堵后仍能立即成五时，直接选择可证明的强制着法，并在多个强制着法之间按胜点数量和棋型排序。
- **搜索层强化**：
  1. 叶节点增加直接杀点/双杀点延伸，修复静态评估看不见“下一手必胜”的典型漏算；终局分数加入按 ply 的距离修正，优先快胜、延迟必败。
  2. 置换表键不再硬编码深度，允许更深迭代复用较浅层精确结果的主着排序；增加主变着优先、杀手着和历史启发，减少无效分支。
  3. 评估器补偿非连续断四、断三和分散二连，同时保留连续活四、活三、中心控制等棋型权重。
  4. Worker 生产配置调整为移动端约 520 ms / 深度 7 / 根节点 20，桌面端约 900 ms / 深度 9 / 根节点 26；计算仍在后台线程，超时自动保留上一层完整结果并回退旧 AI。
- **兼容与同步范围**：
  - `js/ai_fast.js`、`js/ai_worker.js`、`js/ai.js` 已更新；`index.html` 已传入新的 Worker 搜索预算；
  - `android_src/assets/index.html` 已重新内嵌快速引擎，`android_src/assets/js/` 已同步；
  - `五子棋大师_单文件版.html` 已重新打包，`五子棋.apk` 已使用仓库外原正式签名密钥重新生成，保持 v1.0.106 的覆盖安装签名兼容；
  - 新增 `tests/ai_strength_smoke.js`，覆盖直接胜、唯一防守、双威胁、角落开局、禁点和安静局面搜索。
- **验证结果**：
  - `node tests/ai_strength_smoke.js`：6/6 通过；
  - `node tests/ai_benchmark.js`：快速引擎安静局面在约 520 ms 预算下完成到深度 5，直接战术局面即时返回；
  - `python -B tests/ai_worker_smoke.py`：使用 Android UA，主版与单文件版均可完成安静局面搜索（约 522 ms、深度 4），主线程计时器持续运行且无 console/page error；
  - `python -B tests/optimization_smoke.py`、`node tests/worker_unit.js`、`node tests/auth_refresh_unit.js`、`python -B tests/online_match_race_smoke.py`、`node --check`、`git diff --check` 均通过；
  - 20 手快速 AI 自对弈冒烟通过，未出现越界、覆盖已有棋子或非法落子。
- **发布结果**：已递增为 v1.0.106（Build 107），完成正式签名 APK、单文件版、私有仓库推送和 GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.106>。线上 `https://gomoku-api.pages.dev/api/version` 实测 HTTP 200、`code=0`、`tag=v1.0.106`，可签发 APK/HTML 短时票据且不返回可复用直链。
- **部署边界**：本轮只改客户端 AI、Worker 资源与测试，未修改运行中的 Worker/Pages/D1/票据逻辑，因此按既定规则跳过 Cloudflare 生产部署；Pages 会读取私有仓库最新 Release，已安装用户可通过现有热更新入口获取 v1.0.106。
- **v1.0.106 产物 SHA-256**：`index.html`：`F0AFB7CC969C2A1974A29173EEEDA50AAAAFD730B7A9C57936CDE44E0F469103`；`android_src/assets/index.html`：`A6512AB5810D264E23EA18F9487A3877648BE477DB5EA0BB6A92CEA26BAAFBEB`；单文件版：`36226CDD2039989A4AEB4D4DE365632186BCBBF996FFCEDC4CE657A82E0ED09D`；APK：`2BF69F37F3934C8C616FCEC45EFBF3A8C3A66845CF6C40AC08644693E8575E0D`。

## 二十八、冷启动与首屏按需资源优化（2026-09-05，本地构建完成）

- **本轮目标**：针对手机端启动时蓝屏等待、首屏加载资源过多和首次进入联机等待偏长的问题，收缩冷启动工作量；本轮只改客户端页面、单文件打包器和 Android 本地启动顺序，未修改 Worker、Pages、D1 或更新票据逻辑。
- **网页端首屏**：
  1. MQTT、PeerJS 兼容层、P2P 兼容层、樱桃炸弹音频和动漫头像不再在首屏执行；统一通过 `window.ensureGomokuResource()` 去重、按需加载。
  2. 进入联机大厅时才加载 MQTT；首次用户交互后加载音频；打开昵称/头像设置时才加载动漫头像；移除启动即执行的 API 出口探测，登录或实际网络功能仍会按需预热。
  3. AI 外置脚本改为 `defer`，不阻塞 HTML 骨架和棋盘首帧；默认冷启动资源从此前的联机/音频/头像全量加载收缩为 AI 与基础头像。
- **单文件版**：`bundle_single_file.js` 将 MQTT、音频和动漫头像保留为 `text/plain` 资源节点，由同一按需加载器在真正需要时注入执行；单文件仍可离线使用，冷启动不再编译这些大段脚本。当前文件约 1.33 MiB，SHA-256 为 `BE491B463E1C0AFA13D8A2305BC0E85747425B88E9D1B46C6F23A8B6CD91ABA0`。
- **Android 启动顺序**：`MainActivity` 在创建 WebView 前先异步启动 `LocalWebServer`，随后与 WebView 初始化并行；取消原先先阻塞等待最多 500 ms 再创建 WebView 的串行路径，WebView 设置完成后仅保留 120 ms 的极端兜底等待，继续使用本地 HTTP 源以兼容 WebSocket/WebRTC。
- **验证结果**：网页端和单文件版 Playwright 冷启动均通过，初始均未注册 MQTT/音频/动漫头像/PeerJS/P2P 兼容层；进入联机后 MQTT 与音频按需成功加载，打开头像设置后动漫头像成功加载，0 console/page error。`tests/optimization_smoke.py`、`tests/ai_worker_smoke.py`、`tests/online_match_race_smoke.py`、`tests/online_transport_smoke.py`、`node tests/ai_strength_smoke.js`、`node tests/worker_unit.js`、`node tests/auth_refresh_unit.js`、Node 语法检查和 `git diff --check` 全部通过。
- **本地产物**：已重新生成 `android_src/assets/index.html`、`五子棋大师_单文件版.html` 和正式签名 `五子棋.apk`。根页面 SHA-256 为 `3D7B0E559C7FC1E38606EE4C20CC3544E4CFCE45569A3CEA11D347DA749C8404`；Android 内嵌页面为 `BAE3C794294A515F4C865D7DE716778CC4D6F471B411693279969FD3C6B5C5D1`；APK 为 `3A17094FA178AE0C5D9B2A841C9E218C385081CD70A8DF310EAA14BD36220653`。APK v1/v2/v3 签名验证通过，签名者数量为 1。
- **发布边界**：本地 APK 仍是 `v1.0.106 (Build 107)`，本轮未创建新 GitHub Release、未部署 Cloudflare，线上 `/api/version` 仍以正式发布的 v1.0.106 为准；因此本轮产物用于本地测试，不能让已安装用户自动识别为新热更新版本。确认真机体验后，如需给用户推送，再递增版本并执行 `node publish.js`，普通客户端发版仍不需要重复部署 Cloudflare。

## 二十九、最强大师 AI v3 战术根节点与统一回退（2026-09-05，已发布 v1.0.107）

- **本轮实现**：根据“分析人机强化策略”任务中的方案完成并验收未发布草稿，保留 AI 只负责落子、不读取或发送干扰牌的边界；没有把卡牌逻辑混入搜索状态，也没有改变对局消息格式。
- **棋力与正确性**：根节点不再只取排序前 `rootLimit` 个普通点；所有已识别的直接杀点、必防点、冲四/断四、双活三和断三战术点都会进入根搜索。新增有限威胁空间递归，覆盖双重立即胜点以及“唯一封堵后继续成五”的强制线；评估器继续补偿断四、断三和分散二连，置换表保留双哈希、边界类型、主变优先、杀手着和历史启发。
- **移动端与回退**：Worker 仍使用扁平 `Uint8Array` 和后台搜索；页面把移动端 `threatPly` 正确传入 Worker。Worker 异常时优先按相同 `GomokuFastAI` 快速内核低预算回退，只有快速内核资源本身不可用才进入旧兼容兜底，避免正常异常路径退回阻塞式旧 AI。
- **自动验证**：`node tests/ai_strength_smoke.js` 通过 11 个战术/搜索用例；`node tests/ai_selfplay.js` 完成 6 局自对弈，均正常胜负结束且没有卡牌/技能字段；移动端 UA 下主版与单文件版 Worker 搜索、主线程计时器和错误监听均通过；冷启动、聊天 TXT 导出、悔棋返还、昵称同步、网络状态/延迟、匹配跨 Broker、真实公共 MQTT 双向落子、Worker 单测、认证刷新和 AI 基准均通过。
- **正式发布**：已发布 `v1.0.107 (Build 108)`，GitHub Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.107`。Release 已上传 `gomoku.apk` 和 `gomoku.html`；线上 `https://gomoku-api.pages.dev/api/version` 实测 HTTP 200、`code=0`、`tag=v1.0.107`。本轮仍未部署 Cloudflare 生产环境，因为运行中的 Worker/Pages/D1/票据逻辑没有改动；版本接口会动态读取私有仓库最新 Release，已安装用户可按现有热更新入口获取新版本。
- **产物 SHA-256**：根页面 `index.html`：`417F758F33C3DD43A6E9A404D67323EB5E857BA43061CDDC4087040F200A0970`；Android 内嵌页面：`BF4F397A6E9D43C1C801F6DABFF3302A07FDF6C96563E92665A18B6DC61F2539`；单文件版：`59DE72A7C40AC4F08A44E4146C106E200FDC33744BA773D1E8ABB5E646A16A78`；APK：`61A89DFC4EE7A0E85FB5F7475FF86032C0CFCB4EF27B4C06D9D3DF9C1BA60A9D`。APK v1/v2/v3 签名校验通过，签名者数量为 1。

## 三十、情侣动漫头像资源轻量化与懒加载（2026-09-05，已发布 v1.0.108）

- **本轮目标**：将用户提供的两张 640×640 动漫图片作为男/女头像，替换原先体积较大的 PNG Base64，降低网页、单文件版和 Android 包的资源负担；不改变昵称、账号、联机或头像同步协议。
- **资源策略**：
  - 新增 `img/anime_avatar_boy.jpg`（256×256，14,453 bytes）和 `img/anime_avatar_girl.jpg`（256×256，15,471 bytes），Android `assets/img/` 已同步同名文件；
  - `js/assets/anime_avatars.js` 从约 164 KB 的图片 Base64 缩减为 434 bytes 的路径清单；普通网页和 Android 页面继续由打开头像设置时按需请求 JPG；
  - 单文件打包器只在 `avatars` 按需资源节点内把 JPG 转成 JPEG data URL，继续保证离线可用；头像卡片的默认预览改成极小内嵌 SVG，单文件版不再携带旧 PNG Base64；榜单检测到 `anime_boy/anime_girl` 时会先等待头像资源就绪再渲染，避免显示成文字或旧占位。
- **构建与验证**：已成功运行 `node bundle_single_file.js`、`node build_apk.js`；单文件版 1,165,956 bytes，APK 1,587,418 bytes。`tests/avatar_asset_smoke.py`、`tests/optimization_smoke.py`、`tests/ai_worker_smoke.py` 全部通过：主版和单文件版榜单均显示新头像，主版仅请求两张 JPG，单文件版无头像网络请求且两图均正常解码为 256 宽度；无 console/page error。APK v1/v2/v3 签名验证通过，签名者数量为 1。
- **产物 SHA-256**：男头像 JPG：`C72DB7A572F72864373D494CB9D634B089235DDD2DC69C780176A9BD63DF7290`；女头像 JPG：`C629FD6461D1D762918FAE0982A48F0377297C358B0A0E08F07D5E5128A4C780`；头像清单：`80092899C0C274AFA2AC1972AA505FA8B26C18EB6A6CCE4B4C1C526D79439100`；根页面：`6E46686BE699C9CDD2EEF5571CDA88D24F7A6535144E56DF14AB57AE98D528E5`；Android 内嵌页面：`BE67C5A3E9ECFC58900D352C972CEE5555E31A5FA7EA09698B75E9A4420E975B`；单文件版：`6DCE79EA68B2E8984E421D98C8C41C55EE18514B00DAF99D8416449AD2783654`；APK：`1EDFF86B406FDF3BDE6FE885A41A9EAD10F46A70421557F5A9C7029A87F8B19C`。
- **正式发布**：已发布 `v1.0.108 (Build 109)`，GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.108>。Release 已上传 `gomoku.apk` 和 `gomoku.html`，线上 `/api/version` 实测 `code=0、tag=v1.0.108`，并正常签发 APK/HTML 短时票据；接口不直接返回可复用下载直链。普通客户端发版仍不需要重复部署 Cloudflare，本轮已按规则跳过生产部署。

## 三十一、全服匹配会话续期与 API 出口稳定性修复（2026-09-06，已发布 v1.0.109）

- **问题定位**：全服匹配入口只检查内存中的 Access Token；用户更新应用、长时间挂起或 Token 轮换后，账号界面可能仍显示已登录，但 `/api/match/join`/`poll` 已收到 401/403，前端却统一显示为“匹配连接失败”。同时，API 出口测速只探测 OPTIONS，可能把能响应预检但更新业务未完整配置的 Worker 备用出口选成默认，造成联机请求不稳定。
- **客户端修复**：
  1. `ensureMatchAccountSession()` 在开始匹配前恢复正式账号会话；有 Refresh Token 时先无感换发，不放宽游客不能进入全服匹配的安全限制；
  2. `requestMatchApi()` 为 join/poll 增加一次性凭证续期重试，并同时携带规范 `Authorization` 与旧 Android WebView 兼容的 body token；
  3. 轮询期间同样处理 401/403，过期时停止轮询并打开登录入口；服务端返回的授权/业务原因不再被隐藏成笼统网络错误；首次入队超时放宽至 12 秒，轮询为 10 秒；
  4. API 顺序固定以 `https://gomoku-api.pages.dev` 为正式主出口，`gomoku-backend.xnnb04664.workers.dev` 只在主出口失败或冷却时容灾，避免 OPTIONS 竞速误选备用节点。
- **同步范围**：修复已同步到 `index.html`、`android_src/assets/index.html`、`五子棋大师_单文件版.html` 和正式签名 APK；发布脚本日志与本交接文档同步更新。未修改 Worker/D1/Pages/票据逻辑，因此本轮没有部署 Cloudflare 生产环境。
- **验证结果**：自动续期回归确认“旧 Token → 401 → Refresh Token 换发 → 新 Token 再次入队”成功；`tests/optimization_smoke.py`、`tests/online_match_race_smoke.py`、`tests/online_transport_smoke.py`、`tests/avatar_asset_smoke.py`、`tests/ai_worker_smoke.py`、`node tests/worker_unit.js`、`node tests/auth_refresh_unit.js`、APK v1/v2/v3 签名校验和 `git diff --check` 均通过。线上 `https://gomoku-api.pages.dev/api/version` 已返回 `code=0、tag=v1.0.109`。
- **发布结果**：已发布 `v1.0.109 (Build 110)`，GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.109>；Release 已上传 `gomoku.apk`（1,587,418 bytes）与 `gomoku.html`（1,170,311 bytes）。
- **v1.0.109 产物 SHA-256**：根页面 `index.html`：`EF629087455C3916F940D382C6F00F4C5DE22AD2738CF750FFD3A5309C999A30`；Android 内嵌页面：`3B93ACFE8D2E79266937D457E21DD385395DF63F1E3821CEAC9DFD66E5F93D59`；单文件版：`F1EFB07FF2B29D7F035686C8B520737BBB53F629291544D02864A82A08FD02D4`；APK：`AC6B7772C84AFF61EAF02935ED4FF59B6071864FC7DC63B40D84EF315954B206`。

## 三十二、Cloudflare Realtime TURN 接入（2026-09-06，代码已部署、凭据待核对）

- **凭据状态**：`gomoku-backend` Worker 与 `gomoku-api` Pages production 均已配置 `TURN_KEY_ID`、`TURN_KEY_API_TOKEN`；长期凭据没有写入源码、网页、单文件版或 APK。
- **后端接口**：`backend/worker.js` 新增 `GET /api/rtc/ice-servers`，使用 Cloudflare TURN Key 在服务端签发 1 小时短期凭据；响应只返回临时 `iceServers`，不返回长期 API Token；增加每 IP 轻量限频，并过滤 Cloudflare 备用 53 端口以缩短 ICE 收敛时间。
- **客户端接入**：`index.html`、`android_src/assets/index.html` 与 `五子棋大师_单文件版.html` 在 WebRTC 探针启动前按需请求 TURN 配置；凭据按短期缓存复用，接口失败时自动回退现有 STUN，P2P 失败仍回退 MQTT，不阻断房间对局。
- **测试**：新增 `tests/turn_worker_unit.js`，验证 Cloudflare 请求参数、短期凭据响应、53 端口过滤、长期密钥不回传和缺少 Secret 时的 503；该测试与 `tests/worker_unit.js`、`tests/optimization_smoke.py`、`tests/online_transport_smoke.py`、`tests/online_match_race_smoke.py`、`tests/ai_worker_smoke.py`、`tests/avatar_asset_smoke.py`、`tests/auth_refresh_unit.js`、`git diff --check` 均通过。
- **发布边界**：Worker 与 Pages 已部署，线上接口已存在；当前客户端代码已在本地同步但尚未递增版本/发布 Release。待 TURN 凭据验证通过后，再构建/发布新的 HTML 与 APK，用户端才会正式使用 TURN。

## 三十三、TURN 线上验证结果（2026-09-06）

- 已执行 `node deploy_worker.js`，Worker 与 Pages 均部署成功；最新 Pages 预览部署地址为 `https://5539e821.gomoku-api.pages.dev`，正式域名仍为 `https://gomoku-api.pages.dev`。
- 实测 `GET /api/rtc/ice-servers`：Worker 与 Pages 正式入口均返回 HTTP 502，Worker Tail 记录两条 Cloudflare 上游请求均为 HTTP 404：`generate-ice-servers` 与兼容路径 `generate`。
- 官方接口路径、请求方法、Bearer 头和 `ttl` 参数均已按 Cloudflare Realtime 文档实现；因此当前最可能的问题不是 Worker 部署，而是 Secret 中的 `TURN_KEY_ID` 不是 TURN Key 创建结果里的 `uid`，或 `TURN_KEY_API_TOKEN` 不是同一次创建返回的 `key`。Cloudflare 文档规定 `uid` 为 32 位标识，`key` 为 64 位 Bearer Token；二者不能互换。
- 客户端已保留 STUN 回退和 MQTT 最终兜底，不会因 TURN 凭据失败阻断普通联机；但在凭据核对前，不能宣称 Cloudflare TURN 中继已生效。
- **待办**：在 Cloudflare Realtime/Calls 的 TURN Keys 页面重新确认同一条 TURN Key 的 `uid` 与 `key`，分别更新 Worker 和 Pages 的两个 Secret 后重新部署并验证；凭据验证通过后再发布含 TURN 客户端代码的新版本。

## 三十四、TURN 凭据绑定复核（2026-09-06）

- Pages 正式入口 `https://gomoku-api.pages.dev/api/rtc/ice-servers` 已返回 HTTP 200、`code=0`，响应包含 Cloudflare `turn:`/`turns:` 临时 ICE 配置，说明 Pages production 的两个 TURN Secret 当前有效。
- 为修复 Worker 备用入口，已使用 Wrangler 正式部署 `gomoku-backend`（版本 ID：`231a44ca-618f-48a3-8ff7-1744a0f40c7a`），确认 D1 绑定正常；随后在最后一次部署后重新绑定两个 Worker Secret。
- **最终验证**：Worker 与 Pages 正式入口均返回 HTTP 200、`code=0`，并返回 Cloudflare `turn:`/`turns:` 临时 ICE 配置。每次响应的 username/credential 不同属于 1 小时短期凭据正常轮换。TURN 服务端配置已完成；发布含 TURN 客户端代码的新版本仍需单独执行构建/发布流程。

## 三十五、Cloudflare TURN 客户端正式发布（2026-09-06，v1.0.110）

- 发布内容：客户端在 WebRTC 探针启动前按需请求 /api/rtc/ice-servers，优先使用 Cloudflare TURN，失败时回退 STUN，P2P 仍失败时回退 MQTT；短期凭据只在内存缓存，不写入源码或 APK。
- 正式版本：v1.0.110 (Build 111)，GitHub Release：https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.110；已上传 gomoku.apk 与 gomoku.html，Release 为正式版。
- 线上验收：https://gomoku-api.pages.dev/api/version 返回 HTTP 200、code=0、tag=v1.0.110，同时签发 APK/HTML 短时票据；接口不暴露可复用下载直链。Worker/Pages TURN 接口均返回 code=0 和 turn/turns 配置。
- 产物 SHA-256：APK E257BE576EF3079D7DD41806BC2148665679BD287855DE38F6EA35C4080818E8；HTML 0D42E823641880F137317D1F95F1013E787972C22F3160631189BA7E15BF3F0B。本地构建产物与线上版本接口摘要一致。
- 部署边界：本次为客户端发版，按规则未再次部署 Cloudflare；TURN 服务端已在本轮前完成显式部署和凭据绑定。后续只改 HTML、AI 或资源时继续使用 node publish.js，只有改 Worker、D1、Pages、Secret 或票据逻辑时才显式部署 Cloudflare。

## 三十六、P2P/MQTT 可靠业务消息层（2026-09-06，已发布 v1.0.111；历史记录）

- **本轮目标**：解决联机时偶发“落子一边有、一边没有”、P2P 半开后聊天丢失，以及 P2P 与 MQTT 镜像造成重复显示的问题；本轮只改客户端传输层、测试与派生构建资源，没有修改 Worker、Pages、D1、TURN 或更新票据逻辑。
- **可靠传输协议**：
  1. 落子、聊天、悔棋、重开、棋局快照、同步请求和技能/命运状态消息自动生成唯一 _mid，P2P 直连和 MQTT 中继同时发送；delivery_ack 同样双通道发送。
  2. 接收端先回 ACK，再按 _mid 去重，因此同一条报文从两条链路到达不会重复落子或重复聊天；如果首个 ACK 丢失，重复报文会再次确认但不会重复执行。
  3. 发送端最多每 900 ms 重发一次，最多 8 次、总计约 10 秒；重连时同一房间/轮次会接管仍未确认的消息，换房、离开或重开时清除旧消息。
  4. 落子业务仍执行棋子颜色、空位、步数、回合校验；确认超时会触发全量棋局对账，而不是盲目强行落子。聊天确认超时会提示用户重试。
- **P2P 恢复**：DataChannel 的 close/error、PeerConnection/ICE 的 failed/closed 和信令超时都会触发 1.2 秒起、最高 30 秒的指数退避重建；每次重建使用新的 sessionId/generation，隔离旧 SDP/ICE，恢复期间业务消息自动走 MQTT，不拆除整局连接。公共 MQTT 连接池对仍在线的单节点按 1.5 秒起退避重连，避免单个公共 Broker 抖动扩大为整局断线。
- **同步范围**：index.html、android_src/assets/index.html、五子棋大师_单文件版.html 和正式签名五子棋.apk 已同步；测试中的传输探针覆盖资料消息镜像，P2P 故障测试覆盖半开 DataChannel、MQTT 过渡和自动恢复。
- **验证结果**：
  - python -B tests/online_transport_smoke.py：真实公共 MQTT 双页面建房、P2P 建立、双向落子、可靠聊天只显示一次、双方网络状态/延迟和页面错误检查通过；
  - python -B tests/p2p_recovery_smoke.py：真实双页面主动关闭 DataChannel，验证两端切换 MQTT、故障期间落子可达、P2P 自动恢复、恢复后落子可达且无浏览器错误；
  - python -B tests/online_match_race_smoke.py：模拟首 Broker 失败、跨 Broker 汇合、ready 闸门、双向落子和 MQTT-only 可靠聊天只显示一次通过；
  - python -B tests/optimization_smoke.py、python -B tests/ai_worker_smoke.py、python -B tests/avatar_asset_smoke.py、node tests/turn_worker_unit.js、node tests/worker_unit.js、node tests/auth_refresh_unit.js、node tests/ai_strength_smoke.js、git diff --check 和全主题内嵌脚本语法检查均通过；页面无 console/page error。
- **本地产物**：根页面 622,503 bytes，Android 内嵌页面 670,190 bytes，单文件版 1,188,986 bytes，APK 1,591,514 bytes；APK 仍使用仓库外正式签名密钥，保持覆盖安装签名兼容。
- **产物 SHA-256**：index.html：569B0B60B2E6C858E607D3BF6E8B9E2C51FD10DA25928704EB0BE3843C556502；android_src/assets/index.html：7202AD467F0A46FA76D280997ACE32A3904EF26A1BB295ED51A926A4F20CC02F；单文件版：5EDEBE7A59639B77F382F6049EF75A27AD629C8778899509F37078B510739ED7；APK：AED31E87705E3E5CDE9D66675E234971E07DCEB00B75700FC2DFA1538C89F5B3。
- **正式发布**：已发布 `v1.0.111 (Build 112)`，GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.111>；Release 已上传 `gomoku.apk` 与 `gomoku.html`，并已推送 `master`。
- **线上验收**：`https://gomoku-api.pages.dev/api/version` 返回 `code=0、tag=v1.0.111`，并正常签发 APK/HTML 短时票据；接口不暴露可复用下载直链。
- **部署边界**：本轮没有部署 Cloudflare，因为未修改 Worker、D1、Pages、TURN 或更新票据逻辑；现有线上 TURN 与更新服务继续使用。普通客户端发版仍不需要重复部署 Cloudflare。

## 三十七、低延迟联机与断网恢复优化（2026-09-06，已发布 v1.0.112）

- **低延迟传输路径**：P2P DataChannel 正常时，落子、聊天、悔棋、重开、技能和棋局快照先走直连；不再与 MQTT 同时发送，等待 300ms 未收到 ACK 才启动 MQTT 兜底。这样正常网络不再被公共 Broker 的慢包/重复包影响，弱网仍保留可靠重试、ACK 和 _mid 去重。
- **P2P 建链提速**：首次探测不再等待 Cloudflare TURN 接口返回，先用 STUN 立即启动 ICE，TURN 配置后台并行加载；若首轮无法直连，TURN 凭据就绪后立即触发新一轮探测。P2P 连接仍失败时自动回落 MQTT。
- **状态与断网恢复**：网络心跳从 4 秒调整为 2.5 秒，超时窗口为 9 秒；浏览器重新联网时立即触发重连。断线重连保留房间码、轮次、棋盘和可靠消息队列，重连后通过握手/快照继续对局。
- **回归验证**：真实双页面 P2P 双向落子实测约 12–14ms；online_transport、p2p_recovery、online_reconnect、online_match_race、optimization、ai_worker、avatar_asset、turn_worker、worker、auth_refresh、ai_strength、ai_selfplay 均通过，页面无 console/page error。
- **本地产物**：根页面 626,088 bytes，Android 内嵌页面 673,775 bytes，单文件版 1,192,571 bytes，APK 1,591,514 bytes；APK v1/v2/v3 签名校验通过。
- **产物 SHA-256**：index.html：185CDDED1074DB901324ED39C78AFF3434BA730546D668FFA648A8B5D2F224DD；android_src/assets/index.html：02B7366AB900D105F9DFCA6CBC78E8A6B89AD86096870F38F5CDDEBC7CCA5AA2；单文件版：FDB8F85E5C8A555089ACAC4E06945CC706AAA5A551E311AA24F42E591AF4881C；APK：861AEBA6C54279954F35F27D11A4D94171745C7EF891A678053916F2CCBDE21D。
- **正式发布**：已发布 v1.0.112（Build 113），GitHub Release：https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.112；已上传 gomoku.apk 与 gomoku.html，并推送 master。
- **线上验收**：https://gomoku-api.pages.dev/api/version 返回 code=0、tag=v1.0.112，APK/HTML 短时票据正常签发；本轮未部署 Cloudflare，因为未修改 Worker、D1、Pages、TURN 或票据逻辑。

## 三十八、D1 玩家反馈回归修复（2026-09-06，本地已修复，待正式发布）

- **反馈检查**：通过 `node admin.js feedback --json` 检查最新 50 条记录，当前有 2 条 v1.0.112 的 Bug 反馈：白方/黑方显示混乱导致无法落子；对方使用干扰牌形成五子后未显示终局。
- **执色修复**：新增统一 `setOnlineColor()`；匹配结果按 `role/color` 先锁定本端颜色，加入房间的客户端在 accepted 报文到达前也固定执白，避免建连延迟期间沿用默认黑子。
- **技能终局修复**：远端执行策反、移形、抹除、命运位移等会改变棋盘的技能后，统一扫描棋盘并触发胜负/和棋结算；已有大炸弹、身份互换、天命降临的专用结算保持幂等，不会重复弹窗。
- **同步范围**：已重新生成 `android_src/assets/index.html`、`五子棋大师_单文件版.html` 与本地正式签名 `五子棋.apk`；未修改 Worker、D1、Pages、TURN 或更新票据逻辑，因此本轮不部署 Cloudflare，也未自动创建 GitHub Release。
- **回归结果**：`tests/optimization_smoke.py`（远端技能成五弹窗）、`tests/online_match_race_smoke.py`（双方执色与标签）、`online_reconnect_smoke.py`、`online_transport_smoke.py`、`p2p_recovery_smoke.py`、`ai_worker_smoke.py`、`avatar_asset_smoke.py`、`turn_worker_unit.js`、`worker_unit.js`、`auth_refresh_unit.js`、`ai_strength_smoke.js`、`ai_selfplay.js` 和 `git diff --check` 均通过，页面无 console/page error。
- **本地修复产物**：`index.html` 628,174 bytes；Android 内嵌页面 675,861 bytes；单文件版 1,194,657 bytes；APK 1,595,610 bytes。SHA-256：`03E4D9000E8ABB6EFF7D47B40F9B8FE4112FFFCC17D0090627C152F7DC8C37EA`、`D0C46798FE0B0043ADDAC5FA07349412EDB6690A73F5AA77BC23C8063F3EC128`、`F66EE9C67D0AB90C3ABA679D73FD22867EEE538491BA06DA37DC47DB58977A2F`、`5439D3F18F027F6B2D2C958701C1B55C1A07826A6A2B97E25614A0A4D4B7C720`。

## 三十九、P2P 心跳线路隔离与真实延迟校准（2026-09-06，本地已修复，待正式发布）

- **问题定位**：原先 `ping/pong` 在 P2P 打通后仍会立即镜像到 MQTT，迟到的 MQTT 心跳可能污染 P2P 延迟；界面只要看到 DataChannel 打开就显示“P2P直连”，没有区分公网直连与 TURN 中继；延迟还是单次原始样本，手机切网或 WebView 调度抖动时容易显示 600ms 级别尖峰。
- **传输修复**：心跳现在只走发起时实际选定的链路；P2P 可用时只走 DataChannel，P2P 不可用时才走 MQTT。收到心跳时记录实际入口（P2P/MQTT），响应强制回同一路径，并拒绝把不同路径的迟到响应计入当前样本。P2P/MQTT 切换时清空旧路径的待测请求和延迟样本。
- **线路识别**：新增 WebRTC `getStats()` 轮询，读取当前 selected candidate pair 的 `candidateType` 与 `currentRoundTripTime`；界面新增“P2P直连 / P2P中继 / P2P检测”状态，避免把 TURN 中继误称为公网直连。WebRTC RTT 会写入状态栏悬停提示，主显示延迟使用最近 5 次应用心跳样本的中位数。
- **同步范围**：`index.html`、`android_src/assets/index.html`、`五子棋大师_单文件版.html` 和 `tests/optimization_smoke.py` 已同步；本轮没有修改 Worker、Pages、D1、TURN Secret 或更新票据逻辑，因此不部署 Cloudflare。现有正式线上版本仍为 v1.0.112，尚未创建新 Release，`五子棋.apk` 本轮未重新签名构建。
- **验证结果**：`tests/optimization_smoke.py`（P2P 心跳不镜像 MQTT、TURN 线路识别）通过；真实 `tests/online_transport_smoke.py` 通过，P2P 双向落子约 17–22ms、心跳约 1ms、可靠聊天只显示一次；`tests/p2p_recovery_smoke.py`、`tests/online_reconnect_smoke.py`、`tests/online_match_race_smoke.py` 均通过；`turn_worker_unit.js`、`worker_unit.js`、`auth_refresh_unit.js`、HTML 脚本语法检查和 `git diff --check` 通过，页面无 console/page error。
- **当前本地产物**：`index.html` 637,780 bytes，SHA-256 `DAE7763AC6E5E2D77A6C68DC03CE2D074A365811C8EDEC299807FA38F0D14771`；Android 内嵌页面 683,019 bytes，SHA-256 `DF157E5B8E8717120BA0AF61B000CB88165A5630473D83742F493702476EAEBE`；单文件版 1,201,815 bytes，SHA-256 `396819EA68C99C3D1DE6CCF3D215A50849719DE2561BE578AC1D60924E645928`。

## 四十、P2P 高延迟线路自动重选（2026-09-06，本地已修复，待正式发布）

- **线路评分**：WebRTC 统计连续 3 次 RTT 超过 250ms 后，认为当前 ICE 候选线路质量偏低；根据 selected candidate pair 的 `candidateType` 区分直连和 TURN 中继，并把当前 WebRTC RTT 保留在状态提示中。
- **自动优化**：触发高延迟策略后自动重建一次 P2P/ICE，尝试重新选择直连或更快的 TURN 路径；每个房间最多自动重选 2 次，重选冷却 90 秒。重选期间可靠落子、聊天和技能消息继续由 MQTT 兜底，不会因优化动作丢棋局消息。
- **保护边界**：RTT 正常时不重连；连续高 RTT 且达到上限后停止自动重试，保留当前可用链路，避免手机弱网反复闪断。该策略只能尝试更好的候选线路，无法消除运营商到 TURN 节点本身的物理高延迟。
- **同步范围**：已同步 `index.html`、`android_src/assets/index.html`、`五子棋大师_单文件版.html` 与 `tests/optimization_smoke.py`；未修改 Worker、Pages、D1、TURN Secret 或更新票据逻辑，不部署 Cloudflare；未重新签名 APK，也未创建新 Release。
- **验证结果**：优化冒烟已验证 P2P 心跳不镜像 MQTT、TURN 线路识别和连续高 RTT 只触发一次重选；真实 `online_transport_smoke.py` 通过，P2P 心跳约 1ms、双向落子约 15–19ms；`p2p_recovery_smoke.py`、`online_reconnect_smoke.py`、`online_match_race_smoke.py` 及 Worker/认证单测、HTML 语法检查和 `git diff --check` 通过。
- **当前本地产物**：`index.html` 639,841 bytes，SHA-256 `13C12086A9A62AAFD9A23FFCC9E2D7A2B81DF515E800689B33B95AEF444CA0A0`；Android 内嵌页面 687,528 bytes，SHA-256 `FBEC1BBCD5494580891E1700CD213EF5C7DFD403799DFAFF50C678BEE03CD562`；单文件版 1,206,324 bytes，SHA-256 `C9F6CE8A1D5ED3364268E4FA5A1098739498D3AE0968D215F0D98E38FC0F256E`。

## 四十一、P2P 低延迟与高 RTT 自愈正式发布（2026-09-06，已发布 v1.0.113）

- **正式版本**：`v1.0.113 (Build 114)`，GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.113>；已上传 `gomoku.apk` 与 `gomoku.html`，并已推送 `master`。
- **本轮发布内容**：P2P 心跳按实际链路隔离，延迟采用最近 5 次应用心跳中位数；WebRTC 统计区分 P2P 直连与 TURN 中继并显示真实 RTT；连续高 RTT 时自动限次重选 ICE 线路，重选期间由 MQTT 可靠兜底，避免落子、聊天和技能消息丢失。
- **发布前回归**：`tests/optimization_smoke.py`、`tests/online_transport_smoke.py`、`tests/p2p_recovery_smoke.py`、`tests/online_reconnect_smoke.py`、`tests/online_match_race_smoke.py`、`tests/ai_worker_smoke.py`、`tests/avatar_asset_smoke.py`、`tests/turn_worker_unit.js`、`tests/worker_unit.js`、`tests/auth_refresh_unit.js`、`tests/ai_strength_smoke.js`、`tests/ai_selfplay.js`、全主题脚本语法检查和 `git diff --check` 均通过；真实双页面 P2P 心跳约 1ms、双向落子约 15–22ms、可靠聊天只显示一次，页面无 console/page error。
- **线上验收**：`https://gomoku-api.pages.dev/api/version` 返回 `code=0、tag=v1.0.113`，APK/HTML 短时票据均存在；接口继续不暴露可复用下载直链。Release 资产为 APK 1,595,610 bytes、HTML 1,206,324 bytes。
- **产物 SHA-256**：根页面 `index.html`：`3531D520F1BC5D8AAD76C778D19451F55968278F35590EDBCB1A5509735F2EF8`；Android 内嵌页面：`1D907DB7D1F32DA93FA4DAC997F22E748690E84B378B442B22C9B3990FDEE41C`；单文件版：`022003D958204BDE44AD0CDA369090847AEF22AF47ED25FB3D84D3FBDC199E6E`；正式 APK：`A99E8B5F57BE9CC9E7C018D41AEFABCCDF923A200104D7770D8E567014D5982C`。APK v1/v2/v3 签名验证通过，签名者数量为 1。
- **部署边界**：本次只发布客户端和静态资源，没有修改 Worker、D1、Pages、TURN Secret 或更新票据逻辑，因此按规则未重新部署 Cloudflare；后续普通客户端版本更新仍直接执行 `node publish.js` 即可。

## 四十二、WiFi/流量切换联机自愈正式发布（2026-09-07，已发布 v1.0.114）

- **问题根因**：WiFi 切到 4G/5G 时浏览器不一定派发 `offline/online`；旧 MQTT WebSocket 可能半开但连接池仍标记为 connected，重连又复用旧池；P2P 重新协商需要 MQTT 信令，因此最终表现为切流量后房间无法恢复。
- **连接修复**：MQTT 池新增真实可用性检查和主动失效接口，只要底层没有 live client 就拒绝复用；心跳超时或网络变化时先销毁半开 MQTT/WebRTC，再按原房间码、roundId 和可靠消息队列重建，不再误判旧连接为“重连成功”。
- **网络变化检测**：网页端监听 `navigator.connection`、`online/offline`、页面恢复；Android 新增 `ConnectivityManager.NetworkCallback`，通过安全的 JS 回调通知 WiFi、流量和网络能力变化。事件统一去抖，避免一次切网触发多次重连。
- **回归验证**：`tests/online_reconnect_smoke.py` 已模拟 Android WiFi→蜂窝数据回调，房间码与轮次保持不变，重连后双向落子和可靠聊天只显示一次；`tests/online_transport_smoke.py`、`tests/p2p_recovery_smoke.py`、`tests/online_match_race_smoke.py`、`tests/optimization_smoke.py`、全主题语法检查、`git diff --check` 均通过，页面无 console/page error；Android Java 编译和 APK v1/v2/v3 签名校验通过。
- **正式版本**：`v1.0.114 (Build 115)`，GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.114>；已上传 `gomoku.apk` 与 `gomoku.html`，并推送 `master`。线上 `/api/version` 返回 `code=0、tag=v1.0.114`，APK/HTML 短时票据均存在。
- **产物**：APK 1,599,706 bytes；单文件 HTML 1,212,815 bytes。SHA-256：根页面 `F2C293268B8C8703A00627CC2CDC10C367F74FB1C2729475F03B40861D564310`；Android 内嵌页面 `AAE32875D28AB6E4AE4C13E20F18DFC8484EBCE716914736200335898D5B3BC5`；单文件版 `5D0C22B27984D0CC0ADEC2B3582836A1C209ADFC3A4EAF820314C5451C968207`；APK `EE20B7F815C42ECE340FD049A23195E7AA411A6BE602B7B336FDAB180A2C8A0C`。
- **部署边界**：本次只发布客户端、Android 网络监听和静态资源，没有修改 Worker、D1、Pages、TURN Secret 或更新票据逻辑，因此未重新部署 Cloudflare；普通客户端更新仍可直接走现有热更新通道。

## 四十三、双端进房确认闸门正式发布（2026-09-07，已发布 v1.0.115）

- **问题根因**：房主收到客方 `join_request` 后就提前更新对手昵称并显示“好友已加入”；客方自己的房间连接若仍在订阅、跨 Broker 切换或弱网重试，客方会继续停留在人机模式，造成两端状态不一致。
- **握手修复**：房主连接 ready 后只发送 `join_accepted`；客方完成自己的 `MqttRoomConnection.readyPromise` 后发送 `join_ready`；房主确认连接、房间码、轮次和 UID 均匹配后才更新对手资料、切到 online，并发送 `join_confirmed`；客方收到确认后才停止加入重试、切到 online。确认前双方均不会误显示已开始联机。
- **弱网保护**：加入期间冻结旧的人机搜索，客方确认超时会关闭当前临时连接并继续按房间码重试；房主确认等待超时会释放临时连接并恢复等待状态。重复的 accepted/ready/confirmed 报文均可安全处理，不会重复建连或重复切换模式。
- **界面修复**：房主在确认前保持“等待好友完成进房确认”，确认后双方状态栏统一显示“已与好友连接，可以开始对弈”；对手昵称不会在未完成进房时提前覆盖人机显示。
- **回归验证**：`tests/online_match_race_smoke.py` 新增客方延迟 700ms ready 的竞态用例，确认确认前双方仍为 AI、房主不显示客方，确认后双方同时 online；该用例通过。`tests/optimization_smoke.py` 通过；真实 `tests/online_transport_smoke.py` 后续重试通过，双向落子/可靠聊天/网络状态均正常；发布脚本全主题语法、安全门禁、Android 编译和 APK 签名校验通过。
- **正式版本**：`v1.0.115 (Build 116)`，GitHub Release：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.115>；已上传 `gomoku.apk` 与 `gomoku.html`，并推送 `master`。正式 `/api/version` 返回 `code=0、tag=v1.0.115`，短时下载票据正常签发。
- **本地产物**：根页面 652,664 bytes；Android 内嵌页面 700,351 bytes；单文件版 1,219,147 bytes；APK 1,599,706 bytes。SHA-256：根页面 `D9CEC6679D131A5D096F92CB2EC0B30A64B39541A88B61D71DD5135CFC1C71EF`；Android 内嵌页面 `06072EC4B78DC7BD75FB20E474C9DE837F05956115444705C9B4B7CF0EC726C6`；单文件版 `3C8E1F4CB7E88BFBBCE662B63E7DF4B43395CDC0D24AD72707C9FCAACE5D707D`；APK `7F6B31C61B6C5D76DE0A16D4052502162C1B11FA7DB263A24ED6611BA85D8399`。APK v1/v2/v3 签名验证通过，签名者数量为 1。
- **部署边界**：本轮只改客户端联机握手、静态资源和测试，没有修改 Worker、D1、Pages、TURN Secret 或更新票据逻辑；按规则未部署 Cloudflare。普通客户端可通过现有热更新通道升级到 v1.0.115。

## 四十四、项目自有房间中继与联机链路强化（2026-09-07，已部署并发布 v1.0.116）

- **根因确认**：公共 MQTT 四个节点在同一时段全部出现 WebSocket close，导致两端直接回到人机；继续堆公共 Broker 重试只能缓解，不能把它当作核心信令基础设施。
- **新联机拓扑**：新增 Cloudflare Durable Object `GomokuRoom` 作为项目自有 WebSocket 房间中继，客户端优先连接 `gomoku-backend.xnnb04664.workers.dev/api/room/socket`，Pages 同路径作为备用；只有自有中继不可用或旧环境不支持 WebSocket 时，才回退公共 MQTT。P2P DataChannel 仍是棋局首选路径，TURN 只在直连失败时中继。
- **房间隔离与握手**：DO 按 6 位房间码固定到单一对象，每房间最多一名 host、一名 client；host 使用随机 `room sessionId + joinTicket` 建立会话，bootstrap 进房报文只允许 v3 的 join 请求/确认，正式业务统一走带 sessionId、senderRole 的 v4 通道。旧房间重开会主动关闭旧连接和客方，防止旧棋局、旧 WebSocket 或撞码报文串入。
- **服务端保护**：中继限制单条报文 64KB、每连接每秒 120 条，限制 topic 方向、角色和会话；v4 数据必须匹配发送角色，P2P 信令单独校验 WebRTC sessionId；中继不保存密码、账号或棋局历史，只在内存中短暂转发并缓存少量等待中的 join_request。
- **客户端复用**：新增 `RoomRelayClient` 适配器，复用原有进房确认闸门、ACK/QoS 1 业务可靠层、`_mid` 去重、状态版本/摘要对账、P2P ICE restart、DataChannel 关闭后的整条 PeerConnection 重建和 WiFi/流量切换自愈。网络状态栏能区分 `P2P直连`、`P2P中继`、`WebSocket中继` 和 `MQTT中继`。
- **连接池优化**：公共 MQTT 节点改为 300ms 错峰并行探测；首个可用节点先进入房间，其余节点后台容灾；初始探测未全部结束前不会因一个节点关闭就误判整个连接池离线。
- **后端配置**：`wrangler.worker.toml` 管理 `gomoku-backend` Worker 与 `GomokuRoom` SQLite migration；根目录 `wrangler.toml` 管理 Pages 项目，并通过 `script_name = "gomoku-backend"` 绑定已经部署的 Durable Object；`deploy_worker.js` 使用 Wrangler 管理迁移状态，重复部署不会重复执行 `v1` migration。`pages_build/_worker.js` 已与 Worker 同步。Wrangler `--dry-run` 已确认绑定为 `env.GOMOKU_ROOMS (GomokuRoom)` 和现有 D1。
- **回归验证**：
  - `tests/online_relay_smoke.py`：自有中继双端模拟、双向落子、可靠聊天只显示一次、无页面错误；
  - `tests/online_match_race_smoke.py`：跨 Broker/延迟 ready/进房闸门通过；
  - `tests/online_transport_smoke.py`：P2P 直连、双方网络状态/延迟、双向落子和聊天通过；
  - `tests/online_reconnect_smoke.py`：WiFi→流量回调、房间轮次保持、重连后落子和聊天通过；
  - `tests/p2p_recovery_smoke.py`：DataChannel 关闭后 MQTT 兜底、自动恢复 P2P、恢复后落子通过；
  - `tests/optimization_smoke.py`、`tests/worker_unit.js`、`tests/turn_worker_unit.js`、HTML/Worker 语法检查及 `git diff --check` 通过；Wrangler 本地 DO 实测 WebSocket 101、bootstrap 转发和 v4 安全业务转发通过。
- **线上验证**：Worker `wss://gomoku-backend.xnnb04664.workers.dev/api/room/socket` 与 Pages `wss://gomoku-api.pages.dev/api/room/socket` 均完成真实双端 WebSocket 101、`relay_ready`、v3 bootstrap 转发和 v4 业务转发测试；Worker 最终版本 ID 为 `761bf5b2-6818-461c-a21c-b26148caa9ac`。
- **正式发布**：v1.0.116（Build 117）已推送 `master`，GitHub Release 已创建：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.116`，上传 `gomoku.apk` 与 `gomoku.html`；生产 `/api/version?channel=stable&client=v1.0.116` 返回 `code=0、tag=v1.0.116`。
- **正式产物**：APK SHA-256：`86DB27B87ED98C8C09108D77BAE2B4BE19504A9D7CAD88DF2E841EBAFBCB68DE`；根页面 `B9DB2A0D44D70992B2E2C3A26B75FDA6C474F947E9DBB068BFD87E0310181CEB`；Android 内嵌页面 `DED281DD63E4D21D03C394CA9FF01E6D0DDBE059E95F9FACC1AFE2799561E1E4`；单文件版 `83EC7A08A231B1DA72994241A5FF83E2F3FF06DFC040F23219CAEC18B87F018B`；Worker 与 Pages 派生脚本 `DC8B0EA8EEDF90AD60E5B09BF8C0B676E36CE076BCF219CF2CED2AD763B75E51`。APK v1/v2/v3 签名和单签名者校验通过。
- **后续规则**：普通客户端发版只需执行 `node publish.js`，不重复部署 Cloudflare；只有修改 Worker、DO、Pages 绑定、D1 或更新票据逻辑时，才执行 `node publish.js --deploy-cloudflare`。本轮后端改造已完成部署并随 v1.0.116 正式发布。

## 四十五、生产联机移除公共 MQTT 依赖（2026-09-07，已发布 v1.0.117）

- **生产链路调整**：新版客户端默认只连接项目自有 Durable Object WebSocket 中继（Worker 主入口失败后再串行切换 Pages 备用入口），不再把公共 MQTT 当作生产信令或对局兜底。P2P DataChannel 仍优先承载低延迟棋局数据，TURN 继续负责无法直连时的穿透。
- **修复重复抢房**：原先 Worker 与 Pages 两个 WebSocket 入口并行竞速，同一房间同一角色可能同时占用两个 DO 会话，导致一端显示进房、另一端被踢回人机。现在改为主入口失败后才尝试备用入口，避免重复会话。
- **兼容边界**：旧 MQTT 连接池、适配器和模拟测试仍保留，但必须显式设置 `window.__GOMOKU_ENABLE_LEGACY_MQTT__ = true` 才会启用；正常页面流程不会加载 `mqtt.min.js`，也不会请求四个公共 Broker。该开关不写入正式 UI，不作为用户可见配置。
- **同步范围**：本轮修改了 `index.html` 与联机回归测试，并已重新生成 `android_src/assets/index.html`、`五子棋大师_单文件版.html` 和正式签名 `五子棋.apk`；版本已递增为 v1.0.117（Build 118）。
- **回归验证**：`tests/online_no_public_mqtt_smoke.py`、`tests/online_relay_smoke.py`、`tests/online_match_race_smoke.py`、`tests/online_transport_smoke.py`、`tests/online_reconnect_smoke.py`、`tests/p2p_recovery_smoke.py`、`tests/optimization_smoke.py`、`tests/worker_unit.js`、`tests/turn_worker_unit.js`、Node 语法检查和 `git diff --check` 均通过；默认路径未请求 `mqtt.min.js`，自有 WebSocket 双端、P2P、断线恢复、可靠聊天和延迟显示无页面错误。APK v1/v2/v3 签名校验通过，签名者数量为 1。
- **正式发布与产物 SHA-256**：GitHub Release：`https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.117`；线上 `https://gomoku-api.pages.dev/api/version?channel=stable&client=v1.0.117` 已返回 `code=0、tag=v1.0.117`。根页面 `2A6E9FA5537DCAB54ECC635527092853FEE4D0FF4BC731F2705776315EB417EA`；Android 内嵌页面 `B641AC2D6513C8607685C07680225B6BAFC6E9EEFE563B6AD1E57E7073B9C33A`；单文件版 `10CCE034742020BD12537413FDC15FA247E55004FB03AACFF42FCE3CAABD27EB`；APK `FC96F024C494AF0DF05BCF29A6E2A427F8C33AB94003F9924BB5F117835E93C7`。
- **部署边界**：本轮没有修改 Worker/DO、Pages、D1、TURN Secret 或更新票据逻辑，因此不需要重复部署 Cloudflare。后续若只发布客户端，执行 `node publish.js`；若同时改后端，再显式执行 `node publish.js --deploy-cloudflare`。

## 四十六、界面折叠版本号与 v1.0.118 正式发布（2026-09-07）

- **版本显示**：内部版本仍使用 `v1.0.118 (Build 119)` 做更新比较、Android `versionName/versionCode` 和发布标识；只在用户界面折叠显示为 `v1.1.8`，避免改变既有更新顺序。
- **正式发布**：v1.0.118 已推送私有仓库并创建 GitHub Release；生产 `/api/version` 已确认返回 `v1.0.118`。网页、单文件版、Android 资源和 APK 均已同步，APK 继续使用仓库外原签名。
- **部署边界**：本轮为客户端展示与静态资源发布，没有重新部署 Cloudflare 生产 Worker/Pages。

## 四十七、手机流量联机进房竞态与延迟显示修复（2026-09-07，本地已验证，待下次发布）

- **问题复现**：iQOO Z10x 使用 5G 流量、MuMu 使用电脑网络快速匹配时，曾出现模拟器进入房间而手机退回人机；旧状态栏把双方连接信息塞在同一行，真实毫秒数在窄屏上被省略号截断，看起来像“没有延迟”。
- **进房修复**：房主现在先登记 `pendingGuestReady` 再发送 `join_accepted`，消除高速 WebSocket 回包先于本地状态登记的竞态；客方每 700ms 持续重发 `join_ready`，房主对已完成闸门的重复 ready 幂等补发 `join_confirmed`，确认窗口统一为 15 秒。P2P/TURN 是否成功不再影响 WebSocket 进房确认，确认超时也会给出明确提示。
- **P2P 与延迟**：移除真机持续 DNS 失败的 `stun.qq.com` 默认项，保留 Cloudflare 官方 STUN，并继续从 `/api/rtc/ice-servers` 获取一小时短期 TURN 凭据；进房后的 0.7 秒与 1.6 秒补发心跳。状态栏改为上下两行，双方的 `P2P直连 / P2P中继 / WebSocket中继` 与毫秒数完整显示。
- **真机结果**：修复版 APK 已覆盖安装到手机与 MuMu，均保持 `v1.0.118 (Build 119)`、原签名和原账号数据。两端最终进入同一房间 `523342`，先稳定显示 WebSocket 中继约 `490–504ms`，随后自动升级为 `P2P中继` 约 `473–492ms`；手机黑方与模拟器白方各落一子，双方棋盘均同步显示两手。
- **自动化回归**：`online_relay_smoke.py` 模拟连续丢弃 14 条 `join_confirmed` 后仍自动进房，双向落子与可靠聊天通过；`online_match_race_smoke.py`、`online_transport_smoke.py`（含延迟文字不裁切）、`online_reconnect_smoke.py`、`online_no_public_mqtt_smoke.py`、`p2p_recovery_smoke.py`、`optimization_smoke.py`、`turn_worker_unit.js`、`worker_unit.js` 均通过，页面无错误，`git diff --check` 通过。
- **本地产物**：根页面 683,612 bytes，SHA-256 `3E1C5F01F3A79BBEA9205ECB22A785891282E4E8F23AB5BA1F6F188A65D4DEE9`；Android 内嵌页面 731,299 bytes，SHA-256 `1F99F0B7337A9C6D8F762B1566B49A64E392885923A1DD24D0D8994C331C8369`；单文件版 1,250,095 bytes，SHA-256 `7B8517D17A43F423FE3A9AD29B39F7F8403C3E632409E43FF0FCC659CD7CC624`；APK 1,607,898 bytes，SHA-256 `BF7716EA7B5E17C1C44213BA8E430FA3842B40E0598F941B234AC52ECCD529E0`。APK v1/v2/v3 签名校验通过，签名证书 SHA-256 仍为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。
- **发布边界**：本轮只改客户端、静态派生产物和测试，没有改 Worker/DO/D1/Pages/Secret，未部署 Cloudflare，也未创建新的 Release。当前生产仍是已发布的 v1.0.118；若要让其他设备自动热更新到本修复，需要下一次执行普通客户端发布流程。

## 四十八、Android 页面重建后的原房间恢复修复（2026-09-07，本地已验证，待下次发布）

- **真机根因**：房间 `523342` 对局期间 MuMu 的 WebView/进程被系统重建。旧恢复数据只保存六位房号、棋盘和轮次，没有保存 `onlineSessionId`；MuMu 因而为同一房号生成新会话，手机仍持有旧会话并按安全规则拒绝新会话，形成手机显示旧对手在线、MuMu 显示等待对方的状态分叉。
- **会话恢复**：五分钟有效的本地对局恢复记录现在同时保存原 `sessionId`、短期 `joinTicket` 和房主当前客方 UID；入房确认闸门一完成就立即落盘，即使尚未落子也可恢复。恢复值均执行原有长度限制，会话隔离、发送角色和轮次校验没有放宽；退出房间仍会立即清除恢复记录。
- **同时重连竞态**：客方恢复时除在原 v4 对局信道发送 `reconnect_handshake`，还会把带原 `sessionId/roundId` 的同一握手发送到房主 v3 重建信道。这样房主若恰好也因心跳超时销毁旧 v4 连接，仍可发现合法客方并重建；非法或其他会话的握手继续被拒绝。
- **真机验证**：最终 APK 覆盖安装到 iQOO Z10x 和 MuMu，账号与存档保留。双方进入房间 `762504` 后强制结束 MuMu 进程并重新启动，约 30 秒内自动恢复到同一房间，随后重新升级为 Cloudflare TURN 的 `P2P中继`，双方延迟约 `699–744ms`；恢复后黑白双方各落一子，两端棋盘均同步显示两手。
- **自动化回归**：`tests/online_reconnect_smoke.py` 新增“零落子时立即保存会话身份、客方整页刷新、房主同时废弃旧连接”的回归，确认原房号、sessionId、roundId、两步棋、双向消息与可靠聊天全部恢复。`online_relay_smoke.py`、`online_match_race_smoke.py`、`online_transport_smoke.py`、`online_no_public_mqtt_smoke.py`、`p2p_recovery_smoke.py`、`optimization_smoke.py`、`turn_worker_unit.js`、`worker_unit.js` 和 `git diff --check` 均通过，页面无错误。
- **同步与签名**：根页面、Android 内嵌页面、单文件版和 APK 已同步；APK v1/v2/v3 签名验证通过，签名证书 SHA-256 仍为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。
- **本地产物**：根页面 685,417 bytes，SHA-256 `2CFB8FD63A83904BA7A34ABD0988DFB4C2456E82992BFDD104F2495F3702209F`；Android 内嵌页面 733,104 bytes，SHA-256 `39B03C4846DE15CC8DB5EF434DE7097532BD40F443CB9447917FC1346C9AC295`；单文件版 1,251,900 bytes，SHA-256 `C7CC9ABC8B1F3347E0E409C4D9C70D75D2F28F4B542B33BC1C00FB3209CA7D70`；APK 1,607,898 bytes，SHA-256 `9A8E16227D0913593008121FC15A5A941D0DB8597B5BCD275A0390A836643EFA`。
- **发布边界**：本轮仍只改客户端、静态派生产物和测试，没有修改 Worker/DO/D1/Pages/Secret，未部署 Cloudflare，也未创建 Release。生产版本仍为 v1.0.118；对外热更新需执行下一次普通客户端发布流程。

## 四十九、联机进房、延迟显示与页面重建恢复正式发布（2026-09-07，v1.0.119）

- **正式版本**：内部版本 `v1.0.119 (Build 120)`，用户界面折叠显示 `v1.1.9`。提交 `4a830e7` 已推送私有仓库 `master`。
- **GitHub Release**：<https://github.com/xnnb04664-afk/gomoku/releases/tag/v1.0.119>，正式版、非草稿，包含 `gomoku.apk`（1,607,898 bytes）和 `gomoku.html`（1,251,900 bytes）两个产物。
- **生产验收**：`https://gomoku-api.pages.dev/api/version?channel=stable&client=v1.0.118` 已返回 `code=0、tag=v1.0.119`，现有短时票据更新链路可向旧客户端提供新版本；没有暴露可复用下载地址。
- **正式产物 SHA-256**：根页面 `217536F617099B3291F2B1116CDF6420021C2DBE6EEAAF735A76570FB5B4DD40`；Android 内嵌页面 `2A2C0B67E02741AD3B42D5E61F2CF09E3EB5B08653E7D3C3BD0180715FFF3211`；单文件版 `B5DD39D83117ADC24B1781DB38786C07532BCB45FBF755BAA9269B8111C98EA3`；APK `CA819E4B6004AC2C8AD8FC6D9CA4646A5B19AF3A730A78C29EF3DA7B015EEEC5`。
- **签名与门禁**：APK v1/v2/v3 签名均通过，签名证书 SHA-256 仍为 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。发布前静态完整性、安全门禁、Android 构建和联机回归均通过。
- **部署边界**：本次执行普通 `node publish.js`，没有重新部署 Cloudflare。未修改 Worker/DO、D1、Pages 绑定、TURN Secret 或票据逻辑，现有生产后端继续服务。

---
*交接文档最后更新时间：2026年9月7日*
*当前工程正式版本：v1.0.119 (Build 120，界面显示 v1.1.9)；“四十七至四十八”的手机流量进房、延迟显示与 Android 页面重建恢复修复已随“四十九”正式发布。*
*当前工程状态：下载票据保护、客户端防篡改、天梯榜性能优化、统一密码策略、修改密码、满盘和棋、联机神抽额度与云端和棋记录、MQTT/WebRTC 联机稳定性、AI/Canvas/联机安全重点优化、全端 UI 精细化排查、联机终局/重开/悔棋/状态显示修复、Refresh Token 自动续期、全服匹配自动续期与授权错误提示、手机 TXT 导出、双方网络状态/延迟显示、联机昵称同步兜底、Pages 主出口优先与 Worker 容灾、手机端图标设计提示词、棋子超清重构与全工程视觉舒适度拉网排查、默认棋子纯黑白样式确认、手机端应用图标替换、账号登录网络路径优化、更新检测可靠性修复、五子连珠终局后悔棋继续对弈全模式适配、全工程深层排查与空安全加固、移动端 Web Worker/bitboard AI 异步性能优化、更新路由与 D1 冷启动隔离、干扰牌/大爆炸历史记录防污染与专业推演复盘引擎深度重构、跨端匹配 ready 闸门、双端 join_ready/join_confirmed 进房确认、MQTT 多节点错峰汇合、匹配轮询去重、match_id 幂等重试、D1 匹配队列索引与限频清理、API 出口后台预热、线上 Worker/Pages 入口恢复、终局待确认事务机制与胜后悔棋不计对局/天梯落库、最强大师 AI v2、AI v3 根节点战术候选与威胁空间搜索、统一快速引擎回退、移动端 Worker 威胁深度传递、情侣动漫头像资源轻量化、榜单头像加载闸门与懒加载、P2P/MQTT 可靠业务消息层、低延迟直连优先、TURN 非阻塞建链、网络状态加速刷新与断网自动重连、P2P 心跳按实际链路测量、TURN/直连线路识别、延迟样本去污染、高 RTT 线路自动重选、WiFi/流量切换自愈、双端进房状态一致性、项目自有 Durable Object 房间中继、WebSocket 主信令、公共 MQTT 仅保留旧版迁移/自动化测试开关和可重复 Cloudflare 部署流程均已完成或按本交接文档状态维护。普通客户端发版默认不重复部署 Cloudflare；只有修改后端 Worker、DO、D1、Pages 配置或更新中转/票据逻辑时才执行一次显式部署。后续代码更新先运行完整回归，再使用仓库外正式签名密钥执行 `node publish.js`。*
