(() => {
  const GAME_SOURCE = 'rpg-dreamer-game';
  const HOST_SOURCE = 'rpg-dreamer-host';
  let ready = false;
  let paused = false;
  let completedResources = 0;
  let lastProgress = 0;
  let audioGate = null;
  let audioUnlockPromise = null;
  let audioWasUnlocked = false;
  let lastPostedAudioState = '';
  const hasTouchInput = navigator.maxTouchPoints > 0
    || window.matchMedia?.('(pointer: coarse)').matches;
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

  function setAudioGateVisible(visible) {
    if (!audioGate) return;
    audioGate.hidden = !visible;
    audioGate.setAttribute('aria-hidden', String(!visible));
  }

  function syncAudioGate() {
    const state = getAudioState();
    postAudioState(state);
    if (!hasTouchInput || state === 'pending') return;
    if (state === 'running') {
      audioWasUnlocked = true;
      setAudioGateVisible(false);
      return;
    }
    setAudioGateVisible(true);
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
      setAudioGateVisible(false);
      postAudioState('running');
      return true;
    }
    const contextRunning = !sound.context || sound.context.state === 'running';
    if (!contextRunning) return false;
    // Phaser clears `locked` and flushes queued sounds on the next update after
    // `unlocked` is set. This preserves its normal sound-manager lifecycle.
    if (sound.locked) sound.unlocked = true;
    audioWasUnlocked = true;
    setAudioGateVisible(false);
    postAudioState('running');
    return true;
  }

  function unlockAudioFromGesture() {
    if (audioUnlockPromise) return audioUnlockPromise;
    const sound = getSoundManager();
    if (!sound) {
      syncAudioGate();
      return Promise.resolve(false);
    }

    audioGate?.classList.add('is-unlocking');
    const context = sound.context;
    if (!context) {
      // HTML5AudioSoundManager's own body-level touch handler receives this
      // same gesture. Check its result after the event has completed.
      audioUnlockPromise = new Promise((resolve) => {
        window.setTimeout(() => resolve(finishAudioUnlock(sound)), 80);
      });
    } else {
      // resume() must be called synchronously from this iframe-local gesture.
      // A parent-page click delivered through postMessage is not sufficient on
      // iOS Safari because transient user activation does not cross origins.
      primeAudioContext(context);
      try {
        audioUnlockPromise = Promise.resolve(context.resume())
          .then(() => finishAudioUnlock(sound))
          .catch(() => false);
      } catch {
        audioUnlockPromise = Promise.resolve(false);
      }
    }

    return audioUnlockPromise.finally(() => {
      audioUnlockPromise = null;
      audioGate?.classList.remove('is-unlocking');
      syncAudioGate();
    });
  }

  function createAudioGate() {
    if (!hasTouchInput || audioGate || !document.body) return;
    const language = `${document.documentElement.lang} ${navigator.language}`.toLowerCase();
    const isChinese = language.includes('zh');
    const style = document.createElement('style');
    style.textContent = `
      #rpg-audio-gate {
        position: fixed;
        z-index: 2147483647;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        border: 0;
        background: rgba(1, 7, 12, 0.54);
        color: #f4fbff;
        font: 700 clamp(15px, 3.5vw, 20px)/1.2 system-ui, -apple-system, sans-serif;
        letter-spacing: 0.02em;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      #rpg-audio-gate[hidden] { display: none; }
      #rpg-audio-gate span {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 0 20px;
        border: 1px solid rgba(145, 220, 255, 0.72);
        border-radius: 999px;
        background: rgba(5, 18, 29, 0.9);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38), inset 0 1px rgba(255, 255, 255, 0.12);
      }
      #rpg-audio-gate.is-unlocking span { opacity: 0.68; }
    `;
    audioGate = document.createElement('button');
    audioGate.id = 'rpg-audio-gate';
    audioGate.type = 'button';
    audioGate.hidden = true;
    audioGate.setAttribute('aria-label', isChinese ? '点击开启声音' : 'Tap to enable sound');
    audioGate.innerHTML = `<span aria-hidden="true">🔊 ${isChinese ? '点击开启声音' : 'Tap to enable sound'}</span>`;
    audioGate.addEventListener('pointerdown', unlockAudioFromGesture);
    audioGate.addEventListener('click', unlockAudioFromGesture);
    document.head.appendChild(style);
    document.body.appendChild(audioGate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createAudioGate, { once: true });
  } else {
    createAudioGate();
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
    if (audioWasUnlocked && game.sound?.context?.state !== 'running') {
      game.sound.context.resume().then(syncAudioGate, syncAudioGate);
    }
    game.scale?.refresh();
    syncAudioGate();
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
    syncAudioGate();
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
    syncAudioGate();
    if (!game.scene?.isActive?.('menu')) return;
    ready = true;
    lastProgress = 1;
    post('loading', { progress: 1 });
    post('ready');
    window.clearInterval(readyPoll);
  }, 80);
})();
