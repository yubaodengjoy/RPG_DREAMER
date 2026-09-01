(() => {
  const GAME_SOURCE = 'rpg-dreamer-game';
  const HOST_SOURCE = 'rpg-dreamer-host';
  let ready = false;
  let paused = false;
  let completedResources = 0;
  let lastProgress = 0;

  function normalizeOrigin(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.origin;
    } catch {
      return '';
    }
  }

  const hostParams = new URLSearchParams(window.location.hash.slice(1));
  const hostOrigin = normalizeOrigin(hostParams.get('rpg-host-origin'))
    || normalizeOrigin(document.referrer);
  const isEmbedded = window.parent !== window && Boolean(hostOrigin);

  // Keep gameplay gestures inside the cartridge. Phaser still receives these
  // events; only the browser's default page/iframe scrolling is suppressed.
  if (isEmbedded) {
    const lockScroll = () => {
      document.documentElement.style.overscrollBehavior = 'none';
      if (document.body) document.body.style.overscrollBehavior = 'none';
    };
    lockScroll();
    document.addEventListener('DOMContentLoaded', lockScroll, { once: true });
    const scrollKeys = new Set([' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    window.addEventListener('keydown', (event) => {
      if (scrollKeys.has(event.key)) event.preventDefault();
    }, { capture: true });
    window.addEventListener('wheel', (event) => event.preventDefault(), { capture: true, passive: false });
    window.addEventListener('touchmove', (event) => event.preventDefault(), { capture: true, passive: false });
  }

  function post(type, detail = {}) {
    if (window.parent === window || !hostOrigin) return;
    window.parent.postMessage(
      { source: GAME_SOURCE, type, ...detail },
      hostOrigin,
    );
  }

  // The generated games call window.close() from their main-menu Exit button.
  // Embedded frames cannot close the browser tab, so hand that action back to
  // the cartridge host instead.
  if (isEmbedded) {
    const requestHostExit = () => post('exit');
    try {
      Object.defineProperty(window, 'close', {
        configurable: true,
        value: requestHostExit,
      });
    } catch {
      window.close = requestHostExit;
    }
  }

  function postProgress(value) {
    const normalized = Math.max(lastProgress, Math.min(0.96, value));
    if (normalized - lastProgress < 0.01) return;
    lastProgress = normalized;
    post('loading', { progress: normalized });
  }

  function syncPlayback() {
    const game = window.__WEBRPG_GAME__;
    if (!game) return;
    if (paused) {
      game.loop?.sleep();
      game.sound?.pauseAll();
      return;
    }
    game.loop?.wake();
    game.sound?.resumeAll();
    game.scale?.refresh();
  }

  post('loading', { progress: 0 });

  if ('PerformanceObserver' in window) {
    const observer = new PerformanceObserver((list) => {
      completedResources += list.getEntries().length;
      postProgress(0.06 + (1 - Math.exp(-completedResources / 28)) * 0.88);
    });
    observer.observe({ type: 'resource', buffered: true });
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== hostOrigin || event.data?.source !== HOST_SOURCE) return;
    if (event.data.type === 'pause') paused = true;
    if (event.data.type === 'resume') paused = false;
    if (event.data.type === 'resize') window.__WEBRPG_GAME__?.scale?.refresh();
    syncPlayback();
  });

  window.addEventListener('error', (event) => {
    if (ready) return;
    post('error', { message: event.message || 'The game failed to start.' });
  });

  const readyPoll = window.setInterval(() => {
    const game = window.__WEBRPG_GAME__;
    if (!game) return;
    syncPlayback();
    if (!game.scene?.isActive?.('menu')) return;
    ready = true;
    lastProgress = 1;
    post('loading', { progress: 1 });
    post('ready');
    window.clearInterval(readyPoll);
  }, 80);
})();
