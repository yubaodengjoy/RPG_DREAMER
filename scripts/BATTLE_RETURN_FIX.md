# Cached-map battle return regression (2026-09-10)

All seven deployed games (`src-40` through `src-46`) retained the same global
`subscribeBattleRequests` callback while their world scenes were sleeping.
Yarn's `startBattle` broadcast reached every cached scene. A later-created,
sleeping scene could queue another launch of the shared Battle scene, replacing
its `parentSceneKey`. Victory then refreshed/saved/resumed that other map while
the visible map remained paused. No JavaScript exception was necessary.

Reproduced before the fix in Chinese src-45 and English src-46:

1. Load Neon Club Street at the `mia-intel` quest stage.
2. Visit Hillside HQ, retaining the club scene; return to the club.
3. Trigger `Dlg_Ambush_Pre` through Yarn, not by directly launching Battle.
4. Battle incorrectly reports `scene.chapter-02.hillside-hq` as its parent.
5. After victory, the visible club stays paused (scene status 6), its player does
   not move, and its displayed quest remains stale. The game loop still runs.

The repair restricts `startBattleFromNpc` to an active scene owning the NPC,
before any dialogue/UI mutation or Battle launch. Scene warmup now always
installs this guard, including when a previous warmup patch is already present.
There is no blanket forced-resume, timeout, save migration, or asset change.
The English editable source contains the same guard.

## Rebuild / apply

`node scripts/patch-game-battle-owner.mjs` patches existing converted bundles
and bumps only their entry-module query versions. It accepts `RPG_GAME_ROOTS`
and rejects an unexpected compiled handler rather than silently skipping it.
The chapter packs, inventories, audio, and save keys stay unchanged.

## Regression checks

- `node scripts/test-battle-scene-owner.mjs`: actual compiled handlers from all
  seven games; sleeping/paused maps, transient active non-owners, valid owners,
  malformed NPC configuration, and patch idempotence.
- `node scripts/test-battle-return.mjs`: Chinese and English police and club
  battles with cached-map revisits, Yarn battle dispatch, actual Continue-button
  clicks, post-battle quest/dialogue, movement, Escape/pause and resume. Serves
  only entry files and packs; loose media requests cannot hide missing resources.
- `RPG_TEST_REAL_COMBAT=1 node scripts/test-battle-return.mjs`: real combat
  damage/turn/animation resolution instead of forcing the result. Uses ATK 75 /
  DEF 11 in the private fixture; leaves enemy HP intact.
- `RPG_TEST_REMOTE=1 node scripts/test-battle-return.mjs`: repeat against R2.

`PLAYWRIGHT_MODULE` can select an existing Playwright installation. By default,
the tests use the dependency installed in `src-46/src/node_modules/playwright`.
`RPG_TEST_GAMES=45,46` selects editions. Reports go to ignored
`workspace/battle-owner/`. Pre-fix bundles are backed up locally in
`workspace/battle-owner-backup/`.
