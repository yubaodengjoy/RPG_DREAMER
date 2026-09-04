// RPG Dreamer — five independently cached, explicitly loaded playable worlds.
(() => {
  const root = document.getElementById('rpg-play-demo');
  if (!root) return;

  function configureGameAudioSession() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // The Audio Session API is available only on newer Safari releases.
    }
  }

  configureGameAudioSession();

  const hostname = window.location.hostname;
  const isLocalHost = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  const gameAssetBase = isLocalHost
    ? new URL('./', document.baseURI).href
    : 'https://pub-f92b6274842f4c76bae0e87541458375.r2.dev/rpg-dreamer/';

  const games = {
    'world-40': {
      title: '武松·最后一虎',
      meta: 'Long-horizon generated RPG · Chinese',
      src: `${gameAssetBase}src-40/src/dist/index.html?v=20260904-scene-warmup-03`,
      poster: `${gameAssetBase}src-40/src/dist/cover.webp`,
      copy: 'Follow Wu Song beyond the familiar legend and into a final hunt where every trail conceals a harder choice. Explore a dangerous mountain world shaped by duty, survival, and the mystery of the last tiger.',
    },
    'magic-brush': {
      title: '神笔：移命录',
      meta: 'Long-horizon generated RPG · Chinese',
      src: `${gameAssetBase}src-41/src/dist/index.html?v=20260904-scene-warmup-03`,
      poster: `${gameAssetBase}src-41/src/dist/cover.webp`,
      copy: 'Join Ma Liang on a four-chapter journey through a world transformed by the power of a magic brush. Every miracle transfers its hidden cost to someone else, turning each act of creation into a difficult moral choice.',
    },
    'world-42': {
      title: 'Pinocchio: The City That Swallows Truth',
      meta: 'Long-horizon generated RPG · English',
      src: `${gameAssetBase}src-42/src/dist/index.html?v=20260904-scene-warmup-03`,
      poster: `${gameAssetBase}src-42/src/dist/cover.webp`,
      copy: 'Enter a city that consumes truth and rewrites the identities of everyone who lives within its walls. Investigate its shifting districts, confront manufactured memories, and decide what it means to remain real.',
    },
    'vanishing-emperor': {
      title: 'The Vanishing Emperor',
      meta: 'Long-horizon generated RPG · English',
      src: `${gameAssetBase}src-43/src/dist/index.html?v=20260904-scene-warmup-03`,
      poster: `${gameAssetBase}src-43/src/dist/cover.webp`,
      copy: 'Investigate the kingdom of Valdris after its emperor vanishes without explanation, leaving an empty crown and a disputed voice. Follow competing accounts, uncover concealed loyalties, and determine which truth the kingdom will inherit.',
    },
    'journey-west': {
      title: '西游·女儿国情劫',
      meta: 'Long-horizon generated RPG · Chinese',
      src: `${gameAssetBase}src-44/src/dist/index.html?v=20260904-scene-warmup-03`,
      poster: `${gameAssetBase}src-44/src/dist/assets/main-menu-TS6JUrUr.png`,
      copy: 'Accompany Sun Wukong as he escorts Tang Sanzang through the Kingdom of Women, the western road, and the Blackwater River. Explore diverse locations, complete side quests, and make pivotal choices that confront mortal desire, attachment, duty, and farewell.',
    },
  };
  const standbyPoster = '../rpg-dreamer-top-hero-poster.webp';

  const states = Object.fromEntries(
    Object.keys(games).map((id) => [id, {
      frame: null,
      progress: 0,
      progressLabel: 'Reading world cartridge…',
      ready: false,
      readyPending: false,
      status: 'Standby',
      timer: 0,
      readyTimer: 0,
      startedAt: 0,
    }]),
  );

  const stage = root.querySelector('[data-rpg-screen]');
  const device = root.querySelector('.rpg-handheld-player');
  const placeholder = root.querySelector('[data-rpg-placeholder]');
  const progress = root.querySelector('[data-rpg-progress]');
  const progressBar = root.querySelector('[data-rpg-progress-bar]');
  const progressLabel = root.querySelector('[data-rpg-progress-label]');
  const progressTitle = root.querySelector('[data-rpg-progress-title]');
  const placeholderTitle = root.querySelector('[data-rpg-placeholder-title]');
  const placeholderCopy = root.querySelector('[data-rpg-placeholder-copy]');
  const loadButton = root.querySelector('[data-rpg-load]');
  const openControlsButton = root.querySelector('[data-rpg-open-controls]');
  const closeControlsButton = root.querySelector('[data-rpg-close-controls]');
  const controlsPage = root.querySelector('[data-rpg-controls-page]');
  const enterFullscreen = root.querySelector('[data-rpg-enter-fullscreen]');
  const exitFullscreen = root.querySelector('[data-rpg-exit-fullscreen]');
  const virtualToggle = root.querySelector('[data-rpg-virtual-toggle]');
  const virtualControls = root.querySelector('[data-rpg-virtual-controls]');
  const virtualPanels = [...root.querySelectorAll('[data-rpg-virtual-panel]')];
  const virtualKeys = [...root.querySelectorAll('[data-rpg-virtual-key]')];
  const compilerLines = [...root.querySelectorAll('.rpg-compiler-log span')];
  const cartridgeLabels = [...root.querySelectorAll('[data-rpg-cartridge-label]')];
  const insertedCartridge = root.querySelector('[data-rpg-eject]');
  const power = root.querySelector('[data-rpg-power]');
  const powerOffButton = root.querySelector('[data-rpg-power-off]');
  const powerToggleButton = root.querySelector('[data-rpg-power-toggle]');
  const powerOnButton = root.querySelector('[data-rpg-power-on]');
  // Disabled cartridges remain listed and stored on R2, but are excluded from
  // all selection and launch behavior until they are re-enabled.
  const choices = [...root.querySelectorAll('[data-rpg-game]:not(:disabled)')];
  choices.forEach((choice) => {
    const game = games[choice.dataset.rpgGame];
    const cover = choice.querySelector('.rpg-demo-choice-cover');
    if (game && cover) cover.style.setProperty('--rpg-card-cover', `url("${game.poster}")`);
  });
  const cartridgeStrip = root.querySelector('.rpg-demo-switcher');
  const cartridgeScrollButtons = [...root.querySelectorAll('[data-rpg-scroll]')];
  let activeId = choices[0]?.dataset.rpgGame || Object.keys(games)[0];
  let hasCartridge = false;
  let poweredOn = false;
  let cartridgeMoving = false;
  let fallbackFullscreen = false;
  let fallbackMount = null;
  let controlsOpen = false;
  let virtualControlsEnabled = false;
  let virtualToggleDrag = null;
  let suppressVirtualToggleClick = false;
  const virtualPointers = new Map();
  const virtualPanelPositions = loadVirtualPanelPositions();

  function activeState() {
    return states[activeId];
  }

  function setProgress(value, label) {
    const normalized = Math.max(0, Math.min(1, Number(value) || 0));
    progressBar.style.width = `${Math.max(4, Math.round(normalized * 100))}%`;
    progressLabel.textContent = label || `Loading ${Math.round(normalized * 100)}%`;
    const compilerStep = normalized >= 1 ? compilerLines.length : Math.min(compilerLines.length - 1, Math.floor(normalized * compilerLines.length));
    progress.dataset.compilerStep = String(compilerStep);
    compilerLines.forEach((line, index) => {
      const state = index < compilerStep ? 'done' : index === compilerStep ? 'running' : 'waiting';
      line.dataset.state = state;
      const marker = line.querySelector('i');
      if (marker) marker.textContent = state === 'done' ? 'OK' : state === 'running' ? 'RUN' : 'WAIT';
    });
  }

  function sendToGame(id, type, detail = {}) {
    states[id]?.frame?.contentWindow?.postMessage(
      { source: 'rpg-dreamer-host', type, ...detail },
      new URL(games[id].src).origin,
    );
  }

  function openControlsPage() {
    if (!controlsPage || controlsOpen) return;
    setVirtualControls(false);
    controlsOpen = true;
    controlsPage.hidden = false;
    root.classList.add('is-controls-open');
    openControlsButton?.setAttribute('aria-expanded', 'true');
    if (hasCartridge && poweredOn && activeState().ready) sendToGame(activeId, 'pause');
    enterFullscreen.disabled = true;
    window.requestAnimationFrame(() => closeControlsButton?.focus());
  }

  function closeControlsPage({ restoreFocus = true, resume = true } = {}) {
    if (!controlsPage || !controlsOpen) return;
    controlsOpen = false;
    controlsPage.hidden = true;
    root.classList.remove('is-controls-open');
    openControlsButton?.setAttribute('aria-expanded', 'false');
    enterFullscreen.disabled = !hasCartridge || !poweredOn || !activeState().ready;
    if (resume && hasCartridge && poweredOn && activeState().ready && !document.hidden) {
      sendToGame(activeId, 'resume');
    }
    if (restoreFocus) openControlsButton?.focus();
  }

  function syncChoiceState() {
    choices.forEach((choice) => {
      const id = choice.dataset.rpgGame;
      const selected = hasCartridge && id === activeId;
      choice.classList.toggle('is-active', selected);
      choice.setAttribute('aria-pressed', String(selected));
      choice.dataset.state = states[id].ready ? 'ready' : states[id].frame ? 'loading' : 'idle';
    });
  }

  function syncActiveUi() {
    const game = games[activeId];
    const state = activeState();
    root.classList.toggle('has-cartridge', hasCartridge);
    root.classList.toggle('is-powered-on', hasCartridge && poweredOn);
    root.classList.toggle('is-booting', hasCartridge && poweredOn && Boolean(state.frame) && !state.ready);
    root.classList.toggle('is-playing', hasCartridge && poweredOn && state.ready);
    root.style.setProperty(
      '--rpg-demo-poster',
      `url("${hasCartridge ? game.poster : standbyPoster}")`,
    );
    cartridgeLabels.forEach((label) => { label.textContent = hasCartridge ? game.title : 'NO CARTRIDGE'; });
    if (insertedCartridge) {
      insertedCartridge.disabled = !hasCartridge || cartridgeMoving;
      insertedCartridge.setAttribute('aria-label', hasCartridge ? `Eject ${game.title}` : 'No cartridge inserted');
    }
    power?.classList.toggle('is-on', hasCartridge && poweredOn);
    if (powerOffButton) {
      powerOffButton.disabled = !hasCartridge || !poweredOn || cartridgeMoving;
      powerOffButton.setAttribute('aria-pressed', String(!poweredOn));
    }
    if (powerToggleButton) {
      powerToggleButton.disabled = !hasCartridge || cartridgeMoving;
      powerToggleButton.setAttribute('aria-pressed', String(poweredOn));
      powerToggleButton.setAttribute('aria-label', poweredOn ? 'Turn console off' : 'Turn console on');
    }
    if (powerOnButton) {
      powerOnButton.disabled = !hasCartridge || poweredOn || cartridgeMoving;
      powerOnButton.setAttribute('aria-pressed', String(poweredOn));
    }

    if (!hasCartridge) {
      placeholderTitle.textContent = 'INSERT CARTRIDGE';
      placeholderCopy.textContent = 'Choose one of the playable world cartridges from the library below.';
      placeholder.hidden = false;
      progress.hidden = true;
      loadButton.disabled = true;
      enterFullscreen.disabled = true;
      Object.entries(states).forEach(([id, item]) => {
        if (!item.frame) return;
        item.frame.hidden = true;
        item.frame.style.visibility = 'hidden';
        item.frame.setAttribute('aria-hidden', 'true');
        sendToGame(id, 'pause');
      });
      syncChoiceState();
      return;
    }

    placeholderTitle.textContent = game.title;
    placeholderCopy.textContent = game.copy;
    progressTitle.textContent = `Booting ${game.title}`;
    setProgress(state.progress, state.progressLabel);

    Object.entries(states).forEach(([id, item]) => {
      if (!item.frame) return;
      const selected = id === activeId && poweredOn;
      item.frame.hidden = !selected;
      // Keep the selected iframe renderable while the compiler panel covers it.
      // Chromium heavily throttles cross-origin frames with visibility:hidden,
      // which can otherwise stall Phaser's boot scene before it becomes ready.
      item.frame.style.visibility = selected ? 'visible' : 'hidden';
      item.frame.setAttribute('aria-hidden', String(!selected));
      sendToGame(id, selected && !document.hidden && !controlsOpen ? 'resume' : 'pause');
      if (selected) window.requestAnimationFrame(() => sendToGame(id, 'resize'));
    });

    placeholder.hidden = poweredOn && Boolean(state.frame);
    progress.hidden = !poweredOn || !state.frame || state.ready;
    enterFullscreen.disabled = controlsOpen || !poweredOn || !state.ready;
    loadButton.disabled = !hasCartridge || poweredOn;
    syncChoiceState();
  }

  async function animateCartridge(choice, game) {
    const target = root.querySelector('.rpg-handheld-cartridge');
    const handheldBody = root.querySelector('.rpg-handheld-body');
    if (!target || reducedMotion.matches || typeof choice.animate !== 'function') return;

    const start = choice.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const bodyBounds = handheldBody?.getBoundingClientRect() || end;
    const pageLeft = window.scrollX;
    const pageTop = window.scrollY;
    const startLeft = start.left + pageLeft;
    const startTop = start.top + pageTop;
    const endLeft = end.left + pageLeft;
    const endTop = end.top + pageTop;
    const startCenter = start.left + start.width / 2;
    const bodyCenter = bodyBounds.left + bodyBounds.width / 2;
    const travelSide = startCenter <= bodyCenter ? -1 : 1;
    const corridorWidth = Math.max(42, Math.min(76, end.width * 0.5));
    const corridorHeight = corridorWidth * (end.height / end.width);
    const viewportInset = 4;
    const corridorLeftInViewport = travelSide < 0
      ? Math.max(viewportInset, bodyBounds.left - corridorWidth + 8)
      : Math.min(window.innerWidth - corridorWidth - viewportInset, bodyBounds.right - 8);
    const corridorLeft = corridorLeftInViewport + pageLeft;
    const liftTop = Math.min(start.top - 22, bodyBounds.bottom + 24) + pageTop;
    const sideEntryTop = bodyBounds.bottom + 8 + pageTop;
    const sideExitTop = bodyBounds.top - corridorHeight - 16 + pageTop;
    const preInsertTop = endTop - 28;
    const travelTilt = travelSide < 0 ? '-2deg' : '2deg';
    const flight = document.createElement('div');
    flight.className = 'rpg-cartridge-flight';
    const flightCover = document.createElement('span');
    flightCover.className = 'rpg-cartridge-flight-cover';
    const flightLabel = document.createElement('span');
    flightLabel.className = 'rpg-cartridge-flight-label';
    flightLabel.textContent = game.title;
    flight.appendChild(flightCover);
    flight.appendChild(flightLabel);
    Object.assign(flight.style, {
      left: `${startLeft}px`,
      top: `${startTop}px`,
      width: `${start.width}px`,
      height: `${start.height}px`,
    });
    document.body.appendChild(flight);
    const cover = choice.querySelector('.rpg-demo-choice-cover');
    if (cover) flightCover.style.backgroundImage = getComputedStyle(cover).backgroundImage;
    root.classList.add('is-cartridge-moving');
    choice.classList.add('is-launching');

    try {
      const motion = flight.animate([
        {
          left: `${startLeft}px`, top: `${startTop}px`,
          width: `${start.width}px`, height: `${start.height}px`,
          transform: 'rotate(0deg)', offset: 0,
          easing: 'cubic-bezier(.22,.72,.28,1)',
        },
        {
          left: `${startLeft}px`, top: `${liftTop}px`,
          width: `${start.width}px`, height: `${start.height}px`,
          transform: `rotate(${travelTilt})`, offset: 0.14,
          easing: 'cubic-bezier(.4,0,.2,1)',
        },
        {
          left: `${corridorLeft}px`, top: `${sideEntryTop}px`,
          width: `${corridorWidth}px`, height: `${corridorHeight}px`,
          transform: `rotate(${travelTilt})`, offset: 0.34,
          easing: 'cubic-bezier(.4,0,.2,1)',
        },
        {
          left: `${corridorLeft}px`, top: `${sideExitTop}px`,
          width: `${corridorWidth}px`, height: `${corridorHeight}px`,
          transform: `rotate(${travelTilt})`, offset: 0.68,
          easing: 'cubic-bezier(.2,.7,.2,1)',
        },
        {
          left: `${endLeft}px`, top: `${preInsertTop}px`,
          width: `${end.width}px`, height: `${end.height}px`,
          transform: 'rotate(0deg)', offset: 0.88,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        },
        {
          left: `${endLeft}px`, top: `${endTop}px`,
          width: `${end.width}px`, height: `${end.height}px`,
          transform: 'rotate(0deg)', offset: 1,
        },
      ], {
        duration: 1120,
        easing: 'linear',
        fill: 'forwards',
      });
      await motion.finished;
    } finally {
      flight.remove();
      root.classList.remove('is-cartridge-moving');
      choice.classList.remove('is-launching');
    }
  }

  async function revealCartridgePath() {
    const handheldBody = root.querySelector('.rpg-handheld-body');
    const cartridgeBrowser = root.querySelector('.rpg-cartridge-browser');
    if (!handheldBody || !cartridgeBrowser) return;

    const bodyBounds = handheldBody.getBoundingClientRect();
    const browserBounds = cartridgeBrowser.getBoundingClientRect();
    const topSafety = Math.min(84, window.innerHeight * 0.12);
    const bottomSafety = 20;
    const pathTop = bodyBounds.top - 84;
    const pathBottom = browserBounds.bottom;
    if (pathTop >= topSafety && pathBottom <= window.innerHeight - bottomSafety) return;

    const availableHeight = window.innerHeight - topSafety - bottomSafety;
    const pathHeight = pathBottom - pathTop;
    const desiredTop = topSafety + Math.max(0, (availableHeight - pathHeight) / 2);
    const destination = Math.max(0, window.scrollY + pathTop - desiredTop);
    window.scrollTo({
      top: destination,
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
    });
    if (!reducedMotion.matches) {
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      window.scrollTo({ top: destination, behavior: 'auto' });
    }
  }

  async function selectGame(id, choice) {
    if (!games[id] || cartridgeMoving || hasCartridge) return;
    cartridgeMoving = true;
    loadButton.disabled = true;
    await revealCartridgePath();
    await animateCartridge(choice, games[id]);
    activeId = id;
    hasCartridge = true;
    poweredOn = false;
    const state = activeState();
    if (!state.frame) state.status = 'Cartridge ready';
    cartridgeMoving = false;
    syncActiveUi();

    const bounds = device?.getBoundingClientRect();
    if (bounds && (bounds.top < 76 || bounds.bottom > window.innerHeight)) {
      device.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
    }
  }

  async function animateCartridgeEject() {
    if (!insertedCartridge || reducedMotion.matches || typeof insertedCartridge.animate !== 'function') return;
    insertedCartridge.getAnimations().forEach((animation) => animation.cancel());
    const from = getComputedStyle(insertedCartridge).transform;
    const motion = insertedCartridge.animate([
      { opacity: 1, transform: from },
      { opacity: 1, transform: 'translate(-50%, -54px)', offset: 0.62 },
      { opacity: 0, transform: 'translate(-50%, -104px)' },
    ], {
      duration: 520,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    });
    try {
      await motion.finished;
    } finally {
      motion.cancel();
    }
  }

  async function ejectCartridge() {
    if (!hasCartridge || cartridgeMoving) return;
    closeControlsPage({ restoreFocus: false, resume: false });
    cartridgeMoving = true;
    poweredOn = false;
    sendToGame(activeId, 'pause');
    root.classList.add('is-ejecting');
    syncActiveUi();
    await animateCartridgeEject();
    hasCartridge = false;
    root.classList.remove('is-ejecting');
    cartridgeMoving = false;
    syncActiveUi();
  }

  function resetGameFrame(id) {
    const state = states[id];
    if (!state) return;
    window.clearTimeout(state.timer);
    window.clearTimeout(state.readyTimer);
    state.frame?.remove();
    state.frame = null;
    state.progress = 0;
    state.progressLabel = 'Reading world cartridge…';
    state.ready = false;
    state.readyPending = false;
    state.status = 'Standby';
    state.timer = 0;
    state.readyTimer = 0;
    state.startedAt = 0;
  }

  async function returnToLibrary(id) {
    if (id !== activeId || cartridgeMoving) return;
    if (document.fullscreenElement || fallbackFullscreen) {
      await exitGameFullscreen();
    }
    await ejectCartridge();
    resetGameFrame(id);
    syncActiveUi();
  }

  function loadGame() {
    if (!hasCartridge || poweredOn || cartridgeMoving) return;
    configureGameAudioSession();
    closeControlsPage({ restoreFocus: false, resume: false });
    const game = games[activeId];
    const state = activeState();
    poweredOn = true;
    if (state.frame) {
      state.status = state.ready ? 'Ready' : 'Booting';
      syncActiveUi();
      return;
    }

    state.status = 'Booting';
    state.progress = 0.02;
    state.progressLabel = 'Reading world cartridge…';
    state.startedAt = performance.now();

    const frame = document.createElement('iframe');
    frame.className = 'rpg-demo-iframe';
    frame.title = `${game.title} playable RPG demo`;
    frame.loading = 'eager';
    frame.allow = 'fullscreen; autoplay';
    frame.setAttribute('allowfullscreen', '');
    frame.sandbox = 'allow-scripts allow-same-origin';
    const hostOrigin = encodeURIComponent(window.location.origin);
    frame.src = `${game.src}#rpg-host-origin=${hostOrigin}`;
    frame.dataset.gameId = activeId;
    frame.addEventListener('load', () => {
      state.progress = Math.max(state.progress, 0.08);
      state.progressLabel = 'Binding RPG runtime…';
      if (activeId === frame.dataset.gameId) syncActiveUi();
    });
    state.frame = frame;
    stage.appendChild(frame);

    state.timer = window.setTimeout(() => {
      if (state.ready) return;
      state.status = 'Still booting';
      state.progressLabel = 'Compiling this world may take a little longer…';
      if (activeState() === state) syncActiveUi();
    }, 30000);
    syncActiveUi();
  }

  function powerOffGame() {
    if (!hasCartridge || !poweredOn || cartridgeMoving) return;
    closeControlsPage({ restoreFocus: false, resume: false });
    poweredOn = false;
    releaseVirtualKeys();
    sendToGame(activeId, 'pause');
    syncActiveUi();
  }

  function togglePower() {
    if (poweredOn) powerOffGame();
    else loadGame();
  }

  function markReady(id) {
    const state = states[id];
    if (state.ready || state.readyPending) return;
    state.readyPending = true;
    state.status = 'Compiling';
    state.progress = Math.max(state.progress, 0.92);
    state.progressLabel = 'Opening chapter 01…';
    if (id === activeId) syncActiveUi();

    const finish = () => {
      state.readyPending = false;
      state.ready = true;
      state.status = 'Ready';
      state.progress = 1;
      window.clearTimeout(state.timer);
      if (hasCartridge && poweredOn && id === activeId) {
        syncActiveUi();
        state.frame?.focus();
      } else {
        sendToGame(id, 'pause');
        syncChoiceState();
      }
    };

    const minimumCompilerTime = 2200;
    const delay = Math.max(0, minimumCompilerTime - (performance.now() - state.startedAt));
    state.readyTimer = window.setTimeout(finish, delay);
  }

  function loadVirtualPanelPositions() {
    try {
      const saved = JSON.parse(window.localStorage.getItem('rpg-dreamer-virtual-controls-v1') || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  function saveVirtualPanelPositions() {
    try {
      window.localStorage.setItem('rpg-dreamer-virtual-controls-v1', JSON.stringify(virtualPanelPositions));
    } catch {
      // Private browsing or a locked-down browser may disallow local storage.
    }
  }

  function isGameFullscreen() {
    return document.fullscreenElement === root || fallbackFullscreen;
  }

  function releaseVirtualKeys() {
    virtualPointers.clear();
    virtualKeys.forEach((button) => button.classList.remove('is-pressed'));
    if (hasCartridge && poweredOn && activeState().frame) {
      sendToGame(activeId, 'virtual-keys-release');
    }
  }

  function placeVirtualPanels() {
    if (!virtualControls || virtualControls.hidden) return;
    const bounds = virtualControls.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    virtualPanels.forEach((panel) => {
      const id = panel.dataset.rpgVirtualPanel;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const maxX = Math.max(8, bounds.width - width - 8);
      const maxY = Math.max(8, bounds.height - height - 8);
      const saved = virtualPanelPositions[id];
      const hasSavedPosition = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
      const defaultX = id === 'action' ? maxX : 14;
      const defaultY = Math.max(8, bounds.height - height - 18);
      const x = hasSavedPosition ? 8 + saved.x * Math.max(0, maxX - 8) : defaultX;
      const y = hasSavedPosition ? 8 + saved.y * Math.max(0, maxY - 8) : defaultY;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${Math.max(8, Math.min(maxX, x))}px`;
      panel.style.top = `${Math.max(8, Math.min(maxY, y))}px`;
    });
  }

  function placeVirtualToggle() {
    if (!virtualToggle || virtualToggle.hidden || !isGameFullscreen()) return;
    const bounds = root.getBoundingClientRect();
    const width = virtualToggle.offsetWidth;
    const height = virtualToggle.offsetHeight;
    if (!bounds.width || !bounds.height || !width || !height) return;

    const minX = 8;
    const minY = 8;
    const maxX = Math.max(minX, bounds.width - width - 8);
    const maxY = Math.max(minY, bounds.height - height - 8);
    const saved = virtualPanelPositions.toggle;
    const hasSavedPosition = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
    const x = hasSavedPosition
      ? minX + saved.x * Math.max(0, maxX - minX)
      : (bounds.width - width) / 2;
    const y = hasSavedPosition
      ? minY + saved.y * Math.max(0, maxY - minY)
      : maxY - 4;

    virtualToggle.style.right = 'auto';
    virtualToggle.style.bottom = 'auto';
    virtualToggle.style.translate = 'none';
    virtualToggle.style.left = `${Math.max(minX, Math.min(maxX, x))}px`;
    virtualToggle.style.top = `${Math.max(minY, Math.min(maxY, y))}px`;
  }

  function setVirtualControls(enabled) {
    virtualControlsEnabled = Boolean(enabled && isGameFullscreen());
    if (virtualToggle) {
      virtualToggle.setAttribute('aria-pressed', String(virtualControlsEnabled));
      virtualToggle.title = virtualControlsEnabled ? 'Hide virtual buttons' : 'Show virtual buttons';
    }
    root.classList.toggle('has-virtual-controls', virtualControlsEnabled);
    if (virtualControls) virtualControls.hidden = !virtualControlsEnabled;
    if (virtualControlsEnabled) window.requestAnimationFrame(placeVirtualPanels);
    else releaseVirtualKeys();
  }

  function enterFallbackFullscreen() {
    if (fallbackFullscreen) return;
    const parent = root.parentNode;
    const host = root.closest('#demos') || document.body;
    const placeholder = document.createElement('div');
    const bounds = root.getBoundingClientRect();
    placeholder.className = 'rpg-demo-fullscreen-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.height = `${bounds.height}px`;
    parent.insertBefore(placeholder, root);
    fallbackMount = {
      parent,
      placeholder,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    host.appendChild(root);
    fallbackFullscreen = true;
    root.classList.add('is-fallback-fullscreen');
    document.documentElement.classList.add('rpg-demo-fullscreen-fallback');
    document.body.classList.add('rpg-demo-fullscreen-fallback');
    syncFullscreenUi();
  }

  async function requestGameFullscreen() {
    if (!hasCartridge || !poweredOn || !activeState().ready) return;
    if (root.requestFullscreen) {
      try {
        await root.requestFullscreen();
        return;
      } catch {
        enterFallbackFullscreen();
        return;
      }
    }
    enterFallbackFullscreen();
  }

  async function exitGameFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    fallbackFullscreen = false;
    root.classList.remove('is-fallback-fullscreen');
    document.documentElement.classList.remove('rpg-demo-fullscreen-fallback');
    document.body.classList.remove('rpg-demo-fullscreen-fallback');
    if (fallbackMount) {
      const { parent, placeholder, scrollX, scrollY } = fallbackMount;
      if (parent && placeholder.parentNode === parent) {
        parent.insertBefore(root, placeholder);
        placeholder.remove();
      }
      fallbackMount = null;
      window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
    }
    syncFullscreenUi();
  }

  function syncFullscreenUi() {
    const active = document.fullscreenElement === root || fallbackFullscreen;
    enterFullscreen.hidden = active;
    exitFullscreen.hidden = !active;
    if (virtualToggle) virtualToggle.hidden = !active;
    if (!active) setVirtualControls(false);
    window.requestAnimationFrame(() => {
      placeVirtualToggle();
      sendToGame(activeId, 'resize');
      window.requestAnimationFrame(() => sendToGame(activeId, 'resize'));
    });
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function syncCartridgeScrollButtons() {
    if (!cartridgeStrip) return;
    const end = cartridgeStrip.scrollWidth - cartridgeStrip.clientWidth;
    cartridgeScrollButtons.forEach((button) => {
      const direction = Number(button.dataset.rpgScroll);
      button.disabled = direction < 0 ? cartridgeStrip.scrollLeft <= 2 : cartridgeStrip.scrollLeft >= end - 2;
    });
  }

  cartridgeScrollButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!cartridgeStrip) return;
      cartridgeStrip.scrollBy({
        left: Number(button.dataset.rpgScroll) * Math.max(180, cartridgeStrip.clientWidth * 0.72),
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
      });
    });
  });
  cartridgeStrip?.addEventListener('scroll', syncCartridgeScrollButtons, { passive: true });
  new ResizeObserver(syncCartridgeScrollButtons).observe(cartridgeStrip);
  new ResizeObserver(() => {
    if (!hasCartridge || !poweredOn || !activeState().frame) return;
    window.requestAnimationFrame(() => sendToGame(activeId, 'resize'));
  }).observe(stage);

  const virtualKeyMap = {
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
  };

  function sendVirtualKey(code, phase) {
    const key = virtualKeyMap[code];
    if (!key || !hasCartridge || !poweredOn || !activeState().frame) return;
    sendToGame(activeId, 'virtual-key', { phase, ...key });
  }

  function releaseVirtualPointer(event) {
    const pressed = virtualPointers.get(event.pointerId);
    if (!pressed) return;
    event.preventDefault();
    event.stopPropagation();
    virtualPointers.delete(event.pointerId);
    pressed.button.classList.remove('is-pressed');
    sendVirtualKey(pressed.code, 'up');
  }

  virtualKeys.forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      if (!virtualControlsEnabled || !isGameFullscreen()) return;
      event.preventDefault();
      event.stopPropagation();
      const code = button.dataset.rpgVirtualKey;
      if (!virtualKeyMap[code]) return;
      try { button.setPointerCapture(event.pointerId); } catch {}
      virtualPointers.set(event.pointerId, { button, code });
      button.classList.add('is-pressed');
      sendVirtualKey(code, 'down');
    });
    button.addEventListener('pointerup', releaseVirtualPointer);
    button.addEventListener('pointercancel', releaseVirtualPointer);
    button.addEventListener('lostpointercapture', releaseVirtualPointer);
    button.addEventListener('click', (event) => {
      if (event.detail !== 0 || !virtualControlsEnabled || !isGameFullscreen()) return;
      const code = button.dataset.rpgVirtualKey;
      sendVirtualKey(code, 'down');
      window.setTimeout(() => sendVirtualKey(code, 'up'), 80);
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  root.querySelectorAll('[data-rpg-virtual-drag]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      if (!virtualControlsEnabled || !virtualControls) return;
      event.preventDefault();
      event.stopPropagation();
      const panel = handle.closest('[data-rpg-virtual-panel]');
      const controlsBounds = virtualControls.getBoundingClientRect();
      const panelBounds = panel.getBoundingClientRect();
      const offsetX = event.clientX - panelBounds.left;
      const offsetY = event.clientY - panelBounds.top;
      panel.classList.add('is-dragging');
      try { handle.setPointerCapture(event.pointerId); } catch {}

      const move = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        moveEvent.preventDefault();
        const maxX = Math.max(8, controlsBounds.width - panel.offsetWidth - 8);
        const maxY = Math.max(8, controlsBounds.height - panel.offsetHeight - 8);
        const x = Math.max(8, Math.min(maxX, moveEvent.clientX - controlsBounds.left - offsetX));
        const y = Math.max(8, Math.min(maxY, moveEvent.clientY - controlsBounds.top - offsetY));
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };

      const finish = (finishEvent) => {
        if (finishEvent.pointerId !== event.pointerId) return;
        panel.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        const maxX = Math.max(8, controlsBounds.width - panel.offsetWidth - 8);
        const maxY = Math.max(8, controlsBounds.height - panel.offsetHeight - 8);
        const x = parseFloat(panel.style.left) || 8;
        const y = parseFloat(panel.style.top) || 8;
        virtualPanelPositions[panel.dataset.rpgVirtualPanel] = {
          x: maxX > 8 ? (x - 8) / (maxX - 8) : 0,
          y: maxY > 8 ? (y - 8) / (maxY - 8) : 0,
        };
        saveVirtualPanelPositions();
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
    });
    handle.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  virtualToggle?.addEventListener('pointerdown', (event) => {
    if (!isGameFullscreen()) return;
    const rootBounds = root.getBoundingClientRect();
    const toggleBounds = virtualToggle.getBoundingClientRect();
    virtualToggleDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: toggleBounds.left - rootBounds.left,
      startTop: toggleBounds.top - rootBounds.top,
      rootBounds,
      moved: false,
    };
    try { virtualToggle.setPointerCapture(event.pointerId); } catch {}
  });

  virtualToggle?.addEventListener('pointermove', (event) => {
    const drag = virtualToggleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.moved = true;
    event.preventDefault();
    const minX = 8;
    const minY = 8;
    const maxX = Math.max(minX, drag.rootBounds.width - virtualToggle.offsetWidth - 8);
    const maxY = Math.max(minY, drag.rootBounds.height - virtualToggle.offsetHeight - 8);
    const x = Math.max(minX, Math.min(maxX, drag.startLeft + deltaX));
    const y = Math.max(minY, Math.min(maxY, drag.startTop + deltaY));
    virtualToggle.style.right = 'auto';
    virtualToggle.style.bottom = 'auto';
    virtualToggle.style.translate = 'none';
    virtualToggle.style.left = `${x}px`;
    virtualToggle.style.top = `${y}px`;
    virtualToggle.classList.add('is-dragging');
  });

  const finishVirtualToggleDrag = (event) => {
    const drag = virtualToggleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    virtualToggleDrag = null;
    virtualToggle.classList.remove('is-dragging');
    if (!drag.moved) return;

    const minX = 8;
    const minY = 8;
    const maxX = Math.max(minX, drag.rootBounds.width - virtualToggle.offsetWidth - 8);
    const maxY = Math.max(minY, drag.rootBounds.height - virtualToggle.offsetHeight - 8);
    const x = parseFloat(virtualToggle.style.left) || minX;
    const y = parseFloat(virtualToggle.style.top) || minY;
    virtualPanelPositions.toggle = {
      x: maxX > minX ? (x - minX) / (maxX - minX) : 0,
      y: maxY > minY ? (y - minY) / (maxY - minY) : 0,
    };
    saveVirtualPanelPositions();
    suppressVirtualToggleClick = true;
    window.setTimeout(() => { suppressVirtualToggleClick = false; }, 0);
  };

  virtualToggle?.addEventListener('pointerup', finishVirtualToggleDrag);
  virtualToggle?.addEventListener('pointercancel', finishVirtualToggleDrag);
  virtualToggle?.addEventListener('lostpointercapture', finishVirtualToggleDrag);
  virtualToggle?.addEventListener('click', (event) => {
    if (suppressVirtualToggleClick) {
      event.preventDefault();
      return;
    }
    setVirtualControls(!virtualControlsEnabled);
  });
  window.addEventListener('resize', () => {
    if (isGameFullscreen()) window.requestAnimationFrame(placeVirtualToggle);
    if (virtualControlsEnabled) window.requestAnimationFrame(placeVirtualPanels);
  }, { passive: true });

  choices.forEach((choice) => {
    choice.addEventListener('click', () => {
      void (async () => {
        const id = choice.dataset.rpgGame;
        if (hasCartridge) {
          await ejectCartridge();
          if (id === activeId) return;
        }
        await selectGame(id, choice);
      })();
    });
  });
  loadButton.addEventListener('click', loadGame);
  powerOnButton?.addEventListener('click', loadGame);
  powerOffButton?.addEventListener('click', powerOffGame);
  powerToggleButton?.addEventListener('click', togglePower);
  insertedCartridge?.addEventListener('click', () => { void ejectCartridge(); });
  openControlsButton?.addEventListener('click', () => {
    if (controlsOpen) closeControlsPage();
    else openControlsPage();
  });
  closeControlsButton?.addEventListener('click', () => closeControlsPage());
  enterFullscreen.addEventListener('click', requestGameFullscreen);
  exitFullscreen.addEventListener('click', exitGameFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenUi);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (controlsOpen) {
      closeControlsPage();
      return;
    }
    if (fallbackFullscreen) void exitGameFullscreen();
  });

  window.addEventListener('message', (event) => {
    const id = Object.keys(states).find((gameId) => event.source === states[gameId].frame?.contentWindow);
    if (!id || event.origin !== new URL(games[id].src).origin || event.data?.source !== 'rpg-dreamer-game') return;
    const state = states[id];

    if (event.data.type === 'exit') {
      void returnToLibrary(id);
      return;
    }

    if (event.data.type === 'loading') {
      if (state.readyPending) return;
      const value = Number(event.data.progress) || 0;
      state.progress = 0.08 + value * 0.9;
      state.progressLabel = `Mounting world assets ${Math.round(value * 100)}%`;
      if (id === activeId) syncActiveUi();
      return;
    }
    if (event.data.type === 'ready') {
      markReady(id);
      return;
    }
    if (event.data.type === 'error') {
      window.clearTimeout(state.timer);
      window.clearTimeout(state.readyTimer);
      state.status = 'Error';
      state.progress = 1;
      state.progressLabel = event.data.message || 'Game failed to load';
      if (id === activeId) syncActiveUi();
    }
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      Object.keys(states).forEach((id) => {
        if (!states[id].ready) return;
        sendToGame(id, hasCartridge && poweredOn && !controlsOpen && id === activeId && (visible || document.fullscreenElement === root || fallbackFullscreen) ? 'resume' : 'pause');
      });
    }, { threshold: 0.05 });
    observer.observe(root);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) configureGameAudioSession();
    Object.keys(states).forEach((id) => {
      if (!states[id].ready) return;
      sendToGame(id, hasCartridge && poweredOn && !controlsOpen && !document.hidden && id === activeId ? 'resume' : 'pause');
    });
  });

  syncActiveUi();
  syncCartridgeScrollButtons();
})();
