#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const VERSION = process.env.RPG_PACK_RUNTIME_VERSION ?? '20260910-packready-01';
const MARKER = '__RPG_PACK_READINESS_20260910_01__';
const MAGIC = 'RPGPK001';
const root = path.resolve(import.meta.dirname, '..');
const gameRoots = (process.env.RPG_GAME_ROOTS
  ? process.env.RPG_GAME_ROOTS.split(',')
  : ['src-40', 'src-41', 'src-42', 'src-43', 'src-44', 'src-45'])
  .map((value) => value.trim())
  .filter(Boolean);

function entryBundle(dist, gameRoot) {
  const assets = path.join(dist, 'assets');
  const bundles = fs.readdirSync(assets).filter((name) => /^index-.*\.js$/.test(name));
  if (bundles.length !== 1) {
    throw new Error(`${gameRoot}: expected one entry bundle, found ${bundles.length}`);
  }
  return path.join(assets, bundles[0]);
}

function readPackEntries(file, packId) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(12);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) {
      throw new Error(`${packId}: truncated pack header`);
    }
    if (header.subarray(0, 8).toString() !== MAGIC) {
      throw new Error(`${packId}: invalid pack header`);
    }
    const indexLength = header.readUInt32LE(8);
    const index = Buffer.alloc(indexLength);
    if (fs.readSync(descriptor, index, 0, indexLength, 12) !== indexLength) {
      throw new Error(`${packId}: truncated pack index`);
    }
    return JSON.parse(index.toString()).entries;
  } finally {
    fs.closeSync(descriptor);
  }
}

function patchManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const assetPacks = {};
  const packDirectory = path.dirname(file);
  for (const [packId, details] of Object.entries(manifest.packs)) {
    const entries = readPackEntries(path.join(packDirectory, details.file), packId);
    if (entries.length !== details.entries) {
      throw new Error(`${file}: ${packId} entry count does not match its manifest`);
    }
    for (const entry of entries) {
      if (assetPacks[entry.p] && assetPacks[entry.p] !== packId) {
        throw new Error(`${file}: ${entry.p} is present in multiple packs`);
      }
      assetPacks[entry.p] = packId;
    }
  }
  manifest.assetPacks = assetPacks;
  fs.writeFileSync(file, `${JSON.stringify(manifest)}\n`);
  return Object.keys(assetPacks).length;
}

function patchBundle(file) {
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(MARKER)) return false;

  const resolver = source.match(
    /function ([A-Za-z_$][\w$]*)\(e\)\{let t=[A-Za-z_$][\w$]*\(e\),n=[A-Za-z_$][\w$]*\[`\.\.\/assets\/\$\{t\}`\];if\(!n\)throw Error\(`Asset path "\$\{t\}" was not found in src\/assets\.`\);return globalThis\.__RPG_PACK_RESOLVE__\?\.\(n\)\?\?n\}/,
  );
  if (!resolver) throw new Error(`${file}: pack-aware asset resolver was not found`);
  const resolverName = resolver[1];
  const atlasCall = `t.type===\`atlas\`?e.load.atlas(n,${resolverName}(t.imagePath),${resolverName}(t.dataPath))`;
  const atlasCallIndex = source.indexOf(atlasCall);
  if (atlasCallIndex < 0 || source.indexOf(atlasCall, atlasCallIndex + 1) >= 0) {
    throw new Error(`${file}: compiled asset queue function was not uniquely identified`);
  }
  const functionIndex = source.lastIndexOf('function ', atlasCallIndex);
  const bodyIndex = source.indexOf('{', functionIndex);
  const signature = source.slice(functionIndex, bodyIndex + 1);
  if (!/^function [A-Za-z_$][\w$]*\(e,t,n=t\.id\)\{$/.test(signature)) {
    throw new Error(`${file}: unexpected compiled asset queue signature: ${signature}`);
  }
  const guard = `var ${MARKER}=!0;if(globalThis.__RPG_PACK_ASSET_READY__&&!globalThis.__RPG_PACK_ASSET_READY__(t.type===\`atlas\`?[${resolverName}(t.imagePath),${resolverName}(t.dataPath)]:[${resolverName}(t.path)]))return;`;
  source = source.slice(0, bodyIndex + 1) + guard + source.slice(bodyIndex + 1);
  fs.writeFileSync(file, source);
  return true;
}

function patchIndex(file) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(
    /rpg-pack-loader\.js(?:\?v=[^"']+)?/,
    `rpg-pack-loader.js?v=${VERSION}`,
  );
  source = source.replace(
    /(await import\("\.\/assets\/index-[^"?]+\.js)(?:\?v=[^"]+)?("\))/,
    `$1?v=${VERSION}$2`,
  );
  fs.writeFileSync(file, source);
}

for (const gameRoot of gameRoots) {
  const dist = path.join(root, gameRoot, 'src', 'dist');
  const manifestFile = path.join(dist, 'packs', 'manifest.json');
  const bundleFile = entryBundle(dist, gameRoot);
  const assetCount = patchManifest(manifestFile);
  const changed = patchBundle(bundleFile);
  patchIndex(path.join(dist, 'index.html'));

  const bundle = fs.readFileSync(bundleFile, 'utf8');
  const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  if (!bundle.includes(MARKER)) throw new Error(`${gameRoot}: readiness guard is missing`);
  if (!index.includes(`rpg-pack-loader.js?v=${VERSION}`)) {
    throw new Error(`${gameRoot}: pack loader version was not updated`);
  }
  console.log(`${gameRoot}: ${assetCount} packed assets indexed; bundle ${changed ? 'patched' : 'verified'}`);
}

console.log(`Pack readiness patch ${VERSION} complete.`);
