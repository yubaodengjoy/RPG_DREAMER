import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { patchBattleOwner } from './patch-game-battle-owner.mjs';

const root = path.resolve(import.meta.dirname, '..');
for (let number = 40; number <= 46; number++) {
  const dir = path.join(root, `src-${number}/src/dist/assets`);
  const file = fs.readdirSync(dir).find(name => /^index-.*\.js$/.test(name));
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  const fixed = patchBattleOwner(source);
  assert.equal(patchBattleOwner(fixed), fixed, 'patch must be idempotent');
  const match = fixed.match(/startBattleFromNpc\(e\)\{([\s\S]*?)\}startNpcBattle\(\)/);
  assert.ok(match, `src-${number}: battle handler exists`);
  const lookup = match[1].match(/let t=([\w$]+)\(e\)/)[1];
  const npcs = { enemy: { id: 'enemy', scene: 'current', battle: {} }, invalid: { id: 'invalid', scene: 'current' } };
  const launch = vm.runInNewContext(`(function(e){${match[1]}})`, { [lookup]: id => npcs[id] });
  const effects = [];
  function scene(key, active) {
    return {
      scene: { key, isActive: query => query === key && active }, definition: { id: key },
      activeDialogue: ['preserve'], dialogueIndex: 7,
      closeDialogue() { effects.push(['close', key]); }, closeDialogueChoice() {}, closeBattleChoice() {},
      launchNpcBattle(_battle, npc) { effects.push(['launch', key, npc]); },
    };
  }
  // Simulate the real broadcast order after returning to a previously visited
  // map: its listener runs before the more recently created, sleeping map.
  const current = scene('current', true), sleeping = scene('old', false);
  [current, sleeping].forEach(receiver => launch.call(receiver, 'enemy'));
  assert.deepEqual(effects.filter(e => e[0] === 'launch'), [['launch', 'current', 'enemy']]);
  assert.deepEqual(sleeping.activeDialogue, ['preserve']);
  assert.equal(sleeping.dialogueIndex, 7);
  effects.length = 0;
  launch.call(scene('old', true), 'enemy'); // Overlapping transition frame.
  launch.call(scene('current', false), 'enemy'); // Paused or sleeping owner.
  assert.equal(effects.length, 0, 'ineligible maps must not mutate UI or launch');
  assert.throws(() => launch.call(current, 'invalid'), /without battle config/);
  console.log(`PASS src-${number}: only the active NPC owner handles battle requests`);
}
assert.throws(() => patchBattleOwner('unexpected bundle'), /expected one/);
