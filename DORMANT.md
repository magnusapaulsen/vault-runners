# Dormant machinery in `game.js`

Everything catalogued here is unused *right now* but deliberately kept, because it is the wiring that future cards will plug into. **Do not delete anything in this list without checking here first.** Line numbers are a snapshot and will drift; the identifier names are the reliable anchor.

---

# 0. Now live — revived, no longer dormant

The Gold Rush cards brought part of this catalogue back. Recorded here so the file stays honest about what is and isn't dead.

| Item | Revived by | Notes |
|---|---|---|
| `addStatus(on, scope, effect)` | **Protection Racket** | `addStatus('turnStart', 'combat', fn)` in its `onPlay`. One caller again, after having zero. |
| `fireEvent(eventName, payload)` | **Protection Racket** | Its `turnStart` call site now matches a real listener. The `cardMissed` and `playerAttacked` call sites still match nothing — see §1 and §2. |
| `combat.statuses` | **Protection Racket** | No longer permanently `[]`. Holds one entry per copy played. |
| `turnStart` event | **Protection Racket** | *New* event, added with these cards. Fired at the end of `endTurn`'s new-turn block (~line 625). |
| `card.selfDamage` | **Blood Money** | The `playCard` branch fires again. `canPlayCard` now also gates it: `selfDamage >= game.hp` makes a card unplayable, so self-damage can never be lethal. |
| `playerAttacked` event | **Bramble Guard** | `addStatus('playerAttacked', 'combat', fn)`. Note the scope: old Spiked Armor was `'turn'` and expired each turn; Bramble Guard is `'combat'` and retaliates every turn for the rest of the fight. |
| `card.isAttackToo` | **Shield Bash** | The `playCard` condition fires again, so one card ticks both `turnBlockCount` and `turnAttackCount`. |
| `card.damageFromBlockPercent` | **Shield Bash** | **Semantics changed — see below.** |

**`damageFromBlockPercent` came back with different semantics.** The old dormant branch dealt flat `round(block × pct)` damage, took no combo multiplier, and **zeroed the player's block**. It is now folded into the attack branch instead: it supplies the *base damage* fed to `resolveAttackHit`, so it scales with the attack multiplier and ticks `turnAttackCount` — and it **no longer spends the block**. The standalone branch is gone. Anything written against the old behaviour needs rechecking.

**`playCard` now resolves block BEFORE attack.** Required by Shield Bash, which gains block and then hits for the block it is standing on. Only cards carrying both halves (`isAttackToo`) can observe the ordering, and Shield Bash is the only one, so no existing card changed. The block/attack combo-popup labels swapped order as a side effect.

**A correction worth recording:** `combat.turnAttackCount` was never dormant — `resolveAttackHit` has always incremented and read it on every hit. What Skim adds is the first *card-level* reader of it. The counter that genuinely has no readers is **`combat.turnDamageDealt`**, and Skim does not fix that; it is still listed in §3.

The pub/sub subsystem is therefore now **partly** live: registration and dispatch work, but two of the three events still have no subscribers, and the `'turn'` scope has never been used since Spiked Armor.

---

# Quick index of what is still dormant

| Item | Kind | Status | Last user |
|---|---|---|---|
| `cardMissed` event | event | **fires, zero listeners** | Sore Loser |
| `'turn'` scope + `clearTurnStatuses()` | scope + fn | runs, always a no-op | Spiked Armor |
| `resolveGoldCardOutcome()` | function | called, body inert | Sore Loser |
| `combat.turnDamageDealt` | state | written, **never read** | Hit Job |
| `currentAttackMult()` | function | never called (**and off by one**) | Adrenaline |
| `card.discardRandom` + `discardRandomCards()` | card prop + fn | branch never taken | Reckless Swing |
| `card.retainBlock` | card prop | **fully removed — no trace** | Blood Magic |
| `makeCard()` | function | never called (pre-existing) | never used |

---

# 1. The miss / gamble hook

**The event side already works and fires correctly today.** Only the subscriber side is empty. Registration and dispatch are now proven live by Protection Racket, so a miss-payoff card needs nothing but a listener.

## `cardMissed`

**What it is:** an event fired through `fireEvent('cardMissed', { card })`.

**Where it fires from — both live right now:**

1. `trashCard(card)` (~line 348) — whenever a card is trashed out of the run. Currently reached only by Glass Cannon's failed roll (1–3 on a d6).
2. `resolveGoldCardOutcome(card, succeeded)` (~line 369) — when `succeeded` is `false`. Currently reached only by Double or Nothing on tails.

So a listener would already receive an event on **a Glass Cannon miss** and **a Double or Nothing tails**. Both fire on every occurrence; the events are simply dropped.

**What it did:** Sore Loser registered a combat-scoped listener adding `+3` to `soreLoserBonus` per miss, which `resolveAttackHit` folded into every later attack's base damage.

**Last user:** Sore Loser (deleted). `soreLoserBonus` was removed from combat state and from `resolveAttackHit`.

**To make it live again:**

```js
onPlay(card) {
  addStatus('cardMissed', 'combat', ({ card: missedCard }) => {
    // your payoff here
  });
}
```

