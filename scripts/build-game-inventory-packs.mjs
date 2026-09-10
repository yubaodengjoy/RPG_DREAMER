#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const version = process.env.RPG_INVENTORY_VERSION ?? '20260910-inventory-01';
const auditDirectory = path.resolve(process.env.RPG_ICON_AUDIT_DIR ?? path.join(root, 'workspace/icon-audit'));
const gameRoots = process.env.RPG_GAME_ROOTS?.split(',').map(s => s.trim()).filter(Boolean)
  ?? ['src-40', 'src-41', 'src-42', 'src-43', 'src-44', 'src-45'];

function packedPath(value) {
  const pathname = new URL(value, 'https://local.invalid/').pathname;
  const marker = '/src/dist/';
  const index = pathname.lastIndexOf(marker);
  return index >= 0 ? pathname.slice(index + marker.length) : pathname.replace(/^\/+/, '');
}

function readPayload(dist, manifest, assetPath) {
  const packId = manifest.assetPacks[assetPath];
  const details = manifest.packs[packId];
  if (!details) throw new Error(`No pack owns ${assetPath}`);
  const descriptor = fs.openSync(path.join(dist, 'packs', details.file), 'r');
  try {
    const header = Buffer.alloc(12);
    fs.readSync(descriptor, header, 0, 12, 0);
    if (header.subarray(0, 8).toString() !== 'RPGPK001') throw new Error(`Invalid ${packId} pack`);
    const size = header.readUInt32LE(8);
    const index = Buffer.alloc(size);
    fs.readSync(descriptor, index, 0, size, 12);
    const entry = JSON.parse(index).entries.find(e => e.p === assetPath);
    if (!entry) throw new Error(`Missing packed asset ${assetPath}`);
    const data = Buffer.alloc(entry.l);
    if (fs.readSync(descriptor, data, 0, entry.l, 12 + size + entry.o) !== entry.l) {
      throw new Error(`Truncated packed asset ${assetPath}`);
    }
    return data;
  } finally {
    fs.closeSync(descriptor);
  }
}

const changed = [];
for (const gameRoot of gameRoots) {
  const audit = JSON.parse(fs.readFileSync(path.join(auditDirectory, `${gameRoot}.json`), 'utf8'));
  const dist = path.join(root, gameRoot, 'src/dist');
  const manifestFile = path.join(dist, 'packs/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const initial = new Set(manifest.initial);
  const icons = audit.assets.filter(asset => audit.itemAtlases.includes(asset.id));
  const needsRepair = audit.atlasAudit.some(atlas => atlas.missing.length || !atlas.loaded)
    || icons.some(a => ['imagePath', 'dataPath'].some(key => !initial.has(manifest.assetPacks[packedPath(audit.urls[a[key]])])));
  if (!needsRepair) {
    console.log(`${gameRoot}: complete icon bindings and startup coverage; unchanged`);
    continue;
  }

  const files = new Map();
  const repairedFiles = new Set();
  for (const asset of icons) {
    const repair = audit.atlasAudit.find(a => a.id === asset.id).missing.length > 0;
    for (const key of ['imagePath', 'dataPath']) {
      const assetPath = packedPath(audit.urls[asset[key]]);
      const sourceFile = path.join(root, gameRoot, 'src/src/assets', asset[key]);
      const data = repair ? fs.readFileSync(sourceFile) : readPayload(dist, manifest, assetPath);
      files.set(assetPath, { data, type: key === 'dataPath' ? 'application/json' : 'image/png' });
      if (repair) repairedFiles.add(assetPath);
    }
    const json = JSON.parse(files.get(packedPath(audit.urls[asset.dataPath])).data);
    for (const item of audit.items.filter(i => i.icon.atlasAssetId === asset.id)) {
      for (let frame = 0; frame < 4; frame++) {
        const key = `${item.icon.framePrefix}.${String(frame).padStart(3, '0')}`;
        if (!json.frames[key]) throw new Error(`${gameRoot}: missing generated frame ${key}`);
      }
    }
  }

  let offset = 0;
  const entries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, file]) => {
    const entry = { p, o: offset, l: file.data.length, t: file.type };
    offset += entry.l;
    return entry;
  });
  const index = Buffer.from(JSON.stringify({ version: 1, entries }));
  const header = Buffer.alloc(12);
  header.write('RPGPK001');
  header.writeUInt32LE(index.length, 8);
  const payload = Buffer.concat([header, index, ...entries.map(entry => files.get(entry.p).data)]);
  const file = `inventory.${version}.rpgpack`;
  const backupDirectory = path.join(auditDirectory, 'backups', gameRoot);
  fs.mkdirSync(backupDirectory, { recursive: true });
  for (const [name, filePath] of [['manifest.json', manifestFile], ['index.html', path.join(dist, 'index.html')]]) {
    const backup = path.join(backupDirectory, name);
    if (!fs.existsSync(backup)) fs.copyFileSync(filePath, backup);
  }
  for (const assetPath of repairedFiles) {
    const destination = path.join(dist, assetPath);
    const backup = path.join(backupDirectory, assetPath);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (!fs.existsSync(backup)) fs.copyFileSync(destination, backup);
    // Keep the build inputs in sync so a future full pack build also uses the
    // generated icons. The old chapter pack binaries remain as the backup.
    fs.writeFileSync(destination, files.get(assetPath).data);
  }
  fs.writeFileSync(path.join(dist, 'packs', file), payload);
  manifest.packs.inventory = {
    file, entries: entries.length, indexBytes: index.length,
    sha256: crypto.createHash('sha256').update(payload).digest('hex'), size: payload.length,
  };
  for (const entry of entries) manifest.assetPacks[entry.p] = 'inventory';
  manifest.initial = ['base', 'inventory', ...manifest.initial.filter(id => id !== 'base' && id !== 'inventory')];
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest)}\n`);
  const indexFile = path.join(dist, 'index.html');
  const html = fs.readFileSync(indexFile, 'utf8').replace(/rpg-pack-loader\.js(?:\?v=[^"']+)?/, `rpg-pack-loader.js?v=${version}`);
  fs.writeFileSync(indexFile, html);
  changed.push({ game: gameRoot, file, size: payload.length, icons: audit.items.length });
  console.log(`${gameRoot}: ${audit.items.length} inventory icons available at boot; ${payload.length} bytes`);
}
fs.writeFileSync(path.join(auditDirectory, 'inventory-pack-report.json'), JSON.stringify({ version, changed }, null, 2));
