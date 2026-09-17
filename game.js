// ===================================================================
// VAULT RUNNERS — prototype roguelike deckbuilder
// Slay the Spire flow + Clank!-simple cards + Balatro-style combo scoring
// ===================================================================

// A patch applied over CARD_LIBRARY, BOSSES, TRINKET_LIBRARY, and the tunable constants
// at startup (see applyTuningPatch() below the constants block). Empty by default. The
// dev tuning panel's "Export patch" button copies a patch shaped exactly like this to the
// clipboard, along with a plain-text changelog of what changed -- paste the patch object
// here to bake a tuning session's numbers into the file as a one-line, reversible change.
// Example: { twinBlades: { baseDamage: 9, price: 50 }, bosses: { 0: { maxHp: 60 } } }
const TUNING = {};

// ---------- Card definitions ----------
// type: 'attack' | 'block' | 'loot' | 'skill'
// 'skill' covers both draw-effect cards (drawOnPlay) and energy-effect cards (energyGain) --
// mechanically different but sharing one color/category, so the desc is what tells them
// apart, not the type.
// Attack and block cards both scale with a per-turn combo multiplier (more of that
// type played this turn = bigger multiplier on each one) -- small/cheap cards lean on
// that, while big/expensive cards trade the multiplier for higher flat single-card value.
// A card with `discardCost` makes the player click that many hand cards to discard as a
// cost before its own drawOnPlay/energyGain resolve -- see beginDiscardSelection().

function makeCard(def) {
  return { uid: null, ...def };
}

