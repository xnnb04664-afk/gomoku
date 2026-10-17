(() => {
  'use strict';

  const root = document.getElementById('startupSplash');
  if (!root) return;

  const boardCanvas = root.querySelector('[data-startup-board]');
  const context = boardCanvas && boardCanvas.getContext ? boardCanvas.getContext('2d') : null;
  const skipButton = root.querySelector('[data-startup-skip]');
  const reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lowPower = Number(navigator.hardwareConcurrency || 8) <= 4 || Number(navigator.deviceMemory || 8) <= 3;
  const duration = lowPower ? 3000 : 3600;
  // Keep the center empty: the stones draw only the heart's outline.
  // Black occupies the left half; white occupies the right half.
  const stones = Object.freeze([
    [2, 4], [2, 10], [2, 5], [2, 9],
    [3, 3], [3, 11], [3, 6], [3, 8],
    [4, 2], [4, 12], [4, 7],
    [5, 1], [5, 13], [6, 1], [6, 13],
    [7, 2], [7, 12], [8, 3], [8, 11],
    [9, 4], [9, 10], [10, 5], [10, 9],
    [11, 6], [11, 8], [12, 7]
  ].map(([row, col]) => Object.freeze([row, col, col < 7 ? 0 : 1])));
  window.GOMOKU_HEART_STONES = stones;
  window.dispatchEvent(new Event('gomoku-heart-stones-ready'));
  let finished = false;
  let finishTimer = 0;
  let animationFrame = 0;
  let startedAt = 0;
  let pausedAt = 0;
  let elapsedBeforePause = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasDpr = 1;
  const stoneSprites = [null, null];

  function hasNativeBridge() {
    try {
      return Boolean(window.AndroidNativeApp && typeof window.AndroidNativeApp.isNativeApp === 'function' && window.AndroidNativeApp.isNativeApp());
    } catch (_) {
      return false;
    }
  }

  function clamp(value) {
    return Math.max(0, Math.min(1, value));
  }

  function easeOut(value) {
    const t = clamp(value);
    return 1 - Math.pow(1 - t, 3);
  }

  function dismiss(reason) {
    if (finished) return false;
    finished = true;
    window.clearTimeout(finishTimer);
    window.cancelAnimationFrame(animationFrame);
    document.documentElement.classList.remove('startup-splash-active');
    root.classList.add('is-dismissing');
    root.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      root.hidden = true;
      root.classList.remove('is-dismissing');
      root.dataset.dismissReason = reason || 'complete';
      try {
        root.dispatchEvent(new CustomEvent('gomoku:splash-dismissed', { detail: { reason: root.dataset.dismissReason } }));
      } catch (_) {}
    }, reducedMotion ? 0 : 420);
    return true;
  }

  window.GomokuStartupSplash = Object.freeze({
    dismiss,
    skip: () => dismiss('skip'),
    isVisible: () => !root.hidden && !finished
  });

  // Android shows the same scene from native Canvas while its WebView starts.
  if (hasNativeBridge()) {
    finished = true;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    return;
  }

  function resizeBoard() {
    if (!context || !boardCanvas) return;
    // offsetWidth/Height ignore the board's entrance transform. Using a transformed
    // bounding rect here would scale the canvas twice while the board is moving in.
    const bounds = boardCanvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(boardCanvas.offsetWidth || bounds.width));
    const nextHeight = Math.max(1, Math.round(boardCanvas.offsetHeight || bounds.height));
    canvasDpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (nextWidth === canvasWidth && nextHeight === canvasHeight
        && boardCanvas.width === Math.round(nextWidth * canvasDpr)
        && boardCanvas.height === Math.round(nextHeight * canvasDpr)) return;
    canvasWidth = nextWidth;
    canvasHeight = nextHeight;
    boardCanvas.width = Math.round(canvasWidth * canvasDpr);
    boardCanvas.height = Math.round(canvasHeight * canvasDpr);
    context.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
    drawBoard(elapsedBeforePause / duration);
  }

  function drawStone(x, y, radius, color, stoneProgress) {
    if (!context || stoneProgress <= 0) return;
    const pop = easeOut(stoneProgress);
    const drawRadius = radius * (0.68 + 0.32 * pop);
    const drop = (1 - pop) * radius * 1.15;
    context.save();
    context.globalAlpha = Math.min(1, stoneProgress * 1.4);
    context.fillStyle = 'rgba(35, 66, 65, .28)';
    context.beginPath();
    context.ellipse(x, y + radius * .42, drawRadius * 1.04, drawRadius * .58, 0, 0, Math.PI * 2);
    context.fill();
    const centerY = y + drop;
    const sprite = stoneSprites[color];
    if (sprite) context.drawImage(sprite, x - drawRadius, centerY - drawRadius, drawRadius * 2, drawRadius * 2);
    context.restore();
  }

  function createStoneSprite(color) {
    const sprite = document.createElement('canvas');
    const size = 96;
    const center = size / 2;
    const radius = size * .48;
    sprite.width = size;
    sprite.height = size;
    const spriteContext = sprite.getContext('2d');
    if (!spriteContext) return null;

    const gradient = spriteContext.createRadialGradient(
      center - radius * .34, center - radius * .42, radius * .06,
      center, center, radius * 1.22
    );
    if (color === 0) {
      gradient.addColorStop(0, '#83919b');
      gradient.addColorStop(.34, '#303d48');
      gradient.addColorStop(1, '#07121d');
    } else {
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(.5, '#f5f8fa');
      gradient.addColorStop(1, '#aebdc5');
    }
    spriteContext.fillStyle = gradient;
    spriteContext.beginPath();
    spriteContext.arc(center, center, radius, 0, Math.PI * 2);
    spriteContext.fill();
    spriteContext.fillStyle = color === 0 ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.86)';
    spriteContext.beginPath();
    spriteContext.ellipse(center - radius * .25, center - radius * .32,
      radius * .24, radius * .13, -.42, 0, Math.PI * 2);
    spriteContext.fill();
    return sprite;
  }

  function drawBoard(progress) {
    if (!context || !canvasWidth || !canvasHeight) return;
    const width = canvasWidth;
    const height = canvasHeight;
    const boardSide = Math.min(width, height);
    const grassLeft = boardSide * (.126 + .004) + (width - boardSide) * .5;
    const grassRight = boardSide * (.873 - .004) + (width - boardSide) * .5;
    const grassTop = boardSide * (.128 + .004) + (height - boardSide) * .5;
    const grassBottom = boardSide * (.789 - .004) + (height - boardSide) * .5;
    const step = Math.min((grassRight - grassLeft) / 15, (grassBottom - grassTop) / 15);
    const firstX = (grassLeft + grassRight) * .5 - 7 * step;
    const firstY = grassTop + .5 * step;
    const lastX = firstX + 14 * step;
    const lastY = firstY + 14 * step;
    const centerX = (firstX + lastX) * .5;
    const centerY = (firstY + lastY) * .5;

    context.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    // Begin with a complete empty board; the animation focuses on forming the heart.
    const reveal = 1;
    if (reveal > 0) {
      for (let index = 0; index < 15; index++) {
        const distance = Math.abs(index - 7) / 7;
        const span = easeOut((reveal - distance * .11) / .9);
        if (span <= 0) continue;
        const halfHeight = (lastY - firstY) * .5 * span;
        const halfWidth = (lastX - firstX) * .5 * span;
        context.strokeStyle = 'rgba(53, 76, 48, ' + (.32 + .34 * reveal) + ')';
        context.lineWidth = Math.max(.7, step * .032);
        context.beginPath();
        context.moveTo(firstX + index * step, centerY - halfHeight);
        context.lineTo(firstX + index * step, centerY + halfHeight);
        context.moveTo(centerX - halfWidth, firstY + index * step);
        context.lineTo(centerX + halfWidth, firstY + index * step);
        context.stroke();
      }
      const starReveal = 1;
      if (starReveal > 0) {
        context.fillStyle = 'rgba(52, 75, 46, ' + (.42 * starReveal) + ')';
        for (const row of [3, 7, 11]) {
          for (const col of [3, 7, 11]) {
            context.beginPath();
            context.arc(firstX + col * step, firstY + row * step, Math.max(1.4, step * .055), 0, Math.PI * 2);
            context.fill();
          }
        }
      }
    }

    stones.forEach((stone, index) => {
      const start = .22 + index * .027;
      const stoneProgress = clamp((progress - start) / .09);
      drawStone(
        firstX + stone[1] * step,
        firstY + stone[0] * step,
        step * .43,
        stone[2],
        stoneProgress
      );
    });
  }

  function createStoneSprites() {
    stoneSprites[0] = createStoneSprite(0);
    stoneSprites[1] = createStoneSprite(1);
  }

  function dismissAfterAnimation() {
    root.classList.add('is-complete');
    window.setTimeout(() => dismiss('complete'), 420);
  }

  function animate(now) {
    if (finished) return;
    const elapsed = now - startedAt + elapsedBeforePause;
    const progress = clamp(elapsed / duration);
    drawBoard(progress);
    if (progress >= 1) {
      animationFrame = 0;
      dismissAfterAnimation();
      return;
    }
    animationFrame = window.requestAnimationFrame(animate);
  }

  root.classList.add('is-running');
  root.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('startup-splash-active');
  createStoneSprites();
  resizeBoard();
  window.addEventListener('resize', resizeBoard, { passive: true });

  if (skipButton) {
    skipButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      dismiss('skip');
    });
  }

  document.addEventListener('pointerdown', event => {
    if (finished || (event.target && event.target.closest && event.target.closest('#startupSplash'))) return;
    if (event.target && event.target.closest
        && event.target.closest('button, a, [role="button"], input, select, textarea, canvas')) {
      dismiss('interaction');
    }
  }, true);

  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' && event.key !== 'Enter') return;
    const target = event.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    dismiss('key');
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (finished) return;
    if (document.hidden) {
      pausedAt = performance.now();
      elapsedBeforePause += pausedAt - startedAt;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      return;
    }
    if (!pausedAt) return;
    pausedAt = 0;
    startedAt = performance.now();
    animationFrame = window.requestAnimationFrame(animate);
  });

  if (reducedMotion) {
    drawBoard(1);
    root.classList.add('is-complete');
    finishTimer = window.setTimeout(() => dismiss('reduced-motion'), 520);
  } else {
    startedAt = performance.now();
    animationFrame = window.requestAnimationFrame(animate);
  }
})();
