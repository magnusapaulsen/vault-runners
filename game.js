// ===================================================================
// VAULT RUNNERS — prototype roguelike deckbuilder
// Slay the Spire flow + Clank!-simple cards + Balatro-style combo scoring
// ===================================================================

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
  strike: { key: 'strike', name: 'Strike', type: 'attack', cost: 1, baseDamage: 6, desc: 'Deal 6 damage.' },
  guard: { key: 'guard', name: 'Guard', type: 'block', cost: 1, block: 5, desc: 'Gain 5 block.' },
  treasureGrab: { key: 'treasureGrab', name: 'Treasure Grab', type: 'loot', cost: 1, gold: 4, desc: 'Gain 4 gold.' },

  quickStab: { key: 'quickStab', name: 'Quick Stab', type: 'attack', cost: 1, baseDamage: 4, drawOnPlay: 1, desc: 'Deal 4 damage. Draw 1 card.', price: 25 },
  shieldWall: { key: 'shieldWall', name: 'Shield Wall', type: 'block', cost: 2, block: 14, desc: 'Gain 14 block.', price: 30 },
  sidestep: { key: 'sidestep', name: 'Sidestep', type: 'skill', cost: 0, block: 2, drawOnPlay: 2, desc: '0 cost. Gain 2 block, draw 2 cards.', price: 45 },
  comboStrike: { key: 'comboStrike', name: 'Combo Strike', type: 'attack', cost: 1, baseDamage: 4, comboBonus: 3, desc: 'Deal 4 damage, +3 per attack already played this turn.', price: 40 },
  twinBlades: { key: 'twinBlades', name: 'Twin Blades', type: 'attack', cost: 2, baseDamage: 8, hits: 2, desc: 'Deal 8 damage, twice.', price: 45 },
  heavyStrike: { key: 'heavyStrike', name: 'Heavy Strike', type: 'attack', cost: 3, baseDamage: 30, desc: 'Deal 30 damage.', price: 70 },
  gather: { key: 'gather', name: 'Gather', type: 'skill', cost: 0, drawOnPlay:3, desc: 'Draw 3 cards.', price: 25},
  overdraw: { key: 'overdraw', name: 'Overdraw', type: 'skill', cost: 0, discardCost: 2, drawOnPlay: 4, desc: 'Requires 2 other cards in hand. Discard 2 cards, draw 4 cards.', price: 40 },
  spark: { key: 'spark', name: 'Spark', type: 'skill', cost: 0, energyGain: 1, desc: 'Gain 1 energy.', price: 30 },
  overcharge: { key: 'overcharge', name: 'Overcharge', type: 'skill', cost: 0, discardCost: 1, energyGain: 1, desc: 'Requires 1 other card in hand. Discard 1 card, gain 1 energy.', price: 45 },

  // ---- Combo Flurry (Red + Purple/skill) ----
  thousandCuts: { key: 'thousandCuts', name: 'Thousand Cuts', type: 'attack', cost: 2, baseDamage: 2, hits: 5, desc: 'Deal 2 damage, 5 times.', price: 45 },
  armor: { key: 'armor', name: 'Armor', type: 'block', cost: 3, block: 24, desc: 'Gain 24 block.', price: 40 },

  // ---- Overheat Engine (Purple/skill) ----
  burnout: { key: 'burnout', name: 'Burnout', type: 'skill', cost: 0, energyGain: 3, drawOnPlay: 3, exhaustOnPlay: true, desc: 'Gain 3 energy, draw 3 cards. Exhaust (removed for the rest of this combat).', price: 50 },

  // ---- The Phalanx (block / retaliation) ----
  // Block mirrors attack: turnBlockCount ticks once per hit, so `hits` buys triggers here
  // the same way it does on the attack side, and blockComboBonus is the block twin of
  // comboBonus. Remember block does not carry over -- c.block is wiped every endTurn --
  // so everything here is single-turn value.
  brace: { key: 'brace', name: 'Brace', type: 'block', cost: 0, block: 2, desc: '0 cost. Gain 2 block.', price: 25 },
  bulwark: { key: 'bulwark', name: 'Bulwark', type: 'block', cost: 2, block: 3, hits: 4, desc: 'Gain 3 block, four times.', price: 50 },
  stonewall: { key: 'stonewall', name: 'Stonewall', type: 'block', cost: 1, block: 4, blockComboBonus: 4, desc: 'Gain 4 block, +4 per block card already played this turn.', price: 40 },
  shieldBash: {
    key: 'shieldBash', name: 'Shield Bash', type: 'block', cost: 2, block: 8,
    isAttackToo: true, damageFromBlockPercent: 1.0,
    desc: 'Gain 8 block, then deal damage equal to your block. Your block is not spent.',
    price: 55,
  },
  brambleGuard: {
    key: 'brambleGuard', name: 'Bramble Guard', type: 'block', cost: 2, block: 10, retaliateDamage: 5,
    desc: 'Gain 10 block. Whenever you are attacked, deal 5 damage back for the rest of this combat.',
    price: 50,
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

  // ---- The Gold Rush (loot / economy) ----
  // Pure economy: none of these deal damage or grant block, so each one trades tempo in
  // the current fight for buying power at the next market. Every gain routes through
  // gainGold() so the Gold Loot trinket applies -- note that gainGold rounds, so small
  // per-tick amounts (Skim at 1-2, Protection Racket at 3) can round the bonus away.
  shakedown: { key: 'shakedown', name: 'Shakedown', type: 'loot', cost: 1, gold: 5, desc: 'Gain 5 gold.', price: 30 },
  skim: {
    key: 'skim', name: 'Skim', type: 'loot', cost: 0, goldPerAttack: 1,
    desc: 'Gain 1 gold per attack already played this turn.',
    price: 35,
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
  crackTheVault: { key: 'crackTheVault', name: 'Crack the Vault', type: 'loot', cost: 3, gold: 15, desc: 'Gain 15 gold.', price: 45 },
  protectionRacket: {
    key: 'protectionRacket', name: 'Protection Racket', type: 'loot', cost: 1, goldPerTurn: 3,
    desc: 'Gain 3 gold at the start of each turn for the rest of this combat.',
    price: 50,
    onPlay(card) {
      // Combat-scoped, so it survives clearTurnStatuses() and keeps paying every turn until
      // startCombat() replaces the whole combat object at the next fight. Each copy played
      // registers its own listener, so copies stack -- exactly how Sore Loser behaved.
      addStatus('turnStart', 'combat', () => {
        const g = gainGold(card.goldPerTurn);
        logMsg(`Protection Racket: collected ${g} gold.`);
      });
      logMsg('Protection Racket: the arrangement starts paying next turn.');
    },
  },
  bloodMoney: { key: 'bloodMoney', name: 'Blood Money', type: 'loot', cost: 0, selfDamage: 5, gold: 8, desc: 'Lose 5 HP. Gain 8 gold. Unplayable if it would kill you.', price: 35 },

  // ---- The High Roller (Gold, with cross-color support) ----
  // Both gamble cards are free to acquire (price: 0) and free in energy (cost: 0), and
  // charge gold per play (goldCost) instead. All the tunable numbers live on the card
  // defs: goldCost is the per-play price, damagePerPip / winDamage are the payouts.
  // Change them here; the desc strings directly below each one restate the same numbers
  // and must be kept in sync by hand.
  //
  // Both COUNT FOR COMBO: the roll/flip decides the base damage and resolveAttackHit
  // scales it, so they increment turnAttackCount and take the multiplier exactly like any
  // other attack. A failed gamble does not -- see the tails branch below.
  //
  // They carry `deferredAttack` because they resolve their damage inside onPlay once the
  // animation settles. It is redundant while their type is 'loot' (playCard's automatic
  // attack branch only fires for 'attack' / isAttackToo), but it stops them double-dipping
  // if that type is ever changed.
  rollTheBones: {
    key: 'rollTheBones', name: 'Roll the Bones', type: 'loot', cost: 0, deferredAttack: true,
    goldCost: 5, damagePerPip: 2,
    desc: 'Pay 5 gold. Roll a die. Deal (roll x 2) damage. Counts for combo.',
    price: 0,
    onPlay(card) {
      rollDie(6, (roll) => {
        const { damage } = resolveAttackHit(roll * card.damagePerPip);
        logMsg(`Roll the Bones: rolled a ${roll}, dealt ${damage} damage.`);
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  doubleOrNothing: {
    key: 'doubleOrNothing', name: 'Double or Nothing', type: 'loot', cost: 0, deferredAttack: true,
    goldCost: 5, winDamage: 15,
    desc: 'Pay 5 gold. 50% chance: deal 15 damage, counting for combo. 50% chance: nothing.',
    price: 0,
    onPlay(card) {
      flipCoin((heads) => {
        if (heads) {
          const { damage } = resolveAttackHit(card.winDamage);
          logMsg(`Double or Nothing: heads! Dealt ${damage} damage.`);
        } else {
          // Tails matches Glass Cannon's miss: resolveAttackHit is never called, so no
          // damage, no turnDamageDealt, and no turnAttackCount increment -- a whiff must
          // not inflate the combo for cards played after it.
          logMsg('Double or Nothing: tails. Nothing happens.');
        }
        resolveGoldCardOutcome(card, heads);
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  glassCannon: {
    key: 'glassCannon', name: 'Glass Cannon', type: 'attack', cost: 0, baseDamage: 30, deferredAttack: true,
    desc: '0 cost. Roll a die -- on a 4, 5 or 6 deal 30 damage. On a 1, 2 or 3 it deals nothing and is trashed permanently.',
    price: 50,
    onPlay(card) {
      rollDie(6, (roll) => {
        if (roll >= 4) {
          const { damage } = resolveAttackHit(card.baseDamage);
          logMsg(`Glass Cannon: rolled ${roll}, hit for ${damage} damage.`);
        } else {
          logMsg(`Glass Cannon: rolled ${roll}, misses completely.`);
          trashCard(card);
        }
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  // Named "Loaded Dice" like the trinket, but a different thing (a played card, not a
  // passive) -- distinct key so the two don't collide, flagged to the user as a naming
  // overlap worth knowing about.
  loadedDiceCard: {
    key: 'loadedDiceCard', name: 'Loaded Dice', type: 'skill', cost: 0,
    desc: '0 cost. Your next die roll or coin flip this turn is guaranteed to hit its best outcome.',
    price: 40,
    onPlay(card) { game.combat.forcedNextRoll = 'max'; },
  },
};

// Trinkets are repeatable purchases: each buy stacks by calling apply(game) again,
// which nudges a plain constant on `game`. No per-effect special-casing elsewhere.
// Listed with shopSize first so it's always visible in the base 3 trinket slots --
// otherwise it could hide behind its own "+1 shop slot" effect and never be reachable.
const TRINKET_LIBRARY = {
  shopSize:     { key: 'shopSize',     name: 'Shop Size',     price: 45, desc: '+1 card & trinket slot in the market.', apply(game) { game.shopSizeBonus += 1; } },
  maxHp:        { key: 'maxHp',        name: 'Max HP',        price: 35, desc: '+10 Max HP.',                          apply(game) { game.maxHp += 10; game.hp += 10; } },
  handSize:     { key: 'handSize',     name: 'Hand Size',     price: 50, desc: '+1 card drawn per turn.',               apply(game) { game.handSizeBonus += 1; } },
  goldLoot:     { key: 'goldLoot',     name: 'Gold Loot',     price: 35, desc: '+10% gold gained.',                    apply(game) { game.goldLootBonus += 0.10; } },
  shopDiscount: { key: 'shopDiscount', name: 'Shop Discount', price: 35, desc: '-10% market prices.',                  apply(game) { game.shopDiscount += 0.10; } },
};

const STARTER_DECK_KEYS = ['strike', 'strike', 'strike', 'strike', 'strike', 'guard', 'guard', 'guard', 'guard', 'treasureGrab'];
const SHOP_POOL_KEYS = [
  'quickStab', 'shieldWall', 'sidestep', 'comboStrike', 'twinBlades', 'heavyStrike', 'gather', 'overdraw', 'spark', 'overcharge',
  'thousandCuts', 'armor', 'burnout',
  'brace', 'bulwark', 'stonewall', 'shieldBash', 'brambleGuard',
  'shakedown', 'skim', 'crackTheVault', 'protectionRacket', 'bloodMoney',
  'rollTheBones', 'doubleOrNothing', 'glassCannon', 'loadedDiceCard',
];

// HP roughly doubled from the original 42/68/95 -- High Roller cards can swing 30-50
// damage in one card, which would trivialize fights at the old scale.
const BOSSES = [
  { name: 'Cave Troll', maxHp: 90, pattern: [6, 6, 11] },
  { name: 'Rock Golem', maxHp: 150, pattern: [8, 8, 14, 5] },
  { name: 'The Dragon', maxHp: 220, pattern: [11, 11, 9, 22] },
  { name: 'God', maxHp: 500, pattern: [6, 7] },
];

const HAND_SIZE = 5;
const BASE_ENERGY = 3;

// ---------- Game state ----------
let game = null;
let uidCounter = 0;

function newRun() {
  game = {
    hp: 100,
    maxHp: 100,
    gold: 10,
    deck: STARTER_DECK_KEYS.map(k => instantiateCard(k)),
    // trinket-driven constants -- each trinket purchase nudges one of these, nothing else
    handSizeBonus: 0,
    goldLootBonus: 0,
    shopDiscount: 0,
    shopSizeBonus: 0,
    trinketLevels: Object.fromEntries(Object.keys(TRINKET_LIBRARY).map(k => [k, 0])),
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
      if (c.discardPile.length === 0) return; // nothing left to draw
      c.drawPile = shuffle(c.discardPile);
      c.discardPile = [];
      logMsg('Shuffled discard pile into draw pile.');
    }
    c.hand.push(c.drawPile.pop());
  }
}

function logMsg(msg) {
  game.combat.log.unshift(msg);
  if (game.combat.log.length > 30) game.combat.log.pop();
}

// ---------- Playing cards ----------
const COMBO_STEP = 0.2;

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
  game.deck = game.deck.filter(x => x.uid !== card.uid);
  const c = game.combat;
  if (c) {
    c.drawPile = c.drawPile.filter(x => x.uid !== card.uid);
    c.hand = c.hand.filter(x => x.uid !== card.uid);
    c.discardPile = c.discardPile.filter(x => x.uid !== card.uid);
    c.exhaustPile = c.exhaustPile.filter(x => x.uid !== card.uid);
  }
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
      setTimeout(() => { hideDiceOverlay(); onResult(finalValue); }, 400);
    }
  }, 60);
}

function flipCoin(onResult) {
  const c = game.combat;
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
      setTimeout(() => { hideDiceOverlay(); onResult(heads); }, 400);
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
  if (!c || c.discardSelection) return false;
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
  if (!c || game.hp <= 0 || c.boss.hp <= 0 || c.discardSelection) return;

  // discard remaining hand
  c.discardPile.push(...c.hand);
  c.hand = [];

  // boss attacks
  const dmg = c.boss.pattern[c.boss.patternIndex];
  c.boss.patternIndex = (c.boss.patternIndex + 1) % c.boss.pattern.length;
  fireEvent('playerAttacked', { damage: dmg }); // Bramble Guard-style retaliation
  const dealt = Math.max(0, dmg - c.block);
  game.hp = Math.max(0, game.hp - dealt);
  logMsg(`${c.boss.name} attacks for ${dmg}${c.block > 0 ? ` (blocked ${Math.min(dmg, c.block)})` : ''}, you take ${dealt}.`);
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
  if (game.hp <= 0) {
    showScreen('screen-gameover');
    document.getElementById('gameover-text').textContent =
      `${c.boss.name} finished you off on boss ${game.bossIndex + 1} of ${BOSSES.length}.`;
    return;
  }
  if (c.boss.hp <= 0) {
    const reward = gainGold(15 + 5 * game.bossIndex);
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

// Trinket offers aren't rolled/cached like cards -- they're a deterministic slice of
// TRINKET_LIBRARY sized by the current shopSize level, so they're always computed fresh.
function currentTrinketOffers() {
  return Object.values(TRINKET_LIBRARY).slice(0, trinketShopSlots());
}

// If Shop Size was just bought, grow this visit's card list immediately instead of
// making the player wait for the next market to see the extra slot.
function growCardOffersToShopSize() {
  while (marketState.cardOffers.length < cardShopSlots()) {
    const key = SHOP_POOL_KEYS[Math.floor(Math.random() * SHOP_POOL_KEYS.length)];
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

function healCost() { return discountedPrice(15); }
function removeCost() { return discountedPrice(25); }

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
    div.className = `market-card ${card.type}`;
    div.innerHTML = `<div class="name">${card.name}</div><div class="desc">${card.desc}</div>`;
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

// ---------- Rendering ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function cardDescText(card) {
  return card.desc;
}

function renderCombat() {
  const c = game.combat;
  if (!c) return;

  document.getElementById('player-hp-fill').style.width = `${Math.max(0, (game.hp / game.maxHp) * 100)}%`;
  document.getElementById('player-hp-text').textContent = `${game.hp}/${game.maxHp}`;
  document.getElementById('player-block-text').textContent = c.block;
  document.getElementById('player-energy-text').textContent = `${c.energy}/${BASE_ENERGY}`;
  document.getElementById('player-gold-text').textContent = game.gold;
  document.getElementById('deck-count-text').textContent = game.deck.length;

  document.getElementById('boss-name').textContent = `${c.boss.name}  (Boss ${game.bossIndex + 1}/${BOSSES.length})`;
  document.getElementById('boss-hp-fill').style.width = `${Math.max(0, (c.boss.hp / c.boss.maxHp) * 100)}%`;
  document.getElementById('boss-hp-text').textContent = `${c.boss.hp}/${c.boss.maxHp}`;
  document.getElementById('boss-intent').textContent = `Intent: ⚔ ${c.boss.pattern[c.boss.patternIndex]} damage next turn`;

  document.getElementById('draw-count').textContent = c.drawPile.length;
  document.getElementById('discard-count').textContent = c.discardPile.length;

  const selecting = !!c.discardSelection;
  const handEl = document.getElementById('hand');
  handEl.innerHTML = '';
  c.hand.forEach(card => {
    const div = document.createElement('div');
    const playable = canPlayCard(card);
    div.className = `card ${card.type}${(!selecting && !playable) ? ' unplayable' : ''}${selecting ? ' discard-target' : ''}`;
    div.dataset.uid = card.uid;
    div.draggable = !selecting;
    div.innerHTML = `
      <div class="cost">${card.cost}</div>
      ${card.goldCost ? `<div class="gold-cost">${card.goldCost}</div>` : ''}
      <div class="name">${card.name}</div>
      <div class="desc">${cardDescText(card)}</div>
    `;
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
  document.getElementById('btn-end-turn').disabled = selecting;

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

  const cardsEl = document.getElementById('market-cards');
  cardsEl.innerHTML = '';
  marketState.cardOffers.forEach((offer, i) => {
    const owned = marketState.boughtCardKeys.has(i);
    const price = discountedPrice(offer.price);
    const afford = game.gold >= price;
    const div = document.createElement('div');
    div.className = `market-card ${offer.type}${owned ? ' owned' : ''}${!owned && !afford ? ' cant-afford' : ''}`;
    const priceLabel = owned ? 'Bought' : (price === 0 ? 'Free' : price + 'g');
    div.innerHTML = `<div class="name">${offer.name}</div><div class="desc">${offer.desc}</div><div class="price">${priceLabel}</div>`;
    if (!owned) div.onclick = () => buyMarketCard(i);
    cardsEl.appendChild(div);
  });

  // Trinkets are repeatable, so there's no "owned" state -- just a stacking level.
  const trinketsEl = document.getElementById('market-trinkets');
  trinketsEl.innerHTML = '';
  currentTrinketOffers().forEach((offer, i) => {
    const price = discountedPrice(offer.price);
    const afford = game.gold >= price;
    const level = game.trinketLevels[offer.key];
    const div = document.createElement('div');
    div.className = `market-card trinket${!afford ? ' cant-afford' : ''}`;
    div.innerHTML = `<div class="name">${offer.name}${level > 0 ? ` (Lv ${level})` : ''}</div><div class="desc">${offer.desc}</div><div class="price">${price}g</div>`;
    div.onclick = () => buyMarketTrinket(i);
    trinketsEl.appendChild(div);
  });

  document.getElementById('btn-heal').disabled = game.gold < healCost() || game.hp >= game.maxHp;
  document.getElementById('btn-remove').disabled = game.gold < removeCost() || game.deck.length === 0;
}

// ---------- Wiring ----------
document.getElementById('btn-new-run').onclick = newRun;
document.getElementById('btn-end-turn').onclick = endTurn;
document.getElementById('btn-continue').onclick = continueFromMarket;
document.getElementById('btn-heal').onclick = doHeal;
document.getElementById('btn-remove').onclick = openRemoveScreen;
document.getElementById('btn-cancel-remove').onclick = () => { showScreen('screen-market'); renderMarket(); };
document.getElementById('btn-restart-lose').onclick = newRun;
document.getElementById('btn-restart-win').onclick = newRun;

showScreen('screen-start');