const CARD_LIBRARY = {
  // ==================== ATTACK ====================
  strike: { key: 'strike',           name: 'Strike',          type: 'attack', cost: 1, baseDamage: 6,                                                               desc: 'Deal 6 damage.' },
  quickStab: { key: 'quickStab',        name: 'Quick Stab',      type: 'attack', cost: 1, baseDamage: 4,                          drawOnPlay: 1,                       price: 25, desc: 'Deal 4 damage. Draw 1 card.' },
  comboStrike: { key: 'comboStrike',      name: 'Combo Strike',    type: 'attack', cost: 1, baseDamage: 4,           comboBonus: 3,                                      price: 40, desc: 'Deal 4 damage (+3 per attack played this turn).' },
  twinBlades: { key: 'twinBlades',       name: 'Twin Blades',     type: 'attack', cost: 2, baseDamage: 8,  hits: 2,                                                     price: 45, desc: 'Deal 8 damage, 2 times.' },
  heavyStrike: { key: 'heavyStrike',      name: 'Heavy Strike',    type: 'attack', cost: 3, baseDamage: 30,                                                              price: 70, desc: 'Deal 30 damage.' },
  thousandCuts: { key: 'thousandCuts',     name: 'Thousand Cuts',   type: 'attack', cost: 2, baseDamage: 2,  hits: 5,                                                     price: 45, desc: 'Deal 2 damage, 5 times.' },

  // Shares deferredAttack/combo-counting mechanics with the High Roller loot cards
  // (see the comment above rollTheBones in the LOOT group) even though this one is a
  // straight attack card, not a gold-cost gamble.
  glassCannon: { key: 'glassCannon',      name: 'Glass Cannon',    type: 'attack', cost: 0, baseDamage: 30,                                        deferredAttack: true, price: 50, desc: 'Roll a die: 4+ deals 30 damage, else this card is destroyed.',
    onPlay(card) {
      rollDie(6, (roll) => {
        if (roll >= 4) {
          const { damage, mult } = resolveAttackHit(card.baseDamage);
          logMsg(`Glass Cannon: rolled ${roll}, hit for ${damage} damage.`);
          if (mult > 1.001) showComboPopup(`ATK x${mult.toFixed(2)}!`);
        } else {
          logMsg(`Glass Cannon: rolled ${roll}, misses completely.`);
          trashCard(card);
        }
        renderCombat();
        checkCombatEnd();
      });
    },
  },

  // ==================== BLOCK ====================
  // Block mirrors attack: turnBlockCount ticks once per hit, so `hits` buys triggers here
  // the same way it does on the attack side, and blockComboBonus is the block twin of
  // comboBonus. Remember block does not carry over -- c.block is wiped every endTurn --
  // so everything here is single-turn value.
  guard: { key: 'guard',            name: 'Guard',           type: 'block',  cost: 1, block: 5,                                                                                                   desc: 'Gain 5 block.' },
  shieldWall: { key: 'shieldWall',       name: 'Shield Wall',     type: 'block',  cost: 2, block: 14,                                                                                                  price: 30, desc: 'Gain 14 block.' },
  armor: { key: 'armor',            name: 'Armor',           type: 'block',  cost: 3, block: 24,                                                                                                  price: 40, desc: 'Gain 24 block.' },
  brace: { key: 'brace',            name: 'Brace',           type: 'block',  cost: 0, block: 2,                                                                                                   price: 25, desc: 'Gain 2 block.' },
  bulwark: { key: 'bulwark',          name: 'Bulwark',         type: 'block',  cost: 2, block: 3,  hits: 4,                                                                                         price: 50, desc: 'Gain 3 block, 4 times.' },
  stonewall: { key: 'stonewall',        name: 'Stonewall',       type: 'block',  cost: 1, block: 4,           blockComboBonus: 4,                                                                     price: 40, desc: 'Gain 4 block (+4 per block played this turn).' },
  shieldBash: { key: 'shieldBash',       name: 'Shield Bash',     type: 'block',  cost: 2, block: 8,                               damageFromBlockPercent: 1.0,                     isAttackToo: true, price: 55, desc: 'Gain 8 block, then deal damage equal to your block.' },
  brambleGuard: { key: 'brambleGuard',     name: 'Bramble Guard',   type: 'block',  cost: 2, block: 10,                                                           retaliateDamage: 5,                    price: 50, desc: 'Gain 10 block. Retaliate for 5 damage when attacked this combat.',
    onPlay(card) {
      // Combat-scoped, unlike the old turn-scoped Spiked Armor: it survives
      // clearTurnStatuses() and keeps retaliating every turn until startCombat() replaces
      // the combat object. Each copy registers its own listener, so copies stack. The
      // damage goes straight to boss.hp -- it resolves on the BOSS's turn, so it must not
      // touch turnAttackCount or the player's combo.
      addStatus('playerAttacked', 'combat', () => {
        const c = game.combat;
        c.boss.hp = Math.max(0, c.boss.hp - card.retaliateDamage);
        logMsg(`Bramble Guard retaliates for ${card.retaliateDamage} damage!`);
      });
    },
  },

  // ==================== LOOT ====================
  // Pure economy: none of these deal damage or grant block, so each one trades tempo in
  // the current fight for buying power at the next market. Every gain routes through
  // gainGold() so the Gold Loot trinket applies -- note that gainGold rounds, so small
  // per-tick amounts (Skim at 1-2, Kickback at 3) can round the bonus away.
  treasureGrab: { key: 'treasureGrab',     name: 'Treasure Grab',   type: 'loot',   cost: 1, gold: 4,                                                                                                                      desc: 'Gain 4 gold.' },
  shakedown: { key: 'shakedown',        name: 'Shakedown',       type: 'loot',   cost: 1, gold: 5,                                                                                                                      price: 30, desc: 'Gain 5 gold.' },
  skim: { key: 'skim',             name: 'Skim',            type: 'loot',   cost: 0,                        goldPerAttack: 1,                                                                                      price: 35, desc: 'Gain 1 gold per attack played this turn.',
    onPlay(card) {
      const n = game.combat.turnAttackCount;
      if (n <= 0) {
        logMsg('Skim: no attacks played this turn -- nothing to skim.');
        return;
      }
      const g = gainGold(n * card.goldPerAttack);
      logMsg(`Skim: ${n} attack(s) this turn, gained ${g} gold.`);
    },
  },
  crackTheVault: { key: 'crackTheVault',    name: 'Crack the Vault', type: 'loot',   cost: 3, gold: 15,                                                                                                                     price: 45, desc: 'Gain 15 gold.' },
  protectionRacket: { key: 'protectionRacket', name: 'Kickback',        type: 'loot',   cost: 1,                                          goldPerTurn: 3,                                                                      price: 50, desc: 'Gain 3 gold at the start of each turn this combat.',
    onPlay(card) {
      // Combat-scoped, so it survives clearTurnStatuses() and keeps paying every turn until
      // startCombat() replaces the whole combat object at the next fight. Each copy played
      // registers its own listener, so copies stack -- exactly how Sore Loser behaved.
      addStatus('turnStart', 'combat', () => {
        const g = gainGold(card.goldPerTurn);
        logMsg(`Kickback: collected ${g} gold.`);
      });
      logMsg('Kickback: the arrangement starts paying next turn.');
    },
  },
  bloodMoney: { key: 'bloodMoney',       name: 'Blood Money',     type: 'loot',   cost: 0, gold: 8,                                                 selfDamage: 5,                                                       price: 35, desc: 'Lose 5 HP. Gain 8 gold.' },

  // Both gamble cards below are free to acquire (price: 0) and free in energy (cost: 0),
  // and charge gold per play (goldCost) instead. All the tunable numbers live on the card
  // defs: goldCost is the per-play price, damagePerPip / winDamage are the payouts. Change
  // them here; the desc strings restate the same numbers and must be kept in sync by hand.
  //
  // Both COUNT FOR COMBO: the roll/flip decides the base damage and resolveAttackHit
  // scales it, so they increment turnAttackCount and take the multiplier exactly like any
  // other attack. A failed gamble does not -- see the tails branch on Double Up below.
  //
  // They carry `deferredAttack` because they resolve their damage inside onPlay once the
  // animation settles. It is redundant while their type is 'loot' (playCard's automatic
  // attack branch only fires for 'attack' / isAttackToo), but it stops them double-dipping
  // if that type is ever changed. Glass Cannon (ATTACK group) shares this same mechanic.
  rollTheBones: { key: 'rollTheBones',     name: 'Bones',           type: 'loot',   cost: 0,           goldCost: 5,                                                  damagePerPip: 2,                deferredAttack: true, price: 0, desc: 'Pay 5 gold. Roll a die: deal 2x the roll in damage.',
    onPlay(card) {
      rollDie(6, (roll) => {
        const { damage, mult } = resolveAttackHit(roll * card.damagePerPip);
        logMsg(`Bones: rolled a ${roll}, dealt ${damage} damage.`);
        if (mult > 1.001) showComboPopup(`ATK x${mult.toFixed(2)}!`);
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  doubleOrNothing: { key: 'doubleOrNothing',  name: 'Double Up',       type: 'loot',   cost: 0,           goldCost: 5,                                                                   winDamage: 15, deferredAttack: true, price: 0, desc: 'Pay 5 gold. Coin flip: heads deals 15 damage, tails nothing.',
    onPlay(card) {
      flipCoin((heads) => {
        if (heads) {
          const { damage, mult } = resolveAttackHit(card.winDamage);
          logMsg(`Double Up: heads! Dealt ${damage} damage.`);
          if (mult > 1.001) showComboPopup(`ATK x${mult.toFixed(2)}!`);
        } else {
          // Tails matches Glass Cannon's miss: resolveAttackHit is never called, so no
          // damage, no turnDamageDealt, and no turnAttackCount increment -- a whiff must
          // not inflate the combo for cards played after it.
          logMsg('Double Up: tails. Nothing happens.');
        }
        resolveGoldCardOutcome(card, heads);
        renderCombat();
        checkCombatEnd();
      });
    },
  },

  // ==================== SKILL ====================
  sidestep: { key: 'sidestep',         name: 'Sidestep',        type: 'skill',  cost: 0, block: 2,                drawOnPlay: 2,                                      price: 45, desc: 'Gain 2 block. Draw 2 cards.' },
  gather: { key: 'gather',           name: 'Gather',          type: 'skill',  cost: 0,                          drawOnPlay: 3,                                      price: 25, desc: 'Draw 3 cards.' },
  overdraw: { key: 'overdraw',         name: 'Overdraw',        type: 'skill',  cost: 0,                          drawOnPlay: 4, discardCost: 2,                      price: 40, desc: 'Discard 2 cards. Draw 4 cards.' },
  spark: { key: 'spark',            name: 'Spark',           type: 'skill',  cost: 0,           energyGain: 1,                                                     price: 30, desc: 'Gain 1 energy.' },
  overcharge: { key: 'overcharge',       name: 'Overcharge',      type: 'skill',  cost: 0,           energyGain: 1,                discardCost: 1,                      price: 45, desc: 'Discard 1 card. Gain 1 energy.' },
  burnout: { key: 'burnout',          name: 'Burnout',         type: 'skill',  cost: 0,           energyGain: 3, drawOnPlay: 3,                 exhaustOnPlay: true, price: 50, desc: 'Gain 3 energy. Draw 3 cards. Exhausts after use.' },

  // Named "Loaded Dice" like the trinket, but a different thing (a played card, not a
  // passive) -- distinct key so the two don't collide, flagged to the user as a naming
  // overlap worth knowing about.
  loadedDiceCard: { key: 'loadedDiceCard',   name: 'Loaded Dice',     type: 'skill',  cost: 0,                                                                              price: 40, desc: 'Your next roll or flip this turn is guaranteed to hit its best outcome.',
    onPlay(card) { game.combat.forcedNextRoll = 'max'; },
  },
};

// Trinkets are repeatable purchases: each buy stacks by calling apply(game) again,
// which nudges a plain constant on `game`. No per-effect special-casing elsewhere.
// Listed with shopSize first so it's always visible in the base 3 trinket slots --
// otherwise it could hide behind its own "+1 shop slot" effect and never be reachable.
// effectAmount is read by apply() via `this` (each apply is always called as
// `offer.apply(game)`, a method call, so `this` is the trinket object) rather than being
// a literal in the function body -- that's what lets the dev tuning panel edit a
// trinket's per-stack effect without touching a function's source text. Editing
// effectAmount does NOT update the desc string below it, which still prints the
// original number; see the tuning panel's known-limitations note.
const TRINKET_LIBRARY = {
  shopSize:     { key: 'shopSize',     name: 'Shop Size',     price: 45, effectAmount: 1,    desc: '+1 card & trinket slot in the market.', apply(game) { game.shopSizeBonus += this.effectAmount; } },
  maxHp:        { key: 'maxHp',        name: 'Max HP',        price: 35, effectAmount: 10,   desc: '+10 Max HP.',                          apply(game) { game.maxHp += this.effectAmount; game.hp += this.effectAmount; } },
  handSize:     { key: 'handSize',     name: 'Hand Size',     price: 50, effectAmount: 1,    desc: '+1 card drawn per turn.',               apply(game) { game.handSizeBonus += this.effectAmount; } },
  goldLoot:     { key: 'goldLoot',     name: 'Gold Loot',     price: 35, effectAmount: 0.10, desc: '+10% gold gained.',                    apply(game) { game.goldLootBonus += this.effectAmount; } },
  shopDiscount: { key: 'shopDiscount', name: 'Shop Discount', price: 35, effectAmount: 0.10, desc: '-10% market prices.',                  apply(game) { game.shopDiscount += this.effectAmount; } },
};

const STARTER_DECK_KEYS = ['strike', 'strike', 'strike', 'strike', 'strike', 'guard', 'guard', 'guard', 'guard', 'treasureGrab'];
const SHOP_POOL_KEYS = [
  'quickStab', 'shieldWall', 'sidestep', 'comboStrike', 'twinBlades', 'heavyStrike', 'gather', 'overdraw', 'spark', 'overcharge',
  'thousandCuts', 'armor', 'burnout',
  'brace', 'bulwark', 'stonewall', 'shieldBash', 'brambleGuard',
  'shakedown', 'skim', 'crackTheVault', 'protectionRacket', 'bloodMoney',
  'rollTheBones', 'doubleOrNothing', 'glassCannon', 'loadedDiceCard',
];

// 10-boss curve (up from 4) so a run means more market visits and more time building
// the deck. HP steps get bigger each fight (18, 24, 30, 38, 45, 55, 65, 75, 80) rather
// than scaling linearly -- early fights are easy on a starter deck with 3 energy/turn,
// and the ramp steepens later once the player has had several markets to buy cards and
// trinkets.
//
// Every pattern includes one 0 -- a real "boss does nothing this turn" beat, telegraphed
// by the intent display like anything else -- paired with a spike roughly 2x the old max
// hit. This closes off stalling out a fight on purpose (playing only loot/skip turns to
// reshuffle the deck and re-farm gold cards indefinitely): the free turn is real, but the
// cycle's other beats hit hard enough that turtling through many cycles to grind gold
// still costs meaningful HP, rather than the old flat, low patterns that a starter deck
// could tank forever. Early bosses got the biggest relative jump since they were the
// easiest to stall on. God keeps its "no escape" flavor -- still no single dominant
// spike -- but now also has one dead beat like every other boss.
const BOSSES = [
  { name: 'Rat Swarm',    maxHp: 50,  pattern: [0, 6, 9, 4] },
  { name: 'Cave Troll',   maxHp: 68,  pattern: [0, 8, 13, 6] },
  { name: 'Bandit Chief', maxHp: 92,  pattern: [0, 9, 16, 7] },
  { name: 'Rock Golem',   maxHp: 122, pattern: [0, 10, 19, 8] },
  { name: 'Swamp Hag',    maxHp: 160, pattern: [0, 12, 22, 9] },
  { name: 'Iron Sentinel',maxHp: 205, pattern: [0, 13, 25, 10] },
  { name: 'The Dragon',   maxHp: 260, pattern: [0, 14, 28, 11] },
  { name: 'Lich',         maxHp: 325, pattern: [0, 15, 31, 12] },
  { name: 'Void Herald',  maxHp: 400, pattern: [0, 16, 34, 13] },
  { name: 'God',          maxHp: 480, pattern: [0, 13, 15, 17, 13] },
];

// ---------- Tunable run constants ----------
// Plain mutable (`let`, not `const`) bindings so the dev tuning panel and a pasted TUNING
// patch (see the empty `const TUNING = {}` near the top of the file) can both reassign
// them at runtime -- every other reference to these names elsewhere in the file keeps
// working unchanged, since a `let` is just as readable from other functions as a `const`.
let HAND_SIZE = 5;
let BASE_ENERGY = 3;
let COMBO_STEP = 0.2;
let START_HP = 100;
let START_MAX_HP = 100;
let START_GOLD = 10;
let BOSS_REWARD_BASE = 15;       // gainGold(BOSS_REWARD_BASE + BOSS_REWARD_PER_BOSS * bossIndex)
let BOSS_REWARD_PER_BOSS = 5;
let HEAL_COST_BASE = 15;         // healCost() = discountedPrice(HEAL_COST_BASE); heal amount itself stays a fixed 15, not tunable
let REMOVE_COST_BASE = 25;
let REROLL_COST_START = 1;       // game.rerollCost starts here each newRun()
let REROLL_COST_STEP = 1;        // and climbs by this much every rerollShop()

// Applies a pasted TUNING patch over the card library, boss list, trinket library, and
// the constants above. Deliberately NOT part of the dev tuning panel block further down
// this file -- this function (and the TUNING const itself) is meant to keep working even
// if that whole panel block is stripped out later, so a hand-pasted patch stays a
// one-line, reversible change independent of the interactive tool.
function applyTuningPatch() {
  // Card patches are top-level keys in TUNING (e.g. `{ twinBlades: { baseDamage: 9 } }`),
  // matching the shape the tuning panel exports -- 'bosses', 'constants' and 'trinkets'
  // are the only reserved top-level names, so every other key is treated as a card key.
  const RESERVED_TOP_LEVEL_KEYS = new Set(['bosses', 'constants', 'trinkets']);
  for (const [key, patch] of Object.entries(TUNING)) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) continue;
    if (CARD_LIBRARY[key]) Object.assign(CARD_LIBRARY[key], patch);
  }
  for (const [idxStr, patch] of Object.entries(TUNING.bosses || {})) {
    const boss = BOSSES[Number(idxStr)];
    if (!boss) continue;
    if (patch.maxHp != null) boss.maxHp = patch.maxHp;
    if (patch.pattern) boss.pattern = patch.pattern.slice();
  }
  for (const [key, patch] of Object.entries(TUNING.trinkets || {})) {
    if (TRINKET_LIBRARY[key]) Object.assign(TRINKET_LIBRARY[key], patch);
  }
  const c = TUNING.constants || {};
  if (c.HAND_SIZE != null) HAND_SIZE = c.HAND_SIZE;
  if (c.BASE_ENERGY != null) BASE_ENERGY = c.BASE_ENERGY;
  if (c.COMBO_STEP != null) COMBO_STEP = c.COMBO_STEP;
  if (c.START_HP != null) START_HP = c.START_HP;
  if (c.START_MAX_HP != null) START_MAX_HP = c.START_MAX_HP;
  if (c.START_GOLD != null) START_GOLD = c.START_GOLD;
  if (c.BOSS_REWARD_BASE != null) BOSS_REWARD_BASE = c.BOSS_REWARD_BASE;
  if (c.BOSS_REWARD_PER_BOSS != null) BOSS_REWARD_PER_BOSS = c.BOSS_REWARD_PER_BOSS;
  if (c.HEAL_COST_BASE != null) HEAL_COST_BASE = c.HEAL_COST_BASE;
  if (c.REMOVE_COST_BASE != null) REMOVE_COST_BASE = c.REMOVE_COST_BASE;
  if (c.REROLL_COST_START != null) REROLL_COST_START = c.REROLL_COST_START;
  if (c.REROLL_COST_STEP != null) REROLL_COST_STEP = c.REROLL_COST_STEP;
}
applyTuningPatch();

// ---------- Game state ----------
let game = null;
let uidCounter = 0;

function newRun() {
  game = {
    hp: START_HP,
    maxHp: START_MAX_HP,
    gold: START_GOLD,
    deck: STARTER_DECK_KEYS.map(k => instantiateCard(k)),
    // trinket-driven constants -- each trinket purchase nudges one of these, nothing else
    handSizeBonus: 0,
    goldLootBonus: 0,
    shopDiscount: 0,
    shopSizeBonus: 0,
    trinketLevels: Object.fromEntries(Object.keys(TRINKET_LIBRARY).map(k => [k, 0])),
    // Cost of the next market card reroll -- climbs by 1 each use and never resets between
    // shop visits (only newRun() resets it), so rerolling repeatedly across a whole run
    // gets steadily more expensive.
    rerollCost: REROLL_COST_START,
    bossIndex: 0,
    // combat-only state, set by startCombat
    combat: null,
  };
  startCombat();
}

function instantiateCard(key) {
  uidCounter++;
  return { ...CARD_LIBRARY[key], uid: uidCounter };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentHandSize() { return HAND_SIZE + game.handSizeBonus; }

// Routes every gold gain through the goldLoot trinket bonus; returns the actual amount added.
function gainGold(amount) {
  const actual = Math.round(amount * (1 + game.goldLootBonus));
  game.gold += actual;
  return actual;
}

// The Math.max(1, ...) floor stops a discount from ever making a paid item free, but a
// deliberately free item (price: 0) has to survive it -- so 0 short-circuits out first.
// Written as `<= 0` rather than a falsy check so an undefined price still behaves exactly
// as it did before (starter cards carry no price and never reach the market).
function discountedPrice(basePrice) {
  if (basePrice <= 0) return 0;
  return Math.max(1, Math.round(basePrice * (1 - game.shopDiscount)));
}

function cardShopSlots() { return Math.min(SHOP_POOL_KEYS.length, 4 + game.shopSizeBonus); }
function trinketShopSlots() { return Math.min(Object.keys(TRINKET_LIBRARY).length, 3 + game.shopSizeBonus); }

// ---------- Combat setup ----------
function startCombat() {
  const bossDef = BOSSES[game.bossIndex];
  game.combat = {
    boss: { name: bossDef.name, hp: bossDef.maxHp, maxHp: bossDef.maxHp, pattern: bossDef.pattern, patternIndex: 0 },
    drawPile: shuffle(game.deck),
    hand: [],
    discardPile: [],
    block: 0,
    energy: BASE_ENERGY,
    turnAttackCount: 0,
    turnBlockCount: 0,
    turnDamageDealt: 0,
    discardSelection: null,
    exhaustPile: [],
    statuses: [],       // { on: 'turnStart' | 'playerAttacked' | 'cardMissed', scope: 'turn' | 'combat', effect() }
    forcedNextRoll: null, // 'max' consumed by the next rollDie/flipCoin call
    rolling: false,     // true for the ~1s a die/coin is spinning -- blocks playing cards and ending the turn
    ended: false,       // set once by checkCombatEnd -- makes a second call for this fight a no-op
    log: [],
  };
  drawCards(currentHandSize());
  logMsg(`--- ${bossDef.name} appears! ---`);
  showScreen('screen-combat');
  renderCombat();
}

function drawCards(n) {
  const c = game.combat;
  for (let i = 0; i < n; i++) {
    if (c.drawPile.length === 0) {
      if (c.discardPile.length === 0) break; // nothing left to draw
      c.drawPile = shuffle(c.discardPile);
      c.discardPile = [];
      logMsg('Shuffled discard pile into draw pile.');
    }
    c.hand.push(c.drawPile.pop());
  }
  assignHandSlots();
}

// A card's number-key slot is sticky: it's assigned here (on draw or reorder) and then
// left alone as cards are played/discarded out of hand, so playing card 1 never shifts
// what 2-5 mean -- only a fresh draw or a manual reorder renumbers the hand.
function assignHandSlots() {
  game.combat.hand.forEach((card, i) => { card.handSlot = i; });
}

function logMsg(msg) {
  game.combat.log.unshift(msg);
  if (game.combat.log.length > 30) game.combat.log.pop();
}

// ---------- Playing cards ----------
// COMBO_STEP is declared with the other tunable run constants, above.

// What your next attack's combo multiplier would be, without playing anything --
// used by cards like Adrenaline that check the current combo state.
function currentAttackMult() {
  const n = game.combat.turnAttackCount;
  return n <= 0 ? 1 : 1 + COMBO_STEP * (n - 1);
}

// ---------- Status effects (Protection Racket's per-turn payout, etc.) ----------
// A tiny pub/sub: cards register a status with an event name and a scope, and fireEvent
// calls every status listening for that event. 'turn' statuses are cleared at end of turn;
// 'combat' statuses live until the combat object is replaced (i.e. the whole fight ends).
function addStatus(on, scope, effect) {
  game.combat.statuses.push({ on, scope, effect });
}

function fireEvent(eventName, payload) {
  for (const status of game.combat.statuses) {
    if (status.on === eventName) status.effect(payload);
  }
}

function clearTurnStatuses() {
  const c = game.combat;
  c.statuses = c.statuses.filter(s => s.scope !== 'turn');
}

function discardRandomCards(n) {
  const c = game.combat;
  for (let i = 0; i < n && c.hand.length > 0; i++) {
    const idx = Math.floor(Math.random() * c.hand.length);
    const [discarded] = c.hand.splice(idx, 1);
    c.discardPile.push(discarded);
    logMsg(`Discarded ${discarded.name}.`);
  }
}

// Trashes a card out of the run for good -- for Glass Cannon's missed roll. Removing it
// from game.deck alone is not enough: the card was already pushed into a combat zone by
// playCard, so it has to come out of every zone too, or it gets reshuffled and replayed
// for the rest of the fight. Also counts as a "miss" for Sore Loser-style passives.
function trashCard(card) {
  const remainingDeck = game.deck.filter(x => x.uid !== card.uid);
  if (remainingDeck.length === 0) {
    // Never let a trash effect empty the run deck -- with nothing left to draw, the run
    // is unwinnable. The card is spared from game.deck and simply goes wherever playCard
    // already put it in combat (the discard pile, same as any other played card), instead
    // of being stripped out of every zone the way a real trash does below.
    logMsg(`${card.name} survives the trash -- it's the last card in your deck.`);
    fireEvent('cardMissed', { card });
    return;
  }
  game.deck = remainingDeck;
  // Only ever called while a card is being played mid-combat, so game.combat always
  // exists here -- same assumption logMsg/fireEvent below already make.
  const c = game.combat;
  c.drawPile = c.drawPile.filter(x => x.uid !== card.uid);
  c.hand = c.hand.filter(x => x.uid !== card.uid);
  c.discardPile = c.discardPile.filter(x => x.uid !== card.uid);
  c.exhaustPile = c.exhaustPile.filter(x => x.uid !== card.uid);
  logMsg(`${card.name} is trashed -- removed from your deck for good!`);
  fireEvent('cardMissed', { card });
}

// One attack hit: bumps the per-turn attack combo, applies the multiplier, and lands the
// damage. Shared by the normal attack branch in playCard and by cards whose damage
// resolves later (Glass Cannon's roll), so a deferred hit scores exactly like an
// immediate one instead of duplicating the combo formula.
function resolveAttackHit(baseDamage, comboBonus = 0) {
  const c = game.combat;
  c.turnAttackCount++;
  const mult = 1 + COMBO_STEP * (c.turnAttackCount - 1);
  const base = baseDamage + comboBonus * (c.turnAttackCount - 1);
  const damage = Math.round(base * mult);
  c.boss.hp = Math.max(0, c.boss.hp - damage);
  c.turnDamageDealt += damage;
  return { damage, mult };
}

// One block gain: bumps the per-turn block combo, applies the multiplier, and banks the
// block. Deliberately the mirror image of resolveAttackHit -- same counter-then-multiply
// order, same rounding, same optional per-trigger bonus -- so both halves of the combo
// system score identically and multi-hit block cards (Bulwark) tick once per hit exactly
// like multi-hit attacks do.
function resolveBlockGain(blockAmount, blockComboBonus = 0) {
  const c = game.combat;
  c.turnBlockCount++;
  const mult = 1 + COMBO_STEP * (c.turnBlockCount - 1);
  const base = blockAmount + blockComboBonus * (c.turnBlockCount - 1);
  const block = Math.round(base * mult);
  c.block += block;
  return { block, mult };
}

// Shared "did a gold-cost gamble pay off" handling: notifies Sore Loser-style passives
// on a miss. Kept as its own seam so every gold-card outcome reports through one place.
function resolveGoldCardOutcome(card, succeeded) {
  if (!succeeded) fireEvent('cardMissed', { card });
}

// ---------- Dice & coin animations ----------
// forcedNextRoll (from Loaded Dice) is consumed by whichever of these runs next.
function showDiceOverlay() { document.getElementById('dice-overlay').classList.remove('hidden'); }
function hideDiceOverlay() { document.getElementById('dice-overlay').classList.add('hidden'); }

// Standard 6-sided die pip layouts, as positions in a 3x3 grid (0-8, row-major).
const DICE_PIP_PATTERNS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// The two face renderers are the only things that touch the die/coin classes, and each
// one asserts BOTH directions -- adds its own, removes the other. That way a flip after a
// roll (or the reverse) can never leave a stale class on the shared #dice-face element.
function renderDiePips(value) {
  const faceEl = document.getElementById('dice-face');
  faceEl.classList.add('die');
  faceEl.classList.remove('coin');
  const filled = new Set(DICE_PIP_PATTERNS[value] || []);
  faceEl.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip' + (filled.has(i) ? ' pip-on' : '');
    faceEl.appendChild(pip);
  }
}

function renderCoinFace(letter) {
  const faceEl = document.getElementById('dice-face');
  faceEl.classList.add('coin');
  faceEl.classList.remove('die');
  faceEl.textContent = letter;
}

function rollDie(sides, onResult) {
  const c = game.combat;
  c.rolling = true;
  const forced = c.forcedNextRoll === 'max';
  if (forced) c.forcedNextRoll = null;
  const finalValue = forced ? sides : (1 + Math.floor(Math.random() * sides));

  const resultEl = document.getElementById('dice-result-text');
  resultEl.classList.remove('landed');
  resultEl.textContent = '';
  // Paint a face BEFORE the overlay is shown, or the first 60ms displays whatever the
  // previous roll or flip left on #dice-face.
  renderDiePips(1 + Math.floor(Math.random() * sides));
  showDiceOverlay();

  let ticks = 0;
  const spin = setInterval(() => {
    renderDiePips(1 + Math.floor(Math.random() * sides));
    ticks++;
    if (ticks > 10) {
      clearInterval(spin);
      renderDiePips(finalValue);
      resultEl.textContent = `Rolled a ${finalValue}!`;
      resultEl.classList.add('landed');
      setTimeout(() => { hideDiceOverlay(); c.rolling = false; onResult(finalValue); }, 400);
    }
  }, 60);
}

function flipCoin(onResult) {
  const c = game.combat;
  c.rolling = true;
  const forced = c.forcedNextRoll === 'max';
  if (forced) c.forcedNextRoll = null;
  const heads = forced ? true : Math.random() < 0.5;

  const resultEl = document.getElementById('dice-result-text');
  resultEl.classList.remove('landed');
  resultEl.textContent = '';
  // Same pre-paint as rollDie, for the same reason.
  renderCoinFace(Math.random() < 0.5 ? 'H' : 'T');
  showDiceOverlay();

  let ticks = 0;
  const spin = setInterval(() => {
    renderCoinFace(Math.random() < 0.5 ? 'H' : 'T');
    ticks++;
    if (ticks > 10) {
      clearInterval(spin);
      renderCoinFace(heads ? 'H' : 'T');
      resultEl.textContent = heads ? 'Heads!' : 'Tails...';
      resultEl.classList.add('landed');
      setTimeout(() => { hideDiceOverlay(); c.rolling = false; onResult(heads); }, 400);
    }
  }, 60);
}

// Single source of truth for "can this card be played right now". Both playCard and the
// render layer call it, so a card the UI greys out is exactly a card playCard refuses.
// A discardCost is a hard requirement, not a clamped one: the card needs that many OTHER
// cards in hand to pay with (the card itself is still in hand here, hence length - 1),
// otherwise it is unplayable rather than resolving at a reduced cost.
function canPlayCard(card) {
  const c = game.combat;
  // Also refuses while a die/coin is spinning -- a deferred attack's combo trigger isn't
  // final until it resolves, and End Turn is blocked for the same reason (see rollDie).
  if (!c || c.discardSelection || c.rolling) return false;
  if (card.cost > c.energy) return false;
  if (card.goldCost && card.goldCost > game.gold) return false;
  if (card.discardCost && c.hand.length - 1 < card.discardCost) return false;
  // Self-damage must never be lethal or reduce you to 0 -- Blood Money greys itself out
  // at low HP rather than letting you cash yourself in.
  if (card.selfDamage && card.selfDamage >= game.hp) return false;
  return true;
}

function playCard(uid) {
  const c = game.combat;
  if (c.discardSelection) return; // must resolve the pending discard cost first
  const idx = c.hand.findIndex(card => card.uid === uid);
  if (idx === -1) return;
  const card = c.hand[idx];
  if (!canPlayCard(card)) return;

  c.energy -= card.cost;
  if (card.goldCost) game.gold -= card.goldCost;
  c.hand.splice(idx, 1);
  (card.exhaustOnPlay ? c.exhaustPile : c.discardPile).push(card);

  const comboTexts = [];

  // BLOCK RESOLVES BEFORE ATTACK. Only cards carrying both (isAttackToo) can tell the
  // difference, and Shield Bash needs it this way round: it gains block first, then hits
  // for the block it is now standing on. `hits` drives the loop here exactly as it does
  // for attacks -- cards without it default to 1 and behave as they always did.
  if (card.block) {
    const hits = card.hits || 1;
    let totalBlock = 0;
    let lastMult = 1;
    for (let h = 0; h < hits; h++) {
      const { block, mult } = resolveBlockGain(card.block, card.blockComboBonus || 0);
      totalBlock += block;
      lastMult = mult;
    }
    logMsg(`${card.name} grants ${totalBlock} block.`);
    if (lastMult > 1.001) comboTexts.push(`BLK x${lastMult.toFixed(2)}`);
  }

  // `deferredAttack` cards (Glass Cannon) resolve their own damage inside onPlay once a
  // die settles, so the automatic branch has to skip them -- otherwise they'd land damage
  // and burn a combo trigger before the roll decides whether they even hit.
  if ((card.type === 'attack' || card.isAttackToo) && !card.deferredAttack) {
    const hits = card.hits || 1;
    // Shield Bash-style cards take their base damage from the block they are standing on
    // (the block branch above has already run), rather than from a flat baseDamage. The
    // block is read, not spent -- nothing here zeroes c.block.
    const baseDmg = card.damageFromBlockPercent
      ? Math.round(c.block * card.damageFromBlockPercent)
      : (card.baseDamage || 0);
    let totalDmg = 0;
    let lastMult = 1;
    for (let h = 0; h < hits; h++) {
      const { damage, mult } = resolveAttackHit(baseDmg, card.comboBonus || 0);
      totalDmg += damage;
      lastMult = mult;
    }
    logMsg(`Played ${card.name}: dealt ${totalDmg} damage.`);
    if (lastMult > 1.001) comboTexts.push(`ATK x${lastMult.toFixed(2)}`);
  }

  if (card.selfDamage) {
    game.hp = Math.max(0, game.hp - card.selfDamage);
    logMsg(`${card.name} costs you ${card.selfDamage} HP.`);
  }

  if (card.gold) {
    const g = gainGold(card.gold);
    logMsg(`${card.name} grants ${g} gold.`);
  }

  if (card.discardRandom) {
    discardRandomCards(card.discardRandom);
  }

  if (card.discardCost) {
    beginDiscardSelection(card, card.discardCost);
  } else {
    resolveDeferrableEffects(card);
  }

  if (card.onPlay) card.onPlay(card);

  if (comboTexts.length) showComboPopup(comboTexts.join(' / ') + '!');

  renderCombat();
  checkCombatEnd();
}

// energyGain and drawOnPlay are the two effects a discardCost can gate behind an
// upfront discard -- pulled into one place so both the immediate and deferred paths
// (see beginDiscardSelection) apply them identically.
function resolveDeferrableEffects(card) {
  const c = game.combat;
  if (card.energyGain) {
    c.energy += card.energyGain;
    logMsg(`${card.name} grants ${card.energyGain} energy.`);
  }
  if (card.drawOnPlay) {
    drawCards(card.drawOnPlay);
  }
}

// ---------- Discard-cost cards (an "offering" paid before the card's effect fires) ----------
// canPlayCard guarantees enough other cards are in hand before the card is ever played,
// so there is no clamping or skip-the-cost path here -- the discard always happens in full.
function beginDiscardSelection(card, count) {
  game.combat.discardSelection = { forCard: card, remaining: count };
  logMsg(`${card.name}: choose ${count} card(s) to discard.`);
}

function selectDiscard(uid) {
  const c = game.combat;
  if (!c.discardSelection) return;
  const idx = c.hand.findIndex(card => card.uid === uid);
  if (idx === -1) return;
  const [discarded] = c.hand.splice(idx, 1);
  c.discardPile.push(discarded);
  c.discardSelection.remaining--;
  if (c.discardSelection.remaining <= 0) {
    const finishedCard = c.discardSelection.forCard;
    c.discardSelection = null;
    resolveDeferrableEffects(finishedCard);
  }
  renderCombat();
}

function showComboPopup(text) {
  const el = document.getElementById('combo-popup');
  el.textContent = text;
  el.classList.remove('hidden');
  // restart animation
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(showComboPopup._t);
  showComboPopup._t = setTimeout(() => el.classList.add('hidden'), 1400);
}

function endTurn() {
  const c = game.combat;
  if (!c || game.hp <= 0 || c.boss.hp <= 0 || c.discardSelection || c.rolling) return;

  // discard remaining hand
  c.discardPile.push(...c.hand);
  c.hand = [];

  // boss attacks
  const dmg = c.boss.pattern[c.boss.patternIndex];
  c.boss.patternIndex = (c.boss.patternIndex + 1) % c.boss.pattern.length;
  fireEvent('playerAttacked', { damage: dmg }); // Bramble Guard-style retaliation
  const dealt = Math.max(0, dmg - c.block);
  game.hp = Math.max(0, game.hp - dealt);
  if (dmg === 0) {
    logMsg(`${c.boss.name} does nothing this turn.`);
  } else {
    logMsg(`${c.boss.name} attacks for ${dmg}${c.block > 0 ? ` (blocked ${Math.min(dmg, c.block)})` : ''}, you take ${dealt}.`);
  }
  c.block = 0;
  clearTurnStatuses();

  if (game.hp <= 0) {
    renderCombat();
    checkCombatEnd();
    return;
  }

  // Retaliation (Bramble Guard) resolves on the boss's turn and can finish it off, so the
  // fight has to be able to end here. Without this you'd start a fresh turn against a
  // boss sitting on 0 HP.
  if (c.boss.hp <= 0) {
    renderCombat();
    checkCombatEnd();
    return;
  }

  // new player turn
  c.energy = BASE_ENERGY;
  c.turnAttackCount = 0;
  c.turnBlockCount = 0;
  c.turnDamageDealt = 0;
  c.forcedNextRoll = null; // Loaded Dice only promises "this turn"
  drawCards(currentHandSize() - c.hand.length);
  // Fired last, once the new turn is fully built: after the death check above (a dead
  // player collects nothing), after the counters reset (a listener sees a clean turn),
  // after the draw (a listener can act on the new hand), and before renderCombat() so
  // anything it grants is on screen immediately. Protection Racket listens here.
  fireEvent('turnStart', {});
  renderCombat();
}

function checkCombatEnd() {
  const c = game.combat;
  // Idempotency guard: once this fight has already been resolved (either branch below),
  // a second call is a no-op. Without this, calling checkCombatEnd() twice while
  // c.boss.hp is still 0 (it stays 0 for the whole market visit -- nothing resets it
  // until startCombat() replaces the combat object for the next fight) would re-grant
  // the gold reward and re-open the market, which reshuffles cardOffers and clears
  // boughtCardKeys, making an already-bought card buyable again.
  if (c.ended) return;
  // Player-death is checked before boss-death on purpose: if both hit 0 HP on the same
  // boss attack (e.g. a lethal hit landing the same turn Bramble Guard's retaliation
  // finishes the boss), a mutual kill resolves as a LOSS, not a win. Don't reorder these
  // two checks -- that would silently flip the mutual-kill ruling to a win.
  if (game.hp <= 0) {
    c.ended = true;
    showScreen('screen-gameover');
    document.getElementById('gameover-text').textContent =
      `${c.boss.name} finished you off on boss ${game.bossIndex + 1} of ${BOSSES.length}.`;
    return;
  }
  if (c.boss.hp <= 0) {
    c.ended = true;
    const reward = gainGold(BOSS_REWARD_BASE + BOSS_REWARD_PER_BOSS * game.bossIndex);
    logMsg(`${c.boss.name} defeated! +${reward} gold.`);
    openMarket();
  }
}

// ---------- Market ----------
let marketState = null;

function openMarket() {
  const cardOffers = shuffle(SHOP_POOL_KEYS).slice(0, cardShopSlots()).map(k => ({ ...CARD_LIBRARY[k] }));
  marketState = { cardOffers, boughtCardKeys: new Set() };
  showScreen('screen-market');
  renderMarket();
}

// Rerolls just the card offers for gold, at an ever-climbing price (see rerollCost's
// comment in newRun). Trinkets are a deterministic slice of TRINKET_LIBRARY, not a random
// draw, so there's nothing to reroll there.
function rerollShop() {
  if (game.gold < game.rerollCost) return;
  game.gold -= game.rerollCost;
  game.rerollCost += REROLL_COST_STEP;
  marketState.cardOffers = shuffle(SHOP_POOL_KEYS).slice(0, cardShopSlots()).map(k => ({ ...CARD_LIBRARY[k] }));
  marketState.boughtCardKeys = new Set();
  renderMarket();
}

// Trinket offers aren't rolled/cached like cards -- they're a deterministic slice of
// TRINKET_LIBRARY sized by the current shopSize level, so they're always computed fresh.
function currentTrinketOffers() {
  return Object.values(TRINKET_LIBRARY).slice(0, trinketShopSlots());
}

// If Shop Size was just bought, grow this visit's card list immediately instead of
// making the player wait for the next market to see the extra slot. Matches openMarket's
// no-duplicates rule -- draws from pool keys not already on offer, same as the initial
// shuffle-and-slice does implicitly by construction. If the pool runs out of unused keys
// (only possible if cardShopSlots() somehow exceeded SHOP_POOL_KEYS.length, which it can't
// today since cardShopSlots() is itself capped at the pool size) this just stops adding
// offers short of the slot count rather than duplicating or looping forever.
function growCardOffersToShopSize() {
  const usedKeys = new Set(marketState.cardOffers.map(o => o.key));
  const available = shuffle(SHOP_POOL_KEYS.filter(k => !usedKeys.has(k)));
  while (marketState.cardOffers.length < cardShopSlots() && available.length) {
    const key = available.pop();
    marketState.cardOffers.push({ ...CARD_LIBRARY[key] });
  }
}

function buyMarketCard(idx) {
  const offer = marketState.cardOffers[idx];
  if (!offer || marketState.boughtCardKeys.has(idx)) return;
  const price = discountedPrice(offer.price);
  if (game.gold < price) return;
  game.gold -= price;
  game.deck.push(instantiateCard(offer.key));
  marketState.boughtCardKeys.add(idx);
  renderMarket();
}

// Trinkets are repeatable: buying one just re-runs its apply(game) and bumps its level.
function buyMarketTrinket(idx) {
  const offer = currentTrinketOffers()[idx];
  if (!offer) return;
  const price = discountedPrice(offer.price);
  if (game.gold < price) return;
  game.gold -= price;
  offer.apply(game);
  game.trinketLevels[offer.key]++;
  growCardOffersToShopSize();
  renderMarket();
}

function healCost() { return discountedPrice(HEAL_COST_BASE); }
function removeCost() { return discountedPrice(REMOVE_COST_BASE); }

function doHeal() {
  const cost = healCost();
  if (game.gold < cost || game.hp >= game.maxHp) return;
  game.gold -= cost;
  game.hp = Math.min(game.maxHp, game.hp + 15);
  renderMarket();
}

function openRemoveScreen() {
  if (game.gold < removeCost()) return;
  showScreen('screen-remove');
  renderRemoveScreen();
}

function renderRemoveScreen() {
  const el = document.getElementById('remove-deck-list');
  el.innerHTML = '';
  game.deck.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = `card shop-card ${card.type}`;
    div.innerHTML = cardFaceHTML(card, null);
    div.onclick = () => {
      game.deck.splice(i, 1);
      game.gold -= removeCost();
      showScreen('screen-market');
      renderMarket();
    };
    el.appendChild(div);
  });
}

