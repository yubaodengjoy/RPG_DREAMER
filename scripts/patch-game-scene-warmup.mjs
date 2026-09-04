#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION = '20260904-scene-warmup-03';
const root = path.resolve(import.meta.dirname, '..');
const gameRoots = ['src-40', 'src-41', 'src-42', 'src-43', 'src-44'];

function replaceOnce(source, search, replacement, label, file) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`${file}: missing ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`${file}: ${label} is not unique`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function capture(source, expression, label, file) {
  const match = source.match(expression);
  if (!match) throw new Error(`${file}: could not identify ${label}`);
  return match;
}

function upgradeWarmupV1(file, source) {
  const oldFinish = 'finish(){if(this.finishing)return;this.finishing=!0,this.letterTimer?.remove(!1),this.shotTimer?.remove(!1),__rpgWarmScene(this,this.startSceneId).finally(()=>{this.scene.isActive(this.scene.key)&&(this.cameras.main.fadeOut(220,0,0,0),this.cameras.main.once(`camerafadeoutcomplete`,()=>{this.scene.start(this.startSceneId,{isNewGame:!0})}))})}}';
  const newFinish = 'finish(){if(this.finishing)return;this.finishing=!0,this.letterTimer?.remove(!1),this.shotTimer?.remove(!1),this.cameras.main.fadeOut(220,0,0,0),this.cameras.main.once(`camerafadeoutcomplete`,()=>{this.scene.start(this.startSceneId,{isNewGame:!0})})}}';
  const oldContinue = 'agentContinueChapter(){if(!this.nextSceneId)return{ok:!1,message:`No next chapter is available.`};if(this.__rpgContinuing)return{ok:!0,message:`The next chapter is being prepared.`};this.__rpgContinuing=!0;let e=this.nextSceneId,t=this.startCutsceneId;return __rpgWarmScene(this,e).finally(()=>{this.scene.isActive(this.scene.key)&&(this.endingQaState=void 0,this.nextSceneId=void 0,this.startCutsceneId=void 0,this.scene.stop(this.parentSceneKey),this.scene.start(e,{chapterStartCutsceneId:t,isChapterStart:!0}))}),{ok:!0,message:`Continued to the next chapter.`}}';
  const newContinue = 'agentContinueChapter(){if(!this.nextSceneId)return{ok:!1,message:`No next chapter is available.`};if(this.__rpgContinuing)return{ok:!0,message:`The next chapter is being prepared.`};this.__rpgContinuing=!0;let e=this.nextSceneId,t=this.startCutsceneId;return this.endingQaState=void 0,this.nextSceneId=void 0,this.startCutsceneId=void 0,this.scene.stop(this.parentSceneKey),this.scene.start(e,{chapterStartCutsceneId:t,isChapterStart:!0}),{ok:!0,message:`Continued to the next chapter.`}}';

  source = replaceOnce(source, oldFinish, newFinish, 'non-blocking opening finish', file);
  source = replaceOnce(source, oldContinue, newContinue, 'non-blocking chapter continuation', file);
  source = replaceOnce(
    source,
    '__RPG_SCENE_WARMUP_20260904__',
    '__RPG_SCENE_WARMUP_20260904_02__',
    'warmup version marker',
    file,
  );
  fs.writeFileSync(file, source);
  return true;
}

function upgradeWarmupV2(file, source) {
  const registry = capture(
    source,
    /function __rpgAdjacentSceneIds\(e\)\{let t=([A-Za-z_$][\w$]*)\(\);/,
    'warmup content registry',
    file,
  )[1];
  const battleLoader = capture(
    source,
    /function ([A-Za-z_$][\w$]*)\(e,t\)\{let n=[A-Za-z_$][\w$]*\(\),r=new Set,i=t\.musicId\?\?n\.defaultBattleMusicId;/,
    'battle asset loader',
    file,
  )[1];
  const adjacent = capture(
    source,
    /function __rpgWarmAdjacent\(e,t\)\{return Promise\.allSettled\(__rpgAdjacentSceneIds\(t\)\.map\(t=>__rpgWarmScene\(e,t\)\)\)\}/,
    'adjacent scene warmup helper',
    file,
  )[0];
  const battleWarmup = `function __rpgWarmBattles(e,t){let n=${registry}(),r=n.npcs.filter(e=>e.scene===t&&e.battle).map(e=>e.battle);r.forEach(t=>${battleLoader}(e,t)),r.length&&!e.load.isLoading()&&e.load.start()}function __rpgWarmReachable(e,t){return __rpgWarmBattles(e,t),__rpgWarmAdjacent(e,t)}`;

  source = replaceOnce(
    source,
    adjacent,
    adjacent + battleWarmup,
    'battle warmup helpers',
    file,
  );
  const oldHook = 'e.time.delayedCall(80,()=>__rpgWarmAdjacent(e,e.definition.id))';
  const hookCount = source.split(oldHook).length - 1;
  if (hookCount !== 2) throw new Error(`${file}: expected two world warmup hooks; found ${hookCount}`);
  source = source.replaceAll(
    oldHook,
    'e.time.delayedCall(80,()=>__rpgWarmReachable(e,e.definition.id))',
  );
  source = replaceOnce(
    source,
    '__RPG_SCENE_WARMUP_20260904_02__',
    '__RPG_SCENE_WARMUP_20260904_03__',
    'warmup version marker',
    file,
  );
  fs.writeFileSync(file, source);
  return true;
}

function patchBundle(file) {
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes('__RPG_SCENE_WARMUP_20260904_03__')) return false;
  if (source.includes('__RPG_SCENE_WARMUP_20260904_02__')) {
    return upgradeWarmupV2(file, source);
  }
  if (source.includes('__RPG_SCENE_WARMUP_20260904__')) {
    upgradeWarmupV1(file, source);
    return patchBundle(file);
  }

  const loader = capture(
    source,
    /function ([A-Za-z_$][\w$]*)\(e,t\)\{([A-Za-z_$][\w$]*)\(t\)\.forEach\(t=>\{([A-Za-z_$][\w$]*)\(e,t\)\}\)\}/,
    'scene asset loader',
    file,
  );
  const getSceneAssetIds = loader[2];

  const battleLoader = capture(
    source,
    /function ([A-Za-z_$][\w$]*)\(e,t\)\{let n=[A-Za-z_$][\w$]*\(\),r=new Set,i=t\.musicId\?\?n\.defaultBattleMusicId;/,
    'battle asset loader',
    file,
  )[1];

  const registryAndScene = capture(
    source,
    new RegExp(`function ${getSceneAssetIds}\\(e\\)\\{let t=([A-Za-z_$][\\w$]*)\\(\\),n=([A-Za-z_$][\\w$]*)\\(e\\),r=new Set;return t\\.assets\\.filter`),
    'content registry',
    file,
  );
  const registry = registryAndScene[1];
  const getScene = registryAndScene[2];

  const lazy = capture(
    source,
    /function ([A-Za-z_$][\w$]*)\(e,t,n=t\)\{let r=([A-Za-z_$][\w$]*)\(t\);if\(([A-Za-z_$][\w$]*)\(e,r,n\)\)return Promise\.resolve\(!0\)/,
    'lazy asset loader',
    file,
  );
  const lazyLoad = lazy[1];

  const preload = capture(
    source,
    new RegExp(`preload\\(\\)\\{[A-Za-z_$][\\w$]*\\(this,this\\.definition\\.id\\),this\\.load\\.json\\(this\\.pixelCollisionManifestKey\\(\\),([A-Za-z_$][\\w$]*)\\(this\\.definition\\.collisionManifestPath\\)\\)\\}`),
    'world preload method',
    file,
  );
  const assetUrl = preload[1];

  const music = capture(
    source,
    /create\(e=\{\}\)\{([A-Za-z_$][\w$]*)\(this,this\.definition\.id\),this\.add\.image\(0,0,this\.definition\.mapImageAssetId\)/,
    'scene music synchronizer',
    file,
  );
  const syncMusic = music[1];

  const allowed = capture(
    source,
    /startTransitionInteraction\(e\)\{let t=([A-Za-z_$][\w$]*)\(this\.definition\.id,e\);/,
    'transition guard',
    file,
  )[1];

  const telemetry = capture(
    source,
    /recordBlockedTransition\(e\)\{let t=[A-Za-z_$][\w$]*\(this\.definition\.id,e\);([A-Za-z_$][\w$]*)\(`world\.transition\.blocked`,/,
    'transition telemetry function',
    file,
  )[1];

  const saveGame = capture(
    source,
    /this\.applyDebugMode\(\),([A-Za-z_$][\w$]*)\(this\),this\.unsubscribeBattleRequests=/,
    'world save function',
    file,
  )[1];

  const insertionPoint = capture(
    source,
    /var [A-Za-z_$][\w$]*=720;function [A-Za-z_$][\w$]*\(e,t=\{\}\)\{e\.input\.enabled=!1;/,
    'asset helper insertion point',
    file,
  )[0];

  const helpers = `var __RPG_SCENE_WARMUP_20260904_02__=!0,__rpgSceneWarmups=new Map,__rpgJsonWarmups=new Map,__rpgSceneHistory=[];function __rpgWarmJson(e,t,n){if(e.cache.json.exists(t))return Promise.resolve(!0);let r=__rpgJsonWarmups.get(t);if(r)return r;let i=new Promise(r=>{let i=()=>{e.load.off(\`filecomplete\`,a),e.load.off(\`loaderror\`,o),__rpgJsonWarmups.delete(t)},a=(e,n)=>{e===t&&n===\`json\`&&(i(),r(!0))},o=e=>{e.key===t&&(i(),r(!1))};e.load.on(\`filecomplete\`,a),e.load.on(\`loaderror\`,o),e.load.json(t,${assetUrl}(n)),e.load.isLoading()||e.load.start()});return __rpgJsonWarmups.set(t,i),i}function __rpgWarmScene(e,t){if(!t)return Promise.resolve(!1);let n=${getScene}(t);if(!n)return Promise.resolve(!1);let r=__rpgSceneWarmups.get(t);if(r)return r;let i=[...${getSceneAssetIds}(t)].map(t=>${lazyLoad}(e,t)),a=\`pixel-collision.\${t}.manifest\`;n.collisionManifestPath&&i.push(__rpgWarmJson(e,a,n.collisionManifestPath));let o=Promise.all(i).then(e=>e.every(Boolean)).catch(e=>(console.warn(\`Scene warmup failed for "\${t}".\`,e),!1)).finally(()=>__rpgSceneWarmups.delete(t));return __rpgSceneWarmups.set(t,o),o}function __rpgAdjacentSceneIds(e){let t=${registry}();return[...new Set(t.worldInteractions.filter(t=>t.type===\`transition\`&&t.scene===e).map(e=>e.transition.toSceneId).filter(Boolean))]}function __rpgWarmAdjacent(e,t){return Promise.allSettled(__rpgAdjacentSceneIds(t).map(t=>__rpgWarmScene(e,t)))}async function __rpgWarmChapter(e,t){t&&(await __rpgWarmScene(e,t),e.scene.isActive(e.scene.key)&&await __rpgWarmAdjacent(e,t))}function __rpgRememberScene(e){let t=e.scene.key,n=__rpgSceneHistory.indexOf(t);n>=0&&__rpgSceneHistory.splice(n,1),__rpgSceneHistory.push(t);let r=globalThis.matchMedia?.(\`(pointer: coarse)\`)?.matches?2:3;for(;__rpgSceneHistory.length>r;){let t=__rpgSceneHistory.shift();t&&t!==e.scene.key&&e.scene.isSleeping(t)&&e.scene.stop(t)}}function __rpgFinishSceneSwitch(e,t={}){let n=t.__rpgPreviousSceneKey;if(n&&n!==e.scene.key){let t=e.scene.get(n);t?.__rpgTransitionTimer?.remove(!1),t&&(t.__rpgTransitionTimer=void 0),e.scene.isActive(n)&&e.scene.sleep(n)}e.scene.bringToTop(e.scene.key),__rpgRememberScene(e)}function __rpgWorldWake(e,t={}){e.sceneTransitionPending=!1,e.input.enabled=!0,${syncMusic}(e,e.definition.id),e.resolvePlayerSpawn?.(t),e.refreshAfterQuestStateChange?.(),e.syncNpcs?.(),e.syncQuestPickups?.(),e.refreshQuestTracker?.(),e.refreshQuestTrackerToggle?.(),e.refreshInventoryBar?.(),e.configureMainCameraBounds?.(),e.queueArrivalCutscene?.(t),e.queueChapterStartCutscene?.(t),__rpgFinishSceneSwitch(e,t),e.time.delayedCall(80,()=>__rpgWarmAdjacent(e,e.definition.id))}function __rpgWorldReady(e,t={}){e.sceneTransitionPending=!1,e.input.enabled=!0,e.__rpgWakeHandler||(e.__rpgWakeHandler=(t,n)=>__rpgWorldWake(e,n),e.events.on(\`wake\`,e.__rpgWakeHandler),e.events.once(\`shutdown\`,()=>{e.events.off(\`wake\`,e.__rpgWakeHandler),e.__rpgWakeHandler=void 0})),__rpgFinishSceneSwitch(e,t),e.time.delayedCall(80,()=>__rpgWarmAdjacent(e,e.definition.id))}`;

  const adjacentHelper = 'function __rpgWarmAdjacent(e,t){return Promise.allSettled(__rpgAdjacentSceneIds(t).map(t=>__rpgWarmScene(e,t)))}';
  const battleHelpers = `function __rpgWarmBattles(e,t){let n=${registry}(),r=n.npcs.filter(e=>e.scene===t&&e.battle).map(e=>e.battle);r.forEach(t=>${battleLoader}(e,t)),r.length&&!e.load.isLoading()&&e.load.start()}function __rpgWarmReachable(e,t){return __rpgWarmBattles(e,t),__rpgWarmAdjacent(e,t)}`;
  const preparedHelpers = helpers
    .replace('__RPG_SCENE_WARMUP_20260904_02__', '__RPG_SCENE_WARMUP_20260904_03__')
    .replace(adjacentHelper, adjacentHelper + battleHelpers)
    .replaceAll(
      'e.time.delayedCall(80,()=>__rpgWarmAdjacent(e,e.definition.id))',
      'e.time.delayedCall(80,()=>__rpgWarmReachable(e,e.definition.id))',
    );

  source = replaceOnce(
    source,
    insertionPoint,
    preparedHelpers + insertionPoint,
    'warmup helper insertion',
    file,
  );

  const transitionStart = source.indexOf('startTransitionInteraction(e){');
  const transitionEnd = source.indexOf('}resolveTransitionArrival(e){', transitionStart);
  if (transitionStart < 0 || transitionEnd < 0) {
    throw new Error(`${file}: could not isolate transition method`);
  }
  const transitionMethod = source.slice(transitionStart, transitionEnd + 1);
  const transitionReplacement = `async startTransitionInteraction(e){if(this.sceneTransitionPending)return;let t=${allowed}(this.definition.id,e);if(!t.allowed){this.recordBlockedTransition(e),this.showExitNotice(t.blockedHint);return}this.sceneTransitionPending=!0,this.input.enabled=!1;let n=e.transition.toSceneId,r=this.resolveTransitionArrival(e);await __rpgWarmScene(this,n);if(!this.scene.isActive(this.scene.key))return;let i=this.getTransitionEventPayload(e);${telemetry}(e.event??\`world.transition.used\`,i),this.runWorldInteractionActions(e),${saveGame}(this);let a={...r,__rpgPreviousSceneKey:this.scene.key};this.__rpgTransitionTimer?.remove(!1),this.__rpgTransitionTimer=this.time.delayedCall(3e4,()=>{this.scene.isActive(this.scene.key)&&(this.scene.stop(n),this.sceneTransitionPending=!1,this.input.enabled=!0,this.showExitNotice(\`The next area could not be prepared. Please try again.\`))}),this.scene.isSleeping(n)?this.scene.wake(n,a):this.scene.launch(n,a),this.scene.bringToTop(n)}`;
  source = replaceOnce(source, transitionMethod, transitionReplacement, 'transition method', file);

  source = replaceOnce(
    source,
    'this.queueArrivalCutscene(e),this.queueChapterStartCutscene(e)}handleSceneResume',
    'this.queueArrivalCutscene(e),this.queueChapterStartCutscene(e),__rpgWorldReady(this,e)}handleSceneResume',
    'world scene ready hook',
    file,
  );

  source = replaceOnce(
    source,
    'this.playShot(0)}}showLoading',
    'this.playShot(0),__rpgWarmScene(this,this.startSceneId)}}showLoading',
    'opening warmup hook',
    file,
  );

  const openingClass = source.indexOf('this.startSceneId=e.startSceneId??');
  const openingFinishStart = source.indexOf('finish(){this.finishing||(', openingClass);
  const openingFinishEnd = source.indexOf('}};function ', openingFinishStart);
  if (openingFinishStart < 0 || openingFinishEnd < 0) {
    throw new Error(`${file}: could not isolate opening finish method`);
  }
  const openingFinish = source.slice(openingFinishStart, openingFinishEnd + 2);
  const openingFinishReplacement = 'finish(){if(this.finishing)return;this.finishing=!0,this.letterTimer?.remove(!1),this.shotTimer?.remove(!1),this.cameras.main.fadeOut(220,0,0,0),this.cameras.main.once(`camerafadeoutcomplete`,()=>{this.scene.start(this.startSceneId,{isNewGame:!0})})}}';
  source = replaceOnce(source, openingFinish, openingFinishReplacement, 'opening finish method', file);

  source = replaceOnce(
    source,
    'this.revealEnding(i,a),this.input.keyboard?.on',
    'this.revealEnding(i,a),this.nextSceneId&&__rpgWarmScene(this,this.nextSceneId),this.input.keyboard?.on',
    'ending warmup hook',
    file,
  );

  const continueStart = source.indexOf('agentContinueChapter(){');
  const continueEnd = source.indexOf('}async loadEndingImage', continueStart);
  if (continueStart < 0 || continueEnd < 0) {
    throw new Error(`${file}: could not isolate chapter continuation method`);
  }
  const continueMethod = source.slice(continueStart, continueEnd + 1);
  const continueReplacement = 'agentContinueChapter(){if(!this.nextSceneId)return{ok:!1,message:`No next chapter is available.`};if(this.__rpgContinuing)return{ok:!0,message:`The next chapter is being prepared.`};this.__rpgContinuing=!0;let e=this.nextSceneId,t=this.startCutsceneId;return this.endingQaState=void 0,this.nextSceneId=void 0,this.startCutsceneId=void 0,this.scene.stop(this.parentSceneKey),this.scene.start(e,{chapterStartCutsceneId:t,isChapterStart:!0}),{ok:!0,message:`Continued to the next chapter.`}}';
  source = replaceOnce(source, continueMethod, continueReplacement, 'chapter continuation method', file);

  fs.writeFileSync(file, source);
  return true;
}

function patchIndex(file) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(
    /(assets\/index-[^"?]+\.js)(?:\?v=[^"]+)?/,
    `$1?v=${VERSION}`,
  );
  fs.writeFileSync(file, source);
}

let changed = 0;
for (const gameRoot of gameRoots) {
  const dist = path.join(root, gameRoot, 'src', 'dist');
  const assets = path.join(dist, 'assets');
  const bundle = fs.readdirSync(assets).find((name) => /^index-.*\.js$/.test(name));
  if (!bundle) throw new Error(`${gameRoot}: entry bundle was not found`);
  if (patchBundle(path.join(assets, bundle))) changed += 1;
  patchIndex(path.join(dist, 'index.html'));
}

console.log(`Scene warmup patch ${VERSION}: ${changed} bundle(s) updated.`);