Notes:

- Copy Protection Racket's registration shape — it is the working reference implementation now.
- The payload is `{ card }`, the card that missed. The payload plumbing still has **no** exercised consumer: Protection Racket's handler takes no arguments, as Sore Loser's did. Untested.
- If the payoff needs its own combat-state counter (as Sore Loser used `soreLoserBonus`), re-add that field to the object literal in `startCombat` — it is gone.
- To widen what counts as a miss, add more `fireEvent('cardMissed', …)` call sites; the listener side needs no changes.

## `resolveGoldCardOutcome(card, succeeded)` — ~line 368

**What it is:** the single seam every gold-cost gamble reports its outcome through.

**What it did:** originally handled Insurance Policy's refund (`insuranceActive`) *and* notified miss-passives. The refund half went with Insurance Policy; only the notify half remains:

```js
function resolveGoldCardOutcome(card, succeeded) {
  if (!succeeded) fireEvent('cardMissed', { card });
}
```

**Current status:** still called by Double or Nothing, but the single statement is inert for want of `cardMissed` listeners. A no-op function with a live call site.

**To make it live again:** this is the natural home for anything on *any* failed gamble — refunds, consolation gold, miss counters. Route new gold cards through it rather than re-implementing per card. Note that Roll the Bones and Glass Cannon do **not** call it (Roll the Bones cannot fail; Glass Cannon reports its miss via `trashCard`).

---

# 2. ~~`playerAttacked`~~ — REVIVED by Bramble Guard

No longer dormant; see §0. Kept here only for the facts a future listener needs:

- Fired once per `endTurn`, at the boss's attack, as `fireEvent('playerAttacked', { damage: dmg })`.
- Payload `{ damage }` is the boss's **raw intent damage, before block is subtracted**. Bramble Guard ignores it, so the payload is still an unexercised path.
- The boss attacks exactly once per turn, so a listener fires at most once per turn — "when you are attacked this turn", never per-hit.
- Bramble Guard registers `'combat'` scope, so it persists all fight. `'turn'` scope would expire it each turn, the way Spiked Armor worked — that scope remains unused (§2b).
- **A listener firing here can kill the boss on its own turn.** `endTurn` now has an explicit `if (c.boss.hp <= 0)` check after the attack phase for exactly this reason; without it the fight would continue against a 0 HP boss.

---

# 2b. The `'turn'` scope and `clearTurnStatuses()` — ~line 319

**What it is:** `clearTurnStatuses()` filters `'turn'`-scoped statuses off `combat.statuses`. Called once per turn in `endTurn` (~line 606).

**What it did:** expired Spiked Armor's retaliation so it did not persist into later turns.

**Last user:** Spiked Armor — still the **only** `'turn'`-scoped status ever registered. Protection Racket uses `'combat'`, so this did *not* come back to life with it.

**Current status:** runs every turn, always filters an empty result. The `scope` parameter of `addStatus` remains effectively single-valued in practice.

**Ordering that matters if you revive it:** in `endTurn`, `fireEvent('playerAttacked')` (~601) runs **before** `clearTurnStatuses()` (~606), which runs before the new-turn block and `fireEvent('turnStart')` (~625). So a `'turn'`-scoped status registered during a turn fires on that turn's boss attack, is then cleared, and is gone before the next turn starts.

---

# 3. Damage & combo tracking

## `combat.turnDamageDealt` — ~line 264

**What it is:** running total of damage dealt to the boss this turn.

**Written in four places:** `resolveAttackHit` (~362), Roll the Bones and Double or Nothing via `resolveAttackHit`, and the `damageFromBlockPercent` branch (~507). Initialised in `startCombat`, reset in `endTurn` (~618).

**What it did:** Hit Job compared it against an exact threshold (`turnDamageDealt === 50`) to settle its bet.

**Last user:** Hit Job (deleted, along with `pendingBets` and `resolvePendingBets()`).

**Current status:** **written but never read.** Nothing consumes it for any decision. Skim reads `turnAttackCount`, not this.

**To make it live again:** read it anywhere before the reset. Two timing facts:

- The reset at ~line 618 sits in the *new turn* block of `endTurn`, after the boss attack. Hit Job settled at the **top** of `endTurn`, before the boss attacked — end-of-turn payoffs belong there.
- The `damageFromBlockPercent` branch adds to it without going through `resolveAttackHit`, so it counts non-combo damage too.

If you rebuild a bet-style card, the deleted `pendingBets` array (`{ card, checkAmount, reward }`) and `resolvePendingBets()` are the pattern to copy — both are gone and would need reinstating.

## `currentAttackMult()` — ~line 300

**What it is:** a read-only report of the attack combo multiplier, derived from `combat.turnAttackCount`.

**What it did:** Adrenaline checked `currentAttackMult() > 2.0` to decide whether to draw a bonus card.

**Last user:** Adrenaline (deleted).

**Current status:** **zero callers.** Note that Skim reads `game.combat.turnAttackCount` directly rather than going through this helper — deliberately, since Skim wants the raw count, not the multiplier.