function continueFromMarket() {
  game.bossIndex++;
  if (game.bossIndex >= BOSSES.length) {
    showScreen('screen-win');
  } else {
    startCombat();
  }
}

// ---------- Number-key hand shortcuts ----------
// Position in hand -> key label: 1..9 then 0 for the 10th card. Hands past 10 cards have
// no keybind for the overflow (click only) -- rebinding onto QWERTY would cover ground
// this game never needs, since hand size only grows in +1 steps via the Hand Size trinket.
function handKeyLabel(index) {
  if (index < 9) return String(index + 1);
  if (index === 9) return '0';
  return null;
}

document.addEventListener('keydown', (e) => {
  if (!game || !game.combat) return;
  if (!document.getElementById('screen-combat').classList.contains('active')) return;

  // Space ends the turn -- preventDefault so it doesn't also scroll the page or, if an
  // <button> happens to have focus, double-fire via the browser's own space-to-click.
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    endTurn();
    return;
  }

  const key = e.key;
  let idx;
  if (key >= '1' && key <= '9') idx = key.charCodeAt(0) - '1'.charCodeAt(0);
  else if (key === '0') idx = 9;
  else return;

  const c = game.combat;
  const card = c.hand.find(h => h.handSlot === idx);
  if (!card) return;

  if (c.discardSelection) {
    selectDiscard(card.uid);
  } else if (canPlayCard(card)) {
    playCard(card.uid);
  }
});

