import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./patch-game-chapter-packs.mjs', import.meta.url), 'utf8');
const expression = source.match(/^const readyContinue = (.+);$/m)?.[1];
assert(expression, 'The converter must supply the decode-ready continuation method');
const method = vm.runInNewContext(expression);

function fixture() {
  const calls = [];
  let resolveWarmup;
  let active = true;
  const pending = new Promise(resolve => { resolveWarmup = resolve; });
  const Ending = vm.runInNewContext(`(class Ending { ${method} })`, {
    __rpgWarmScene: (_scene, next) => { calls.push(['warm', next]); return pending; },
    console: { warn() {} },
  });
  const ending = new Ending();
  Object.assign(ending, {
    nextSceneId: 'chapter-two', startCutsceneId: 'intro-two', parentSceneKey: 'chapter-one',
    scene: {
      key: 'ending', isActive: () => active,
      stop: key => calls.push(['stop', key]),
      start: (key, data) => calls.push(['start', key, JSON.parse(JSON.stringify(data))]),
    },
  });
  return { ending, calls, resolveWarmup, deactivate: () => { active = false; } };
}

const ready = fixture();
assert.equal(ready.ending.agentContinueChapter().ok, true);
assert.equal(ready.ending.agentContinueChapter().ok, true);
assert.deepEqual(ready.calls, [['warm', 'chapter-two']], 'Keep the old scene alive and deduplicate repeated Space');
ready.resolveWarmup(true);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(ready.calls, [
  ['warm', 'chapter-two'], ['stop', 'chapter-one'],
  ['start', 'chapter-two', { chapterStartCutsceneId: 'intro-two', isChapterStart: true }],
]);

const failed = fixture();
failed.ending.agentContinueChapter();
failed.resolveWarmup(false);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(failed.calls, [['warm', 'chapter-two']]);
assert.equal(failed.ending.__rpgContinuing, false, 'A failed warmup must permit retry');
assert.equal(failed.ending.nextSceneId, 'chapter-two');

const exited = fixture();
exited.ending.agentContinueChapter();
exited.deactivate();
exited.resolveWarmup(true);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(exited.calls, [['warm', 'chapter-two']], 'An exited ending must not start a stale chapter');
console.log('PASS: chapter continuation waits for decoded assets, deduplicates Space, and handles failure/exit safely.');
