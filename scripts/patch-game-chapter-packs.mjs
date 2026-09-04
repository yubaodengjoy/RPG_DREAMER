#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const VERSION = '20260904-chapter-packs-01';
const MARKER = '__RPG_CHAPTER_PACKS_20260904_01__';
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

function patchBundle(file) {
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(MARKER)) return false;

  const resolver = capture(
    source,
    /function ([A-Za-z_$][\w$]*)\(e\)\{let t=([A-Za-z_$][\w$]*)\(e\),n=([A-Za-z_$][\w$]*)\[`\.\.\/assets\/\$\{t\}`\];if\(!n\)throw Error\(`Asset path "\$\{t\}" was not found in src\/assets\.`\);return n\}/,
    'compiled asset resolver',
    file,
  );
  const resolverReplacement = resolver[0].replace(
    'return n}',
    `return globalThis.__RPG_PACK_RESOLVE__?.(n)??n}var ${MARKER}=!0;`,
  );
  source = replaceOnce(source, resolver[0], resolverReplacement, 'pack-aware asset resolver', file);

  const warmScene = capture(
    source,
    /function __rpgWarmScene\(e,t\)\{if\(!t\)return Promise\.resolve\(!1\);let n=([A-Za-z_$][\w$]*)\(t\);if\(!n\)return Promise\.resolve\(!1\);let r=__rpgSceneWarmups\.get\(t\);if\(r\)return r;let i=\[\.\.\.([A-Za-z_$][\w$]*)\(t\)\]\.map\(t=>([A-Za-z_$][\w$]*)\(e,t\)\),a=`pixel-collision\.\$\{t\}\.manifest`;n\.collisionManifestPath&&i\.push\(__rpgWarmJson\(e,a,n\.collisionManifestPath\)\);let o=Promise\.all\(i\)\.then\(e=>e\.every\(Boolean\)\)\.catch\(e=>\(console\.warn\(`Scene warmup failed for "\$\{t\}"\.`,e\),!1\)\)\.finally\(\(\)=>__rpgSceneWarmups\.delete\(t\)\);return __rpgSceneWarmups\.set\(t,o\),o\}/,
    'scene warmup function',
    file,
  );
  const getScene = warmScene[1];
  const getSceneAssetIds = warmScene[2];
  const lazyLoad = warmScene[3];
  const warmReplacement = `function __rpgWarmScene(e,t){if(!t)return Promise.resolve(!1);let n=${getScene}(t);if(!n)return Promise.resolve(!1);let r=__rpgSceneWarmups.get(t);if(r)return r;let o=Promise.resolve(globalThis.__RPG_PACK_ENSURE_SCENE__?.(t)).catch(e=>(console.warn(\`Chapter pack preparation failed for "\${t}".\`,e),null)).then(()=>{let r=[...${getSceneAssetIds}(t)].map(t=>${lazyLoad}(e,t)),i=\`pixel-collision.\${t}.manifest\`;return n.collisionManifestPath&&r.push(__rpgWarmJson(e,i,n.collisionManifestPath)),Promise.all(r)}).then(e=>e.every(Boolean)).catch(e=>(console.warn(\`Scene warmup failed for "\${t}".\`,e),!1)).finally(()=>__rpgSceneWarmups.delete(t));return __rpgSceneWarmups.set(t,o),o}`;
  source = replaceOnce(source, warmScene[0], warmReplacement, 'pack-gated scene warmup', file);

  const worldHook = 'e.time.delayedCall(80,()=>__rpgWarmReachable(e,e.definition.id))';
  const hookCount = source.split(worldHook).length - 1;
  if (hookCount !== 2) throw new Error(`${file}: expected two world entry hooks; found ${hookCount}`);
  source = source.replaceAll(
    worldHook,
    'globalThis.__RPG_PACK_ENTER_SCENE__?.(e.definition.id),e.time.delayedCall(80,()=>__rpgWarmReachable(e,e.definition.id))',
  );

  const continueMethod = capture(
    source,
    /agentContinueChapter\(\)\{if\(!this\.nextSceneId\)return\{ok:!1,message:`No next chapter is available\.`\};if\(this\.__rpgContinuing\)return\{ok:!0,message:`The next chapter is being prepared\.`\};this\.__rpgContinuing=!0;let e=this\.nextSceneId,t=this\.startCutsceneId;return this\.endingQaState=void 0,this\.nextSceneId=void 0,this\.startCutsceneId=void 0,this\.scene\.stop\(this\.parentSceneKey\),this\.scene\.start\(e,\{chapterStartCutsceneId:t,isChapterStart:!0\}\),\{ok:!0,message:`Continued to the next chapter\.`\}\}/,
    'chapter continuation method',
    file,
  )[0];
  const continueReplacement = 'agentContinueChapter(){if(!this.nextSceneId)return{ok:!1,message:`No next chapter is available.`};if(this.__rpgContinuing)return{ok:!0,message:`The next chapter is being prepared.`};this.__rpgContinuing=!0;let e=this.nextSceneId,t=this.startCutsceneId;return Promise.resolve(globalThis.__RPG_PACK_ENSURE_SCENE__?.(e)).catch(e=>console.warn(`Next chapter pack preparation failed.`,e)).finally(()=>{this.scene.isActive(this.scene.key)&&(this.endingQaState=void 0,this.nextSceneId=void 0,this.startCutsceneId=void 0,this.scene.stop(this.parentSceneKey),this.scene.start(e,{chapterStartCutsceneId:t,isChapterStart:!0}))}),{ok:!0,message:`Continued to the next chapter.`}}';
  source = replaceOnce(source, continueMethod, continueReplacement, 'pack-gated chapter continuation', file);

  fs.writeFileSync(file, source);
  return true;
}

function patchIndex(file) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(
    /rpg-embed-host\.js(?:\?v=[^"']+)?/,
    `rpg-embed-host.js?v=${VERSION}`,
  );
  if (!source.includes('rpg-pack-loader.js')) {
    source = source.replace(
      /<script type="module" crossorigin src="(\.\/assets\/index-[^"?]+\.js)(?:\?v=[^"]+)?"><\/script>/,
      `<script src="../../../project-page/play-games/rpg-pack-loader.js?v=${VERSION}"></script>\n    <script type="module">\n      await window.__RPG_PACK_READY__;\n      await import("$1?v=${VERSION}");\n    </script>`,
    );
  }
  if (!source.includes(`rpg-pack-loader.js?v=${VERSION}`)) {
    throw new Error(`${file}: pack loader was not installed`);
  }
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

console.log(`Chapter pack runtime ${VERSION}: ${changed} bundle(s) updated.`);
