(() => {
  'use strict';

  function init() {
    const root = document.getElementById('startupSplash');
    if (!root) return;

    function dismiss(reason = 'auto-skip') {
      const wasVisible = !root.hidden;
      root.hidden = true;
      root.classList.remove('is-dismissing');
      root.setAttribute('aria-hidden', 'true');
      root.dataset.dismissReason = reason;
      document.documentElement.classList.remove('startup-splash-active');
      if (wasVisible) {
        try {
          root.dispatchEvent(new CustomEvent('gomoku:splash-dismissed', { detail: { reason } }));
        } catch (_) {}
      }
      return wasVisible;
    }

    // Keep the integration API, but opening the game never waits for an
    // animation, fade, interaction, or visibility-change timer.
    window.GomokuStartupSplash = Object.freeze({
      dismiss,
      skip: () => dismiss('skip'),
      isVisible: () => !root.hidden,
    });
    dismiss();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
