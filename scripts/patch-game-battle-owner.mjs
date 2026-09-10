#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '20260910-battle-owner-01';
const activeGuard = 'if(!this.scene.isActive(this.scene.key))return;';
const ownerGuard = 'if(t&&t.scene!==this.definition.id)return;';
const original = /startBattleFromNpc\(e\)\{let t=([A-Za-z_$][\w$]*)\(e\),n=t\?\.battle;/g;
const patched = /startBattleFromNpc\(e\)\{if\(!this\.scene\.isActive\(this\.scene\.key\)\)return;let t=([A-Za-z_$][\w$]*)\(e\),n=t\?\.battle;if\(t&&t\.scene!==this\.definition\.id\)return;/g;

// World scenes are cached with sleep(), so their global Yarn battle-request
// subscriptions intentionally survive. Only the active NPC-owning scene may
// consume that broadcast. Otherwise an old scene overwrites parentSceneKey and
// victory resumes the wrong map, leaving the visible map permanently paused.
export function patchBattleOwner(source, label = 'bundle') {
  const oldMatches = [...source.matchAll(original)];
  const newMatches = [...source.matchAll(patched)];
  if (!oldMatches.length && newMatches.length === 1) return source;
  if (oldMatches.length !== 1 || newMatches.length) {
    throw new Error(`${label}: expected one unpatched battle-request handler`);
  }
  return source.replace(original, (_match, lookup) =>
    `startBattleFromNpc(e){${activeGuard}let t=${lookup}(e),n=t?.battle;${ownerGuard}`);
}

function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const games = (process.env.RPG_GAME_ROOTS || 'src-40,src-41,src-42,src-43,src-44,src-45,src-46').split(',');
  for (const name of games.map(value => value.trim()).filter(Boolean)) {
    const dist = path.join(root, name, 'src/dist');
    const bundles = fs.readdirSync(path.join(dist, 'assets')).filter(file => /^index-.*\.js$/.test(file));
    if (bundles.length !== 1) throw new Error(`${name}: expected exactly one entry bundle`);
    const file = path.join(dist, 'assets', bundles[0]);
    const before = fs.readFileSync(file, 'utf8');
    const after = patchBattleOwner(before, name);
    if (after !== before) fs.writeFileSync(file, after);
    const index = path.join(dist, 'index.html');
    const html = fs.readFileSync(index, 'utf8');
    const imports = [...html.matchAll(/(await import\("\.\/assets\/index-[^"?]+\.js)(?:\?v=[^"]+)?("\))/g)];
    if (imports.length !== 1) throw new Error(`${name}: expected one entry import`);
    fs.writeFileSync(index, html.replace(imports[0][0], `${imports[0][1]}?v=${VERSION}${imports[0][2]}`));
    console.log(`${name}: battle scene ownership ${after === before ? 'verified' : 'fixed'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