**⚠ Off-by-one — read before reviving.** Its comment claims it returns "what your next attack's combo multiplier would be", but:

```js
const n = game.combat.turnAttackCount;   // attacks ALREADY played
return n <= 0 ? 1 : 1 + COMBO_STEP * (n - 1);
```

`resolveAttackHit` increments first, so the *next* attack receives `1 + 0.2 * n`. This returns `1 + 0.2 * (n - 1)` — the multiplier the **most recently played** attack received, one step behind the comment. Adrenaline's `> 2.0` check therefore required 7 prior attacks, not 6. Fix the function, fix the comment, or write thresholds against the real behaviour.

---

# 4. Card properties with no remaining users

Each is a live `if` branch in `playCard` that no current card triggers. Reviving any needs **only** a card definition carrying the property — the engine side already works. (`selfDamage`, `isAttackToo` and `damageFromBlockPercent` used to be in this list; Blood Money and Shield Bash revived them — see §0.)

## `card.discardRandom` + `discardRandomCards(n)` — branch ~line 522, helper ~line 324

**Did:** discarded `n` randomly chosen cards from hand to the discard pile, logging each.

**Last user:** Reckless Swing (2 random discards as a drawback).

**Design note — differs from `discardCost`:** `discardRandomCards` is **clamped** by hand size (`i < n && c.hand.length > 0`), so it silently does less with a short hand. `discardCost` is a hard playability requirement enforced in `canPlayCard`. Random discards are a *drawback that can fizzle*; discard costs are a *price that must be payable*.

**Revive with:** `{ ..., discardRandom: 2 }`

## `card.retainBlock` — **fully removed, no trace**

Unlike everything else here, this has **no dormant code left**. Blood Magic was its last user and all three pieces were deleted. To bring it back, re-add:

1. `retainBlockNextReset: false` to the combat state object in `startCombat`.
2. The branch in `playCard`: `if (card.retainBlock) { c.retainBlockNextReset = true; logMsg(...); }`
3. The conditional in `endTurn`, replacing the bare `c.block = 0;`:

```js
if (c.retainBlockNextReset) { c.retainBlockNextReset = false; } else { c.block = 0; }
```

Recorded so the mechanic isn't reinvented from scratch.

---

# 5. Other unused code

## `makeCard(def)` — ~line 17

**What it is:** `return { uid: null, ...def };`

**Current status:** **never called**, and predates all recent edits. `instantiateCard(key)` is what actually builds cards, assigning a unique id from `uidCounter`.

**⚠ Do not use it as-is.** It sets `uid: null`. Card identity throughout the engine is uid-based — `playCard`'s `findIndex`, `selectDiscard`, `trashCard`'s zone filters and the drag-reorder sync all match on `uid`. A null-uid card would collide with any other null-uid card and break those lookups. A factory should draw from `uidCounter` the way `instantiateCard` does.

---

# 6. Adjacent seams (live, but thin)

Not dormant — these run — but they are the obvious extension points:

- **`cardDescText(card)`** (~line 742) is a pass-through returning `card.desc`, called by `renderCombat` per hand card. It is the seam for **dynamic card text**. Skim is the current best candidate: its value depends entirely on `turnAttackCount`, so "Gain 1 gold per attack (3 so far)" would compute here with no change at the call site.
- **`combat.exhaustPile`** (~line 266) is written (Burnout via `exhaustOnPlay`, and `trashCard` filters it) but never surfaced in the UI — `renderCombat` shows draw and discard counts only. It works correctly as a sink; it is just invisible to the player.
- **`combat.forcedNextRoll`** (Loaded Dice) is fully live: set in `onPlay`, consumed by whichever of `rollDie`/`flipCoin` runs next, cleared in `endTurn`. Any new gamble card automatically respects it.

---

# 7. Stale comments to clean up in one pass

These name cards that no longer exist, or describe changed behaviour. None affect execution.

| ~Line | Problem |
|---|---|
| 138–140 | Loaded Dice card comment says its name overlaps "the trinket" — **there is no Loaded Dice trinket**; `TRINKET_LIBRARY` holds only Shop Size, Max HP, Hand Size, Gold Loot, Shop Discount. |
| 44 / 46 | Armor sits under the `// ---- Combo Flurry (Red + Purple/skill) ----` header after Adrenaline's removal. Armor is a plain block card and does not belong to that group. |
| 298–299 | `currentAttackMult` comment says "used by cards like Adrenaline" (deleted) — **and misstates the semantics**, see §3. |
| 337 | `trashCard` comment: "Also counts as a 'miss' for Sore Loser-style passives." |
| 366–367 | `resolveGoldCardOutcome` comment: "notifies Sore Loser-style passives on a miss." |

**Fixed already:** the status-effects section header (now "Protection Racket's per-turn payout"), and the `fireEvent('playerAttacked')` inline comment (now "Bramble Guard-style retaliation").

**Keep as-is:** the `statuses: []` type comment (~line 267), now updated to `'turnStart' | 'playerAttacked' | 'cardMissed'`. It documents the intended shape of the subsystem and every event name — exactly the reference a new listener-card needs.
