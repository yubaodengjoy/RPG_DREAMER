(() => {
  const GAME_SOURCE = 'rpg-dreamer-game';
  const HOST_SOURCE = 'rpg-dreamer-host';
  let ready = false;
  let paused = false;
  let completedResources = 0;
  let lastProgress = 0;
  let audioWasUnlocked = false;
  let lastPostedAudioState = '';
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

  function getSoundManager() {
    return window.__WEBRPG_GAME__?.sound || null;
  }

  function getAudioState() {
    const sound = getSoundManager();
    if (!sound) return 'pending';
    if (sound.context) {
      return sound.context.state === 'running' && (!sound.locked || sound.unlocked) ? 'running' : 'locked';
    }
    return sound.locked ? 'locked' : 'running';
  }

  function postAudioState(state) {
    if (state === lastPostedAudioState) return;
    lastPostedAudioState = state;
    post('audio-state', { state });
  }

  function syncAudioState() {
    const state = getAudioState();
    postAudioState(state);
    if (state === 'running') audioWasUnlocked = true;
  }

  function primeAudioContext(context) {
    try {
      const buffer = context.createBuffer(1, 1, context.sampleRate || 22050);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => source.disconnect();
      source.start(0);
    } catch {
      // Resuming the context is the important part; priming is an iOS fallback.
    }
  }

  function finishAudioUnlock(sound) {
    if (!sound.context) {
      if (sound.locked) return false;
      audioWasUnlocked = true;
      postAudioState('running');
      return true;
    }
    const contextRunning = !sound.context || sound.context.state === 'running';
    if (!contextRunning) return false;
    // Phaser clears `locked` and flushes queued sounds on the next update after
    // `unlocked` is set. This preserves its normal sound-manager lifecycle.
    if (sound.locked) sound.unlocked = true;
    audioWasUnlocked = true;
    postAudioState('running');
    return true;
  }

  function unlockAudioFromGesture(event) {
    if (event?.isTrusted === false || getAudioState() === 'running') return;
    const sound = getSoundManager();
    if (!sound) return;

    const context = sound.context;
    if (!context) {
      window.setTimeout(() => finishAudioUnlock(sound), 80);
      return;
    }

    // These calls happen directly inside a trusted event from the game frame.
    // They supplement Phaser's own unlock handler and cover older iOS builds.
    primeAudioContext(context);
    try {
      Promise.resolve(context.resume()).then(
        () => finishAudioUnlock(sound),
        syncAudioState,
      );
    } catch {
      syncAudioState();
    }
  }

  // iOS treats Web Audio as ambient audio by default, so the hardware silent
  // switch can mute a running AudioContext. Playback mode gives games normal
  // media behavior on browsers that expose the Audio Session API.
  function configureAudioSession() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // Older mobile browsers do not expose the Audio Session API.
    }
  }
  configureAudioSession();

  // No extra sound UI: the first real interaction with the game canvas also
  // unlocks its audio. Capture both touch and pointer families for iOS/Android.
  ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'].forEach((type) => {
    document.addEventListener(type, unlockAudioFromGesture, { capture: true, passive: true });
  });

  function syncPlayback() {
    const game = window.__WEBRPG_GAME__;
    if (!game) return;
    configureAudioSession();
    if (paused) {
      game.loop?.sleep();
      game.sound?.pauseAll();
      return;
    }
    game.loop?.wake();
    game.sound?.resumeAll();
    if (audioWasUnlocked && game.sound?.context?.state !== 'running') {
      game.sound.context.resume().then(syncAudioState, syncAudioState);
    }
    game.scale?.refresh();
    syncAudioState();
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
  window.addEventListener('pageshow', () => {
    syncPlayback();
    syncAudioState();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncPlayback();
  });

  window.addEventListener('error', (event) => {
    if (ready) return;
    post('error', { message: event.message || 'The game failed to start.' });
  });

  const readyPoll = window.setInterval(() => {
    const game = window.__WEBRPG_GAME__;
    if (!game) return;
    syncPlayback();
    syncAudioState();
    if (!game.scene?.isActive?.('menu')) return;
    ready = true;
    lastProgress = 1;
    post('loading', { progress: 1 });
    post('ready');
    window.clearInterval(readyPoll);
  }, 80);
})();
