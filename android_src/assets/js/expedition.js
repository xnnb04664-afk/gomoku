(() => {
  'use strict';

  const SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const PROGRESS_KEY = 'gomoku_expedition_progress_v1';
  const ACTIVE_KEY = 'gomoku_expedition_state_v1';
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LEVELS = Object.freeze([
    {
      id: 'island-01', name: '云隙初光', type: '成五', hint: '右侧缺口正等待最后一颗棋。', moveLimit: 1,
      stones: [[7,4,WHITE],[7,5,BLACK],[7,6,BLACK],[7,7,BLACK],[7,8,BLACK]]
    },
    {
      id: 'island-02', name: '苔痕断章', type: '补形', hint: '五颗棋不一定要从边缘开始连接。', moveLimit: 1,
      stones: [[6,3,WHITE],[6,4,BLACK],[6,5,BLACK],[6,7,BLACK],[6,8,BLACK]]
    },
    {
      id: 'island-03', name: '垂云之梯', type: '成五', hint: '顺着风向纵览整条棋路。', moveLimit: 1,
      stones: [[3,7,WHITE],[4,7,BLACK],[5,7,BLACK],[6,7,BLACK],[7,7,BLACK]]
    },
    {
      id: 'island-04', name: '斜阳航标', type: '成五', hint: '日线会沿斜向穿过云层。', moveLimit: 1,
      stones: [[3,3,WHITE],[4,4,BLACK],[5,5,BLACK],[6,6,BLACK],[7,7,BLACK]]
    },
    {
      id: 'island-05', name: '逆风星径', type: '成五', hint: '从右上到左下寻找最后一段。', moveLimit: 1,
      stones: [[3,11,WHITE],[4,10,BLACK],[5,9,BLACK],[6,8,BLACK],[7,7,BLACK]]
    },
    {
      id: 'island-06', name: '守云一手', type: '防守', hint: '白棋只差一手。封住唯一出口。', moveLimit: 1, defense: [7,9],
      stones: [[7,4,BLACK],[7,5,WHITE],[7,6,WHITE],[7,7,WHITE],[7,8,WHITE]]
    },
    {
      id: 'island-07', name: '天脉首领', type: '双杀', hint: '找到横竖两条棋路共同的轴心。', moveLimit: 2, boss: true,
      stones: [[7,5,BLACK],[7,6,BLACK],[7,8,BLACK],[5,7,BLACK],[6,7,BLACK],[8,7,BLACK],[5,5,WHITE],[9,9,WHITE]]
    },
    {
      id: 'island-08', name: '风眼回廊', type: '双头', hint: '横向棋风已经成形，左右两端都能落下制胜一手。', moveLimit: 1,
      stones: [[5,5,WHITE],[5,6,BLACK],[5,7,BLACK],[5,8,BLACK],[5,9,BLACK],[8,4,WHITE],[9,4,WHITE]]
    },
    {
      id: 'island-09', name: '月背落子', type: '斜线', hint: '沿着斜阳留下的四颗黑子，补上缺口即可穿云。', moveLimit: 1,
      stones: [[3,9,WHITE],[4,4,BLACK],[5,5,BLACK],[6,6,BLACK],[7,7,BLACK],[10,4,WHITE]]
    },
    {
      id: 'island-10', name: '潮汐关隘', type: '防守', hint: '白棋的潮汐只剩一个出口，封住右侧缺口。', moveLimit: 1, defense: [9,7],
      stones: [[9,2,BLACK],[9,3,WHITE],[9,4,WHITE],[9,5,WHITE],[9,6,WHITE],[9,8,BLACK],[6,10,BLACK]]
    },
    {
      id: 'island-11', name: '星桥折光', type: '斜线', hint: '两颗星之间只差最后一段，别被边角的白子带走视线。', moveLimit: 1,
      stones: [[2,2,WHITE],[4,4,BLACK],[5,5,BLACK],[6,6,BLACK],[7,7,BLACK],[10,10,WHITE],[11,4,WHITE]]
    },
    {
      id: 'island-12', name: '孤星回旋', type: '防守', hint: '纵向云墙已经逼近，落在最下方的出口才能守住棋台。', moveLimit: 1, defense: [8,10],
      stones: [[3,10,BLACK],[4,10,WHITE],[5,10,WHITE],[6,10,WHITE],[7,10,WHITE],[2,6,BLACK],[11,3,WHITE]]
    },
    {
      id: 'island-13', name: '双星坠海', type: '双杀', hint: '先落在横竖交汇处，下一手会同时点亮两条航线。', moveLimit: 2,
      stones: [[7,5,BLACK],[7,6,BLACK],[7,8,BLACK],[5,7,BLACK],[6,7,BLACK],[8,7,BLACK],[4,4,WHITE],[10,10,WHITE]]
    },
    {
      id: 'island-14', name: '终焉天穹', type: '首领', hint: '最后一座棋台只留一道斜向天门，黑子必须一击穿云。', moveLimit: 1, boss: true,
      stones: [[3,3,BLACK],[4,4,BLACK],[5,5,BLACK],[6,6,BLACK],[8,2,WHITE],[10,10,WHITE],[11,4,WHITE]]
    },
    {
      id: 'island-15', name: '云港开线', type: '成五', hint: '港口横风已经排成一线，补上任意一端即可出航。', moveLimit: 1,
      stones: [[2,2,WHITE],[2,5,BLACK],[2,6,BLACK],[2,7,BLACK],[2,8,BLACK],[11,11,WHITE],[10,3,WHITE]]
    },
    {
      id: 'island-16', name: '霁色纵歌', type: '成五', hint: '沿着垂直的晴光向上或向下，找到唯一的纵轴节拍。', moveLimit: 1,
      stones: [[4,11,WHITE],[5,12,BLACK],[6,12,BLACK],[7,12,BLACK],[8,12,BLACK],[10,2,WHITE],[3,4,WHITE]]
    },
    {
      id: 'island-17', name: '霞光斜渡', type: '斜线', hint: '四颗黑子已经踏上斜桥，顺着霞光补齐最后一块。', moveLimit: 1,
      stones: [[3,3,WHITE],[4,4,BLACK],[5,5,BLACK],[6,6,BLACK],[7,7,BLACK],[10,3,WHITE],[12,9,WHITE]]
    },
    {
      id: 'island-18', name: '逆流星痕', type: '斜线', hint: '逆着星流看向右下方，缺口就在最后一颗黑子旁边。', moveLimit: 1,
      stones: [[3,11,WHITE],[4,10,BLACK],[5,9,BLACK],[6,8,BLACK],[7,7,BLACK],[10,4,WHITE],[12,12,WHITE]]
    },
    {
      id: 'island-19', name: '霜桥封口', type: '防守', hint: '白棋的霜桥只剩右侧出口，封住它才能守住整条航线。', moveLimit: 1, defense: [4,9],
      stones: [[4,4,BLACK],[4,5,WHITE],[4,6,WHITE],[4,7,WHITE],[4,8,WHITE],[4,10,BLACK],[9,2,WHITE]]
    },
    {
      id: 'island-20', name: '雨幕守门', type: '防守', hint: '雨幕从下方逼近，落在纵轴最底端的缺口才能关门。', moveLimit: 1, defense: [10,3],
      stones: [[5,3,BLACK],[6,3,WHITE],[7,3,WHITE],[8,3,WHITE],[9,3,WHITE],[2,8,BLACK],[12,11,WHITE]]
    },
    {
      id: 'island-21', name: '金砂回响', type: '双头', hint: '金砂把左右两端都点亮了，选择更顺手的一端完成连线。', moveLimit: 1,
      stones: [[10,5,WHITE],[10,8,BLACK],[10,9,BLACK],[10,10,BLACK],[10,11,BLACK],[4,2,WHITE],[2,12,WHITE]]
    },
    {
      id: 'island-22', name: '夜航斜阵', type: '斜线', hint: '夜航路线向右下延伸，最后一个坐标藏在云影之后。', moveLimit: 1,
      stones: [[8,3,BLACK],[9,4,BLACK],[10,5,BLACK],[11,6,BLACK],[8,11,WHITE],[3,2,WHITE],[12,10,WHITE]]
    },
    {
      id: 'island-23', name: '风灯双脉', type: '双杀', hint: '先点亮两条斜脉的交汇处，再用下一手逼出双重制胜点。', moveLimit: 2,
      stones: [[5,5,BLACK],[6,6,BLACK],[8,8,BLACK],[5,9,BLACK],[6,8,BLACK],[8,6,BLACK],[3,3,WHITE],[11,11,WHITE]]
    },
    {
      id: 'island-24', name: '云门守望', type: '防守', hint: '白棋沿着云门向下压迫，封住唯一的落脚点。', moveLimit: 1, defense: [7,11],
      stones: [[2,11,BLACK],[3,11,WHITE],[4,11,WHITE],[5,11,WHITE],[6,11,WHITE],[8,4,BLACK],[11,8,WHITE]]
    },
    {
      id: 'island-25', name: '晨星破晓', type: '成五', tier: '高级', hint: '晨星从棋盘左侧升起，先延长光带，再完成横向收束。', goal: '完成 2 手横向推进。', moveLimit: 2,
      solution: [[12,5],[12,6]], aiPlan: [[3,3]],
      stones: [[12,2,BLACK],[12,3,BLACK],[12,4,BLACK],[3,10,WHITE],[7,2,WHITE],[9,12,WHITE]]
    },
    {
      id: 'island-26', name: '远潮长轴', type: '成五', tier: '高级', hint: '远潮在中线留下纵向节拍，两次落子才能把长轴拉满。', goal: '完成 2 手纵向推进。', moveLimit: 2,
      solution: [[5,2],[6,2]], aiPlan: [[9,9]],
      stones: [[2,2,BLACK],[3,2,BLACK],[4,2,BLACK],[9,9,WHITE],[11,4,WHITE],[6,10,WHITE]]
    },
    {
      id: 'island-27', name: '月弧穿云', type: '斜线', tier: '高级', hint: '月弧从右上向左下弯行，沿着黑子轨迹连续补上两格。', goal: '完成 2 手斜线推进。', moveLimit: 2,
      solution: [[5,7],[6,6]], aiPlan: [[8,3]],
      stones: [[2,10,BLACK],[3,9,BLACK],[4,8,BLACK],[10,12,WHITE],[12,5,WHITE]]
    },
    {
      id: 'island-28', name: '落墨天桥', type: '斜线', tier: '高级', hint: '落墨铺出一座反向天桥，不能抢近手，要按斜线次序落子。', goal: '完成 2 手反向斜线推进。', moveLimit: 2,
      solution: [[5,7],[6,8]], aiPlan: [[8,2]],
      stones: [[2,4,BLACK],[3,5,BLACK],[4,6,BLACK],[10,10,WHITE],[12,8,WHITE]]
    },
    {
      id: 'island-29', name: '双月引力', type: '双杀', tier: '高级', hint: '两轮月影共享同一枚棋眼，先占棋眼，再追被留下的第二杀点。', goal: '完成 2 手双杀转换。', moveLimit: 2,
      solution: [[7,7],[4,10]], aiPlan: [[4,4]],
      stones: [[5,5,BLACK],[6,6,BLACK],[8,8,BLACK],[5,9,BLACK],[6,8,BLACK],[8,6,BLACK],[2,7,WHITE],[12,7,WHITE]]
    },
    {
      id: 'island-30', name: '孤帆关隘', type: '防守', tier: '高级', hint: '先在关隘前落一枚准备棋，再封住横线末端截住白棋。', goal: '完成 1 手准备与 1 手防守。', moveLimit: 2, defense: [6,10],
      solution: [[6,4],[6,10]], aiPlan: [[2,2]],
      stones: [[6,5,BLACK],[6,6,WHITE],[6,7,WHITE],[6,8,WHITE],[6,9,WHITE],[3,2,BLACK],[11,11,WHITE]]
    },
    {
      id: 'island-31', name: '曜石横门', type: '双头', tier: '高级', hint: '曜石横门需要连续推进两次，最后一枚才会把两端连成完整杀线。', goal: '完成 2 手横门推进。', moveLimit: 2,
      solution: [[1,8],[1,9]], aiPlan: [[4,4]],
      stones: [[1,5,BLACK],[1,6,BLACK],[1,7,BLACK],[4,4,WHITE],[9,9,WHITE],[12,2,WHITE]]
    },
    {
      id: 'island-32', name: '寂潮回声', type: '防守', tier: '高级', hint: '先把黑棋放到回声线上，再封住最外侧纵线的唯一出口。', goal: '完成 1 手准备与 1 手防守。', moveLimit: 2, defense: [10,13],
      solution: [[4,13],[10,13]], aiPlan: [[2,2]],
      stones: [[5,13,BLACK],[6,13,WHITE],[7,13,WHITE],[8,13,WHITE],[9,13,WHITE],[3,5,BLACK],[11,8,WHITE]]
    },
    {
      id: 'island-33', name: '星环交汇', type: '双杀', tier: '高级', hint: '横轴与纵轴同时靠近四连，先落中心，再追被应手留下的杀点。', goal: '完成 2 手横纵双杀转换。', moveLimit: 2,
      solution: [[9,6],[9,8]], aiPlan: [[9,3]],
      stones: [[9,4,BLACK],[9,5,BLACK],[9,7,BLACK],[7,6,BLACK],[8,6,BLACK],[10,6,BLACK],[3,3,WHITE],[12,12,WHITE]]
    },
    {
      id: 'island-34', name: '苍穹回针', type: '斜线', tier: '高级', hint: '苍穹的指针指向左下，先走回针，再落终点才不会断线。', goal: '完成 2 手斜线回针。', moveLimit: 2,
      solution: [[9,5],[10,6]], aiPlan: [[3,3]],
      stones: [[6,2,BLACK],[7,3,BLACK],[8,4,BLACK],[3,12,WHITE],[11,2,WHITE],[12,9,WHITE]]
    },
    {
      id: 'island-35', name: '终局天阶', type: '成五', tier: '高级', hint: '终局天阶只差两级，先稳住底部再登上最后一阶。', goal: '完成 2 手纵向终局推进。', moveLimit: 2,
      solution: [[11,8],[12,8]], aiPlan: [[4,3]],
      stones: [[8,8,BLACK],[9,8,BLACK],[10,8,BLACK],[4,3,WHITE],[6,12,WHITE],[12,4,WHITE]]
    },
    {
      id: 'island-36', name: '天空棋圣', type: '首领', tier: '高级', hint: '大师区终点只留两步斜向天门，先补内侧，再完成登顶。', goal: '完成 2 手首领棋台推进。', moveLimit: 2, boss: true,
      solution: [[6,6],[7,7]], aiPlan: [[2,2]],
      stones: [[3,3,BLACK],[4,4,BLACK],[5,5,BLACK],[2,10,WHITE],[9,2,WHITE],[11,11,WHITE]]
    },
    {
      id: 'island-37', name: '落子入楔', type: '强制手', tier: '大师', hint: '先把楔子打进横线，再连续压迫两次；偏离主线会立即失去先手。', goal: '连续找到 3 手强制手，最后一手完成五连。', moveLimit: 3, boss: true,
      solution: [[4,6],[4,7],[4,8]], aiPlan: [[2,2],[10,10]],
      stones: [[4,4,BLACK],[4,5,BLACK],[1,1,WHITE],[6,10,WHITE],[11,3,WHITE]]
    },
    {
      id: 'island-38', name: '垂云读秒', type: '强制手', tier: '大师', hint: '纵向读秒只给三次落子机会，先手的节拍不能被打乱。', goal: '沿纵轴完成 3 手连续推进。', moveLimit: 3, boss: true,
      solution: [[5,10],[6,10],[7,10]], aiPlan: [[2,2],[12,12]],
      stones: [[3,10,BLACK],[4,10,BLACK],[1,5,WHITE],[8,4,WHITE],[11,11,WHITE]]
    },
    {
      id: 'island-39', name: '斜桥算路', type: '强制手', tier: '大师', hint: '斜桥的每一步都在扩大杀势，少算一手就会错过唯一窗口。', goal: '算清 3 手斜线推进，最后落子封杀。', moveLimit: 3, boss: true,
      solution: [[5,5],[6,6],[7,7]], aiPlan: [[2,10],[10,2]],
      stones: [[3,3,BLACK],[4,4,BLACK],[1,12,WHITE],[8,3,WHITE],[11,10,WHITE]]
    },
    {
      id: 'island-40', name: '逆风落点', type: '强制手', tier: '大师', hint: '逆风棋形不能追近手，按唯一方向落下三颗黑子才能反转。', goal: '完成 3 手逆向斜杀。', moveLimit: 3, boss: true,
      solution: [[5,9],[6,8],[7,7]], aiPlan: [[2,2],[11,11]],
      stones: [[3,11,BLACK],[4,10,BLACK],[1,4,WHITE],[8,2,WHITE],[10,5,WHITE]]
    },
    {
      id: 'island-41', name: '双翼成势', type: '强制手', tier: '大师', hint: '横翼与纵翼同时抬头，先拓宽横线，再把棋眼压到中心。', goal: '完成横纵转换的 3 手进攻。', moveLimit: 3, boss: true,
      solution: [[7,6],[7,7],[7,8]], aiPlan: [[3,3],[8,8]],
      stones: [[7,4,BLACK],[7,5,BLACK],[5,7,BLACK],[6,7,BLACK],[2,11,WHITE],[10,2,WHITE]]
    },
    {
      id: 'island-42', name: '斜月双脉', type: '强制手', tier: '大师', hint: '两条斜脉共享一个节奏点，必须先稳住内线，再向终点延伸。', goal: '完成 3 手交叉斜线读秒。', moveLimit: 3, boss: true,
      solution: [[6,6],[7,7],[8,8]], aiPlan: [[2,9],[11,3]],
      stones: [[4,4,BLACK],[5,5,BLACK],[1,8,WHITE],[9,2,WHITE],[12,10,WHITE]]
    },
    {
      id: 'island-43', name: '守中反击', type: '强制手', tier: '职业预备', hint: '黑棋看似只有一条横线，真正的杀招藏在中央的连续压迫里。', goal: '不被假手诱导，完成 3 手横向反击。', moveLimit: 3, boss: true,
      solution: [[8,5],[8,6],[8,7]], aiPlan: [[5,5],[10,10]],
      stones: [[8,3,BLACK],[8,4,BLACK],[3,3,WHITE],[6,10,WHITE],[12,4,WHITE]]
    },
    {
      id: 'island-44', name: '风口转线', type: '强制手', tier: '职业预备', hint: '风口会把攻势从横线转入纵线，三次准确落子才能保住主动权。', goal: '完成横转纵的 3 手连续手段。', moveLimit: 3, boss: true,
      solution: [[6,11],[7,11],[8,11]], aiPlan: [[2,4],[12,4]],
      stones: [[4,11,BLACK],[5,11,BLACK],[7,8,BLACK],[1,1,WHITE],[9,4,WHITE],[11,10,WHITE]]
    },
    {
      id: 'island-45', name: '弦月斜杀', type: '强制手', tier: '职业预备', hint: '弦月的弧线只认一个方向，连续三手后才会显出真正的杀点。', goal: '完成 3 手反向斜杀。', moveLimit: 3, boss: true,
      solution: [[6,8],[7,7],[8,6]], aiPlan: [[2,2],[10,12]],
      stones: [[4,10,BLACK],[5,9,BLACK],[1,6,WHITE],[9,3,WHITE],[12,11,WHITE]]
    },
    {
      id: 'island-46', name: '三路压迫', type: '强制手', tier: '职业预备', hint: '三路都在发光，但只有中路能把优势转成连续杀势。', goal: '选择中路并完成 3 手强制推进。', moveLimit: 3, boss: true,
      solution: [[6,6],[7,7],[8,8]], aiPlan: [[3,11],[11,3]],
      stones: [[4,4,BLACK],[5,5,BLACK],[2,2,WHITE],[8,3,WHITE],[10,10,WHITE]]
    },
    {
      id: 'island-47', name: '棋眼终结', type: '强制手', tier: '职业预备', hint: '先占棋眼，再沿同一条斜线推进；每一手都必须保持威胁。', goal: '完成棋眼到终点的 3 手连续杀棋。', moveLimit: 3, boss: true,
      solution: [[7,7],[8,8],[9,9]], aiPlan: [[2,7],[12,7]],
      stones: [[5,5,BLACK],[6,6,BLACK],[3,10,WHITE],[10,3,WHITE],[11,11,WHITE]]
    },
    {
      id: 'island-48', name: '天穹王座', type: '职业首领', tier: '职业', hint: '职业区终局：先算清四手斜线，再在最后一格完成王座杀棋。', goal: '完成最后一条斜线的 4 手终结。', moveLimit: 4, boss: true,
      solution: [[5,5],[6,6],[7,7],[8,8]], aiPlan: [[2,10],[10,2],[1,12]],
      stones: [[4,4,BLACK],[1,1,WHITE],[9,3,WHITE],[11,11,WHITE]]
    }
  ]);

  const state = {
    open: false,
    levelIndex: 0,
    board: [],
    history: [],
    turn: BLACK,
    playerMoves: 0,
    status: 'playing',
    winningLine: [],
    lastMove: null,
    preview: null,
    pointerId: null,
    aiGeneration: 0,
    resultTimer: null,
    animationUntil: 0
  };

  let root = null;
  let canvas = null;
  let ctx = null;
  let frame = null;
  let resizeObserver = null;
  let viewportSize = 0;
  let dpr = 1;

  function blankBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  }

  function levelAt(index = state.levelIndex) {
    return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, Number(index) || 0))];
  }

  function tierLabel(level, index = state.levelIndex) {
    if (level?.tier) return level.tier;
    return ['启航', '入门', '进阶', '高阶', '高级'][Math.min(4, Math.floor(Math.max(0, Number(index) || 0) / 6))] || '高级';
  }

  function readProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      const completed = Array.isArray(value.completed)
        ? value.completed.filter(id => LEVELS.some(level => level.id === id))
        : [];
      const storedCurrent = Number(value.current) || 0;
      const current = Math.max(1, Math.min(LEVELS.length, storedCurrent > completed.length ? storedCurrent : completed.length + 1));
      return { schema: 1, completed: [...new Set(completed)], current };
    } catch (_) {
      return { schema: 1, completed: [], current: 1 };
    }
  }

  function writeProgress(progress) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('gomoku:expedition-progress', { detail: progress }));
  }

  function saveActive() {
    if (!state.open) return;
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        schema: 1,
        levelId: levelAt().id,
        board: state.board,
        history: state.history,
        turn: state.turn,
        playerMoves: state.playerMoves,
        status: state.status,
        updatedAt: Date.now()
      }));
    } catch (_) {}
  }

  function hydrateActive() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '{}');
      const levelIndex = LEVELS.findIndex(level => level.id === saved.levelId);
      const validBoard = Array.isArray(saved.board) && saved.board.length === SIZE && saved.board.every(row =>
        Array.isArray(row) && row.length === SIZE && row.every(value => value === EMPTY || value === BLACK || value === WHITE)
      );
      const fresh = Date.now() - Number(saved.updatedAt || 0) < 7 * 24 * 60 * 60 * 1000;
      if (saved.schema !== 1 || levelIndex < 0 || !validBoard || !fresh || saved.status !== 'playing') return false;
      state.levelIndex = levelIndex;
      state.board = saved.board.map(row => row.slice());
      state.history = Array.isArray(saved.history) ? saved.history.filter(move =>
        Number.isInteger(move?.r) && Number.isInteger(move?.c) && move.r >= 0 && move.r < SIZE && move.c >= 0 && move.c < SIZE && (move.p === BLACK || move.p === WHITE)
      ).map(move => ({ r: move.r, c: move.c, p: move.p })) : [];
      state.turn = saved.turn === WHITE ? WHITE : BLACK;
      state.playerMoves = Math.max(0, Math.min(levelAt().moveLimit, Number(saved.playerMoves) || 0));
      state.status = 'playing';
      state.lastMove = state.history.at(-1) || null;
      state.winningLine = [];
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureUi() {
    if (root) return;
    const style = document.createElement('style');
    style.id = 'skyExpeditionStyles';
    style.textContent = `
      #skyExpedition{position:fixed;inset:0;z-index:100050;display:none;grid-template-rows:auto minmax(0,1fr);overflow:hidden;background:linear-gradient(180deg,#bfe8ff 0%,#dff3ef 62%,#f3f7f4 100%);color:#213a4a;font-family:"Microsoft YaHei UI",system-ui,sans-serif}
      #skyExpedition.show{display:grid}
      .exp-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;width:min(1040px,calc(100% - 24px));margin:0 auto;padding:max(12px,env(safe-area-inset-top,0px)) 0 8px}
      .exp-head button{min-height:36px;padding:6px 11px;border:1px solid rgba(33,58,74,.15);border-radius:999px;background:rgba(255,255,255,.72);color:#213a4a;font-weight:900;cursor:pointer}
      .exp-title{min-width:0;text-align:center}.exp-title strong{display:block;font:900 19px/1.1 "STKaiti","KaiTi",serif;letter-spacing:.06em}.exp-title small{display:block;margin-top:3px;color:rgba(33,58,74,.58);font-size:10px;font-weight:800}
      .exp-layout{display:grid;grid-template-columns:minmax(150px,220px) minmax(300px,650px) minmax(190px,250px);align-items:center;justify-content:center;gap:18px;width:min(1100px,calc(100% - 28px));min-height:0;margin:0 auto;padding-bottom:max(14px,env(safe-area-inset-bottom,0px))}
      .exp-route{display:grid;gap:7px;max-height:min(72vh,640px);overflow-y:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:rgba(33,58,74,.32) transparent}.exp-node{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:8px;min-height:44px;padding:6px 8px;border:1px solid rgba(33,58,74,.13);border-radius:13px;background:rgba(255,255,255,.54);color:#213a4a;text-align:left;cursor:pointer}.exp-node span:first-child{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:rgba(111,159,112,.16);font-size:11px;font-weight:900}.exp-node strong{display:block;font-size:10px}.exp-node small{display:block;margin-top:2px;color:rgba(33,58,74,.55);font-size:8px;font-weight:800}.exp-node.active{border-color:#213a4a;background:#213a4a;color:#fff}.exp-node.active small{color:rgba(255,255,255,.64)}.exp-node.done span:first-child{color:#213a4a;background:#f2bf4d}
      .exp-board-wrap{position:relative;display:grid;place-items:center;width:min(66vh,650px,100%);aspect-ratio:1;justify-self:center}.exp-board-wrap::after{content:"";position:absolute;z-index:-1;inset:5% -3% -7%;border-radius:48% 52% 45% 55%;background:#527b57;box-shadow:0 25px 40px rgba(33,58,74,.24)}#skyExpeditionCanvas{display:block;width:100%;height:100%;border-radius:18px;touch-action:none;cursor:crosshair;filter:drop-shadow(0 12px 20px rgba(33,58,74,.18))}
      .exp-panel{align-self:center}.exp-kicker{color:#466d4b;font-size:9px;font-weight:900;letter-spacing:.15em}.exp-panel h2{margin:6px 0 5px;font:900 27px/1.05 "STKaiti","KaiTi",serif}.exp-goal{margin:0 0 14px;color:rgba(33,58,74,.64);font-size:11px;font-weight:800;line-height:1.55}.exp-status{padding:11px;border-left:3px solid #f2bf4d;background:rgba(255,255,255,.5);font-size:11px;font-weight:900;line-height:1.55}.exp-hint{display:none;margin-top:8px;padding:9px 10px;border:1px solid rgba(111,159,112,.25);border-radius:12px;background:rgba(255,255,255,.56);font-size:10px;font-weight:800;line-height:1.5}.exp-hint.show{display:block}.exp-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.exp-actions button{min-height:38px;border:1px solid rgba(33,58,74,.14);border-radius:12px;background:rgba(255,255,255,.7);color:#213a4a;font-size:10px;font-weight:900;cursor:pointer}
      .exp-result{position:absolute;left:50%;bottom:12px;z-index:3;width:min(430px,calc(100% - 18px));padding:15px;border:1px solid rgba(33,58,74,.14);border-radius:22px 22px 13px 13px;background:#f3f7f4;box-shadow:0 24px 60px rgba(19,40,51,.3);text-align:center;transform:translate(-50%,calc(100% + 28px));opacity:0;visibility:hidden;transition:.32s cubic-bezier(.2,.8,.2,1)}.exp-result.show{transform:translate(-50%,0);opacity:1;visibility:visible}.exp-result strong{display:block;font:900 24px/1.1 "STKaiti","KaiTi",serif}.exp-result p{margin:6px 0 12px;color:rgba(33,58,74,.64);font-size:10px;font-weight:800}.exp-result-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:7px}.exp-result-actions button{min-height:40px;border:1px solid rgba(33,58,74,.15);border-radius:12px;background:#fff;color:#213a4a;font-weight:900;cursor:pointer}.exp-result-actions .primary{color:#fff;background:#213a4a}
      @media(max-width:760px){.exp-head{padding-top:max(7px,env(safe-area-inset-top,0px));padding-bottom:4px}.exp-head button{min-height:32px;padding:5px 9px;font-size:10px}.exp-title strong{font-size:16px}.exp-layout{display:flex;flex-direction:column;justify-content:flex-start;width:calc(100% - 14px);max-width:calc(100% - 14px);min-width:0;gap:5px;padding-bottom:max(6px,env(safe-area-inset-bottom,0px))}.exp-route{display:flex;order:2;width:100%;max-width:100%;min-width:0;max-height:none;overflow-x:auto;overflow-y:hidden;gap:5px;padding:1px 0 3px}.exp-node{display:flex;flex:0 0 auto;min-width:42px;min-height:34px;padding:3px 5px}.exp-node span:first-child{width:26px;height:26px}.exp-node div{display:none}.exp-board-wrap{order:1;width:min(calc(100vw - 16px),calc(100dvh - 210px));max-width:none;flex:0 1 auto}.exp-panel{order:3;width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px}.exp-panel h2{margin:2px 0;font-size:18px}.exp-kicker{font-size:8px}.exp-goal{margin:0;font-size:9px;line-height:1.35}.exp-status{grid-column:1/-1;padding:6px 8px;font-size:9px}.exp-actions{grid-column:2;grid-row:1/3;margin:0}.exp-actions button{min-height:34px;padding:4px 7px}.exp-hint{grid-column:1/-1;margin:0}.exp-result{bottom:max(7px,env(safe-area-inset-bottom,0px))}}
      @media(max-height:700px) and (max-width:760px){.exp-board-wrap{width:min(calc(100vw - 18px),calc(100dvh - 185px))}.exp-status{display:none}.exp-panel{grid-template-columns:minmax(0,1fr) auto}.exp-actions{grid-row:1}.exp-goal{display:none}}
      @media(prefers-reduced-motion:reduce){.exp-result{transition:none}}
    `;
    document.head.appendChild(style);

    root = document.createElement('section');
    root.id = 'skyExpedition';
    root.setAttribute('aria-label', '天空棋岛残局远征');
    root.innerHTML = `
      <header class="exp-head">
        <button type="button" data-exp-action="close">← 返回棋岛</button>
        <div class="exp-title"><strong>天空棋岛 · 残局远征</strong><small>${Math.ceil(LEVELS.length / 6)} 章 · ${LEVELS.length} 关本地航线 · 不计天梯</small></div>
        <button type="button" data-exp-action="restart">重置本关</button>
      </header>
      <main class="exp-layout">
        <nav class="exp-route" id="expRoute" aria-label="远征关卡"></nav>
        <div class="exp-board-wrap">
          <canvas id="skyExpeditionCanvas" aria-label="15乘15残局棋盘"></canvas>
          <section class="exp-result" id="expResult" aria-live="polite">
            <strong id="expResultTitle">棋台已点亮</strong>
            <p id="expResultText">日线沿着五颗棋穿过云层。</p>
            <div class="exp-result-actions"><button type="button" data-exp-action="retry">再看一遍</button><button class="primary" type="button" data-exp-action="next">前往下一岛 →</button></div>
          </section>
        </div>
        <aside class="exp-panel">
          <div><div class="exp-kicker" id="expKicker">普通棋台 · 成五</div><h2 id="expLevelName">云隙初光</h2><p class="exp-goal" id="expGoal">在1手内完成五连。</p></div>
          <div class="exp-status" id="expStatus">你的回合 · 黑棋 · 还可落 1 手</div>
          <div class="exp-hint" id="expHint"></div>
          <div class="exp-actions"><button type="button" data-exp-action="hint">查看提示</button><button type="button" data-exp-action="restart">重新开始</button></div>
        </aside>
      </main>`;
    document.body.appendChild(root);
    canvas = root.querySelector('#skyExpeditionCanvas');
    ctx = canvas.getContext('2d');
    root.addEventListener('click', onAction);
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', cancelPointer, { passive: false });
    canvas.addEventListener('pointerleave', event => { if (state.pointerId === null && event.pointerType === 'mouse') setPreview(null); });
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root.querySelector('.exp-board-wrap'));
  }

  function renderRoute() {
    const progress = readProgress();
    const route = root.querySelector('#expRoute');
    route.innerHTML = LEVELS.map((level, index) => {
      const done = progress.completed.includes(level.id);
      const chapter = Math.floor(index / 6) + 1;
      return `<button type="button" class="exp-node${index === state.levelIndex ? ' active' : ''}${done ? ' done' : ''}" data-level-index="${index}" aria-label="${level.name}${done ? '，已完成' : ''}"><span>${done ? '✓' : index + 1}</span><div><strong>${level.name}</strong><small>第${chapter}章 · ${tierLabel(level, index)} · ${level.boss ? '首领 · ' : ''}${level.type}</small></div></button>`;
    }).join('');
    const activeNode = root.querySelector('.exp-node.active');
    if (activeNode) {
      const compactRoute = window.matchMedia('(max-width: 760px)').matches;
      if (compactRoute) {
        route.scrollLeft = Math.max(0, activeNode.offsetLeft - (route.clientWidth - activeNode.offsetWidth) / 2);
      } else {
        route.scrollTop = Math.max(0, activeNode.offsetTop - (route.clientHeight - activeNode.offsetHeight) / 2);
      }
    }
  }

  function updatePanel() {
    const level = levelAt();
    root.querySelector('#expKicker').textContent = `第 ${Math.floor(state.levelIndex / 6) + 1} 章 · ${tierLabel(level)} · ${level.boss ? '首领棋台' : '普通棋台'} · ${level.type} · ${state.levelIndex + 1}/${LEVELS.length}`;
    root.querySelector('#expLevelName').textContent = level.name;
    root.querySelector('#expGoal').textContent = level.goal || (level.defense ? '用唯一的一手挡住白棋成五。' : `在 ${level.moveLimit} 手内完成五连。`);
    const status = root.querySelector('#expStatus');
    if (state.status === 'won') status.textContent = `棋台已点亮 · 第 ${state.levelIndex + 1}/${LEVELS.length} 关`;
    else if (state.status === 'failed') status.textContent = `航线未通 · 第 ${state.levelIndex + 1} 关重新尝试`;
    else if (state.turn === WHITE) status.textContent = '守岛 AI 正在应对你的棋路…';
    else status.textContent = `你的回合 · 黑棋 · 还可落 ${Math.max(0, level.moveLimit - state.playerMoves)} 手`;
    renderRoute();
  }

  function startLevel(index, options = {}) {
    clearTimeout(state.resultTimer);
    state.aiGeneration++;
    state.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, Number(index) || 0));
    state.board = blankBoard();
    for (const [r,c,p] of levelAt().stones) state.board[r][c] = p;
    state.history = [];
    state.turn = BLACK;
    state.playerMoves = 0;
    state.status = 'playing';
    state.winningLine = [];
    state.lastMove = null;
    state.preview = null;
    state.pointerId = null;
    root.querySelector('#expHint').classList.remove('show');
    root.querySelector('#expResult').classList.remove('show');
    updatePanel();
    saveActive();
    resize();
    animateFor(REDUCED_MOTION ? 0 : 220);
    if (options.focus !== false) canvas.focus?.({ preventScroll: true });
  }

  function open() {
    ensureUi();
    state.open = true;
    root.classList.add('show');
    document.body.classList.remove('sky-cards-open');
    if (!hydrateActive()) {
      const progress = readProgress();
      startLevel(progress.current - 1, { focus: false });
    } else {
      root.querySelector('#expResult').classList.remove('show');
      updatePanel();
      resize();
      if (state.turn === WHITE) queueAiMove();
    }
    return true;
  }

  function close() {
    if (!root) return;
    state.open = false;
    state.aiGeneration++;
    clearTimeout(state.resultTimer);
    cancelAnimationFrame(frame);
    frame = null;
    root.classList.remove('show');
    saveActive();
    window.SkyIslandUI?.refreshProgress?.();
  }

  function resize() {
    if (!root?.classList.contains('show') || !canvas) return;
    const wrap = root.querySelector('.exp-board-wrap');
    const rect = wrap.getBoundingClientRect();
    viewportSize = Math.max(260, Math.floor(Math.min(rect.width, rect.height || rect.width)));
    dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(viewportSize * dpr);
    canvas.height = Math.round(viewportSize * dpr);
    canvas.style.width = `${viewportSize}px`;
    canvas.style.height = `${viewportSize}px`;
    draw();
  }

  function geometry() {
    const pad = viewportSize * .055;
    return { pad, cell: (viewportSize - pad * 2) / SIZE };
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * viewportSize / rect.width;
    const y = (event.clientY - rect.top) * viewportSize / rect.height;
    const { pad, cell } = geometry();
    const c = Math.floor((x - pad) / cell);
    const r = Math.floor((y - pad) / cell);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    return { r, c };
  }

  function setPreview(point) {
    const next = point && state.board[point.r]?.[point.c] === EMPTY ? point : null;
    if ((next?.r ?? -1) === (state.preview?.r ?? -1) && (next?.c ?? -1) === (state.preview?.c ?? -1)) return;
    state.preview = next;
    if (next) canvas.dataset.previewPoint = `${next.r},${next.c}`;
    else delete canvas.dataset.previewPoint;
    draw();
  }

  function onPointerDown(event) {
    event.preventDefault();
    if (state.status !== 'playing' || state.turn !== BLACK || state.pointerId !== null) return;
    state.pointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    setPreview(pointFromEvent(event));
  }

  function onPointerMove(event) {
    if (event.pointerType !== 'mouse' && event.pointerId !== state.pointerId) return;
    if (state.status !== 'playing' || state.turn !== BLACK) return;
    event.preventDefault();
    setPreview(pointFromEvent(event));
  }

  function onPointerUp(event) {
    if (event.pointerId !== state.pointerId) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const preview = state.preview;
    state.pointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
    setPreview(null);
    if (point && preview && point.r === preview.r && point.c === preview.c) placePlayer(point.r, point.c);
  }

  function cancelPointer(event) {
    if (state.pointerId !== null && (!event || event.pointerId === state.pointerId)) {
      state.pointerId = null;
      setPreview(null);
    }
  }

  function findWinningLine(board, r, c, color) {
    for (const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
      const line = [{ r, c }];
      for (let step = 1; step < 5; step++) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === color) line.push({ r:nr, c:nc }); else break;
      }
      for (let step = 1; step < 5; step++) {
        const nr = r - dr * step, nc = c - dc * step;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === color) line.unshift({ r:nr, c:nc }); else break;
      }
      if (line.length >= 5) return line;
    }
    return [];
  }

  function matchesPoint(target, r, c) {
    return Array.isArray(target) && Number(target[0]) === r && Number(target[1]) === c;
  }

  function expectedProfessionalMove(level) {
    if (!Array.isArray(level?.solution)) return null;
    return level.solution[state.playerMoves] || null;
  }

  function scriptedAiMove(level) {
    if (!Array.isArray(level?.aiPlan)) return null;
    const candidate = level.aiPlan[Math.max(0, state.playerMoves - 1)];
    if (!Array.isArray(candidate) || candidate.length < 2) return null;
    const r = Number(candidate[0]);
    const c = Number(candidate[1]);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= SIZE || c < 0 || c >= SIZE || state.board[r]?.[c] !== EMPTY) return null;
    return { r, c };
  }

  function placePlayer(r, c) {
    if (state.status !== 'playing' || state.turn !== BLACK || state.board[r][c] !== EMPTY) return;
    const level = levelAt();
    const target = expectedProfessionalMove(level);
    state.board[r][c] = BLACK;
    state.lastMove = { r, c, p: BLACK };
    state.history.push(state.lastMove);
    state.playerMoves++;
    state.animationUntil = performance.now() + 420;
    playStoneSound(false);
    try { navigator.vibrate?.(8); } catch (_) {}
    if (target && !matchesPoint(target, r, c)) {
      return finish(false, [], `职业判定：第 ${state.playerMoves} 手偏离主线，重新计算这一关。`);
    }
    const line = findWinningLine(state.board, r, c, BLACK);
    if (line.length) return finish(true, line, '你找到了贯穿云层的天脉。');
    const defense = level.defense;
    if (defense && defense[0] === r && defense[1] === c) return finish(true, [], '唯一出口已经封住，守云成功。');
    if (Array.isArray(level.solution) && state.playerMoves >= level.solution.length) {
      return finish(true, [], level.successMessage || '连续强制手完成，职业棋台已点亮。');
    }
    if (state.playerMoves >= level.moveLimit) return finish(false, [], '限定手数已经用完，再看一次棋形。');
    state.turn = WHITE;
    updatePanel();
    saveActive();
    animateFor(430);
    queueAiMove();
  }

  function queueAiMove() {
    const generation = ++state.aiGeneration;
    window.setTimeout(async () => {
      try {
        if (!state.open || generation !== state.aiGeneration || state.status !== 'playing' || state.turn !== WHITE) return;
        const level = levelAt();
        let move = scriptedAiMove(level);
        if (!move) {
          await window.ensureGomokuResource?.('aiFast');
          const snapshot = state.board.map(row => row.slice());
          move = window.GomokuFastAI?.getBestMove(snapshot, WHITE, 'medium', false, [], { size: SIZE, budgetMs: 120, maxDepth: 3 });
        }
        if (!move || !Number.isInteger(move.r) || !Number.isInteger(move.c) || state.board[move.r]?.[move.c] !== EMPTY) throw new Error('AI没有返回可用落点');
        state.board[move.r][move.c] = WHITE;
        state.lastMove = { r:move.r, c:move.c, p:WHITE };
        state.history.push(state.lastMove);
        playStoneSound(false);
        const line = findWinningLine(state.board, move.r, move.c, WHITE);
        if (line.length) return finish(false, line, '守岛者先完成了五连。');
        state.turn = BLACK;
        updatePanel();
        saveActive();
        animateFor(420);
      } catch (error) {
        console.warn('[expedition ai]', error?.message || error);
        if (generation === state.aiGeneration && state.open && state.status === 'playing') {
          state.turn = BLACK;
          updatePanel();
        }
      }
    }, REDUCED_MOTION ? 80 : 320);
  }

  function finish(won, line, message) {
    state.status = won ? 'won' : 'failed';
    state.winningLine = line;
    state.preview = null;
    state.aiGeneration++;
    updatePanel();
    saveActive();
    if (won) {
      const progress = readProgress();
      if (!progress.completed.includes(levelAt().id)) progress.completed.push(levelAt().id);
      progress.current = Math.min(LEVELS.length, Math.max(progress.current, state.levelIndex + 2));
      writeProgress(progress);
      playStoneSound(true);
    }
    animateFor(1000);
    const title = root.querySelector('#expResultTitle');
    const text = root.querySelector('#expResultText');
    const next = root.querySelector('[data-exp-action="next"]');
    title.textContent = won ? '棋台已点亮' : '这条航线还没通';
    text.textContent = message;
    next.textContent = state.levelIndex === LEVELS.length - 1 ? '返回第一岛' : '前往下一岛 →';
    clearTimeout(state.resultTimer);
    state.resultTimer = window.setTimeout(() => root.querySelector('#expResult').classList.add('show'), REDUCED_MOTION ? 80 : 760);
  }

  function playStoneSound(victory) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = playStoneSound.context || (playStoneSound.context = new AudioContextClass());
      const now = audio.currentTime;
      const tones = victory ? [523,659,784,1046] : [210];
      tones.forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = victory ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * .07);
        gain.gain.exponentialRampToValueAtTime(victory ? .055 : .035, now + index * .07 + .01);
        gain.gain.exponentialRampToValueAtTime(.0001, now + index * .07 + (victory ? .18 : .07));
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(now + index * .07);
        oscillator.stop(now + index * .07 + .2);
      });
    } catch (_) {}
  }

  function onAction(event) {
    const levelButton = event.target.closest('[data-level-index]');
    if (levelButton) return startLevel(Number(levelButton.dataset.levelIndex));
    const action = event.target.closest('[data-exp-action]')?.dataset.expAction;
    if (!action) return;
    if (action === 'close') close();
    else if (action === 'restart' || action === 'retry') startLevel(state.levelIndex);
    else if (action === 'next') startLevel((state.levelIndex + 1) % LEVELS.length);
    else if (action === 'hint') {
      const hint = root.querySelector('#expHint');
      hint.textContent = levelAt().hint;
      hint.classList.toggle('show');
    }
  }

  function drawStone(x, y, radius, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(20,23,25,.28)';
    ctx.shadowBlur = radius * .38;
    ctx.shadowOffsetY = radius * .18;
    const gradient = ctx.createRadialGradient(x-radius*.34,y-radius*.34,radius*.08,x,y,radius);
    if (color === BLACK) {
      gradient.addColorStop(0,'#66717a'); gradient.addColorStop(.32,'#2b3137'); gradient.addColorStop(1,'#0b0d0f');
    } else {
      gradient.addColorStop(0,'#fff'); gradient.addColorStop(.5,'#f7f2e7'); gradient.addColorStop(1,'#cfd5d2');
    }
    ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fillStyle=gradient; ctx.fill();
    ctx.lineWidth=Math.max(1,radius*.08); ctx.strokeStyle=color===BLACK?'rgba(255,255,255,.16)':'rgba(33,58,74,.18)'; ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (!ctx || !viewportSize) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,viewportSize,viewportSize);
    const { pad, cell } = geometry();
    const boardSize = cell * SIZE;
    ctx.fillStyle='#6f9f70';
    ctx.beginPath(); ctx.roundRect(pad-4,pad-4,boardSize+8,boardSize+8,14); ctx.fill();
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) {
      ctx.fillStyle=(r+c)%2===0?'#8aca72':'#79bd68';
      ctx.fillRect(pad+c*cell,pad+r*cell,cell+.5,cell+.5);
      ctx.strokeStyle='rgba(54,103,54,.18)'; ctx.lineWidth=.6;
      ctx.strokeRect(pad+c*cell,pad+r*cell,cell,cell);
    }
    const radius = cell * .39;
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (state.board[r]?.[c]) {
      drawStone(pad+(c+.5)*cell,pad+(r+.5)*cell,radius,state.board[r][c]);
    }
    if (state.lastMove && state.board[state.lastMove.r]?.[state.lastMove.c]) {
      const x=pad+(state.lastMove.c+.5)*cell,y=pad+(state.lastMove.r+.5)*cell;
      ctx.beginPath();ctx.arc(x,y,Math.max(2.2,radius*.22),0,Math.PI*2);ctx.fillStyle='#d96656';ctx.fill();
      ctx.lineWidth=1.2;ctx.strokeStyle='#fff';ctx.stroke();
    }
    if (state.preview && state.status==='playing' && state.turn===BLACK) {
      const x=pad+(state.preview.c+.5)*cell,y=pad+(state.preview.r+.5)*cell;
      const pulse=REDUCED_MOTION?1:(Math.sin(performance.now()/115)+1)/2;
      ctx.beginPath();ctx.arc(x,y,radius*(1.35+pulse*.12),0,Math.PI*2);ctx.strokeStyle=`rgba(242,191,77,${.45+pulse*.35})`;ctx.lineWidth=2;ctx.stroke();
      drawStone(x,y,radius,BLACK,.48);
    }
    if (state.winningLine.length>=5) {
      const pulse=REDUCED_MOTION?1:(Math.sin(performance.now()/145)+1)/2;
      ctx.save();ctx.beginPath();
      state.winningLine.forEach((point,index)=>{const x=pad+(point.c+.5)*cell,y=pad+(point.r+.5)*cell;if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y)});
      ctx.lineCap='round';ctx.lineWidth=3.5+pulse*2;ctx.strokeStyle='#f2bf4d';ctx.shadowColor='#f2bf4d';ctx.shadowBlur=12+pulse*8;ctx.stroke();ctx.restore();
    }
  }

  function animateFor(duration) {
    state.animationUntil = Math.max(state.animationUntil, performance.now() + duration);
    if (frame) return;
    const tick = () => {
      draw();
      if (state.open && performance.now() < state.animationUntil) frame = requestAnimationFrame(tick);
      else frame = null;
    };
    frame = requestAnimationFrame(tick);
  }

  function getSnapshot() {
    return JSON.parse(JSON.stringify({
      open: state.open,
      levelId: levelAt().id,
      levelIndex: state.levelIndex,
      board: state.board,
      history: state.history,
      turn: state.turn,
      playerMoves: state.playerMoves,
      status: state.status,
      preview: state.preview,
      winningLine: state.winningLine
    }));
  }

  window.GomokuExpedition = Object.freeze({
    open,
    close,
    restart: () => startLevel(state.levelIndex),
    goNext: () => startLevel((state.levelIndex + 1) % LEVELS.length),
    isOpen: () => state.open,
    getSnapshot,
    levels: LEVELS.map(level => ({ id:level.id, name:level.name, type:level.type, moveLimit:level.moveLimit, boss:Boolean(level.boss) }))
  });
  window.__GOMOKU_EXPEDITION_READY__ = true;
})();