// ---------- Rendering ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function cardDescText(card) {
  return card.desc;
}

// ---------- Card sprites (pixel art) ----------
// Each run is [col, row, widthCells, heightCells, ink] on a 32x20 grid. Ink 'C' resolves to
// the card's type color, 'W'/'K'/'R' are fixed white/black/red. Keyed by CARD_LIBRARY key --
// a missing entry just renders an empty grid rather than throwing (see spriteSVG below).
const GRID_W = 32, GRID_H = 20;
const SPRITES = {
strike:[[25,0,1,1,'W'],[24,1,1,1,'W'],[23,2,1,1,'W'],[22,3,1,1,'W'],[21,4,1,1,'W'],[20,5,1,1,'W'],[19,6,1,1,'W'],[18,7,1,1,'W'],[17,8,1,1,'W'],[16,9,1,1,'W'],[15,10,1,1,'W'],[14,11,1,1,'W'],[13,12,1,1,'W'],[12,13,1,1,'W'],[9,14,6,1,'W'],[10,19,4,1,'W'],[24,0,1,1,'C'],[23,1,1,1,'C'],[22,2,1,1,'C'],[21,3,1,1,'C'],[20,4,1,1,'C'],[19,5,1,1,'C'],[18,6,1,1,'C'],[17,7,1,1,'C'],[16,8,1,1,'C'],[15,9,1,1,'C'],[14,10,1,1,'C'],[13,11,1,1,'C'],[12,12,1,1,'C'],[11,13,1,1,'C'],[11,15,2,4,'C']],
quickStab:[[21,4,1,1,'W'],[20,5,1,1,'W'],[19,6,1,1,'W'],[18,7,1,1,'W'],[17,8,1,1,'W'],[16,9,1,1,'W'],[15,10,1,1,'W'],[14,11,1,1,'W'],[13,12,1,1,'W'],[10,13,6,1,'W'],[11,17,4,1,'W'],[20,4,1,1,'C'],[19,5,1,1,'C'],[18,6,1,1,'C'],[17,7,1,1,'C'],[16,8,1,1,'C'],[15,9,1,1,'C'],[14,10,1,1,'C'],[13,11,1,1,'C'],[12,12,1,1,'C'],[12,14,2,3,'C'],[2,2,6,1,'C'],[1,6,7,1,'C'],[2,10,6,1,'C']],
comboStrike:[[6,12,3,7,'C'],[13,8,3,11,'C'],[20,4,3,15,'C'],[6,11,3,1,'W'],[13,7,3,1,'W'],[20,3,3,1,'W']],
twinBlades:[[6,0,1,1,'W'],[7,1,1,1,'W'],[8,2,1,1,'W'],[9,3,1,1,'W'],[10,4,1,1,'W'],[11,5,1,1,'W'],[12,6,1,1,'W'],[13,7,1,1,'W'],[14,8,1,1,'W'],[15,9,1,1,'W'],[16,10,1,1,'W'],[17,11,1,1,'W'],[18,12,1,1,'W'],[19,13,1,1,'W'],[25,0,1,1,'W'],[24,1,1,1,'W'],[23,2,1,1,'W'],[22,3,1,1,'W'],[21,4,1,1,'W'],[20,5,1,1,'W'],[19,6,1,1,'W'],[18,7,1,1,'W'],[17,8,1,1,'W'],[16,9,1,1,'W'],[15,10,1,1,'W'],[14,11,1,1,'W'],[13,12,1,1,'W'],[12,13,1,1,'W'],[17,14,6,1,'W'],[9,14,6,1,'W'],[18,19,4,1,'W'],[10,19,4,1,'W'],[7,0,1,1,'C'],[8,1,1,1,'C'],[9,2,1,1,'C'],[10,3,1,1,'C'],[11,4,1,1,'C'],[12,5,1,1,'C'],[13,6,1,1,'C'],[14,7,1,1,'C'],[15,8,1,1,'C'],[16,9,1,1,'C'],[17,10,1,1,'C'],[18,11,1,1,'C'],[19,12,1,1,'C'],[20,13,1,1,'C'],[24,0,1,1,'C'],[23,1,1,1,'C'],[22,2,1,1,'C'],[21,3,1,1,'C'],[20,4,1,1,'C'],[19,5,1,1,'C'],[18,6,1,1,'C'],[17,7,1,1,'C'],[16,8,1,1,'C'],[15,9,1,1,'C'],[14,10,1,1,'C'],[13,11,1,1,'C'],[12,12,1,1,'C'],[11,13,1,1,'C'],[19,15,2,4,'C'],[11,15,2,4,'C']],
thousandCuts:[[3,8,2,1,'C'],[4,9,2,1,'C'],[5,10,2,1,'C'],[6,11,2,1,'C'],[9,8,2,1,'C'],[10,9,2,1,'C'],[11,10,2,1,'C'],[12,11,2,1,'C'],[15,8,2,1,'C'],[16,9,2,1,'C'],[17,10,2,1,'C'],[18,11,2,1,'C'],[21,8,2,1,'C'],[22,9,2,1,'C'],[23,10,2,1,'C'],[24,11,2,1,'C'],[27,8,2,1,'C'],[28,9,2,1,'C'],[29,10,2,1,'C'],[30,11,2,1,'C'],[3,7,2,1,'W'],[9,7,2,1,'W'],[15,7,2,1,'W'],[21,7,2,1,'W'],[27,7,2,1,'W']],
heavyStrike:[[9,3,15,1,'W'],[9,4,15,6,'C'],[15,10,3,10,'W'],[11,6,2,2,'K'],[20,6,2,2,'K']],
glassCannon:[[15,6,2,1,'C'],[14,7,4,1,'C'],[13,8,6,1,'C'],[12,9,8,2,'C'],[13,11,6,1,'C'],[14,12,4,1,'C'],[15,13,2,1,'C'],[11,5,1,1,'W'],[10,4,1,1,'W'],[9,3,1,1,'W'],[20,5,1,1,'W'],[21,4,1,1,'W'],[22,3,1,1,'W'],[11,14,1,1,'W'],[10,15,1,1,'W'],[9,16,1,1,'W'],[20,14,1,1,'W'],[21,15,1,1,'W'],[22,16,1,1,'W']],
guard:[[11,3,10,1,'W'],[11,4,10,6,'C'],[12,10,8,2,'C'],[13,12,6,2,'C'],[14,14,4,1,'C'],[15,15,2,1,'C'],[11,4,1,6,'W'],[20,4,1,6,'W']],
brace:[[4,12,24,1,'W'],[4,13,24,3,'C'],[7,16,2,3,'C'],[23,16,2,3,'C']],
stonewall:[[4,5,24,1,'W'],[4,6,24,12,'C'],[4,9,24,1,'K'],[4,13,24,1,'K'],[11,6,1,3,'K'],[19,6,1,3,'K'],[7,10,1,3,'K'],[15,10,1,3,'K'],[23,10,1,3,'K'],[11,14,1,4,'K'],[19,14,1,4,'K']],
shieldWall:[[3,5,8,1,'W'],[12,5,8,1,'W'],[21,5,8,1,'W'],[3,6,8,5,'C'],[4,11,6,2,'C'],[5,13,4,1,'C'],[6,14,2,1,'C'],[12,6,8,5,'C'],[13,11,6,2,'C'],[14,13,4,1,'C'],[15,14,2,1,'C'],[21,6,8,5,'C'],[22,11,6,2,'C'],[23,13,4,1,'C'],[24,14,2,1,'C']],
bulwark:[[2,6,6,1,'W'],[9,6,6,1,'W'],[16,6,6,1,'W'],[23,6,6,1,'W'],[2,7,6,4,'C'],[3,11,4,2,'C'],[4,13,2,1,'C'],[9,7,6,4,'C'],[10,11,4,2,'C'],[11,13,2,1,'C'],[16,7,6,4,'C'],[17,11,4,2,'C'],[18,13,2,1,'C'],[23,7,6,4,'C'],[24,11,4,2,'C'],[25,13,2,1,'C']],
shieldBash:[[5,4,10,1,'W'],[5,5,10,6,'C'],[6,11,8,2,'C'],[7,13,6,2,'C'],[8,15,4,1,'C'],[9,16,2,1,'C'],[19,5,2,1,'R'],[22,3,2,1,'R'],[19,9,3,1,'R'],[24,9,3,1,'R'],[19,14,2,1,'R'],[22,16,2,1,'R']],
brambleGuard:[[10,5,12,1,'W'],[10,6,12,6,'C'],[11,12,10,2,'C'],[12,14,8,1,'C'],[14,15,4,1,'C'],[8,7,2,1,'W'],[8,10,2,1,'W'],[9,13,2,1,'W'],[22,7,2,1,'W'],[22,10,2,1,'W'],[21,13,2,1,'W'],[13,3,1,2,'W'],[18,3,1,2,'W']],
armor:[[8,0,16,1,'W'],[8,1,1,8,'W'],[23,1,1,8,'W'],[9,1,14,8,'C'],[9,9,14,3,'C'],[10,12,12,2,'C'],[12,14,8,1,'C'],[13,15,6,1,'C'],[14,16,4,1,'C'],[15,17,2,1,'C'],[15,3,2,11,'K'],[11,6,10,2,'K']],
treasureGrab:[[11,14,10,3,'C'],[10,10,12,3,'C'],[12,6,8,3,'C'],[11,14,10,1,'W'],[10,10,12,1,'W'],[12,6,8,1,'W'],[15,11,2,1,'K'],[15,15,2,1,'K']],
rollTheBones:[[8,0,20,20,'C'],[8,0,20,1,'W'],[8,0,1,20,'W'],[11,3,3,3,'K'],[22,3,3,3,'K'],[16,8,3,3,'K'],[11,14,3,3,'K'],[22,14,3,3,'K']],
doubleOrNothing:[[12,3,8,1,'C'],[10,4,12,1,'C'],[9,5,14,10,'C'],[10,15,12,1,'C'],[12,16,8,1,'C'],[12,3,8,1,'W'],[9,5,1,10,'W'],[12,7,2,6,'K'],[18,7,2,6,'K'],[14,9,4,2,'K']],
skim:[[5,13,5,4,'C'],[13,13,5,4,'C'],[21,13,5,4,'C'],[5,13,5,1,'W'],[13,13,5,1,'W'],[21,13,5,1,'W'],[4,8,1,1,'W'],[6,6,1,1,'W'],[9,5,1,1,'W'],[13,4,1,1,'W'],[17,4,1,1,'W'],[21,5,1,1,'W'],[24,6,1,1,'W'],[26,7,1,1,'W'],[26,8,1,1,'W'],[27,8,1,1,'W']],
bloodMoney:[[12,2,8,1,'C'],[10,3,12,1,'C'],[9,4,14,7,'C'],[10,11,12,1,'C'],[12,12,8,1,'C'],[12,2,8,1,'W'],[9,4,1,7,'W'],[15,14,2,1,'R'],[14,15,4,1,'R'],[13,16,6,2,'R'],[14,18,4,1,'R']],
shakedown:[[14,2,4,1,'W'],[13,3,6,1,'C'],[11,4,10,2,'C'],[10,6,12,10,'C'],[11,16,10,1,'C'],[13,17,6,1,'C'],[10,8,12,2,'K'],[15,11,2,4,'K'],[13,12,6,1,'K']],
protectionRacket:[[13,8,6,1,'C'],[11,9,10,6,'C'],[13,15,6,1,'C'],[13,8,6,1,'W'],[11,9,1,6,'W'],[8,6,1,1,'W'],[9,4,1,1,'W'],[11,3,2,1,'W'],[14,2,4,1,'W'],[19,3,2,1,'W'],[22,4,1,1,'W'],[23,6,1,1,'W'],[22,5,3,1,'W'],[24,6,1,2,'W'],[15,10,2,4,'K']],
crackTheVault:[[7,1,18,18,'C'],[9,3,14,14,'K'],[14,7,6,6,'C'],[7,1,18,1,'W'],[16,5,2,2,'W'],[16,13,2,2,'W'],[11,9,3,2,'W'],[20,9,3,2,'W']],
gather:[[4,6,9,12,'C'],[11,4,9,14,'C'],[18,6,9,12,'C'],[4,6,9,1,'W'],[11,4,9,1,'W'],[18,6,9,1,'W'],[10,4,1,14,'W'],[17,4,1,14,'W']],
spark:[[16,2,3,1,'C'],[15,3,3,1,'C'],[14,4,3,1,'C'],[13,5,3,1,'C'],[12,6,3,1,'C'],[11,7,12,2,'C'],[18,9,3,1,'C'],[17,10,3,1,'C'],[16,11,3,1,'C'],[15,12,3,1,'C'],[14,13,3,1,'C'],[13,14,3,1,'C'],[16,2,3,1,'W'],[11,7,12,1,'W']],
overdraw:[[3,5,10,13,'C'],[3,5,10,1,'W'],[18,3,2,5,'W'],[16,6,6,1,'W'],[17,5,4,1,'W'],[25,10,2,5,'W'],[23,11,6,1,'W'],[24,12,4,1,'W'],[18,1,2,2,'C'],[25,15,2,2,'C']],
loadedDiceCard:[[9,4,16,15,'C'],[9,4,16,1,'W'],[9,4,1,15,'W'],[12,7,3,2,'K'],[19,7,3,2,'K'],[12,10,3,2,'K'],[19,10,3,2,'K'],[12,14,3,2,'K'],[19,14,3,2,'K'],[26,1,1,3,'W'],[25,2,3,1,'W']],
sidestep:[[4,11,6,7,'C'],[19,3,6,7,'C'],[4,11,6,1,'W'],[19,3,6,1,'W'],[11,10,2,1,'W'],[13,9,2,1,'W'],[15,8,2,1,'W'],[17,7,2,1,'W'],[17,5,1,3,'W'],[15,7,3,1,'W']],
overcharge:[[5,5,20,12,'C'],[25,8,3,6,'W'],[5,5,20,1,'W'],[16,7,3,1,'K'],[15,8,3,1,'K'],[14,9,3,1,'K'],[12,10,8,1,'K'],[15,11,3,1,'K'],[14,12,3,1,'K'],[13,13,3,1,'K']],
burnout:[[15,2,2,1,'C'],[14,3,4,1,'C'],[13,4,6,2,'C'],[12,6,8,2,'C'],[11,8,10,8,'C'],[12,16,8,2,'C'],[15,2,2,1,'W'],[14,10,4,6,'W'],[13,12,6,3,'W']]
};
const TYPE_INK={attack:'#ff0000',block:'#0000ff',loot:'#ffff00',skill:'#a855f7'};
const GRID_OPACITY={attack:.35,block:.5,loot:.3,skill:.4};

