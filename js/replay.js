    const AI_REPLAY_PROFILES = [
      { name: '云岫', avatar: 'ai_cloud_fox' },
      { name: '青翎', avatar: 'ai_jade_crane' },
      { name: '松果', avatar: 'ai_red_panda' },
      { name: '碧游', avatar: 'ai_koi' },
      { name: '月兔', avatar: 'ai_moon_rabbit' },
      { name: '昭麟', avatar: 'ai_qilin' }
    ];

    function historyOpponentProfile(item, index) {
      if (!item || item.mode !== 'ai') return { name: item?.oppName || '对手', avatar: item?.oppAvatar || '👤' };
      const seedText = `${item.date || ''}|${item.time || ''}|${index}|${item.oppName || ''}`;
      let seed = 0;
      for (const char of seedText) seed = (seed * 31 + char.codePointAt(0)) >>> 0;
      const fallback = AI_REPLAY_PROFILES[seed % AI_REPLAY_PROFILES.length];
      const oldName = !item.oppName || item.oppName === '大师AI';
      const oldAvatar = !item.oppAvatar
        || /🤖|👾/.test(String(item.oppAvatar))
        || ['anime_boy', 'anime_girl', 'img/anime_avatar_boy.jpg', 'img/anime_avatar_girl.jpg', 'img/avatar_boy.png', 'img/avatar_girl.png'].includes(String(item.oppAvatar));
      return {
        name: oldName ? fallback.name : item.oppName,
        avatar: oldAvatar ? fallback.avatar : item.oppAvatar
      };
    }

    function findWinningLineOnBoard(boardData, color) {
      if (!Array.isArray(boardData) || (color !== BLACK && color !== WHITE)) return null;
      const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 15; col++) {
          if (Number(boardData[row]?.[col]) !== color) continue;
          for (const [dr, dc] of directions) {
            const line = [];
            for (let offset = 0; offset < 5; offset++) {
              const r = row + dr * offset;
              const c = col + dc * offset;
              if (r < 0 || r >= 15 || c < 0 || c >= 15 || Number(boardData[r]?.[c]) !== color) break;
              line.push({ r, c });
            }
            if (line.length === 5) return line;
          }
        }
      }
      return null;
    }

    function startMainBoardReplay(item, requestedStep = null) {
      try {
        const moves = Array.isArray(item?.movesData) ? item.movesData.map(move => ({ ...move })) : [];
        if (moves.length === 0) {
          showGameNotice("📜 本局未记录详细走法，暂时无法逐手复盘！");
          return false;
        }

        // 1. 关掉所有弹窗与技能浮层；待结算战绩仍保留，复盘不会提前提交。
        cancelPendingGameResultModal();
        if (typeof closeGameResultModal === 'function') closeGameResultModal();
        closeHistoryModal();
        closeProfileModal();
        if (typeof closeReplayModal === 'function') closeReplayModal();
        const skillBanner = document.getElementById('skillBanner');
        if (skillBanner) skillBanner.style.display = 'none';
        const skillPromptBar = document.getElementById('skillPromptBar');
        if (skillPromptBar) skillPromptBar.style.display = 'none';
        if (Array.isArray(activeVFX)) activeVFX = [];
        if (typeof window.__gomokuInvalidateAiTurn === 'function') window.__gomokuInvalidateAiTurn();

        // 旧战绩兼容：第一手异常记录为白子且无身份互换标记时校正色盘。
        if (moves[0] && moves[0].p === WHITE && !moves.some(move => move.action === 'identity_swap' || move.type === 'identity_swap')) {
          moves.forEach(move => {
            if (move.p === BLACK) move.p = WHITE;
            else if (move.p === WHITE) move.p = BLACK;
          });
        }

        // 大厅隐藏棋盘时，先切回游戏页再打开回放控制条。
        if (typeof window.SkyIslandUI?.showGame === 'function') {
          window.SkyIslandUI.showGame();
        } else {
          document.getElementById('skyLobby')?.setAttribute('hidden', '');
          document.body.classList.remove('sky-lobby-open');
          document.body.classList.add('sky-game-open');
        }

        // 2. 备份完整终局状态；退出时能恢复棋盘、胜利光效与结算状态。
        if (!isReplayMode) {
          replaySavedState = {
            board: board.map(row => [...row]),
            history: history.map(move => ({ ...move })),
            turn, isOver, gameMode, gameWinnerColor, gameResultIsDraw,
            winningLine: Array.isArray(winningLine) ? winningLine.map(point => ({ ...point })) : null,
            p1Name, p2Name, p1Avatar, p2Avatar
          };
        }

        // 好友资料中的云端棋谱属于“好友本人”保存的记录；按其 myColor
        // 映射黑白双方身份，避免复盘时仍显示当前用户上一局的人机头像和名字。
        const profilePlayerName = String(item?.playerName || '').trim().slice(0, 32);
        if (profilePlayerName) {
          const playerAvatar = item?.playerAvatar || '👤';
          const opponentName = String(item?.oppName || '对手').trim().slice(0, 32);
          const opponentAvatar = item?.oppAvatar || '👤';
          if (Number(item.myColor) === WHITE) {
            p1Name = opponentName;
            p1Avatar = opponentAvatar;
            p2Name = profilePlayerName;
            p2Avatar = playerAvatar;
          } else {
            p1Name = profilePlayerName;
            p1Avatar = playerAvatar;
            p2Name = opponentName;
            p2Avatar = opponentAvatar;
          }
          if (typeof updatePlayerHeaderUI === 'function') updatePlayerHeaderUI();
        }

        replayAllMoves = moves;
        const replayWinnerColor = Number(item.winnerColor) || 0;
        const replayWinningLine = Array.isArray(item.winningLine)
          ? item.winningLine.map(point => ({ ...point }))
          : findWinningLineOnBoard(item.boardData, replayWinnerColor);
        window.__GOMOKU_REPLAY_CONTEXT__ = {
          winnerColor: replayWinnerColor,
          isDraw: item.isDraw === true,
          winningLine: replayWinningLine,
          opponentName: item.oppName || '对手',
          opponentAvatar: item.oppAvatar || '👤'
        };
        isReplayMode = true;
        isOver = false;
        gameWinnerColor = 0;
        gameResultIsDraw = false;
        winningLine = null;
        const initialStep = requestedStep === null || requestedStep === undefined || !Number.isFinite(Number(requestedStep))
          ? moves.length
          : Number(requestedStep);
        replayStepIndex = Math.max(0, Math.min(moves.length, initialStep));

        // 更新顶部状态栏与回放 Dock。
        const topBar = document.getElementById("replayTopBar");
        const dock = document.getElementById("replayControlDock");
        const oppLabel = document.getElementById("replayOppLabel");
        const badgeLabel = document.getElementById("replayBadgeLabel");
        const slider = document.getElementById("replayMainSlider");
        if (oppLabel) oppLabel.textContent = `VS ${item.oppName || "对手"}`;
        if (badgeLabel) {
          badgeLabel.textContent = item.isDraw ? "🤝 和棋" : (item.isWin ? "🏆 胜利" : "💔 惜败");
          badgeLabel.style.background = item.isDraw ? "#3b82f6" : (item.isWin ? "#10b981" : "#ef4444");
        }
        if (slider) {
          slider.min = 0;
          slider.max = moves.length;
          slider.value = replayStepIndex;
        }
        if (topBar) topBar.style.display = "flex";
        if (dock) dock.style.display = "flex";

        const bottomCtrls = document.querySelector(".bottom-controls");
        const cardArea = document.querySelector(".card-area-wrapper");
        if (bottomCtrls) bottomCtrls.style.display = "none";
        if (cardArea) cardArea.style.display = "none";

        setTimeout(() => {
          const boardWrap = document.getElementById("islandWrapper") || document.getElementById("cvs");
          if (boardWrap) boardWrap.scrollIntoView({ behavior: "smooth", block: "center" });
          else window.scrollTo({ top: 0, behavior: "smooth" });
        }, 50);

        applyMainReplayStep(replayStepIndex);
        if (item.notice !== false) showGameNotice(`🔍 已载入【VS ${item.oppName || "对手"}】棋局，支持逐手回放！`, false);
        return true;
      } catch (error) {
        console.error("Main board replay error:", error);
        showGameNotice("棋局复盘启动失败，请稍后重试", true);
        return false;
      }
    }

    // 点击【查看棋局】从历史战绩载入主棋盘复盘。
    function openReplayModalByIndex(idx) {
      try {
        const key = getHistoryStorageKey();
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        const storedItem = list[idx];
        if (!storedItem) return false;
        const opponent = historyOpponentProfile(storedItem, idx);
        return startMainBoardReplay({ ...storedItem, oppName: opponent.name, oppAvatar: opponent.avatar });
      } catch (error) {
        console.error("Main board replay error:", error);
        return false;
      }
    }

    // 好友资料页的受权云端详情复用同一套主棋盘复盘与退出状态恢复。
    function openFriendMatchReplay(item) {
      if (!item || !Array.isArray(item.movesData) || item.movesData.length === 0) {
        showGameNotice('📜 这局没有可用的完整棋谱，暂时无法复盘！', true);
        return false;
      }
      return startMainBoardReplay({
        movesData: item.movesData,
        boardData: item.boardData,
        winnerColor: item.winnerColor,
        myColor: item.myColor,
        isWin: item.isWin === true,
        isDraw: item.isDraw === true,
        oppName: item.oppName || '对手',
        oppAvatar: item.oppAvatar || '👤',
        playerName: item.playerName || '',
        playerAvatar: item.playerAvatar || '👤'
      });
    }

    // 结算页“返回棋盘复盘”与星轨节点共用当前对局，不写入待确认战绩。
    function openCurrentGameReplay(step = null) {
      const snapshot = typeof window.getReplayInsightSnapshot === 'function' ? window.getReplayInsightSnapshot() : null;
      if (!snapshot || !snapshot.moves.length) {
        showGameNotice("📜 本局没有可回看的棋谱！");
        return false;
      }
      const resultTitle = document.getElementById('resultModalTitle')?.textContent || '';
      return startMainBoardReplay({
        movesData: snapshot.moves,
        winnerColor: snapshot.winnerColor,
        winningLine: snapshot.winningLine,
        isDraw: snapshot.isDraw,
        isWin: !snapshot.isDraw && resultTitle.includes('获胜'),
        oppName: snapshot.opponentName,
        oppAvatar: snapshot.opponentAvatar,
        notice: false
      }, step);
    }

    function applyMainReplayStep(step) {
      replayStepIndex = Math.max(0, Math.min(step, replayAllMoves.length));

      // 清空主棋盘
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          board[r][c] = EMPTY;
        }
      }
      history = [];

      // 逐步应用落子与技能事件
      for (let i = 0; i < replayStepIndex; i++) {
        const m = replayAllMoves[i];
        if (!m) continue;
        if (m.action === 'identity_swap' || m.type === 'identity_swap' || m.type === 'skill_identity_swap') {
          // 🔄 在该步数发生身份互换：全盘已有棋子黑白颠倒！
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
              if (board[r][c] === BLACK) board[r][c] = WHITE;
              else if (board[r][c] === WHITE) board[r][c] = BLACK;
            }
          }
          for (const h of history) {
            if (h && h.r >= 0) h.p = (h.p === BLACK ? WHITE : BLACK);
          }
          history.push({ action: 'identity_swap', r: -1, c: -1, p: m.p || 0 });
        } else if (m.action === 'mega_bomb' || m.type === 'mega_bomb' || m.type === 'skill_mega_bomb') {
          // 💣 乾坤大乱/大爆炸：将全盘清空并重现炸弹洗牌后的棋子坐标！
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
              board[r][c] = EMPTY;
            }
          }
          if (Array.isArray(m.stones)) {
            for (const s of m.stones) {
              if (s && s.r >= 0 && s.r < 15 && s.c >= 0 && s.c < 15) {
                board[s.r][s.c] = s.p;
              }
            }
          }
          history.push({ action: 'mega_bomb', stones: m.stones, r: -1, c: -1, p: m.p || 0 });
        } else if (m.action === 'remove_stone' || m.type === 'remove_stone' || m.type === 'skill_remove_stone') {
          // 💥 虚空陨石/精准爆破：抹除指定棋子
          if (m.r >= 0 && m.r < 15 && m.c >= 0 && m.c < 15) {
            board[m.r][m.c] = EMPTY;
          }
          history.push({ action: 'remove_stone', r: m.r, c: m.c, p: m.p });
        } else if (m.action === 'destiny_wipe_danger' || m.type === 'destiny_wipe_danger') {
          // 👑 天命掀桌：抹除指定危急连线棋子
          if (Array.isArray(m.stones)) {
            for (const s of m.stones) {
              if (s && s.r >= 0 && s.r < 15 && s.c >= 0 && s.c < 15) {
                board[s.r][s.c] = EMPTY;
              }
            }
          }
          history.push({ action: 'destiny_wipe_danger', stones: m.stones, r: -1, c: -1, p: m.p });
        } else if (m.action === 'shift_stone' || m.type === 'shift_stone' || m.type === 'skill_shift_stone') {
          // 🌟 移星换斗/偷梁换柱：将棋子从 (fromR, fromC) 平移至 (toR, toC)
          if (m.fromR >= 0 && m.fromR < 15 && m.fromC >= 0 && m.fromC < 15) {
            board[m.fromR][m.fromC] = EMPTY;
          }
          if (m.toR >= 0 && m.toR < 15 && m.toC >= 0 && m.toC < 15) {
            board[m.toR][m.toC] = m.p;
          }
          history.push({ action: 'shift_stone', fromR: m.fromR, fromC: m.fromC, toR: m.toR, toC: m.toC, r: m.toR, c: m.toC, p: m.p });
        } else if (m.action === 'swap_color' || m.type === 'swap_color' || m.type === 'skill_swap_color') {
          // 🎭 偷天换日/绝地倒戈：策反棋子变色
          if (m.r >= 0 && m.r < 15 && m.c >= 0 && m.c < 15) {
            board[m.r][m.c] = m.p;
          }
          history.push({ action: 'swap_color', r: m.r, c: m.c, p: m.p });
        } else if (m.action === 'swap_positions' || m.type === 'swap_positions' || m.type === 'skill_swap_positions') {
          // 💫 移形换影：双方棋子互换位置
          if (m.r1 >= 0 && m.r1 < 15 && m.c1 >= 0 && m.c1 < 15 && m.r2 >= 0 && m.r2 < 15 && m.c2 >= 0 && m.c2 < 15) {
            const p1 = m.p1 !== undefined ? m.p1 : board[m.r1][m.c1];
            const p2 = m.p2 !== undefined ? m.p2 : board[m.r2][m.c2];
            board[m.r1][m.c1] = p1;
            board[m.r2][m.c2] = p2;
          }
          history.push({ action: 'swap_positions', r1: m.r1, c1: m.c1, p1: m.p1, r2: m.r2, c2: m.c2, p2: m.p2, r: m.r2, c: m.c2 });
        } else if (m.r >= 0 && m.r < 15 && m.c >= 0 && m.c < 15) {
          board[m.r][m.c] = m.p;
          history.push({ r: m.r, c: m.c, p: m.p, moveNum: history.filter(h => h && h.r >= 0 && !h.action).length + 1 });
        }
      }

      // 更新 Dock 提示文本
      const stepLabel = document.getElementById("replayStepLabel");
      const turnLabel = document.getElementById("replayTurnLabel");
      const slider = document.getElementById("replayMainSlider");

      if (stepLabel) {
        stepLabel.textContent = `当前: 第 ${replayStepIndex} / 共 ${replayAllMoves.length} 步`;
      }
      if (turnLabel) {
        if (replayStepIndex === 0) {
          turnLabel.textContent = "准备开局 (黑方先手)";
          turnLabel.style.color = "#1e293b";
        } else {
          const lastM = replayAllMoves[replayStepIndex - 1];
          if (!lastM) {
            turnLabel.textContent = "";
          } else if (lastM.action === 'identity_swap' || lastM.type === 'identity_swap' || lastM.type === 'skill_identity_swap') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 🔄【身份互换】全盘黑白颠倒！`;
            turnLabel.style.color = "#d97706";
          } else if (lastM.action === 'mega_bomb' || lastM.type === 'mega_bomb' || lastM.type === 'skill_mega_bomb') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 💣【乾坤大乱】引爆炸弹洗牌打乱全盘！`;
            turnLabel.style.color = "#dc2626";
          } else if (lastM.action === 'remove_stone' || lastM.type === 'remove_stone' || lastM.type === 'skill_remove_stone') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 💥【${lastM.desc || '虚空陨石'}】抹除 (${lastM.r+1}, ${lastM.c+1}) 棋子！`;
            turnLabel.style.color = "#dc2626";
          } else if (lastM.action === 'destiny_wipe_danger' || lastM.type === 'destiny_wipe_danger') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 👑【天命掀桌】抹除 ${Array.isArray(lastM.stones) ? lastM.stones.length : ''} 颗危险连线棋子！`;
            turnLabel.style.color = "#d97706";
          } else if (lastM.action === 'shift_stone' || lastM.type === 'shift_stone' || lastM.type === 'skill_shift_stone') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 🌟【${lastM.desc || '移星换斗'}】平移至 (${lastM.toR+1}, ${lastM.toC+1})！`;
            turnLabel.style.color = "#2563eb";
          } else if (lastM.action === 'swap_color' || lastM.type === 'swap_color' || lastM.type === 'skill_swap_color') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 🎭【${lastM.desc || '偷天换日'}】策反 (${lastM.r+1}, ${lastM.c+1}) 棋子！`;
            turnLabel.style.color = "#7c3aed";
          } else if (lastM.action === 'swap_positions' || lastM.type === 'swap_positions' || lastM.type === 'skill_swap_positions') {
            turnLabel.textContent = `第 ${replayStepIndex} 步: 💫【移形换影】双方对调 (${lastM.r1+1}, ${lastM.c1+1}) 与 (${lastM.r2+1}, ${lastM.c2+1})！`;
            turnLabel.style.color = "#db2777";
          } else {
            const colorName = lastM ? (lastM.p === 1 ? "黑方落子" : "白方落子") : "";
            turnLabel.textContent = `第 ${replayStepIndex} 手: ${colorName} (${lastM.r+1}, ${lastM.c+1})`;
            turnLabel.style.color = lastM && lastM.p === 1 ? "#1e293b" : "#0284c7";
          }
        }
      }
      if (slider) slider.value = replayStepIndex;

      draw();
    }

    function onMainReplaySlider(val) {
      applyMainReplayStep(parseInt(val, 10));
    }

    function mainReplayStep(delta) {
      applyMainReplayStep(replayStepIndex + delta);
    }

    function mainReplayJump(step) {
      applyMainReplayStep(step);
    }

    function mainReplayJumpToEnd() {
      applyMainReplayStep(replayAllMoves.length);
    }

    function toggleMainReplayAuto() {
      const btnAuto = document.getElementById("btnMainReplayAuto");
      if (replayAutoTimer) {
        clearInterval(replayAutoTimer);
        replayAutoTimer = null;
        if (btnAuto) btnAuto.textContent = "▶️ 播放";
      } else {
        if (replayStepIndex >= replayAllMoves.length) {
          applyMainReplayStep(0);
        }
        if (btnAuto) btnAuto.textContent = "⏸️ 暂停";
        replayAutoTimer = setInterval(() => {
          if (replayStepIndex < replayAllMoves.length) {
            mainReplayStep(1);
          } else {
            clearInterval(replayAutoTimer);
            replayAutoTimer = null;
            if (btnAuto) btnAuto.textContent = "▶️ 播放";
          }
        }, 650);
      }
    }

    // 退出复盘模式，丝滑切回正常游戏
    function exitReplayMode(options = {}) {
      const silent = options === true || Boolean(options && options.silent);
      if (replayAutoTimer) {
        clearInterval(replayAutoTimer);
        replayAutoTimer = null;
      }
      const btnAuto = document.getElementById("btnMainReplayAuto");
      if (btnAuto) btnAuto.textContent = "▶️ 播放";

      isReplayMode = false;
      const topBar = document.getElementById("replayTopBar");
      const dock = document.getElementById("replayControlDock");
      if (topBar) topBar.style.display = "none";
      if (dock) dock.style.display = "none";

      const bottomCtrls = document.querySelector(".bottom-controls");
      if (bottomCtrls) bottomCtrls.style.display = "";
      const cardArea = document.querySelector(".card-area-wrapper");
      if (cardArea) cardArea.style.display = "";

      // 恢复之前的对局状态
      if (replaySavedState) {
        board = replaySavedState.board.map(r => [...r]);
        history = replaySavedState.history.map(h => ({ ...h }));
        turn = replaySavedState.turn;
        isOver = replaySavedState.isOver;
        gameMode = replaySavedState.gameMode;
        gameWinnerColor = replaySavedState.gameWinnerColor || 0;
        gameResultIsDraw = replaySavedState.gameResultIsDraw === true;
        winningLine = Array.isArray(replaySavedState.winningLine) ? replaySavedState.winningLine.map(point => ({ ...point })) : null;
        p1Name = replaySavedState.p1Name;
        p2Name = replaySavedState.p2Name;
        p1Avatar = replaySavedState.p1Avatar;
        p2Avatar = replaySavedState.p2Avatar;
        replaySavedState = null;
      }
      replayAllMoves = [];
      replayStepIndex = 0;
      window.__GOMOKU_REPLAY_CONTEXT__ = null;

      draw();
      updateUI();
      if (!isOver && gameMode === 'ai' && turn === WHITE) setTimeout(() => smartAiMove(), 80);
      if (!silent) showGameNotice("已退出复盘模式");
    }

    function closeReplayModal() {
      const m = document.getElementById("gameReplayModal");
      if (m) {
        m.classList.remove("show");
        m.style.display = "none";
      }
    }

    window.openCurrentGameReplay = openCurrentGameReplay;
    window.openFriendMatchReplay = openFriendMatchReplay;

    function replaceLocalHistoryFromCloud(uid, remoteRecords) {
      if (!hasRegisteredAccountSession() || String(currentUserUid || '') !== String(uid || '')) return false;
      const key = getHistoryStorageKey();
      if (typeof window.mergePendingGomokuHistoryRecords === 'function') {
        window.mergePendingGomokuHistoryRecords(uid, remoteRecords);
      } else {
        let localRecords = [];
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(parsed)) localRecords = parsed;
        } catch (_) {}
        const pending = localRecords.filter(item => item && item.cloudSyncStatus === 'pending' && item.clientRecordId);
        const pendingIds = new Set(pending.map(item => String(item.clientRecordId)));
        localStorage.setItem(key, JSON.stringify([...pending, ...remoteRecords.filter(item => !pendingIds.has(String(item?.clientRecordId || '')))]));
      }
      renderHistoryUI();
      updateHistoryCountUI();
      return true;
    }

    // 云端战绩以 ECS 主库为准 (登录即拉取、换手机找回，仅限正式账号)
    async function syncCloudHistory() {
      if (!hasRegisteredAccountSession()) return;
      const requestedUid = String(currentUserUid);
      try {
        const res = await safeApiFetch(`/api/history/list?uid=${encodeURIComponent(requestedUid)}`, { primaryOnly: true });
        const json = await res.json();
        if (json.code === 0 && Array.isArray(json.data)) {
          replaceLocalHistoryFromCloud(requestedUid, json.data);
        }
      } catch(e) {}
    }

    function openHistoryModal() {
      if (typeof commitPendingMatchRecord === 'function') commitPendingMatchRecord();
      const modal = document.getElementById("historyModal");
      if (!modal) return;
      modal.classList.add("show");
      renderHistoryUI();

      // 每次打开历史弹窗时从 ECS 主库拉取最新战报（仅限正式账号）
      if (hasRegisteredAccountSession()) {
        const requestedUid = String(currentUserUid);
        safeApiFetch(`/api/history/list?uid=${encodeURIComponent(requestedUid)}`, { primaryOnly: true })
          .then(res => res.json())
          .then(json => {
            if (json.code === 0 && Array.isArray(json.data)) replaceLocalHistoryFromCloud(requestedUid, json.data);
          }).catch(() => {});
      }
    }

    function closeHistoryModal() {
      const modal = document.getElementById("historyModal");
      if (modal) modal.classList.remove("show");
    }

    function clearGameHistory() {
      showCustomConfirm("确定要清空历史对局记录吗？\n（本地与云端数据库将彻底双向同步清空）", async () => {
        const pauseUploads = window.pauseGomokuHistoryUploads;
        const resumeUploads = window.resumeGomokuHistoryUploads;
        if (typeof pauseUploads === 'function') await pauseUploads();
        try {
          const key = getHistoryStorageKey();
          localStorage.removeItem(key);
          renderHistoryUI();
          updateHistoryCountUI();

          // 等待在途上传结束后再清云端，防止旧 pending 重试把已清除记录写回来。
          if (hasRegisteredAccountSession()) {
            const response = await safeApiFetch("/api/history/clear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: currentUserUid }),
              primaryOnly: true
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result || result.code !== 0) {
              throw new Error(result?.msg || `HTTP ${response.status}`);
            }
          }
          showGameNotice("🗑️ 历史对局记录已在本地与云端彻底同步清空！");
        } catch (error) {
          showGameNotice(`本地记录已清除，但云端同步失败：${error.message || '请检查网络后重试'}`, true);
        } finally {
          if (typeof resumeUploads === 'function') resumeUploads();
        }
      }, null, { title: '清空战绩 (双向同步)', icon: '🗑️', okText: '确认彻底清空', cancelText: '取消' });
    }

    function renderHistoryUI() {
      const listEl = document.getElementById("historyList");
      const sumEl = document.getElementById("historySummaryText");
      if (!listEl) return;

      let list = [];
      try {
        const key = getHistoryStorageKey();
        list = JSON.parse(localStorage.getItem(key) || "[]");
      } catch(e) {}

      if (list.length === 0) {
        listEl.innerHTML = `
          <div style="text-align:center; padding:36px 0; color:#64748b; font-size:12px; font-weight:800;">
            <div style="font-size:32px; margin-bottom:8px;">📜</div>
            暂无历史战绩，快去开启一局热血博弈吧！
          </div>
        `;
        if (sumEl) sumEl.textContent = "暂无历史对局";
        return;
      }

      const wins = list.filter(x => x.isWin && !x.isDraw).length;
      const draws = list.filter(x => x.isDraw).length;
      const winRate = Math.round((wins / list.length) * 100);
      if (sumEl) sumEl.textContent = `共记录 ${list.length} 局 · 胜 ${wins} 局 · 和 ${draws} 局 (胜率: ${winRate}%)`;

      listEl.innerHTML = list.map((item, idx) => {
        const isDraw = item.isDraw === true;
        const isWin = item.isWin && !isDraw;
        const tagBadge = isDraw
          ? `<span style="background:#3b82f6; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:900;">🤝 和棋</span>`
          : isWin
          ? `<span style="background:#10b981; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:900;">🏆 胜利</span>`
          : `<span style="background:#ef4444; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:900;">💔 惜败</span>`;
        const opponent = historyOpponentProfile(item, idx);
        const modeName = item.mode === "online" ? "🌐 全服联机" : (item.mode === "ai" ? "♟ AI 对局" : "👥 同屏对战");
        return `
          <div style="background:rgba(255,255,255,0.85); border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${renderAvatarElement(opponent.avatar, 32)}
              </div>
              <div style="text-align:left; line-height:1.3;">
                <div style="font-size:12.5px; font-weight:900; color:#1e293b; display:flex; align-items:center; gap:5px;">
                  <span>VS ${escapeRankHTML(opponent.name)}</span>
                  ${tagBadge}
                </div>
                <div style="font-size:10px; color:#64748b; font-weight:700;">
                  ${modeName} · 共 ${Number.isFinite(Number(item.moves)) ? Math.max(0, Math.min(512, Number(item.moves))) : 0} 手
                </div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="text-align:right; font-size:10px; color:#94a3b8; font-weight:700; line-height:1.2;">
                <div>${escapeRankHTML(String(item.date || '').slice(0, 20))}</div>
                <div>${escapeRankHTML(String(item.time || '').slice(0, 20))}</div>
              </div>
              <button type="button" onclick="openReplayModalByIndex(${idx})" style="background:linear-gradient(135deg, #38bdf8, #0284c7); color:#fff; border:none; border-radius:7px; padding:5px 9px; font-size:11px; font-weight:900; cursor:pointer; box-shadow:0 2px 4px rgba(2,132,199,0.25); white-space:nowrap;">
                🔍 查看棋局
              </button>
            </div>
          </div>
        `;
      }).join("");
    }

    // 🤝 满盘和棋统一结算：无胜者、不加减分，但保留完整历史战报
    window.__GOMOKU_REPLAY_READY__ = true;
