#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const VERSION = process.env.RPG_ATLAS_FIX_VERSION ?? '20260910-atlasfix-01';
const MARKER = '__RPG_ATLAS_FILETYPE_20260910_01__';
const root = path.resolve(import.meta.dirname, '..');
const gameRoots = (process.env.RPG_GAME_ROOTS
  ? process.env.RPG_GAME_ROOTS.split(',')
  : ['src-40', 'src-41', 'src-42', 'src-43', 'src-44', 'src-45'])
  .map((value) => value.trim())
  .filter(Boolean);

const brokenFileType = /function ([A-Za-z_$][\w$]*)\(e\)\{return e\.type===`spritesheet`\?`spritesheet`:e\.type\}/g;
const fixedFileType = /function ([A-Za-z_$][\w$]*)\(e\)\{return e\.type===`atlas`\?`atlasjson`:e\.type===`spritesheet`\?`spritesheet`:e\.type\}/g;
const stalledQueueStart = /([A-Za-z_$][\w$]*)\.load\.isLoading\(\)\|\|\1\.load\.start\(\)/g;
const fixedQueueStart = /([A-Za-z_$][\w$]*)\.load\.isLoading\(\)\?\1\.load\.update\(\):\1\.load\.start\(\)/g;
const stalledBattleStart = /!([A-Za-z_$][\w$]*)\.load\.isLoading\(\)&&\1\.load\.start\(\)/g;
const fixedBattleStart = /\(([A-Za-z_$][\w$]*)\.load\.isLoading\(\)\?\1\.load\.update\(\):\1\.load\.start\(\)\)/g;

function entryBundle(dist, gameRoot) {
  const assets = path.join(dist, 'assets');
  const bundles = fs.readdirSync(assets).filter((name) => /^index-.*\.js$/.test(name));
  if (bundles.length !== 1) {
    throw new Error(`${gameRoot}: expected one entry bundle, found ${bundles.length}`);
  }
  return path.join(assets, bundles[0]);
}

function patchBundle(file) {
  let source = fs.readFileSync(file, 'utf8');
  let bundleChanged = false;
  const broken = [...source.matchAll(brokenFileType)];
  const fixed = [...source.matchAll(fixedFileType)];

  if (broken.length > 1 || fixed.length > 1 || (broken.length && fixed.length)) {
    throw new Error(`${file}: ambiguous compiled file-type helpers`);
  }
  if (broken.length === 1) {
    const name = broken[0][1];
    source = source.replace(
      broken[0][0],
      `function ${name}(e){return e.type===\`atlas\`?\`atlasjson\`:e.type===\`spritesheet\`?\`spritesheet\`:e.type}var ${MARKER}=!0;`,
    );
    bundleChanged = true;
  } else if (fixed.length !== 1) {
    throw new Error(`${file}: compiled file-type helper was not found`);
  }

  const stalled = [...source.matchAll(stalledQueueStart)];
  const queueFixed = [...source.matchAll(fixedQueueStart)];
  // Scene warmup may already supply fixed starters while the original lazy
  // loaders still need the repair. Preserve those and update only old forms.
  if (stalled.length) {
    source = source.replace(stalledQueueStart, (match, name) =>
      `${name}.load.isLoading()?${name}.load.update():${name}.load.start()`);
    bundleChanged = true;
  } else if (queueFixed.length < 4) {
    throw new Error(`${file}: lazy-loader queue starter was not found`);
  }

  const battleStalled = [...source.matchAll(stalledBattleStart)];
  const battleFixed = [...source.matchAll(fixedBattleStart)];
  if (battleStalled.length === 1) {
    const name = battleStalled[0][1];
    source = source.replace(
      battleStalled[0][0],
      `(${name}.load.isLoading()?${name}.load.update():${name}.load.start())`,
    );
    bundleChanged = true;
  } else if (battleFixed.length < 1) {
    throw new Error(`${file}: battle-loader queue starter was not found`);
  }

  if (bundleChanged) fs.writeFileSync(file, source);
  return bundleChanged;
}

function patchIndex(file) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(/\s*<meta\s+name=["']description["'][^>]*>\s*/gi, '\n');
  fs.writeFileSync(file, source);
}

let changed = 0;
for (const gameRoot of gameRoots) {
  const dist = path.join(root, gameRoot, 'src', 'dist');
  const bundle = entryBundle(dist, gameRoot);
  if (patchBundle(bundle)) changed += 1;
  patchIndex(path.join(dist, 'index.html'));

  const bundleSource = fs.readFileSync(bundle, 'utf8');
  const indexSource = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  if (brokenFileType.test(bundleSource) || !fixedFileType.test(bundleSource)) {
    throw new Error(`${gameRoot}: atlas completion mapping verification failed`);
  }
  brokenFileType.lastIndex = 0;
  fixedFileType.lastIndex = 0;
  if (stalledQueueStart.test(bundleSource) || !fixedQueueStart.test(bundleSource)) {
    throw new Error(`${gameRoot}: lazy-loader queue advancement verification failed`);
  }
  stalledQueueStart.lastIndex = 0;
  fixedQueueStart.lastIndex = 0;
  if (stalledBattleStart.test(bundleSource) || !fixedBattleStart.test(bundleSource)) {
    throw new Error(`${gameRoot}: battle-loader queue advancement verification failed`);
  }
  stalledBattleStart.lastIndex = 0;
  fixedBattleStart.lastIndex = 0;
  if (/<meta\s+name=["']description["']/i.test(indexSource)) {
    throw new Error(`${gameRoot}: description metadata was not removed`);
  }
  console.log(`${gameRoot}: atlasjson completion mapping and HTML metadata verified`);
}

console.log(`Atlas loading patch ${VERSION}: ${changed} bundle(s) updated.`);
