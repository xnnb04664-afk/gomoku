    function openPhraseManageModal() {
      const modal = document.getElementById('phraseManageModal');
      const list = document.getElementById('managePhraseList');
      list.innerHTML = customPhrases.map((p, idx) => `
        <div class="phrase-manage-item" draggable="true" data-index="${idx}" data-phrase="${escapeHtml(p)}"
             style="display:flex; align-items:center; justify-content:space-between; background:#fff; padding:7px 10px; border-radius:8px; border:1.5px solid #cbd5e1; font-size:12.5px; font-weight:800; cursor:grab; user-select:none; opacity:1 !important; touch-action:none;"
             ondragstart="handlePhraseDragStart(event)"
             ondragover="handlePhraseDragOver(event)"
             ondragend="handlePhraseDragEnd(event)"
             ontouchstart="handlePhraseTouchStart(event)"
             ontouchmove="handlePhraseTouchMove(event)"
             ontouchend="handlePhraseTouchEnd(event)">
          <div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1; min-width:0; margin-right:6px;">
            <span class="drag-handle" style="font-size:16px; color:#94a3b8; cursor:grab; padding:0 2px; flex-shrink:0;">⠿</span>
            <span class="phrase-item-text" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; color:#2d3436;">${idx + 1}. ${escapeHtml(p)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
            <button class="btn-move-up" onclick="event.stopPropagation(); movePhrase(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.25;"' : ''} style="background:#e2e8f0; color:#334155; border:none; border-radius:5px; padding:3px 7px; font-size:11px; cursor:pointer; font-weight:900; min-height:22px;">▲</button>
            <button class="btn-move-down" onclick="event.stopPropagation(); movePhrase(${idx}, 1)" ${idx === customPhrases.length - 1 ? 'disabled style="opacity:0.25;"' : ''} style="background:#e2e8f0; color:#334155; border:none; border-radius:5px; padding:3px 7px; font-size:11px; cursor:pointer; font-weight:900; min-height:22px;">▼</button>
            <button onclick="event.stopPropagation(); deletePhrase(${idx})" style="background:#ff7675; color:#fff; border:none; border-radius:5px; padding:3px 7px; font-size:11px; cursor:pointer; min-height:22px;">❌</button>
          </div>
        </div>
      `).join('');
      modal.classList.add('show');
    }

    function closePhraseManageModal() {
      document.getElementById('phraseManageModal').classList.remove('show');
      renderQuickPhrases();
    }

    // 动态同步更新DOM列表的序号与按钮状态
    function updateManageItemNumbers() {
      const list = document.getElementById('managePhraseList');
      if (!list) return;
      const items = Array.from(list.querySelectorAll('.phrase-manage-item'));
      items.forEach((item, idx) => {
        item.dataset.index = idx;
        const phrase = item.getAttribute('data-phrase') || '';
        const txt = item.querySelector('.phrase-item-text');
        if (txt && phrase) {
          txt.textContent = `${idx + 1}. ${phrase}`;
        }
        const upBtn = item.querySelector('.btn-move-up');
        const downBtn = item.querySelector('.btn-move-down');
        if (upBtn) {
          upBtn.disabled = idx === 0;
          upBtn.style.opacity = idx === 0 ? '0.25' : '1';
          upBtn.setAttribute('onclick', `event.stopPropagation(); movePhrase(${idx}, -1)`);
        }
        if (downBtn) {
          downBtn.disabled = idx === items.length - 1;
          downBtn.style.opacity = idx === items.length - 1 ? '0.25' : '1';
          downBtn.setAttribute('onclick', `event.stopPropagation(); movePhrase(${idx}, 1)`);
        }
        const delBtn = item.querySelector('button[style*="#ff7675"]');
        if (delBtn) {
          delBtn.setAttribute('onclick', `event.stopPropagation(); deletePhrase(${idx})`);
        }
      });
    }

    // 快速上下移动
    function movePhrase(idx, delta) {
      const target = idx + delta;
      if (target < 0 || target >= customPhrases.length) return;
      const temp = customPhrases[idx];
      customPhrases[idx] = customPhrases[target];
      customPhrases[target] = temp;
      savePhrases();
      openPhraseManageModal();
      renderQuickPhrases();
    }

    // ==========================================
    // 🔀 快捷语高级实时换位拖拽排序引擎 (移动触屏 + 鼠标全面支持，其他语录实时移动让位)
    // ==========================================
    let activeDragPhraseItem = null;

    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('.phrase-manage-item:not(.is-dragging)')];
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // 1. 桌面端 HTML5 Drag&Drop 实时换位
    function handlePhraseDragStart(e) {
      activeDragPhraseItem = e.currentTarget;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      setTimeout(() => {
        if (activeDragPhraseItem) activeDragPhraseItem.classList.add('is-dragging');
      }, 0);
    }

    function handlePhraseDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!activeDragPhraseItem) return;

      const list = document.getElementById('managePhraseList');
      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement == null) {
        if (list.lastElementChild !== activeDragPhraseItem) {
          list.appendChild(activeDragPhraseItem);
          updateManageItemNumbers();
        }
      } else {
        if (afterElement !== activeDragPhraseItem && afterElement.previousElementSibling !== activeDragPhraseItem) {
          list.insertBefore(activeDragPhraseItem, afterElement);
          updateManageItemNumbers();
        }
      }
    }

    function handlePhraseDragEnd(e) {
      finishPhraseDrag();
    }

    // 2. 移动端 Touch 触摸实时换位 (基于手指垂直坐标计算，其他语录动态让位平移)
    function handlePhraseTouchStart(e) {
      activeDragPhraseItem = e.currentTarget;
      activeDragPhraseItem.classList.add('is-dragging');
    }

    function handlePhraseTouchMove(e) {
      if (!activeDragPhraseItem) return;
      if (e.cancelable) e.preventDefault();
      const touch = e.touches[0];
      const list = document.getElementById('managePhraseList');
      const afterElement = getDragAfterElement(list, touch.clientY);
      if (afterElement == null) {
        if (list.lastElementChild !== activeDragPhraseItem) {
          list.appendChild(activeDragPhraseItem);
          updateManageItemNumbers();
        }
      } else {
        if (afterElement !== activeDragPhraseItem && afterElement.previousElementSibling !== activeDragPhraseItem) {
          list.insertBefore(activeDragPhraseItem, afterElement);
          updateManageItemNumbers();
        }
      }
    }

    function handlePhraseTouchEnd(e) {
      finishPhraseDrag();
    }

    function finishPhraseDrag() {
      if (!activeDragPhraseItem) return;
      activeDragPhraseItem.classList.remove('is-dragging');
      activeDragPhraseItem = null;

      const list = document.getElementById('managePhraseList');
      if (list) {
        const items = Array.from(list.querySelectorAll('.phrase-manage-item'));
        customPhrases = items.map(el => el.getAttribute('data-phrase') || '').filter(Boolean);
        savePhrases();
        updateManageItemNumbers();
        renderQuickPhrases();
        playPopSound();
      }
    }

    function addNewPhrase() {
      const input = document.getElementById('inputNewPhrase');
      if (!input) return;
      const raw = input.value.trim();
      if (raw.length > 80) return alert("快捷短语最多 80 个字符！");
      const val = raw;
      if (!val) return alert("请输入快捷短语内容！");
      if (customPhrases.length >= 30) return alert("最多保存 30 条快捷短语！");
      customPhrases.push(val);
      savePhrases();
      input.value = '';
      openPhraseManageModal();
      renderQuickPhrases();
    }

    function deletePhrase(idx) {
      if (customPhrases.length <= 1) return alert("至少保留一条快捷短语哦~");
      const phraseText = customPhrases[idx];
      showCustomConfirm(`确定要删除快捷语「${phraseText}」吗？`, () => {
        customPhrases.splice(idx, 1);
        savePhrases();
        openPhraseManageModal();
        renderQuickPhrases();
        showGameNotice("🗑️ 已删除该快捷短语");
      }, null, { title: '删除短语', icon: '🗑️' });
    }

    function restoreDefaultPhrases() {
      showCustomConfirm("确定要恢复内置默认快捷短语吗？", () => {
        customPhrases = [...DEFAULT_PHRASES];
        savePhrases();
        openPhraseManageModal();
        renderQuickPhrases();
        showGameNotice("✅ 已恢复默认快捷短语~");
      }, null, { title: '恢复默认短语', icon: '🔄' });
    }

    window.__GOMOKU_SETTINGS_READY__ = true;
