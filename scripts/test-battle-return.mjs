// Regression: revisit a cached map, trigger a Yarn battle, win, and verify that
// the visible map (not another cached map) receives dialogue, movement and Esc.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { VERSION } from './patch-game-battle-owner.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(root, 'src-46/src/node_modules/playwright'));
const remote = process.env.RPG_TEST_REMOTE === '1';
const games = (process.env.RPG_TEST_GAMES || '45,46').split(',');
const realCombat = process.env.RPG_TEST_REAL_COMBAT === '1';
const cases = [
  { name: 'police', scene: 'scene.chapter-01.downtown', cached: 'scene.chapter-01.dock-warehouse',
    chapter: 'chapter-01', quest: 'ch1_way_out', stage: 'run-downtown', nextStage: 'unmask',
    node: 'Ch1_Ambush_Confront', npc: 'police_officer', x: 512, y: 512 },
  { name: 'neon', scene: 'scene.chapter-02.neon-club-street', cached: 'scene.chapter-02.hillside-hq',
    chapter: 'chapter-02', quest: 'ch2_deep_water', stage: 'mia-intel', nextStage: 'promote',
    node: 'Dlg_Ambush_Pre', npc: 'ch2_gulf_crew', x: 1148, y: 260 },
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.join(root, relative);
  // A passing test cannot silently fall back to loose media files missing on R2.
  const looseMedia = /\/dist\/assets\//.test(relative) && !/\.(js|css|woff2)$/.test(relative);
  if (!file.startsWith(root + path.sep) || looseMedia || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  for (const game of games) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const saveKey = game === '46' ? 'rpg-dreamer:src-46:saves' : 'phaser-rpg-minimal:saves';
    for (const fixture of cases) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const phase = value => page.waitForFunction(value => window.__WEBRPG_AGENT__?.getSnapshot().observation.phase === value, value, { timeout: 60000 });
      const base = remote ? 'https://pub-f92b6274842f4c76bae0e87541458375.r2.dev/rpg-dreamer' : `http://127.0.0.1:${server.address().port}`;
      await page.goto(`${base}/src-${game}/src/dist/index.html?v=${VERSION}`, { waitUntil: 'domcontentloaded' });
      await phase('menu');
      await page.evaluate(key => { localStorage.removeItem(key); window.__WEBRPG_GAME__.scene.getScene('menu').agentNewGame(); }, saveKey);
      await phase('save_slots');
      await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('save-slots').agentSelectSlot(1));
      await page.waitForFunction(key => !!JSON.parse(localStorage.getItem(key) || '[]')[0], saveKey);
      await page.evaluate(({ key, f }) => {
        const saves = JSON.parse(localStorage.getItem(key)), save = saves[0];
        save.scene = f.scene; save.x = f.x; save.y = f.y; save.activeChapterId = f.chapter;
        save.completedChapterIds = f.chapter === 'chapter-02' ? ['chapter-01'] : [];
        save.quest.quests[f.quest] = { flags: {}, status: 'active', stage: f.stage, objectives: f.name === 'neon'
          ? { hear_mia_intel: { completed: true, current: 1 }, win_neon_ambush: { completed: false, current: 0 } } : {} };
        localStorage.setItem(key, JSON.stringify(saves));
      }, { key: saveKey, f: fixture });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await phase('menu');
      await page.evaluate(key => window.__RPG_PACK_ENSURE_SCENE__(key), fixture.scene);
      await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('menu').agentLoadGame());
      await phase('save_slots');
      await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('save-slots').agentSelectSlot(1));
      await phase('world');
      // Keep both maps instantiated, with listener creation order opposite to
      // active-scene order. This is the missing condition in the old tests.
      await page.evaluate(f => window.__WEBRPG_GAME__.scene.getScene(f.scene).scene.launch(f.cached, { __rpgPreviousSceneKey: f.scene }), fixture);
      await page.waitForFunction(f => {
        const g = window.__WEBRPG_GAME__;
        return g.scene.isSleeping(f.scene) && g.scene.isActive(f.cached) && g.scene.getScene(f.cached).player;
      }, fixture, { timeout: 60000 });
      await page.evaluate(f => window.__WEBRPG_GAME__.scene.wake(f.scene, { __rpgPreviousSceneKey: f.cached, spawnX: f.x, spawnY: f.y }), fixture);
      await page.waitForFunction(f => window.__WEBRPG_GAME__.scene.isActive(f.scene) && window.__WEBRPG_GAME__.scene.isSleeping(f.cached), fixture);
      await page.evaluate(f => window.__WEBRPG_GAME__.scene.getScene(f.scene).openTriggerDialogue(f.node), fixture);
      for (let i = 0; i < 60; i++) {
        if (await page.evaluate(() => window.__WEBRPG_GAME__.scene.isActive('battle'))) break;
        await page.keyboard.press('Space', { delay: 35 }); await page.waitForTimeout(100);
      }
      await page.waitForFunction(() => {
        const g = window.__WEBRPG_GAME__, b = g.scene.getScene('battle');
        return g.scene.isActive('battle') && b.enemyParticipants?.length && b.playerParticipants?.length;
      }, null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('battle').parentSceneKey), fixture.scene, 'Battle must belong to the visible map');
      if (realCombat) {
        // Match the reported ATK/DEF, keeping enemy HP and real turn/animation
        // resolution intact. This modifies only the private test save.
        await page.evaluate(f => {
          const p = window.__WEBRPG_GAME__.scene.getScene(f.scene).getSaveGame().characters.player;
          p.combatStats.ATK = 75; p.combatStats.DEF = 11;
        }, fixture);
        for (let turn = 0; turn < 20; turn++) {
          await page.waitForFunction(() => { const b = window.__WEBRPG_GAME__.scene.getScene('battle'); return b.currentTurn === 'player' || b.resultStatus !== null; }, null, { timeout: 30000 });
          if (await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('battle').resultStatus !== null)) break;
          await page.evaluate(f => {
            const g = window.__WEBRPG_GAME__, b = g.scene.getScene('battle'), chars = g.scene.getScene(f.scene).getSaveGame().characters;
            const target = b.enemyParticipants.find(e => chars[e.id].resources.health.current > 0).id;
            b.executePlayerCommand({ type: 'attack', target: 'enemy' }, [target]);
          }, fixture);
          await page.waitForTimeout(400);
        }
      } else await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('battle').finishBattle('victory'));
      assert.equal(await page.evaluate(() => window.__WEBRPG_GAME__.scene.getScene('battle').resultStatus), 'victory');
      // This game's battle result is a pointer button (Space advances Yarn
      // dialogue, not the result panel). Exercise its actual click handler.
      const button = await page.evaluate(() => {
        const g = window.__WEBRPG_GAME__, b = g.scene.getScene('battle').actionButtons[0];
        const rect = g.canvas.getBoundingClientRect();
        return { x: rect.x + b.x * rect.width / g.scale.width, y: rect.y + b.y * rect.height / g.scale.height };
      });
      await page.mouse.click(button.x, button.y);
      await page.waitForFunction(f => window.__WEBRPG_GAME__.scene.isActive(f.scene) && !window.__WEBRPG_GAME__.scene.isActive('battle'), fixture);
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(120);
        if (await page.evaluate(() => window.__WEBRPG_AGENT__.getSnapshot().observation.phase === 'world')) break;
        await page.keyboard.press('Space', { delay: 35 });
      }
      await phase('world');
      const state = () => page.evaluate(f => {
        const g = window.__WEBRPG_GAME__, w = g.scene.getScene(f.scene);
        return { active: g.scene.isActive(f.scene), otherSleeping: g.scene.isSleeping(f.cached),
          input: w.input.enabled, running: g.loop.running, blocking: w.isBlockingUiOpen(),
          stage: w.getSaveGame().quest.quests[f.quest].stage, x: w.player.x, y: w.player.y };
      }, fixture);
      const before = await state();
      assert(before.active && before.otherSleeping && before.input && before.running && !before.blocking);
      assert.equal(before.stage, fixture.nextStage);
      await page.keyboard.down('a'); await page.waitForTimeout(450); await page.keyboard.up('a');
      const after = await state();
      assert(Math.hypot(after.x - before.x, after.y - before.y) > 1, 'Visible map must respond to movement after victory');
      await page.keyboard.press('Escape'); await phase('paused');
      await page.keyboard.press('Escape'); await phase('world');
      assert.deepEqual(errors, []);
      reports.push({ game, battle: fixture.name, remote, realCombat, before, after, escape: 'passed', errors });
      console.log(`PASS src-${game} ${fixture.name}: cached-map battle ownership, victory, dialogue, movement, Esc`);
      await page.close();
    }
    await context.close();
  }
  fs.mkdirSync(path.join(root, 'workspace/battle-owner'), { recursive: true });
  fs.writeFileSync(path.join(root, `workspace/battle-owner/${remote ? 'remote' : 'local'}-${realCombat ? 'combat' : 'return'}-report.json`), JSON.stringify(reports, null, 2));
} finally {
  await browser.close(); server.close();
}