function spriteSVG(key,type){
  const runs=SPRITES[key]||[]; const ink=TYPE_INK[type]||'#ffffff';
  const pick=c=>c==='C'?ink:c==='W'?'#ffffff':c==='K'?'#000000':'#ff0000';
  let g='';
  for(const [x,y,w,h,c] of runs) g+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${pick(c)}"/>`;
  return `<svg viewBox="0 0 ${GRID_W} ${GRID_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="pg-${key}" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0 L0 0 0 1" fill="none" stroke="${ink}" stroke-width="0.06" opacity="${GRID_OPACITY[type]||.35}"/></pattern></defs><rect width="${GRID_W}" height="${GRID_H}" fill="url(#pg-${key})"/>${g}</svg>`;
}

// ---------- Card badges (the colored circles showing cost / hotkey) ----------
// One shared readout so a hand card and its shop listing always agree on what a card does --
// cardAttackDisplay/cardBlockDisplay are the single source of truth for "how much damage or
// block does this number actually represent", used by cornerBadges and the type-line stat.

// Not every attack card carries a flat baseDamage -- Shield Bash derives its hit from the
// block it just gained, and Double or Nothing has a flat payout under a different field
// name. Pure-gamble cards (Roll the Bones) have no single number to show and are skipped.
function cardAttackDisplay(card) {
  if (card.damageFromBlockPercent) return Math.round((card.block || 0) * card.damageFromBlockPercent);
  if (card.baseDamage != null) return card.baseDamage;
  if (card.winDamage != null) return card.winDamage;
  return null;
}

