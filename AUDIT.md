# Bug audit

Read-only review of `game.js`, `index.html`, `style.css` after the card overhaul
(~10 cards deleted, ~10 added, several engine changes). Line numbers are a snapshot
and will drift; identifier names are the reliable anchor.

Findings are ordered worst-first. Nothing here has been fixed.

---

## CRITICAL

### 1. Killing the boss with Bramble Guard retaliation on the turn you die shows YOU DIED

**Location:** `endTurn` lines 673–684, `checkCombatEnd` lines 710–723.

`endTurn` fires retaliation *before* it applies the boss's damage:

```js
fireEvent('playerAttacked', …)   // line 673 — boss.hp can reach 0 here
const dealt = Math.max(0, dmg - c.block);
game.hp = Math.max(0, game.hp - dealt);   // line 675 — player can reach 0 here
…
if (game.hp <= 0) { renderCombat(); checkCombatEnd(); return; }   // line 680 — checked FIRST
if (c.boss.hp <= 0) { … }                                         // line 689 — never reached
```

`checkCombatEnd` also checks `game.hp <= 0` before `c.boss.hp <= 0`. So when both reach 0
on the same boss attack, the boss-death branch at line 689 is dead code and the run ends on
the gameover screen with `boss.hp === 0` sitting in state.

**Repro:** buy 2× Bramble Guard. Play both on an early turn (they register combat-scoped
listeners, 5 damage each). Grind the boss to 8 HP or less and let your own HP drop to at
most the boss's next intent, playing no block that turn. End turn: the log prints
"Bramble Guard retaliates for 5" twice, boss HP goes 8 → 3 → 0, then the boss's 11 damage
kills you. Result is "YOU DIED", not the market.

The `!c || game.hp <= 0 || c.boss.hp <= 0` guard at line 664 then permanently blocks
`endTurn`, so there is no recovery. Whole run lost on a fight that was won.

The comment at 686–688 says the check at 689 exists "for exactly this reason" — it does,
but it sits behind the player-death check that the same scenario trips.

---

## MAJOR

### 2. No "roll in progress" lock — a CSS overlay is the only guard, and it does not cover the keyboard

**Location:** `rollDie` 458–484, `flipCoin` 486–511, `.dice-overlay` (`style.css` 285–295),
`canPlayCard` 518–528.

The three `deferredAttack` cards resolve ~1060 ms after leaving the hand (11 spin ticks ×
60 ms + 400 ms). Nothing in game state records that a roll is pending — no `c.rolling`
flag, and neither `canPlayCard` nor `endTurn` checks for one. The sole defence is
`.dice-overlay { position: fixed; inset: 0; z-index: 1000 }`, which does correctly eat
mouse clicks. It does not stop keyboard activation.

`#btn-end-turn` is the only focusable element on the active combat screen, so during the
overlay a single **Tab, then Space** runs `endTurn()` mid-roll. Consequences, escalating:

- **Damage lands in the wrong turn.** `endTurn` resets `turnAttackCount` at line 697; the
  pending `resolveAttackHit` then fires into the *new* turn, dealing damage a turn late and
  starting the new turn's attack combo at 1 instead of 0. A subsequent Combo Strike gets a
  bonus it did not earn.
- **Damage lands after death.** If the boss's attack kills the player, `checkCombatEnd`
  shows the gameover screen; ~400 ms later the callback still calls `resolveAttackHit`,
  `renderCombat` and `checkCombatEnd` against the corpse combat.
