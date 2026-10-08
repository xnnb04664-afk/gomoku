(() => {
  'use strict';

  const root = document.getElementById('startupSplash');
  if (!root) return;

  const frames = Array.from(root.querySelectorAll('[data-startup-frame]'));
  const skipButton = root.querySelector('[data-startup-skip]');
  const reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lowPower = Number(navigator.hardwareConcurrency || 8) <= 4 || Number(navigator.deviceMemory || 8) <= 3;
  const duration = lowPower ? 2400 : 2800;
  const frameTimeline = [0, 520, 1120, 1710];
  let finished = false;
  let finishTimer = 0;
  let animationFrame = 0;
  let startedAt = 0;
  let pausedAt = 0;

  function hasNativeBridge() {
    try {
      return Boolean(window.AndroidNativeApp && typeof window.AndroidNativeApp.isNativeApp === 'function' && window.AndroidNativeApp.isNativeApp());
    } catch (_) {
      return false;
    }
  }

  function setActiveFrame(index) {
    frames.forEach((frame, frameIndex) => {
      const active = frameIndex === index;
      frame.classList.toggle('is-active', active);
      frame.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  function removeSplash(reason) {
    root.hidden = true;
    root.classList.remove('is-dismissing');
    root.dataset.dismissReason = reason || 'complete';
    try {
      root.dispatchEvent(new CustomEvent('gomoku:splash-dismissed', { detail: { reason: root.dataset.dismissReason } }));
    } catch (_) {
      // Older WebViews can lack CustomEvent constructors; hiding the layer is enough.
    }
  }

  function dismiss(reason) {
    if (finished) return false;
    finished = true;
    window.clearTimeout(finishTimer);
    window.cancelAnimationFrame(animationFrame);
    document.documentElement.classList.remove('startup-splash-active');
    root.classList.add('is-dismissing');
    root.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => removeSplash(reason), reducedMotion ? 0 : 390);
    return true;
  }

  window.GomokuStartupSplash = Object.freeze({
    dismiss,
    skip: () => dismiss('skip'),
    isVisible: () => !root.hidden && !finished,
  });

  // Android already renders the same sequence natively while WebView boots.
  // Hiding this second layer avoids two independent animations competing for
  // the first frame and keeps the native cold-start path asset-local.
  if (hasNativeBridge()) {
    finished = true;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    return;
  }

  document.documentElement.classList.add('startup-splash-active');
  root.setAttribute('aria-hidden', 'false');
  setActiveFrame(reducedMotion ? frames.length - 1 : 0);

  if (skipButton) {
    skipButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      dismiss('skip');
    });
  }

  // Keep the splash visually present without putting a transparent hit layer
  // above the app. The first tap should reach the intended control while the
  // splash dismisses in the capture phase.
  document.addEventListener('pointerdown', event => {
    if (finished || (event.target && event.target.closest && event.target.closest('#startupSplash'))) return;
    if (event.target && event.target.closest && event.target.closest('button, a, [role="button"], input, select, textarea, canvas')) {
      dismiss('interaction');
    }
  }, true);

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Enter') dismiss('key');
  }, { passive: true });

  if (reducedMotion) {
    finishTimer = window.setTimeout(() => dismiss('reduced-motion'), 260);
    return;
  }

  function tick(now) {
    if (finished) return;
    const elapsed = now - startedAt;
    let activeIndex = 0;
    for (let i = 0; i < frameTimeline.length; i += 1) {
      if (elapsed >= frameTimeline[i]) activeIndex = i;
    }
    setActiveFrame(Math.min(activeIndex, frames.length - 1));
    if (elapsed >= duration) {
      dismiss('complete');
      return;
    }
    animationFrame = window.requestAnimationFrame(tick);
  }

  function startSequence() {
    startedAt = performance.now();
    animationFrame = window.requestAnimationFrame(tick);
    finishTimer = window.setTimeout(() => dismiss('complete'), duration + 80);
  }

  document.addEventListener('visibilitychange', () => {
    if (finished) return;
    if (document.hidden) {
      pausedAt = performance.now();
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(finishTimer);
      return;
    }
    if (!pausedAt) return;
    startedAt += performance.now() - pausedAt;
    pausedAt = 0;
    finishTimer = window.setTimeout(() => dismiss('complete'), duration + 80);
    animationFrame = window.requestAnimationFrame(tick);
  });

  startSequence();
})();