function cardBlockDisplay(card) {
  return card.block || null;
}

// Cost / gold-cost / hotkey badges, pinned to the card's corners. `keybind` is the hand-only
// hotkey label (null in the shop, where cards have no hotkey to show).
function cornerBadges(card, keybind) {
  return `
    <div class="badge badge-cost" title="Energy cost">${card.cost}</div>
    ${card.goldCost ? `<div class="badge badge-goldcost" title="Gold cost">${card.goldCost}</div>` : ''}
    ${keybind ? `<div class="badge badge-key" title="Hotkey">${keybind}</div>` : ''}
  `;
}

// The type line's right-hand stat -- folds what used to be the separate attack/block badges
// into the same band as the card's type. Shield Bash is the only card with both an attack
// and a block value, shown as "atk/block"; cards with neither (Skim, Gather, Protection
// Racket, ...) show nothing rather than a placeholder.
function typeLineStat(card) {
  const hits = card.hits || 1;
  const atk = cardAttackDisplay(card);
  const block = cardBlockDisplay(card);
  const atkText = atk == null ? null : (hits > 1 ? `${atk}x${hits}` : `${atk}`);
  const blockText = block == null ? null : (hits > 1 ? `${block}x${hits}` : `${block}`);
  if (atkText != null && blockText != null) return `${atkText}/${blockText}`;
  return atkText != null ? atkText : (blockText != null ? blockText : '');
}

// Full card face -- badges, a framed art window, the type line, and the rules text. Shared
// by the hand, the shop, and the remove screen so a card looks identical everywhere it's shown.
function cardFaceHTML(card, keybind) {
  return `
    ${cornerBadges(card, keybind)}
    <div class="name${card.goldCost ? ' has-goldcost' : ''}">${card.name}</div>
    <div class="name-rule"></div>
    <div class="art">${spriteSVG(card.key, card.type)}</div>
    <div class="typeline"><span>${card.type}</span><span class="stat">${typeLineStat(card)}</span></div>
    <div class="desc">${cardDescText(card)}</div>
  `;
}

function renderCombat() {
  const c = game.combat;
  if (!c) return;

  document.getElementById('player-hp-fill').style.width = `${Math.max(0, (game.hp / game.maxHp) * 100)}%`;
  document.getElementById('player-hp-text').textContent = `${game.hp}/${game.maxHp}`;
  document.getElementById('player-block-text').textContent = c.block;
  // BASE_ENERGY is energy-per-turn, not a cap -- Burnout and other energyGain effects can
  // push c.energy past it, where "x/3" would misleadingly read like a maximum. Only show
  // the denominator while energy is still at or under the normal per-turn amount.
  document.getElementById('player-energy-text').textContent =
    c.energy <= BASE_ENERGY ? `${c.energy}/${BASE_ENERGY}` : `${c.energy}`;
  document.getElementById('player-gold-text').textContent = game.gold;
  document.getElementById('deck-count-text').textContent = game.deck.length;

  document.getElementById('boss-name').textContent = `${c.boss.name}  (Boss ${game.bossIndex + 1}/${BOSSES.length})`;
  document.getElementById('boss-hp-fill').style.width = `${Math.max(0, (c.boss.hp / c.boss.maxHp) * 100)}%`;
  document.getElementById('boss-hp-text').textContent = `${c.boss.hp}/${c.boss.maxHp}`;
  const nextHit = c.boss.pattern[c.boss.patternIndex];
  document.getElementById('boss-intent').textContent = nextHit === 0
    ? 'Intent: nothing next turn'
    : `Intent: ${nextHit} damage next turn`;

  document.getElementById('draw-count').textContent = c.drawPile.length;
  document.getElementById('discard-count').textContent = c.discardPile.length;
  // Only shown once something has actually been exhausted -- most fights never touch
  // this pile (only Burnout uses exhaustOnPlay today), so it stays out of the way until
  // it's relevant instead of sitting at a confusing permanent "0".
  document.getElementById('exhaust-row').classList.toggle('hidden', c.exhaustPile.length === 0);
  document.getElementById('exhaust-count').textContent = c.exhaustPile.length;

  const selecting = !!c.discardSelection;
  const handEl = document.getElementById('hand');
  handEl.innerHTML = '';
  c.hand.forEach(card => {
    const div = document.createElement('div');
    const playable = canPlayCard(card);
    const key = handKeyLabel(card.handSlot);
    div.className = `card ${card.type}${(!selecting && !playable) ? ' unplayable' : ''}${selecting ? ' discard-target' : ''}`;
    div.dataset.uid = card.uid;
    div.draggable = !selecting;
    div.innerHTML = cardFaceHTML(card, key);
    if (selecting) {
      div.onclick = () => selectDiscard(card.uid);
    } else {
      if (playable) div.onclick = () => playCard(card.uid);
      attachHandDragEvents(div);
    }
    handEl.appendChild(div);
  });
  handEl.ondragover = selecting ? null : (e) => {
    e.preventDefault();
    if (draggedCardEl && e.target === handEl) handEl.appendChild(draggedCardEl);
  };

  const promptEl = document.getElementById('discard-prompt');
  if (selecting) {
    promptEl.textContent = `Choose ${c.discardSelection.remaining} card(s) to discard for ${c.discardSelection.forCard.name}`;
    promptEl.classList.remove('hidden');
  } else {
    promptEl.classList.add('hidden');
  }
  document.getElementById('btn-end-turn').disabled = selecting || c.rolling;

  const logEl = document.getElementById('combat-log');
  logEl.innerHTML = c.log.slice(0, 6).map(m => `<div>${m}</div>`).join('');
}

// ---------- Hand drag-to-reorder (Balatro-style) ----------
// Reordering is purely cosmetic (what order you play cards in), so we move the actual
// DOM node live as you drag over neighbors, then sync game.combat.hand to match on drop --
// no full re-render mid-drag, which would otherwise yank the dragged node out from under
// the browser's native drag session.
let draggedCardEl = null;

function attachHandDragEvents(div) {
  div.ondragstart = (e) => {
    draggedCardEl = div;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', div.dataset.uid);
    setTimeout(() => div.classList.add('dragging'), 0);
  };
  div.ondragend = () => {
    div.classList.remove('dragging');
    draggedCardEl = null;
    syncHandOrderFromDOM();
    assignHandSlots();
    // Full re-render (safe now that the drag session is over) so each card's number
    // badge matches its new position -- reordering hand cards must swap their keybinds.
    renderCombat();
  };
  div.ondragover = (e) => {
    e.preventDefault();
    if (!draggedCardEl || draggedCardEl === div) return;
    const rect = div.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    div.parentNode.insertBefore(draggedCardEl, before ? div : div.nextSibling);
  };
}

function syncHandOrderFromDOM() {
  const c = game.combat;
  if (!c) return;
  const order = Array.from(document.querySelectorAll('#hand .card')).map(el => Number(el.dataset.uid));
  c.hand.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
}

