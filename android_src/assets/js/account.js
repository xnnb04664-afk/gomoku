    let cachedLeaderboard = [];
    let leaderboardLoadedAt = 0;
    let leaderboardRequest = null;
    const LEADERBOARD_CACHE_TTL_MS = 30000;

    function openLeaderboardModal() {
      if (typeof commitPendingMatchRecord === 'function') commitPendingMatchRecord();
      const modal = document.getElementById('leaderboardModal');
      if (modal) {
        modal.classList.add('show');
        const statusText = document.getElementById('myRankStatusText');
        if (statusText) {
          if (!hasRegisteredAccountSession()) {
            statusText.innerHTML = `游客未登录 · <a href="javascript:void(0)" onclick="closeLeaderboardModal(); openAuthModal('login')" style="color:#0284c7; font-weight:900; text-decoration:underline;">登录账号入榜</a>`;
            statusText.title = "游客身份未登录，点击登录或注册正式账号上榜";
          } else {
            statusText.innerHTML = `当前玩家: <b style="color:#0984e3;">${escapeRankHTML(p1Name)}</b> (正在同步全服排名...)`;
            statusText.title = `当前玩家: ${p1Name}`;
          }
        }
        fetchGlobalLeaderboard(false);
      }
    }

    function closeLeaderboardModal() {
      const modal = document.getElementById('leaderboardModal');
      if (modal) modal.classList.remove('show');
    }

    function leaderboardNeedsBundledAvatars(list) {
      return Array.isArray(list) && list.some(item => {
        const avatar = item && item.avatar;
        return avatar === 'anime_boy' || avatar === 'anime_girl'
          || avatar === 'img/avatar_boy.png' || avatar === 'img/avatar_girl.png'
          || avatar === 'img/anime_avatar_boy.jpg' || avatar === 'img/anime_avatar_girl.jpg';
      });
    }

    async function renderLeaderboardWithAvatars(list) {
      if (leaderboardNeedsBundledAvatars(list) && typeof window.ensureGomokuResource === 'function') {
        try {
          await window.ensureGomokuResource('avatars');
        } catch (error) {
          console.warn('排行榜头像资源加载失败，将使用安全占位:', error);
        }
      }
      renderLeaderboardUI(list);
      return list;
    }

    // ══════════════════════════════════════════════════════════════════
    // 💬 用户意见反馈与问题提交中枢
    // ══════════════════════════════════════════════════════════════════
    let currentFeedbackType = 'bug';
    let isSubmittingFeedback = false;

    function openFeedbackModal() {
      const modal = document.getElementById('feedbackModal');
      if (!modal) return;
      const verEl = document.getElementById('feedbackAppVer');
      if (verEl && typeof CURRENT_VERSION_TAG !== 'undefined') {
        verEl.textContent = DISPLAY_VERSION_TAG;
      }
      modal.classList.add('show');
    }

    function closeFeedbackModal() {
      const modal = document.getElementById('feedbackModal');
      if (modal) modal.classList.remove('show');
    }

    function selectFeedbackType(btn, type) {
      currentFeedbackType = type;
      const chips = document.querySelectorAll('#feedbackTypeChips .feedback-type-chip');
      chips.forEach(c => c.classList.remove('active'));
      if (btn) btn.classList.add('active');
    }

    function onFeedbackInput(textarea) {
      const counter = document.getElementById('feedbackCharCount');
      if (counter && textarea) {
        counter.textContent = `${textarea.value.length} / 300`;
      }
    }

    async function submitFeedback() {
      if (isSubmittingFeedback) return;
      const contentEl = document.getElementById('feedbackContent');
      const contactEl = document.getElementById('feedbackContact');
      const submitBtn = document.getElementById('btnSubmitFeedback');

      const content = (contentEl ? contentEl.value : '').trim();
      const contact = (contactEl ? contactEl.value : '').trim();

      if (!content || content.length < 3) {
        showGameNotice('💡 请至少输入 3 个字的反馈内容哦~', false);
        if (contentEl) contentEl.focus();
        return;
      }

      isSubmittingFeedback = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ 正在提交...';
      }

      const payload = {
        type: currentFeedbackType,
        content: content,
        contact: contact,
        uid: currentUserUid || '',
        nickname: (typeof p1Name !== 'undefined' && p1Name) ? p1Name : (currentUsername || '游客'),
        version: CURRENT_VERSION_TAG,
        timestamp: Date.now()
      };

      try {
        let submitSuccess = false;
        try {
          const res = await safeApiFetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (data && data.code === 0) {
            submitSuccess = true;
          }
        } catch (netErr) {
          console.warn('Feedback online submit fallback to local save:', netErr);
        }

        // 离线兜底留存（无论网络与否，绝不丢失用户反馈）
        try {
          const offlineList = JSON.parse(localStorage.getItem('gomoku_feedback_offline_list') || '[]');
          offlineList.unshift({ ...payload, submittedOnline: submitSuccess });
          if (offlineList.length > 20) offlineList.length = 20;
          localStorage.setItem('gomoku_feedback_offline_list', JSON.stringify(offlineList));
        } catch (storageErr) {}

        if (contentEl) contentEl.value = '';
        if (contactEl) contactEl.value = '';
        const counter = document.getElementById('feedbackCharCount');
        if (counter) counter.textContent = '0 / 300';

        closeFeedbackModal();
        showGameNotice('🎉 感谢您的宝贵反馈！我们会尽快评估与优化', false);
      } catch (err) {
        showGameNotice('🎉 反馈已收到，感谢您的支持与厚爱！', false);
        closeFeedbackModal();
      } finally {
        isSubmittingFeedback = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🚀 提交反馈';
        }
      }
    }

    const fetchLeaderboard = (...args) => fetchGlobalLeaderboard(...args);
    function fetchGlobalLeaderboard(isManualRefresh = false) {
      const listEl = document.getElementById('leaderboardList');
      const statusText = document.getElementById('myRankStatusText');
      const badge = document.getElementById('myLadderBadge');

      const now = Date.now();
      if (!isManualRefresh && leaderboardLoadedAt > 0 && now - leaderboardLoadedAt < LEADERBOARD_CACHE_TTL_MS) {
        return renderLeaderboardWithAvatars(cachedLeaderboard);
      }
      if (leaderboardRequest) return leaderboardRequest;

      if (isManualRefresh && listEl) {
        listEl.innerHTML = `
          <div style="text-align:center; padding:30px 0; color:#64748b; font-size:12px; font-weight:800;">
            <div style="font-size:24px; margin-bottom:6px; animation:bounceBubble 1s infinite alternate;">⏳</div>
            正在实时同步全服天梯最新排名...
          </div>
        `;
      }

      leaderboardRequest = (async () => {
        try {
          const res = await safeApiFetch('/api/rank', {
            ...(isManualRefresh ? { cache: 'no-store' } : {}),
            timeoutMs: 5500
          });
          const json = await res.json();

          if (json && json.code === 0 && Array.isArray(json.data)) {
            cachedLeaderboard = json.data;
            leaderboardLoadedAt = Date.now();
            await renderLeaderboardWithAvatars(cachedLeaderboard);
          } else if (listEl && isManualRefresh) {
            listEl.innerHTML = `<div style="text-align:center; padding:30px 0; color:#ef4444; font-size:12px; font-weight:800;">获取排行榜失败，请稍后重试</div>`;
          }
        } catch (err) {
          console.warn("拉取排行榜异常:", err);
          if (listEl && cachedLeaderboard.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:30px 0; color:#ef4444; font-size:12px; font-weight:800;">网络连接异常，请检查网络</div>`;
          }
        } finally {
          leaderboardRequest = null;
        }
        return cachedLeaderboard;
      })();
      return leaderboardRequest;
    }

    function renderLeaderboardUI(list) {
      const listEl = document.getElementById('leaderboardList');
      const statusText = document.getElementById('myRankStatusText');
      const badge = document.getElementById('myLadderBadge');
      if (!listEl) return;

      if (list.length === 0) {
        listEl.innerHTML = `
          <div style="text-align:center; padding:36px 0; color:#64748b; font-size:12px; font-weight:800;">
            <div style="font-size:32px; margin-bottom:8px;">🌱</div>
            暂无玩家上榜，快去赢下一局荣登榜首吧！
          </div>
        `;
        return;
      }

      let myRankNum = -1;
      let myScore = 1000;

      const html = list.map((item, idx) => {
        const rank = idx + 1;
        // 🌟 优先通过不变的专属 UID 判定是否是本人（改名后依然百分之百精准命中自己）
        // 只能用不可变 UID 识别本人，绝不能用昵称匹配，否则游客改成他人昵称会冒领对方排名。
        const isP1 = hasRegisteredAccountSession() && currentUserUid && String(item.uid) === String(currentUserUid);
        if (isP1) {
          myRankNum = rank;
          myScore = item.score;
          // 若本人已在本地改了新名字，天梯榜即刻以最新名字展示
          item.name = p1Name;
        }

        let rankBadge = `<span style="font-size:13px; font-weight:900; color:#64748b; min-width:22px; text-align:center;">#${rank}</span>`;
        let cardBg = 'background:rgba(255,255,255,0.85); border:1px solid #e2e8f0;';

        if (rank === 1) {
          rankBadge = `<span style="font-size:20px;">🥇</span>`;
          cardBg = 'background:linear-gradient(135deg, #fef3c7, #fffbeb); border:1.5px solid #f59e0b; box-shadow:0 2px 6px rgba(245,158,11,0.2);';
        } else if (rank === 2) {
          rankBadge = `<span style="font-size:20px;">🥈</span>`;
          cardBg = 'background:linear-gradient(135deg, #f1f5f9, #f8fafc); border:1.5px solid #94a3b8;';
        } else if (rank === 3) {
          rankBadge = `<span style="font-size:20px;">🥉</span>`;
          cardBg = 'background:linear-gradient(135deg, #ffedd5, #fff7ed); border:1.5px solid #ea580c;';
        }

        // 段位标签计算
        let tierName = '🌱 初窥门径';
        let tierColor = '#10b981';
        if (item.score >= 1400) { tierName = '👑 绝代棋圣'; tierColor = '#e11d48'; }
        else if (item.score >= 1200) { tierName = '⚔️ 妙手大师'; tierColor = '#8b5cf6'; }
        else if (item.score >= 1100) { tierName = '🌟 棋坛新秀'; tierColor = '#3b82f6'; }

        // 头像展示：支持动漫头像、emoji 或图片
        let avatarEl = renderAvatarElement(item.avatar, 28);

        const winRate = item.total_games > 0 ? Math.round((item.wins / item.total_games) * 100) : 0;

        return `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border-radius:10px; ${cardBg}">
            <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; margin-right:8px;">
              ${rankBadge}
              <div style="width:28px; height:28px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${avatarEl}
              </div>
              <div style="text-align:left; line-height:1.25; flex:1; min-width:0;">
                <div style="font-size:12.5px; font-weight:900; color:#1e293b; display:flex; align-items:center; gap:5px; min-width:0;">
                  <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex-shrink:1;">${escapeRankHTML(item.name)}</span>
                  ${isP1 ? '<span style="font-size:9.5px; background:#ef4444; color:#fff; padding:1px 4px; border-radius:4px; font-weight:800; flex-shrink:0; white-space:nowrap;">我</span>' : ''}
                  <span style="font-size:9.5px; color:${tierColor}; font-weight:800; border:1px solid ${tierColor}; padding:0 3px; border-radius:4px; flex-shrink:0; white-space:nowrap;">${tierName}</span>
                </div>
                <div style="font-size:10px; color:#64748b; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">胜率: ${winRate}% (${item.wins}胜/${item.total_games}局)</div>
              </div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
              <div style="font-size:13px; font-weight:900; color:#b45309; white-space:nowrap;">🏆 ${item.score}</div>
              <div style="font-size:9px; color:#94a3b8; font-weight:800;">积分</div>
            </div>
          </div>
        `;
      }).join('');

      listEl.innerHTML = html;

      if (statusText) {
        if (myRankNum > 0) {
          statusText.innerHTML = `我的排名: <b style="color:#b45309;">第 ${myRankNum} 名</b> (积分: <b style="color:#0ea5e9;">${myScore}</b>)`;
        } else {
          if (!hasRegisteredAccountSession()) {
            statusText.innerHTML = `游客未登录 · <a href="javascript:void(0)" onclick="closeLeaderboardModal(); openAuthModal('login')" style="color:#0284c7; font-weight:900; text-decoration:underline;">登录账号入榜</a>`;
            statusText.title = "游客身份未登录，点击登录或注册正式账号上榜";
          } else {
            statusText.innerHTML = `当前玩家: <b style="color:#0984e3;">${escapeRankHTML(p1Name)}</b> · 积分: <b style="color:#b45309;">${currentUserScore}</b> (赢局即可入榜)`;
            statusText.title = `当前玩家: ${p1Name}`;
          }
        }
      }

      if (myRankNum > 0) {
        currentUserScore = myScore;
        localStorage.setItem('gomoku_user_score', currentUserScore);
      }
      updateLadderBadgeUI(currentUserScore);
    }

    window.__GOMOKU_ACCOUNT_READY__ = true;
