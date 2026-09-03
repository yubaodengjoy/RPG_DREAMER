(() => {
  const GAME_SOURCE = 'rpg-dreamer-game';
  const HOST_SOURCE = 'rpg-dreamer-host';
  let ready = false;
  let paused = false;
  let completedResources = 0;
  let lastProgress = 0;
  const virtualKeysDown = new Map();
  const allowedVirtualKeys = new Map([
    ['ArrowUp', { key: 'ArrowUp', keyCode: 38 }],
    ['ArrowDown', { key: 'ArrowDown', keyCode: 40 }],
    ['ArrowLeft', { key: 'ArrowLeft', keyCode: 37 }],
    ['ArrowRight', { key: 'ArrowRight', keyCode: 39 }],
    ['Space', { key: ' ', keyCode: 32 }],
  ]);

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
  if (window.parent !== window && hostOrigin) {
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

  function dispatchVirtualKey(code, phase) {
    const definition = allowedVirtualKeys.get(code);
    if (!definition || (phase !== 'down' && phase !== 'up')) return;
    if (phase === 'down' && virtualKeysDown.has(code)) return;
    if (phase === 'up' && !virtualKeysDown.has(code)) return;
    if (phase === 'down') virtualKeysDown.set(code, definition);
    else virtualKeysDown.delete(code);

    const event = new KeyboardEvent(phase === 'down' ? 'keydown' : 'keyup', {
      key: definition.key,
      code,
      bubbles: true,
      cancelable: true,
      repeat: false,
    });
    try {
      Object.defineProperties(event, {
        keyCode: { get: () => definition.keyCode },
        which: { get: () => definition.keyCode },
      });
    } catch {
      // Modern engines use key/code; legacy numeric properties are optional.
    }
    window.dispatchEvent(event);
  }

  function releaseVirtualKeys() {
    [...virtualKeysDown.keys()].forEach((code) => dispatchVirtualKey(code, 'up'));
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
    if (event.data.type === 'pause') {
      paused = true;
      releaseVirtualKeys();
    }
    if (event.data.type === 'resume') paused = false;
    if (event.data.type === 'resize') window.__WEBRPG_GAME__?.scale?.refresh();
    if (event.data.type === 'virtual-key') {
      const requested = allowedVirtualKeys.get(event.data.code);
      if (requested
        && event.data.key === requested.key
        && Number(event.data.keyCode) === requested.keyCode) {
        dispatchVirtualKey(event.data.code, event.data.phase);
      }
    }
    if (event.data.type === 'virtual-keys-release') releaseVirtualKeys();
    syncPlayback();
  });

  window.addEventListener('blur', releaseVirtualKeys);

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