function renderMarket() {
  document.getElementById('market-hp-text').textContent = `${game.hp}/${game.maxHp}`;
  document.getElementById('market-gold-text').textContent = game.gold;
  document.getElementById('heal-cost').textContent = healCost();
  document.getElementById('remove-cost').textContent = removeCost();
  document.getElementById('reroll-cost').textContent = game.rerollCost;
  document.getElementById('btn-reroll').disabled = game.gold < game.rerollCost;

  // Every shop offer is a .shop-slot: the offer itself (a real .card for a purchasable
  // card, identical to how it looks in hand; a plain box for a trinket) stacked above its
  // own .shop-price element, so the price always sits below the thing being priced instead
  // of being baked into the card/box.
  const cardsEl = document.getElementById('market-cards');
  cardsEl.innerHTML = '';
  marketState.cardOffers.forEach((offer, i) => {
    const owned = marketState.boughtCardKeys.has(i);
    const price = discountedPrice(offer.price);
    const afford = game.gold >= price;

    const slot = document.createElement('div');
    slot.className = `shop-slot${owned ? ' owned' : ''}${!owned && !afford ? ' cant-afford' : ''}`;

    const div = document.createElement('div');
    div.className = `card shop-card ${offer.type}`;
    div.innerHTML = cardFaceHTML(offer, null);

    const priceEl = document.createElement('div');
    priceEl.className = 'shop-price';
    priceEl.textContent = owned ? 'Bought' : (price === 0 ? 'Free' : price + 'g');

    slot.appendChild(div);
    slot.appendChild(priceEl);
    if (!owned) slot.onclick = () => buyMarketCard(i);
    cardsEl.appendChild(slot);
  });

  // Trinkets are repeatable, so there's no "owned" state -- just a stacking level.
  const trinketsEl = document.getElementById('market-trinkets');
  trinketsEl.innerHTML = '';
  currentTrinketOffers().forEach((offer, i) => {
    const price = discountedPrice(offer.price);
    const afford = game.gold >= price;
    const level = game.trinketLevels[offer.key];

    const slot = document.createElement('div');
    slot.className = `shop-slot${!afford ? ' cant-afford' : ''}`;

    const div = document.createElement('div');
    div.className = 'market-card trinket';
    div.innerHTML = `<div class="name">${offer.name}${level > 0 ? ` (Lv ${level})` : ''}</div><div class="desc">${offer.desc}</div>`;

    const priceEl = document.createElement('div');
    priceEl.className = 'shop-price';
    priceEl.textContent = `${price}g`;

    slot.appendChild(div);
    slot.appendChild(priceEl);
    slot.onclick = () => buyMarketTrinket(i);
    trinketsEl.appendChild(slot);
  });

  document.getElementById('btn-heal').disabled = game.gold < healCost() || game.hp >= game.maxHp;
  document.getElementById('btn-remove').disabled = game.gold < removeCost() || game.deck.length === 0;
}

// ---------- Wiring ----------
document.getElementById('btn-new-run').onclick = newRun;
document.getElementById('btn-end-turn').onclick = endTurn;
document.getElementById('btn-continue').onclick = continueFromMarket;
document.getElementById('btn-reroll').onclick = rerollShop;
document.getElementById('btn-heal').onclick = doHeal;
document.getElementById('btn-remove').onclick = openRemoveScreen;
document.getElementById('btn-cancel-remove').onclick = () => { showScreen('screen-market'); renderMarket(); };
document.getElementById('btn-restart-lose').onclick = newRun;
document.getElementById('btn-restart-win').onclick = newRun;

showScreen('screen-start');

// ============================================================================
// DEV TUNING PANEL -- balance-iteration overlay, backtick (`) toggles it.
// Not part of the shipped game. Doesn't run anything while closed (event listeners
// only, no polling/rendering loop) and touches nothing outside this block except by
// calling already-public functions (renderCombat/renderMarket/renderRemoveScreen) and
// mutating already-public data (CARD_LIBRARY, BOSSES, TRINKET_LIBRARY, the tunable
// constants). To strip this tool entirely, delete: this whole block, the #tuning-panel
// markup in index.html, and the ".tuning-*" rules in style.css.
// ============================================================================

// The exact numeric fields a card can carry, in the order the panel shows them. Booleans
// (deferredAttack, isAttackToo, exhaustOnPlay) are flags, not tunable numbers, and are
// deliberately not in this list -- a card only gets an input for a field it actually has.
const TUNING_CARD_NUMERIC_FIELDS = [
  'cost', 'baseDamage', 'hits', 'block', 'blockComboBonus', 'comboBonus', 'gold',
  'goldCost', 'goldPerAttack', 'goldPerTurn', 'selfDamage', 'energyGain', 'drawOnPlay',
  'discardCost', 'damagePerPip', 'winDamage', 'retaliateDamage', 'damageFromBlockPercent',
  'price',
];

const TUNING_CONST_NAMES = [
  'BASE_ENERGY', 'HAND_SIZE', 'COMBO_STEP', 'START_HP', 'START_MAX_HP', 'START_GOLD',
  'BOSS_REWARD_BASE', 'BOSS_REWARD_PER_BOSS', 'HEAL_COST_BASE', 'REMOVE_COST_BASE',
  'REROLL_COST_START', 'REROLL_COST_STEP',
];
// Plain `let` bindings can't be handed around as values, so each constant gets a
// get/set pair here -- this is the seam that lets the panel read and reassign them
// generically instead of a 12-way if/else repeated in three different places.
const TUNING_CONST_ACCESSORS = {
  BASE_ENERGY: { get: () => BASE_ENERGY, set: (v) => { BASE_ENERGY = v; } },
  HAND_SIZE: { get: () => HAND_SIZE, set: (v) => { HAND_SIZE = v; } },
  COMBO_STEP: { get: () => COMBO_STEP, set: (v) => { COMBO_STEP = v; } },
  START_HP: { get: () => START_HP, set: (v) => { START_HP = v; } },
  START_MAX_HP: { get: () => START_MAX_HP, set: (v) => { START_MAX_HP = v; } },
  START_GOLD: { get: () => START_GOLD, set: (v) => { START_GOLD = v; } },
  BOSS_REWARD_BASE: { get: () => BOSS_REWARD_BASE, set: (v) => { BOSS_REWARD_BASE = v; } },
  BOSS_REWARD_PER_BOSS: { get: () => BOSS_REWARD_PER_BOSS, set: (v) => { BOSS_REWARD_PER_BOSS = v; } },
  HEAL_COST_BASE: { get: () => HEAL_COST_BASE, set: (v) => { HEAL_COST_BASE = v; } },
  REMOVE_COST_BASE: { get: () => REMOVE_COST_BASE, set: (v) => { REMOVE_COST_BASE = v; } },
  REROLL_COST_START: { get: () => REROLL_COST_START, set: (v) => { REROLL_COST_START = v; } },
  REROLL_COST_STEP: { get: () => REROLL_COST_STEP, set: (v) => { REROLL_COST_STEP = v; } },
};

// Snapshot taken once, right now -- after applyTuningPatch() already ran up top, so
// "the file's values" (what Reset restores to) means the file plus any baked-in TUNING
// patch, not literally the raw source literals. Everything the panel edits is compared
// against this to decide what counts as "changed" for the export patch and changelog.
const TUNING_BASELINE = {
  cards: Object.fromEntries(Object.entries(CARD_LIBRARY).map(([key, card]) => [
    key,
    Object.fromEntries(TUNING_CARD_NUMERIC_FIELDS.filter(f => card[f] !== undefined).map(f => [f, card[f]])),
  ])),
  bosses: BOSSES.map(b => ({ maxHp: b.maxHp, pattern: b.pattern.slice() })),
  trinkets: Object.fromEntries(Object.entries(TRINKET_LIBRARY).map(([key, t]) => [
    key, { price: t.price, effectAmount: t.effectAmount },
  ])),
  constants: Object.fromEntries(TUNING_CONST_NAMES.map(name => [name, TUNING_CONST_ACCESSORS[name].get()])),
};

// Same shape as TUNING_BASELINE's categories, but only holding entries that currently
// differ from baseline -- each leaf is { old, new }. This IS the diff the export patch
// and changelog are built from, kept up to date incrementally as edits land rather than
// recomputed by diffing baseline against live state (simpler once trinket per-stack
// effects and boss patterns are involved).
let tuningEdits = { cards: {}, bosses: {}, trinkets: {}, constants: {} };

// A card key can live in up to five different zones at once (the run deck, hand, draw
// pile, discard pile, exhaust pile) plus the market's current offers -- instantiateCard
// and openMarket/rerollShop/growCardOffersToShopSize all spread CARD_LIBRARY into a new
// object per instance, so editing the library alone leaves every existing instance on
// its old value. This patches all of them in place so an edit is visible immediately on
// cards already drawn, in the shop, or sitting in a pile -- not just future ones.
function patchCardInstancesEverywhere(key, field, value) {
  const zones = [];
  if (game) {
    zones.push(game.deck);
    if (game.combat) zones.push(game.combat.hand, game.combat.drawPile, game.combat.discardPile, game.combat.exhaustPile);
  }
  if (marketState) zones.push(marketState.cardOffers);
  for (const zone of zones) {
    if (!zone) continue;
    for (const inst of zone) {
      if (inst.key === key) inst[field] = value;
    }
  }
}

// Re-renders whichever screens are currently backed by live state, so an edit shows up
// immediately regardless of which screen is open behind the panel. Each render function
// already guards its own preconditions (renderCombat no-ops with no combat, etc.).
function refreshVisibleScreens() {
  if (game && game.combat) renderCombat();
  if (marketState) renderMarket();
  if (game) renderRemoveScreen();
}

function setInputEdited(el, edited) {
  if (el) el.classList.toggle('tuning-edited', edited);
}

function onTuningCardFieldChange(key, field, rawValue, el) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  CARD_LIBRARY[key][field] = value;
  patchCardInstancesEverywhere(key, field, value);
  const baseline = TUNING_BASELINE.cards[key][field];
  const bucket = (tuningEdits.cards[key] ||= {});
  if (value === baseline) {
    delete bucket[field];
    if (!Object.keys(bucket).length) delete tuningEdits.cards[key];
    setInputEdited(el, false);
  } else {
    bucket[field] = { old: baseline, new: value };
    setInputEdited(el, true);
  }
  refreshVisibleScreens();
}

function onTuningBossMaxHpChange(idx, rawValue, el) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  BOSSES[idx].maxHp = value;
  // If this boss is the one currently being fought, update the active fight's HP-bar
  // denominator too. Current HP is deliberately left alone rather than guessing whether
  // it should rescale -- see the report on this feature for the reasoning.
  if (game && game.combat && game.bossIndex === idx) game.combat.boss.maxHp = value;
  const baseline = TUNING_BASELINE.bosses[idx].maxHp;
  const bucket = (tuningEdits.bosses[idx] ||= {});
  if (value === baseline) {
    delete bucket.maxHp;
    if (!Object.keys(bucket).length) delete tuningEdits.bosses[idx];
    setInputEdited(el, false);
  } else {
    bucket.maxHp = { old: baseline, new: value };
    setInputEdited(el, true);
  }
  refreshVisibleScreens();
}

function onTuningBossPatternChange(idx, rawValue, el) {
  const values = rawValue.split(',').map(s => s.trim()).filter(s => s.length).map(Number);
  if (!values.length || values.some(v => !Number.isFinite(v))) return; // leave invalid input un-applied
  const boss = BOSSES[idx];
  // Mutate the array's CONTENTS in place rather than reassigning `boss.pattern` -- an
  // in-progress fight against this same boss holds the identical array by reference
  // (see startCombat), so splicing it updates that fight's pattern immediately instead
  // of only affecting the next time this boss is encountered.
  boss.pattern.splice(0, boss.pattern.length, ...values);
  if (game && game.combat && game.bossIndex === idx) {
    game.combat.boss.patternIndex = game.combat.boss.patternIndex % boss.pattern.length;
  }
  const baseline = TUNING_BASELINE.bosses[idx].pattern;
  const same = baseline.length === values.length && baseline.every((v, i) => v === values[i]);
  const bucket = (tuningEdits.bosses[idx] ||= {});
  if (same) {
    delete bucket.pattern;
    if (!Object.keys(bucket).length) delete tuningEdits.bosses[idx];
    setInputEdited(el, false);
  } else {
    bucket.pattern = { old: baseline.slice(), new: values.slice() };
    setInputEdited(el, true);
  }
  refreshVisibleScreens();
}

