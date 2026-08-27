// RPG Dreamer — four independently cached, explicitly loaded playable worlds.
(() => {
  const root = document.getElementById('rpg-play-demo');
  if (!root) return;

  const games = {
    'world-40': {
      title: '武松·最后一虎',
      meta: 'Long-horizon generated RPG · Chinese',
      src: 'src-40/src/dist/',
      // Consumed from project-page/rpg-demo.css, so this URL is CSS-relative.
      poster: '../src-40/src/dist/cover.webp',
      copy: 'Follow Wu Song into a final confrontation shaped by duty, survival, and the legend of the last tiger.',
    },
    'magic-brush': {
      title: '神笔：移命录',
      meta: 'Long-horizon generated RPG · Chinese',
      src: 'src-41/src/dist/',
      poster: '../src-41/src/dist/cover.webp',
      copy: 'A four-chapter journey about Ma Liang and a magic brush whose miracles transfer their cost to others.',
    },
    'world-42': {
      title: 'Pinocchio: The City That Swallows Truth',
      meta: 'Long-horizon generated RPG · English',
      src: 'src-42/src/dist/',
      poster: '../src-42/src/dist/cover.webp',
      copy: 'Enter a city where truth is consumed, identities are rewritten, and every choice tests what it means to remain real.',
    },
    'vanishing-emperor': {
      title: 'The Vanishing Emperor',
      meta: 'Long-horizon generated RPG · English',
      src: 'src-43/src/dist/',
      poster: '../src-43/src/dist/cover.webp',
      copy: 'Investigate Valdris after its emperor vanishes, leaving an empty crown, a disputed voice, and a kingdom built on uncertain truth.',
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
  const enterFullscreen = root.querySelector('[data-rpg-enter-fullscreen]');
  const exitFullscreen = root.querySelector('[data-rpg-exit-fullscreen]');
  const compilerLines = [...root.querySelectorAll('.rpg-compiler-log span')];
  const cartridgeLabels = [...root.querySelectorAll('[data-rpg-cartridge-label]')];
  const insertedCartridge = root.querySelector('[data-rpg-eject]');
  const power = root.querySelector('[data-rpg-power]');
  const powerOffButton = root.querySelector('[data-rpg-power-off]');
  const powerOnButton = root.querySelector('[data-rpg-power-on]');
  const choices = [...root.querySelectorAll('[data-rpg-game]')];
  const cartridgeStrip = root.querySelector('.rpg-demo-switcher');
  const cartridgeScrollButtons = [...root.querySelectorAll('[data-rpg-scroll]')];
  let activeId = choices[0]?.dataset.rpgGame || Object.keys(games)[0];
  let hasCartridge = false;
  let poweredOn = false;
  let cartridgeMoving = false;
  let fallbackFullscreen = false;

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

  function sendToGame(id, type) {
    states[id]?.frame?.contentWindow?.postMessage(
      { source: 'rpg-dreamer-host', type },
      window.location.origin,
    );
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
      powerOffButton.disabled = !hasCartridge || cartridgeMoving;
      powerOffButton.setAttribute('aria-pressed', String(!poweredOn));
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
    placeholderCopy.textContent = `${game.copy} Insert this cartridge to enter the generated world.`;
    progressTitle.textContent = `Booting ${game.title}`;
    setProgress(state.progress, state.progressLabel);

    Object.entries(states).forEach(([id, item]) => {
      if (!item.frame) return;
      const selected = id === activeId && poweredOn;
      item.frame.hidden = !selected;
      item.frame.style.visibility = selected && item.ready ? 'visible' : 'hidden';
      item.frame.setAttribute('aria-hidden', String(!selected));
      sendToGame(id, selected && !document.hidden ? 'resume' : 'pause');
      if (selected) window.requestAnimationFrame(() => sendToGame(id, 'resize'));
    });

    placeholder.hidden = poweredOn && Boolean(state.frame);
    progress.hidden = !poweredOn || !state.frame || state.ready;
    enterFullscreen.disabled = !poweredOn || !state.ready;
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

  function loadGame() {
    if (!hasCartridge || poweredOn || cartridgeMoving) return;
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
    frame.src = game.src;
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

  function enterFallbackFullscreen() {
    fallbackFullscreen = true;
    root.classList.add('is-fallback-fullscreen');
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
    document.body.classList.remove('rpg-demo-fullscreen-fallback');
    syncFullscreenUi();
  }

  function syncFullscreenUi() {
    const active = document.fullscreenElement === root || fallbackFullscreen;
    enterFullscreen.hidden = active;
    exitFullscreen.hidden = !active;
    window.requestAnimationFrame(() => {
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
  powerOffButton?.addEventListener('click', () => { void ejectCartridge(); });
  insertedCartridge?.addEventListener('click', () => { void ejectCartridge(); });
  enterFullscreen.addEventListener('click', requestGameFullscreen);
  exitFullscreen.addEventListener('click', exitGameFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenUi);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && fallbackFullscreen) void exitGameFullscreen();
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.data?.source !== 'rpg-dreamer-game') return;
    const id = Object.keys(states).find((gameId) => event.source === states[gameId].frame?.contentWindow);
    if (!id) return;
    const state = states[id];

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
        sendToGame(id, hasCartridge && poweredOn && id === activeId && (visible || document.fullscreenElement === root) ? 'resume' : 'pause');
      });
    }, { threshold: 0.05 });
    observer.observe(root);
  }

  document.addEventListener('visibilitychange', () => {
    Object.keys(states).forEach((id) => {
      if (!states[id].ready) return;
      sendToGame(id, hasCartridge && poweredOn && !document.hidden && id === activeId ? 'resume' : 'pause');
    });
  });

  syncActiveUi();
  syncCartridgeScrollButtons();
})();
