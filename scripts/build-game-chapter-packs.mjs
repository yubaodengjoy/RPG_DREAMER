#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PACK_VERSION = '20260904-chapter-packs-01';
const MAGIC = Buffer.from('RPGPK001');
const root = path.resolve(import.meta.dirname, '..');
const gameRoots = ['src-40', 'src-41', 'src-42', 'src-43', 'src-44'];

function mimeType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.aac': 'audio/aac',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[extension] ?? 'application/octet-stream';
}

function extractAssetMap(source, file) {
  const resolver = source.match(
    /function ([A-Za-z_$][\w$]*)\(e\)\{let t=([A-Za-z_$][\w$]*)\(e\),n=([A-Za-z_$][\w$]*)\[`\.\.\/assets\/\$\{t\}`\]/,
  );
  if (!resolver) throw new Error(`${file}: compiled asset resolver was not found`);
  const resolverName = resolver[1];
  const mapName = resolver[3];
  const startToken = `var ${mapName}=Object.assign(`;
  const start = source.indexOf(startToken);
  const end = source.indexOf(`);function ${resolverName}(e)`, start);
  if (start < 0 || end < 0) throw new Error(`${file}: compiled asset map was not found`);
  const expression = source.slice(start + `var ${mapName}=`.length, end + 1);
  return Function(`"use strict";return (${expression})`)();
}

function chapterFromSource(sourcePath) {
  const match = sourcePath.match(/chapter[-_ ]?0*([1-9]\d*)/i);
  return match ? `chapter-${Number(match[1])}` : null;
}

function collectPackFiles(gameRoot, source, assetMap) {
  const groupsByOutput = new Map();
  for (const [sourcePath, outputPath] of Object.entries(assetMap)) {
    const normalized = outputPath.replace(/^\.\//, '');
    const group = chapterFromSource(sourcePath) ?? 'base';
    if (!groupsByOutput.has(normalized)) groupsByOutput.set(normalized, new Set());
    groupsByOutput.get(normalized).add(group);
  }

  const packs = new Map();
  for (const [relativePath, groups] of groupsByOutput) {
    const chapterGroups = [...groups].filter((group) => group !== 'base');
    const group = groups.has('base') || chapterGroups.length !== 1 ? 'base' : chapterGroups[0];
    const absolutePath = path.join(root, gameRoot, 'src', 'dist', relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`${gameRoot}: mapped asset is missing: ${relativePath}`);
    }
    if (!packs.has(group)) packs.set(group, []);
    packs.get(group).push({
      absolutePath,
      path: relativePath.replaceAll('\\', '/'),
      size: fs.statSync(absolutePath).size,
      type: mimeType(relativePath),
    });
  }

  const sceneChapters = {};
  for (const match of source.matchAll(/scene\.chapter-0*([1-9]\d*)\.[A-Za-z0-9._-]+/g)) {
    sceneChapters[match[0]] = `chapter-${Number(match[1])}`;
  }
  return { packs, sceneChapters };
}

async function writeBuffer(handle, hash, buffer) {
  hash.update(buffer);
  await handle.write(buffer);
}

async function buildPack(outputFile, files) {
  files.sort((a, b) => a.path.localeCompare(b.path));
  let offset = 0;
  const entries = files.map((file) => {
    const entry = { p: file.path, o: offset, l: file.size, t: file.type };
    offset += file.size;
    return entry;
  });
  const index = Buffer.from(JSON.stringify({ version: 1, entries }));
  const indexLength = Buffer.allocUnsafe(4);
  indexLength.writeUInt32LE(index.length);
  const handle = await fs.promises.open(outputFile, 'w');
  const hash = crypto.createHash('sha256');
  try {
    await writeBuffer(handle, hash, MAGIC);
    await writeBuffer(handle, hash, indexLength);
    await writeBuffer(handle, hash, index);
    for (const file of files) {
      for await (const chunk of fs.createReadStream(file.absolutePath)) {
        await writeBuffer(handle, hash, chunk);
      }
    }
  } finally {
    await handle.close();
  }
  return {
    entries: files.length,
    indexBytes: index.length,
    sha256: hash.digest('hex'),
    size: 12 + index.length + offset,
  };
}

for (const gameRoot of gameRoots) {
  const dist = path.join(root, gameRoot, 'src', 'dist');
  const assets = path.join(dist, 'assets');
  const bundleName = fs.readdirSync(assets).find((name) => /^index-.*\.js$/.test(name));
  if (!bundleName) throw new Error(`${gameRoot}: entry bundle was not found`);
  const bundleFile = path.join(assets, bundleName);
  const source = fs.readFileSync(bundleFile, 'utf8');
  const assetMap = extractAssetMap(source, bundleFile);
  const { packs, sceneChapters } = collectPackFiles(gameRoot, source, assetMap);
  const packDir = path.join(dist, 'packs');
  fs.rmSync(packDir, { force: true, recursive: true });
  fs.mkdirSync(packDir, { recursive: true });

  const order = [...new Set(Object.values(sceneChapters))]
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const packOrder = ['base', ...order];
  const manifest = {
    version: PACK_VERSION,
    game: gameRoot,
    initial: ['base', order[0]].filter(Boolean),
    order,
    sceneChapters,
    packs: {},
  };

  for (const packId of packOrder) {
    const files = packs.get(packId) ?? [];
    if (files.length === 0) continue;
    const fileName = `${packId}.${PACK_VERSION}.rpgpack`;
    const details = await buildPack(path.join(packDir, fileName), files);
    manifest.packs[packId] = { file: fileName, ...details };
    console.log(
      `${gameRoot}/${packId}: ${details.entries} files, ${(details.size / 1e6).toFixed(1)} MB`,
    );
  }
  fs.writeFileSync(
    path.join(packDir, 'manifest.json'),
    `${JSON.stringify(manifest)}\n`,
  );
}

console.log(`Chapter packs built: ${PACK_VERSION}`);
