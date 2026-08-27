(() => {
  const GAME_SOURCE = 'rpg-dreamer-game';
  const HOST_SOURCE = 'rpg-dreamer-host';
  let ready = false;
  let paused = false;
  let completedResources = 0;
  let lastProgress = 0;

  function post(type, detail = {}) {
    if (window.parent === window) return;
    window.parent.postMessage(
      { source: GAME_SOURCE, type, ...detail },
      window.location.origin,
    );
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
    if (event.origin !== window.location.origin || event.data?.source !== HOST_SOURCE) return;
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
