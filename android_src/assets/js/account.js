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
        let failureMessage = '';
        try {
          const res = await safeApiFetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && data.code === 0) {
            submitSuccess = true;
          } else {
            failureMessage = data && data.msg ? String(data.msg) : '服务器未确认收到反馈';
          }
        } catch (netErr) {
          console.warn('Feedback online submit failed:', netErr);
          failureMessage = '网络连接失败';
        }

        if (submitSuccess) {
          if (contentEl) contentEl.value = '';
          if (contactEl) contactEl.value = '';
          const counter = document.getElementById('feedbackCharCount');
          if (counter) counter.textContent = '0 / 300';
          closeFeedbackModal();
          showGameNotice('🎉 反馈已提交，感谢您的宝贵意见！', false);
        } else {
          let savedLocally = false;
          try {
            const stored = JSON.parse(localStorage.getItem('gomoku_feedback_offline_list') || '[]');
            const offlineList = Array.isArray(stored) ? stored : [];
            offlineList.unshift({ ...payload, submittedOnline: false });
            if (offlineList.length > 20) offlineList.length = 20;
            localStorage.setItem('gomoku_feedback_offline_list', JSON.stringify(offlineList));
            savedLocally = true;
          } catch (storageErr) {
            console.warn('Feedback local fallback save failed:', storageErr);
          }

          const notice = savedLocally
            ? `⚠️ ${failureMessage}，未提交到服务器；反馈已暂存在本机，请稍后重试。`
            : `⚠️ ${failureMessage}，未提交到服务器；内容仍保留在表单中，请稍后重试。`;
          showGameNotice(notice, true);
        }
      } catch (err) {
        console.error('Feedback submission handling failed:', err);
        showGameNotice('⚠️ 反馈未确认提交，内容仍保留在表单中，请稍后重试。', true);
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
          <div class="sky-rank-empty">
            <span aria-hidden="true">♟</span>
            <strong>棋榜暂时安静</strong>
            <small>赢下一局后，名字就会出现在这里。</small>
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
        const displayName = String((isP1 ? (p1Name || currentUsername || item.name) : item.name) || '棋友');
        if (isP1) {
          myRankNum = rank;
          myScore = item.score;
        }

        const rankClass = rank <= 3 ? ` is-top-${rank}` : '';
        const rankBadge = rank === 1 ? 'Ⅰ' : rank === 2 ? 'Ⅱ' : rank === 3 ? 'Ⅲ' : String(rank).padStart(2, '0');
        let tierName = '初窥门径';
        let tierClass = 'seedling';
        if (item.score >= 1400) { tierName = '绝代棋圣'; tierClass = 'master'; }
        else if (item.score >= 1200) { tierName = '妙手大师'; tierClass = 'expert'; }
        else if (item.score >= 1100) { tierName = '棋坛新秀'; tierClass = 'rising'; }

        // 头像以服务端返回的账号资料为准；不要在前端按昵称识别私人账号。
        const avatar = item.avatar || 'anime_boy';
        const avatarEl = renderAvatarElement(avatar, 42);
        const wins = Math.max(0, Number(item.wins) || 0);
        const totalGames = Math.max(0, Number(item.total_games) || 0);
        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
        const score = Math.max(0, Number(item.score) || 0);

        return `
          <article class="sky-rank-row${rankClass}${isP1 ? ' is-self' : ''}">
            <div class="sky-rank-place"><span>${rankBadge}</span><small>${rank <= 3 ? '棋位' : '排名'}</small></div>
            <div class="sky-rank-avatar">${avatarEl}</div>
            <div class="sky-rank-main">
              <div class="sky-rank-name-line">
                <strong>${escapeRankHTML(displayName)}</strong>
                ${isP1 ? '<span class="sky-rank-self-badge">我</span>' : ''}
                <span class="sky-rank-tier is-${tierClass}">${tierName}</span>
              </div>
              <div class="sky-rank-record">${wins} 胜 · ${totalGames} 局 <span>胜率 ${winRate}%</span></div>
              <div class="sky-rank-progress" aria-label="胜率 ${winRate}%"><i style="width:${winRate}%"></i></div>
            </div>
            <div class="sky-rank-score"><strong>${score}</strong><small>积分</small>
            </div>
          </article>
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
