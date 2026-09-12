(function () {
  'use strict';

  document.documentElement.classList.replace('no-js', 'js');

  const navToggle = document.querySelector('.nav-toggle');
  const siteNav = document.getElementById('siteNav');
  if (navToggle && siteNav) {
    const setNavState = open => {
      siteNav.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
    };
    setNavState(false);
    navToggle.addEventListener('click', () => {
      setNavState(!siteNav.classList.contains('is-open'));
    });
    siteNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      setNavState(false);
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && siteNav.classList.contains('is-open')) {
        setNavState(false);
        navToggle.focus();
      }
    });
    document.addEventListener('click', event => {
      if (siteNav.classList.contains('is-open') && !siteNav.contains(event.target) && !navToggle.contains(event.target)) {
        setNavState(false);
      }
    });
  }

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
    revealItems.forEach(item => observer.observe(item));
  } else {
    revealItems.forEach(item => item.classList.add('is-visible'));
  }

  const board = document.querySelector('[data-demo-board]');
  const status = document.querySelector('[data-demo-status]');
  const reset = document.querySelector('[data-reset-board]');
  let demoMoves = [];
  const maxMoves = 5;
  function resetBoard() {
    board?.querySelectorAll('.board-stone.demo').forEach(stone => stone.remove());
    demoMoves = [];
    if (status) status.textContent = '点击棋盘，放下第一手';
  }
  function placeDemoStone(event) {
    if (!board || demoMoves.length >= maxMoves) return;
    const rect = board.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    const x = Math.max(0, Math.min(14, Math.round(((source.clientX - rect.left) / rect.width) * 14)));
    const y = Math.max(0, Math.min(14, Math.round(((source.clientY - rect.top) / rect.height) * 14)));
    if (demoMoves.some(move => move.x === x && move.y === y)) return;
    const stone = document.createElement('span');
    stone.className = `board-stone demo ${demoMoves.length % 2 === 0 ? 'black' : 'white'}`;
    stone.style.setProperty('--x', `${(x / 14) * 100}%`);
    stone.style.setProperty('--y', `${(y / 14) * 100}%`);
    board.appendChild(stone);
    demoMoves.push({ x, y });
    if (status) status.textContent = demoMoves.length === maxMoves
      ? '五手演示完成 · 再来一局？'
      : `第 ${demoMoves.length} 手落下 · ${demoMoves.length % 2 ? '轮到白子' : '轮到黑子'}`;
  }
  board?.addEventListener('click', placeDemoStone);
  board?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); placeDemoStone({ clientX: board.getBoundingClientRect().left + board.clientWidth / 2, clientY: board.getBoundingClientRect().top + board.clientHeight / 2 }); }
  });
  reset?.addEventListener('click', resetBoard);

  const year = document.querySelector('[data-current-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  function renderVersion(data) {
    const internalTag = String(data?.tag || '').trim();
    const match = internalTag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    let display = internalTag;
    if (match && Number(match[3]) >= 100) {
      // 内部版本保留三位发布序号，但官网沿用用户界面的折叠显示：
      // v1.0.118 -> v1.1.8，v1.0.123 -> v1.2.3。更新比较仍使用 internalTag。
      const patch = Number(match[3]);
      display = `v${match[1]}.${Number(match[2]) + Math.floor((patch % 100) / 10)}.${patch % 10}`;
    }
    document.querySelectorAll('.js-version').forEach(item => { if (display) item.textContent = display; });
    document.querySelectorAll('.js-build').forEach(item => { if (data?.build != null) item.textContent = data.build; });
  }

  async function loadVersion() {
    let data;
    try {
      const response = await fetch('/api/site-version', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (response.ok) data = await response.json();
    } catch (_) { /* 继续读取官网随包版本清单 */ }
    if (!data?.tag) {
      try {
        const response = await fetch('/version.json', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (response.ok) {
          const staticData = await response.json();
          data = { tag: staticData.releaseTag, build: staticData.versionCode };
        }
      } catch (_) { /* The static HTML fallback remains usable during maintenance. */ }
    }
    if (data?.tag) renderVersion(data);
  }
  loadVersion();
})();