function onTuningTrinketFieldChange(key, field, rawValue, el) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  TRINKET_LIBRARY[key][field] = value;
  const baseline = TUNING_BASELINE.trinkets[key][field];
  const bucket = (tuningEdits.trinkets[key] ||= {});
  if (value === baseline) {
    delete bucket[field];
    if (!Object.keys(bucket).length) delete tuningEdits.trinkets[key];
    setInputEdited(el, false);
  } else {
    bucket[field] = { old: baseline, new: value };
    setInputEdited(el, true);
  }
  refreshVisibleScreens();
}

function onTuningConstantChange(name, rawValue, el) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  TUNING_CONST_ACCESSORS[name].set(value);
  const baseline = TUNING_BASELINE.constants[name];
  if (value === baseline) {
    delete tuningEdits.constants[name];
    setInputEdited(el, false);
  } else {
    tuningEdits.constants[name] = { old: baseline, new: value };
    setInputEdited(el, true);
  }
  refreshVisibleScreens();
}

function isCardFieldEdited(key, field) { return !!(tuningEdits.cards[key] && field in tuningEdits.cards[key]); }
function isBossFieldEdited(idx, field) { return !!(tuningEdits.bosses[idx] && field in tuningEdits.bosses[idx]); }
function isTrinketFieldEdited(key, field) { return !!(tuningEdits.trinkets[key] && field in tuningEdits.trinkets[key]); }
function isConstantEdited(name) { return name in tuningEdits.constants; }

function tuningNumberInput(kind, attrs, value, edited, extraClass) {
  const dataAttrs = Object.entries(attrs).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<input type="number" step="any" class="${extraClass || ''}${edited ? ' tuning-edited' : ''}" data-kind="${kind}" ${dataAttrs} value="${value}">`;
}

function buildTuningConstantsSection() {
  const rows = TUNING_CONST_NAMES.map(name => `
    <div class="tuning-row">
      <div class="tuning-name">${name}</div>
      <span class="tuning-field">
        ${tuningNumberInput('const', { name }, TUNING_CONST_ACCESSORS[name].get(), isConstantEdited(name))}
      </span>
    </div>
  `).join('');
  return `<div class="tuning-section"><h3>Run Constants</h3>${rows}</div>`;
}

function buildTuningBossesSection() {
  const rows = BOSSES.map((boss, i) => `
    <div class="tuning-row">
      <div class="tuning-name">${boss.name}<span class="tuning-key">boss ${i}</span></div>
      <span class="tuning-field">
        <label>maxHp</label>
        ${tuningNumberInput('boss-maxhp', { idx: i }, boss.maxHp, isBossFieldEdited(i, 'maxHp'))}
      </span>
      <span class="tuning-field">
        <label>pattern</label>
        <input type="text" class="tuning-pattern${isBossFieldEdited(i, 'pattern') ? ' tuning-edited' : ''}" data-kind="boss-pattern" data-idx="${i}" value="${boss.pattern.join(', ')}">
      </span>
    </div>
  `).join('');
  return `<div class="tuning-section"><h3>Bosses</h3>${rows}</div>`;
}

function buildTuningTrinketsSection() {
  const rows = Object.values(TRINKET_LIBRARY).map(t => `
    <div class="tuning-row">
      <div class="tuning-name">${t.name}<span class="tuning-key">${t.key}</span></div>
      <span class="tuning-field">
        <label>price</label>
        ${tuningNumberInput('trinket', { key: t.key, field: 'price' }, t.price, isTrinketFieldEdited(t.key, 'price'))}
      </span>
      <span class="tuning-field">
        <label>effect</label>
        ${tuningNumberInput('trinket', { key: t.key, field: 'effectAmount' }, t.effectAmount, isTrinketFieldEdited(t.key, 'effectAmount'))}
      </span>
    </div>
  `).join('');
  return `<div class="tuning-section"><h3>Trinkets</h3>${rows}</div>`;
}

function buildTuningCardsSection() {
  const groups = [
    ['ATTACK', 'attack'], ['BLOCK', 'block'], ['LOOT', 'loot'], ['SKILL', 'skill'],
  ];
  const body = groups.map(([label, type]) => {
    const cards = Object.values(CARD_LIBRARY).filter(c => c.type === type);
    const rows = cards.map(card => {
      const fields = TUNING_CARD_NUMERIC_FIELDS.filter(f => card[f] !== undefined).map(f => `
        <span class="tuning-field">
          <label>${f}</label>
          ${tuningNumberInput('card', { key: card.key, field: f }, card[f], isCardFieldEdited(card.key, f))}
        </span>
      `).join('');
      return `
        <div class="tuning-row">
          <div class="tuning-name">${card.name}<span class="tuning-key">${card.key}</span></div>
          ${fields}
        </div>
      `;
    }).join('');
    return `<div class="tuning-group-label">${label}</div>${rows}`;
  }).join('');
  return `<div class="tuning-section"><h3>Cards</h3>${body}</div>`;
}

function renderTuningBody() {
  document.getElementById('tuning-body').innerHTML =
    buildTuningConstantsSection() + buildTuningBossesSection() + buildTuningTrinketsSection() + buildTuningCardsSection();
}

function openTuningPanel() {
  renderTuningBody();
  document.getElementById('tuning-panel').classList.remove('hidden');
}

function closeTuningPanel() {
  document.getElementById('tuning-panel').classList.add('hidden');
}

function toggleTuningPanel() {
  const panel = document.getElementById('tuning-panel');
  if (panel.classList.contains('hidden')) openTuningPanel();
  else closeTuningPanel();
}

// One delegated listener for every input in the panel, rather than one per input --
// dispatches on data-kind. Uses 'input' (not 'change') so number-field arrow-clicks and
// typing both apply live without needing to blur the field first.
document.getElementById('tuning-body').addEventListener('input', (e) => {
  const el = e.target;
  const kind = el.dataset.kind;
  if (!kind) return;
  if (kind === 'card') onTuningCardFieldChange(el.dataset.key, el.dataset.field, el.value, el);
  else if (kind === 'boss-maxhp') onTuningBossMaxHpChange(Number(el.dataset.idx), el.value, el);
  else if (kind === 'boss-pattern') onTuningBossPatternChange(Number(el.dataset.idx), el.value, el);
  else if (kind === 'trinket') onTuningTrinketFieldChange(el.dataset.key, el.dataset.field, el.value, el);
  else if (kind === 'const') onTuningConstantChange(el.dataset.name, el.value, el);
});

// Builds the same { <cardKey>: {...}, bosses: {...}, trinkets: {...}, constants: {...} }
// shape applyTuningPatch() reads, from only the entries in tuningEdits, plus a plain-text
// changelog line per changed field. Never touches onPlay -- tuningEdits only ever holds
// plain numeric/array diffs, so there is nothing function-shaped to lose in the round trip.
function buildTuningPatchAndChangelog() {
  const patch = {};
  const changelog = [];

  for (const [key, fields] of Object.entries(tuningEdits.cards)) {
    if (!Object.keys(fields).length) continue;
    patch[key] = {};
    for (const [field, { old, new: nv }] of Object.entries(fields)) {
      patch[key][field] = nv;
      changelog.push(`${key}.${field}: ${old} → ${nv}`);
    }
  }

  const bossPatch = {};
  for (const [idx, fields] of Object.entries(tuningEdits.bosses)) {
    if (!Object.keys(fields).length) continue;
    bossPatch[idx] = {};
    for (const [field, { old, new: nv }] of Object.entries(fields)) {
      bossPatch[idx][field] = Array.isArray(nv) ? nv.slice() : nv;
      const fmt = (v) => Array.isArray(v) ? `[${v.join(', ')}]` : v;
      changelog.push(`bosses[${idx}].${field}: ${fmt(old)} → ${fmt(nv)}`);
    }
  }
  if (Object.keys(bossPatch).length) patch.bosses = bossPatch;

  const trinketPatch = {};
  for (const [key, fields] of Object.entries(tuningEdits.trinkets)) {
    if (!Object.keys(fields).length) continue;
    trinketPatch[key] = {};
    for (const [field, { old, new: nv }] of Object.entries(fields)) {
      trinketPatch[key][field] = nv;
      changelog.push(`trinkets.${key}.${field}: ${old} → ${nv}`);
    }
  }
  if (Object.keys(trinketPatch).length) patch.trinkets = trinketPatch;

  const constPatch = {};
  for (const [name, { old, new: nv }] of Object.entries(tuningEdits.constants)) {
    constPatch[name] = nv;
    changelog.push(`constants.${name}: ${old} → ${nv}`);
  }
  if (Object.keys(constPatch).length) patch.constants = constPatch;

  return { patch, changelog: changelog.join('\n') };
}

async function exportTuningPatch() {
  const { patch, changelog } = buildTuningPatchAndChangelog();
  const text = `const TUNING = ${JSON.stringify(patch, null, 2)};\n\n// Changelog:\n${changelog || '(no changes)'}`;
  try {
    await navigator.clipboard.writeText(text);
    logTuningStatus(Object.keys(patch).length ? 'Patch + changelog copied to clipboard.' : 'Nothing changed -- copied an empty patch.');
  } catch (e) {
    logTuningStatus('Clipboard unavailable -- patch logged to the console instead.');
    console.log(text);
  }
}

function logTuningStatus(msg) {
  let el = document.querySelector('.tuning-status');
  if (!el) {
    el = document.createElement('span');
    el.className = 'tuning-status';
    el.style.marginLeft = '10px';
    el.style.fontSize = '0.75rem';
    el.style.opacity = '0.75';
    document.querySelector('.tuning-header').appendChild(el);
  }
  el.textContent = msg;
}

// Restores every card, boss, trinket, and constant to TUNING_BASELINE (the file's values,
// plus any baked-in TUNING patch) and clears all tracked edits. Does not touch onPlay or
// anything else the panel never edited in the first place.
function resetTuningPanel() {
  for (const [key, fields] of Object.entries(TUNING_BASELINE.cards)) {
    for (const [field, value] of Object.entries(fields)) {
      CARD_LIBRARY[key][field] = value;
      patchCardInstancesEverywhere(key, field, value);
    }
  }
  BOSSES.forEach((boss, i) => {
    const base = TUNING_BASELINE.bosses[i];
    boss.maxHp = base.maxHp;
    boss.pattern.splice(0, boss.pattern.length, ...base.pattern);
    if (game && game.combat && game.bossIndex === i) {
      game.combat.boss.maxHp = base.maxHp;
      game.combat.boss.patternIndex = game.combat.boss.patternIndex % boss.pattern.length;
    }
  });
  for (const [key, fields] of Object.entries(TUNING_BASELINE.trinkets)) {
    Object.assign(TRINKET_LIBRARY[key], fields);
  }
  for (const name of TUNING_CONST_NAMES) {
    TUNING_CONST_ACCESSORS[name].set(TUNING_BASELINE.constants[name]);
  }
  tuningEdits = { cards: {}, bosses: {}, trinkets: {}, constants: {} };
  renderTuningBody();
  refreshVisibleScreens();
  logTuningStatus('Reset to file values.');
}

document.getElementById('btn-tuning-close').onclick = closeTuningPanel;
document.getElementById('btn-tuning-export').onclick = exportTuningPatch;
document.getElementById('btn-tuning-reset').onclick = resetTuningPanel;

// Backtick toggles the panel from anywhere (start screen, combat, market, ...) -- a
// separate listener from the existing combat hotkeys (Space / 1-9 / 0) further up this
// file, which stay scoped to screen-combat. Backtick was unbound before this.
//
// Tests e.code, not e.key: on a Norwegian (and several other non-US) keyboard layout,
// the physical key left of "1" is a dead key for accent composition, so keydown fires
// with e.key === 'Dead' rather than a backtick character -- e.key would make this
// unreachable on those layouts. e.code identifies the physical key position
// ('Backquote') regardless of layout or dead-key behavior, so this works the same on
// every keyboard. Guarded against Ctrl/Alt/Meta so an OS- or browser-level shortcut on
// that same physical key doesn't also pop the panel open.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Backquote') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  toggleTuningPanel();
});
