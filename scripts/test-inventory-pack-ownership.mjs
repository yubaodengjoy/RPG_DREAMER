import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function pack(files) {
  let offset = 0;
  const entries = Object.entries(files).map(([p, text]) => {
    const data = Buffer.from(text);
    const entry = { p, o: offset, l: data.length, t: 'text/plain' };
    offset += data.length;
    return entry;
  });
  const index = Buffer.from(JSON.stringify({ entries }));
  const header = Buffer.alloc(12);
  header.write('RPGPK001');
  header.writeUInt32LE(index.length, 8);
  return new Blob([header, index, ...Object.values(files)]);
}
const payloads = {
  base: pack({ 'assets/icon.png': 'obsolete base icon' }),
  inventory: pack({ 'assets/icon.png': 'new icon', 'assets/later.png': 'new later icon' }),
  'chapter-1': pack({ 'assets/icon.png': 'obsolete chapter icon' }),
  'chapter-2': pack({ 'assets/later.png': 'obsolete later icon', 'assets/map.png': 'new map' }),
};
const manifest = {
  game: 'test', version: 'test', initial: ['base', 'inventory', 'chapter-1'],
  order: ['chapter-1', 'chapter-2'], sceneChapters: { first: 'chapter-1', next: 'chapter-2' },
  packs: Object.fromEntries(Object.entries(payloads).map(([id, blob]) => [id, { file: `${id}.rpgpack`, size: blob.size, sha256: id }])),
  assetPacks: { 'assets/icon.png': 'inventory', 'assets/later.png': 'inventory', 'assets/map.png': 'chapter-2' },
};
const urls = new Map();
class TestURL extends URL {
  static createObjectURL(blob) { const value = `blob:test/${urls.size}`; urls.set(value, blob); return value; }
  static revokeObjectURL(value) { urls.delete(value); }
}
class TestXHR {
  open(_method, url) { this.url = new URL(url); }
  send() {
    const id = this.url.pathname.split('/').pop().replace('.rpgpack', '');
    this.status = payloads[id] ? 200 : 404;
    this.response = payloads[id];
    queueMicrotask(() => this.onload());
  }
}
const context = {
  Blob, Uint8Array, DataView, TextDecoder, URL: TestURL, XMLHttpRequest: TestXHR,
  document: { baseURI: 'https://game.invalid/src-45/src/dist/' }, navigator: {},
  fetch: async () => ({ ok: true, json: async () => manifest }),
  console: { warn() {}, error() {} }, addEventListener() {},
};
context.window = context;
vm.runInNewContext(fs.readFileSync(new URL('../project-page/play-games/rpg-pack-loader.js', import.meta.url), 'utf8'), context);
await context.__RPG_PACK_READY__;
assert.equal(await urls.get(context.__RPG_PACK_RESOLVE__('./assets/icon.png')).text(), 'new icon');
assert.equal(context.__RPG_PACK_ASSET_READY__('./assets/map.png'), false);
await context.__RPG_PACK_ENSURE_SCENE__('next');
// This icon is first resolved after chapter two arrives, so the URL cache
// cannot conceal a chapter overwriting the inventory pack's selected data.
assert.equal(await urls.get(context.__RPG_PACK_RESOLVE__('./assets/later.png')).text(), 'new later icon');
assert.equal(await urls.get(context.__RPG_PACK_RESOLVE__('./assets/map.png')).text(), 'new map');
assert.equal(context.__RPG_PACK_ASSET_READY__('./assets/map.png'), true);
console.log('PASS: selected icons survive later chapter loads; scene assets become available when their pack arrives.');