- **Duplicate boss reward and a re-rolled market** — see finding 3.
- **Damage into a replaced combat.** From gameover, `btn-restart-lose` → `newRun()` →
  `startCombat()` builds a fresh `game.combat`. The pending callback reads `game.combat` at
  call time (`resolveAttackHit` line 389, Bramble Guard's listener line 69), so it hits the
  *new run's first boss* for free and bumps its combo counter. Same via market → Continue
  if the two clicks land inside a second.

**Repro:** play Glass Cannon; while the die spins, press Tab then Space. The boss's attack
resolves, then "Glass Cannon: rolled 5, hit for 30 damage" appears on the following turn.

### 3. `checkCombatEnd` is not idempotent — every extra call re-grants the boss reward and wipes the market

**Location:** `checkCombatEnd` 710–723, `openMarket` 728–733.

```js
if (c.boss.hp <= 0) {
  const reward = gainGold(15 + 5 * game.bossIndex);
  logMsg(…); openMarket();
}
```

There is no `combatOver` flag and `boss.hp` stays at 0 for the whole market visit. Any
second call while the market is open pays the reward again *and* calls `openMarket()`,
which reassigns `marketState` — offers are re-rolled and `boughtCardKeys` is cleared, so
already-purchased cards show as buyable again (the bought card is kept and can be bought a
second time).

**Repro:** chain onto finding 2. Play Glass Cannon with Bramble Guard listeners active;
Tab+Space during the roll; the retaliation kills the boss → market opens with reward #1;
buy a card; ~400 ms later Glass Cannon's callback runs `checkCombatEnd` → reward #2 lands
and the shop resets. Two boss rewards, a fresh shop, and an owned card back on the shelf.

Independent of the keyboard route, the shape is wrong: `checkCombatEnd` is called from six
sites (`playCard` 609, three card callbacks, `endTurn` 682 and 691) and none of them can
tell whether the fight has already been resolved.

### 4. Combo counters tick per *hit*, but three card descriptions promise per *card*

**Location:** `resolveAttackHit` 390, `resolveBlockGain` 406, the `hits` loops in `playCard`
553 and 575.

Multi-hit cards increment the counters once per hit, so one card can advance the combo by 4
or 5 steps. The descriptions say otherwise:

- **Stonewall** — *"+4 per block **card** already played this turn."* Play Bulwark
  (`hits: 4`) then Stonewall: `turnBlockCount` is 4, so Stonewall's base is `4 + 4×4 = 20`
  at ×1.8 → **36 block**, not the 8 its text implies. Off by a factor of 4.5.
- **Combo Strike** — *"+3 per attack already played this turn."* Thousand Cuts (`hits: 5`)
  counts as five prior attacks.
- **Skim** — *"Gain 1 gold per attack already played this turn."* One Thousand Cuts pays 5
  gold.

Either the descriptions or the counters are wrong; they cannot both be right. Stonewall is
the clearest case because it says "card" explicitly.

### 5. Boss list and rules text disagree; boss 4 is effectively unlosable

**Location:** `BOSSES` 217–222, `index.html` 15 and 25.

`BOSSES` has four entries; the start screen says *"Survive three bosses"* and the how-to-play
never mentions a fourth. The fourth, `God`, is `maxHp: 500, pattern: [6, 7]` — 6.5 damage
per turn against a player who starts at 100 HP and can buy +10 Max HP repeatedly. It cannot
realistically kill you; it is a ~15-turn grind with no failure state. The comment at 215–216
explains the *other* three bosses' HP scaling and does not mention this one.

---

## MINOR

### 6. No combo popup on deferred attacks

`showComboPopup` is only called from `playCard` (line 606). Glass Cannon, Roll the Bones and
Double or Nothing all go through `resolveAttackHit` and take the full multiplier, but never
show the `ATK x1.60` popup. The UI says "no combo" while the logic applied one.

### 7. Energy readout can exceed its own denominator

`renderCombat` line 834 prints `${c.energy}/${BASE_ENERGY}`. Play Burnout (`energyGain: 3`)
on a full bar and it reads `6/3`.

### 8. Protection Racket never pays on the turn it is played, and can pay zero times

`turnStart` is fired only at the end of `endTurn`'s survival block (line 706) — `startCombat`
does not fire it. Desc: *"Gain 3 gold at the start of each turn for the rest of this
combat."* Play it on the turn that kills the boss and it pays nothing for its 1 energy. The
log line at 109 is honest about this; the card text is not.

### 9. `growCardOffersToShopSize` samples with replacement

Line 745 picks `SHOP_POOL_KEYS[random]` with no dedupe, while `openMarket` (729) uses
`shuffle().slice()` and is duplicate-free. Buy Shop Size and the new slot can be a second
copy of a card already on the shelf — two separate indices, both buyable, tracked separately
in `boughtCardKeys`.

### 10. The run deck can reach zero cards, leaving an unwinnable run

`btn-remove` is disabled at `deck.length === 0` (line 957), so removal alone cannot empty the
deck — but `trashCard` has no such floor. Whittle down to a single Glass Cannon, play it,
roll 1–3: `game.deck` is now `[]`. `startCombat` shuffles an empty draw pile, `drawCards`
returns immediately, the hand is permanently empty. Only End Turn remains until the boss
kills you. Contrived, but a dead run rather than a loss.

### 11. `trashCard`'s null-guard is half-applied

Line 374 guards the combat zones with `if (c)`, then line 380 calls `logMsg`, which
dereferences `game.combat.log` unguarded — as does `fireEvent` at 381. Currently unreachable
(`game.combat` is only null inside the `newRun` object literal, before `startCombat` runs on
the next line), so this is dead defensiveness rather than a live crash, but the two halves
disagree about whether combat can be absent.

### 12. Deck count vs. exhaust pile

`deck-count-text` shows `game.deck.length`, which still counts Burnout after it is exhausted,
and `exhaustPile` is never surfaced. Already catalogued in `DORMANT.md` §6; noted here only
because it is the one place the visible numbers cannot be reconciled by the player.

---

## LATENT

No live card triggers these, but the engine is wrong if one is added.

- **`hits` cross-contaminates the two branches.** Both loops read `card.hits` (549–557 and
  565–582). A card with `block` + `baseDamage` + `hits: 3` gains block three times *and*
  attacks three times off one `hits` value, with no way to specify them separately. Same for
  `isAttackToo` + `hits`. Verified no current card is affected: the only `hits` cards are
  Twin Blades (2), Thousand Cuts (5) and Bulwark (4), none of which carry the other half;
  Shield Bash carries `isAttackToo` but no `hits`.
- **`onPlay` runs *during* a pending discard selection.** `playCard` calls
  `beginDiscardSelection` at 599 and then `card.onPlay(card)` at 604 — outside the if/else
  that defers `resolveDeferrableEffects`. A card with both `discardCost` and `onPlay` fires
  its `onPlay` before the cost is paid. Worse if that `onPlay` is a `deferredAttack`: the
  roll would start with the selection open.
- **`discardRandom` + `discardCost` on the same card would softlock.** `discardRandomCards`
  (594) runs before `beginDiscardSelection` (598) and can empty the hand below what
  `canPlayCard` validated, leaving a selection with `remaining > 0` and nothing to click.
  `endTurn` is guarded on `discardSelection`, so that state is unrecoverable. `DORMANT.md` §4
  documents the clamped/hard-requirement distinction but not that the two are order-dependent.
- **`fireEvent` iterates a live array.** `for (const status of game.combat.statuses)` (347) —
  a listener that calls `addStatus` for the same event fires within the same dispatch.

---

## Checked and clean

**Gold cannot go negative or be double-spent.** Every sink is gated: `canPlayCard` 522 for
`goldCost`, `buyMarketCard` 754, `buyMarketTrinket` 766, `doHeal` 779, `openRemoveScreen`
786. `discountedPrice` short-circuits `<= 0` before the `Math.max(1, …)` floor, so the two
`price: 0` gamble cards stay genuinely free, and the floor holds even at `shopDiscount > 1.0`
(negative product → `Math.max(1, …)` → 1). The only duplication is finding 3.

**`trashCard` covers every zone.** `game.deck`, `drawPile`, `hand`, `discardPile`,
`exhaustPile` — all five holders of card instances. `marketState.cardOffers` are library
spreads without uids and never enter the deck (`buyMarketCard` calls `instantiateCard`), so
they are correctly out of scope.

**`canPlayCard` is complete and is the only gate.** Energy, gold, discard cost
(`hand.length - 1`, correctly accounting for the card still being in hand at both call
sites), self-damage lethality, and the discard-selection lock. `playCard` re-checks it at 536
after the `findIndex`, and `renderCombat` only attaches `onclick` to cards it passes — so a
stale handler cannot play an unplayable card.

**The discard-selection flow cannot be entered and abandoned.** `canPlayCard` guarantees the
cards exist, nothing between the check and `beginDiscardSelection` removes hand cards (for
current cards), `playCard` and `canPlayCard` both refuse while it is open, `btn-end-turn` is
disabled *and* `endTurn` guards independently, and no damage source can resolve during it
(the overlay prevents overlapping a deferred card with a selection in either order).

**Statuses do not leak across combats.** `startCombat` builds a fresh object with
`statuses: []`; no path carries a listener into the next fight. `turnStart` fires exactly
once per surviving `endTurn` and never on the first turn. `clearTurnStatuses` is the
documented no-op.

**Deck integrity.** `uidCounter` is global and never reset across runs, so uids stay unique;
`drawCards` handles the empty-draw/empty-discard case without looping; `instantiateCard` is
the only path into the deck.
