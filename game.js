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
  strike: { key: 'strike', name: 'Strike', type: 'attack', cost: 1, baseDamage: 6, desc: 'Deal 6 damage.', rarity: 'starter' },
  guard: { key: 'guard', name: 'Guard', type: 'block', cost: 1, block: 5, desc: 'Gain 5 block.', rarity: 'starter' },
  treasureGrab: { key: 'treasureGrab', name: 'Treasure Grab', type: 'loot', cost: 1, gold: 4, desc: 'Gain 4 gold.', rarity: 'starter' },

  heavyStrike: { key: 'heavyStrike', name: 'Heavy Strike', type: 'attack', cost: 2, baseDamage: 12, desc: 'Deal 12 damage.', rarity: 'common', price: 20 },
  quickStab: { key: 'quickStab', name: 'Quick Stab', type: 'attack', cost: 1, baseDamage: 4, drawOnPlay: 1, desc: 'Deal 4 damage. Draw 1 card.', rarity: 'common', price: 25 },
  shieldWall: { key: 'shieldWall', name: 'Shield Wall', type: 'block', cost: 2, block: 10, desc: 'Gain 10 block.', rarity: 'common', price: 20 },
  parry: { key: 'parry', name: 'Parry', type: 'block', cost: 1, block: 4, baseDamage: 3, isAttackToo: true, desc: 'Gain 4 block. Deal 3 damage.', rarity: 'common', price: 28 },
  sidestep: { key: 'sidestep', name: 'Sidestep', type: 'skill', cost: 0, block: 2, drawOnPlay: 2, desc: '0 cost. Gain 2 block, draw 2 cards.', rarity: 'uncommon', price: 45 },
  vault: { key: 'vault', name: 'Vault', type: 'block', cost: 1, block: 3, gold: 2, desc: 'Gain 3 block and 2 gold.', rarity: 'common', price: 22 },
  comboStrike: { key: 'comboStrike', name: 'Combo Strike', type: 'attack', cost: 1, baseDamage: 4, comboBonus: 3, desc: 'Deal 4 damage, +3 per attack already played this turn.', rarity: 'uncommon', price: 40 },
  twinBlades: { key: 'twinBlades', name: 'Twin Blades', type: 'attack', cost: 2, baseDamage: 5, hits: 2, desc: 'Deal 5 damage, twice.', rarity: 'uncommon', price: 42 },
  bigSwing: { key: 'bigSwing', name: 'Big Swing', type: 'attack', cost: 3, baseDamage: 20, desc: 'Deal 20 damage.', rarity: 'rare', price: 55 },
  gather: { key: 'gather', name: 'Gather', type: 'skill', cost: 0, drawOnPlay:3, desc: 'Draw 3 cards.', rarity: 'uncommon', price: 25},
  overdraw: { key: 'overdraw', name: 'Overdraw', type: 'skill', cost: 0, discardCost: 2, drawOnPlay: 4, desc: 'Discard 2 cards. Draw 4 cards.', rarity: 'uncommon', price: 40 },
  spark: { key: 'spark', name: 'Spark', type: 'skill', cost: 0, energyGain: 1, desc: 'Gain 1 energy.', rarity: 'common', price: 30 },
  overcharge: { key: 'overcharge', name: 'Overcharge', type: 'skill', cost: 0, discardCost: 1, energyGain: 3, desc: 'Discard 1 card. Gain 3 energy.', rarity: 'uncommon', price: 45 },

  // ---- Combo Flurry (Red + Purple/skill) ----
  thousandCuts: { key: 'thousandCuts', name: 'Thousand Cuts', type: 'attack', cost: 2, baseDamage: 2, hits: 5, desc: 'Deal 2 damage, 5 times.', rarity: 'uncommon', price: 45 },
  adrenaline: {
    key: 'adrenaline', name: 'Adrenaline', type: 'skill', cost: 1, energyGain: 2, drawOnPlay: 3,
    desc: 'Gain 2 energy, draw 3 cards. If your attack combo is above x2.0, draw 1 more.',
    rarity: 'rare', price: 55,
    onPlay(card) {
      if (currentAttackMult() > 2.0) {
        drawCards(1);
        logMsg('Adrenaline: combo above x2.0, drew an extra card!');
      }
    },
  },

  // ---- Heavyweight Sacrifice (Red + Blue) ----
  recklessSwing: { key: 'recklessSwing', name: 'Reckless Swing', type: 'attack', cost: 2, baseDamage: 50, selfDamage: 15, discardRandom: 2, desc: 'Deal 50 damage. Take 15 damage and discard 2 random cards.', rarity: 'rare', price: 65 },
  bloodMagic: { key: 'bloodMagic', name: 'Blood Magic', type: 'skill', cost: 0, selfDamage: 5, energyGain: 2, retainBlock: true, desc: 'Lose 5 HP. Gain 2 energy. Retain your block into next turn.', rarity: 'uncommon', price: 40 },

  // ---- Retaliation Phalanx (Blue + Red) ----
  shieldBash: { key: 'shieldBash', name: 'Shield Bash', type: 'block', cost: 1, damageFromBlockPercent: 1.5, desc: 'Deal damage equal to 150% of your current block. Removes all block.', rarity: 'rare', price: 60 },
  spikedArmor: {
    key: 'spikedArmor', name: 'Spiked Armor', type: 'block', cost: 2, block: 15,
    desc: 'Gain 15 block. Whenever you are attacked this turn, deal 5 damage back.',
    rarity: 'rare', price: 55,
    onPlay(card) {
      addStatus('playerAttacked', 'turn', () => {
        const c = game.combat;
        c.boss.hp = Math.max(0, c.boss.hp - 5);
        logMsg('Spiked Armor retaliates for 5 damage!');
      });
    },
  },

  // ---- Overheat Engine (Purple/skill) ----
  burnout: { key: 'burnout', name: 'Burnout', type: 'skill', cost: 0, energyGain: 3, drawOnPlay: 3, exhaustOnPlay: true, desc: 'Gain 3 energy, draw 3 cards. Exhaust (removed for the rest of this combat).', rarity: 'rare', price: 50 },

  // ---- The High Roller (Gold, with cross-color support) ----
  rollTheBones: {
    key: 'rollTheBones', name: 'Roll the Bones', type: 'loot', cost: 0, goldCost: 10,
    desc: 'Pay 10 gold. Roll a die. Deal (roll x 5) damage.',
    rarity: 'uncommon', price: 35,
    onPlay(card) {
      rollDie(6, (roll) => {
        const c = game.combat;
        const dmg = roll * 5;
        c.boss.hp = Math.max(0, c.boss.hp - dmg);
        c.turnDamageDealt += dmg;
        logMsg(`Roll the Bones: rolled a ${roll}, dealt ${dmg} damage.`);
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  doubleOrNothing: {
    key: 'doubleOrNothing', name: 'Double or Nothing', type: 'loot', cost: 0, goldCost: 15,
    desc: 'Pay 15 gold. 50% chance: deal 40 damage. 50% chance: nothing.',
    rarity: 'uncommon', price: 40,
    onPlay(card) {
      flipCoin((heads) => {
        const c = game.combat;
        if (heads) {
          c.boss.hp = Math.max(0, c.boss.hp - 40);
          c.turnDamageDealt += 40;
          logMsg('Double or Nothing: heads! Dealt 40 damage.');
        } else {
          logMsg('Double or Nothing: tails. Nothing happens.');
        }
        resolveGoldCardOutcome(card, heads);
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  glassCannon: {
    key: 'glassCannon', name: 'Glass Cannon', type: 'attack', cost: 0, baseDamage: 30,
    desc: 'Deal 30 damage for 0 energy. Roll a die -- on a 1 or 2, this card is destroyed permanently.',
    rarity: 'rare', price: 50,
    onPlay(card) {
      rollDie(6, (roll) => {
        if (roll <= 2) {
          permanentlyRemoveFromDeck(card);
        } else {
          logMsg(`Glass Cannon: rolled ${roll}, card survives.`);
        }
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  hitJob: {
    key: 'hitJob', name: 'Hit Job', type: 'loot', cost: 0, goldCost: 25,
    desc: 'Pay 25 gold. If the boss takes exactly 50 damage this turn, gain 100 gold.',
    rarity: 'rare', price: 55,
    onPlay(card) {
      game.combat.pendingBets.push({ card, checkAmount: 50, reward: 100 });
      logMsg('Hit Job: the bet is on -- exactly 50 damage this turn pays out 100 gold.');
    },
  },
  // Named "Loaded Dice" like the trinket, but a different thing (a played card, not a
  // passive) -- distinct key so the two don't collide, flagged to the user as a naming
  // overlap worth knowing about.
  loadedDiceCard: {
    key: 'loadedDiceCard', name: 'Loaded Dice', type: 'skill', cost: 1, energyGain: 1,
    desc: 'Gain 1 energy. Your next die roll or coin flip this turn is guaranteed to hit its best outcome.',
    rarity: 'uncommon', price: 40,
    onPlay(card) { game.combat.forcedNextRoll = 'max'; },
  },
  insurancePolicy: {
    key: 'insurancePolicy', name: 'Insurance Policy', type: 'block', cost: 1, block: 10,
    desc: 'Gain 10 block. If your next Gold card fails or misses its gamble, refund its gold cost.',
    rarity: 'uncommon', price: 40,
    onPlay(card) { game.combat.insuranceActive = true; },
  },
  soreLoser: {
    key: 'soreLoser', name: 'Sore Loser', type: 'skill', cost: 1,
    desc: 'Passive: whenever a card misses or is destroyed, permanently gain +3 damage on your attacks this combat.',
    rarity: 'rare', price: 60,
    onPlay(card) {
      addStatus('cardMissed', 'combat', () => {
        game.combat.soreLoserBonus = (game.combat.soreLoserBonus || 0) + 3;
        logMsg('Sore Loser: +3 damage to attacks for the rest of this combat!');
      });
    },
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
  'heavyStrike', 'quickStab', 'shieldWall', 'parry', 'sidestep', 'vault', 'comboStrike', 'twinBlades', 'bigSwing', 'gather', 'overdraw', 'spark', 'overcharge',
  'thousandCuts', 'adrenaline', 'recklessSwing', 'bloodMagic', 'shieldBash', 'spikedArmor', 'burnout',
  'rollTheBones', 'doubleOrNothing', 'glassCannon', 'hitJob', 'loadedDiceCard', 'insurancePolicy', 'soreLoser',
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

function discountedPrice(basePrice) {
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
    statuses: [],       // { on: 'playerAttacked' | 'cardMissed', scope: 'turn' | 'combat', effect() }
    pendingBets: [],    // { card, checkAmount, reward } -- resolved at end of turn, see resolvePendingBets()
    retainBlockNextReset: false,
    forcedNextRoll: null, // 'max' consumed by the next rollDie/flipCoin call
    insuranceActive: false,
    soreLoserBonus: 0,
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

// ---------- Status effects (Spiked Armor's retaliate, Sore Loser's passive, etc.) ----------
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

// Permanently removes a card from the run's deck (not just this combat) -- for Glass
// Cannon's unlucky roll. Also counts as a "miss" for Sore Loser-style passives.
function permanentlyRemoveFromDeck(card) {
  const idx = game.deck.findIndex(c => c.uid === card.uid);
  if (idx !== -1) game.deck.splice(idx, 1);
  logMsg(`${card.name} is destroyed and permanently removed from your deck!`);
  fireEvent('cardMissed', { card });
}

// Shared "did a gold-cost gamble pay off" handling: refunds via Insurance Policy on a
// miss, and always notifies Sore Loser-style passives on a miss.
function resolveGoldCardOutcome(card, succeeded) {
  const c = game.combat;
  if (card.goldCost) {
    if (!succeeded && c.insuranceActive) {
      game.gold += card.goldCost;
      logMsg(`Insurance Policy refunds ${card.goldCost} gold from ${card.name}.`);
    }
    c.insuranceActive = false; // consumed by the next gold card's outcome either way
  }
  if (!succeeded) fireEvent('cardMissed', { card });
}

function resolvePendingBets() {
  const c = game.combat;
  for (const bet of c.pendingBets) {
    const succeeded = c.turnDamageDealt === bet.checkAmount;
    if (succeeded) {
      const reward = gainGold(bet.reward);
      logMsg(`${bet.card.name} pays off! +${reward} gold.`);
    } else {
      logMsg(`${bet.card.name} doesn't pay off (dealt ${c.turnDamageDealt}, needed exactly ${bet.checkAmount}).`);
    }
    resolveGoldCardOutcome(bet.card, succeeded);
  }
  c.pendingBets = [];
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

function renderDiePips(value) {
  const faceEl = document.getElementById('dice-face');
  faceEl.classList.add('die');
  const filled = new Set(DICE_PIP_PATTERNS[value] || []);
  faceEl.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip' + (filled.has(i) ? ' pip-on' : '');
    faceEl.appendChild(pip);
  }
}

function rollDie(sides, onResult) {
  const c = game.combat;
  const forced = c.forcedNextRoll === 'max';
  if (forced) c.forcedNextRoll = null;
  const finalValue = forced ? sides : (1 + Math.floor(Math.random() * sides));

  const resultEl = document.getElementById('dice-result-text');
  resultEl.textContent = '';
  showDiceOverlay();

  let ticks = 0;
  const spin = setInterval(() => {
    renderDiePips(1 + Math.floor(Math.random() * sides));
    ticks++;
    if (ticks > 10) {
      clearInterval(spin);
      renderDiePips(finalValue);
      resultEl.textContent = `Rolled a ${finalValue}!`;
      setTimeout(() => { hideDiceOverlay(); onResult(finalValue); }, 900);
    }
  }, 60);
}

function flipCoin(onResult) {
  const c = game.combat;
  const forced = c.forcedNextRoll === 'max';
  if (forced) c.forcedNextRoll = null;
  const heads = forced ? true : Math.random() < 0.5;

  const faceEl = document.getElementById('dice-face');
  faceEl.classList.remove('die');
  const resultEl = document.getElementById('dice-result-text');
  resultEl.textContent = '';
  showDiceOverlay();

  let ticks = 0;
  const spin = setInterval(() => {
    faceEl.textContent = Math.random() < 0.5 ? 'H' : 'T';
    ticks++;
    if (ticks > 10) {
      clearInterval(spin);
      faceEl.textContent = heads ? 'H' : 'T';
      resultEl.textContent = heads ? 'Heads!' : 'Tails...';
      setTimeout(() => { hideDiceOverlay(); onResult(heads); }, 900);
    }
  }, 60);
}

function playCard(uid) {
  const c = game.combat;
  if (c.discardSelection) return; // must resolve the pending discard cost first
  const idx = c.hand.findIndex(card => card.uid === uid);
  if (idx === -1) return;
  const card = c.hand[idx];
  if (card.cost > c.energy) return;
  if (card.goldCost && card.goldCost > game.gold) return;

  c.energy -= card.cost;
  if (card.goldCost) game.gold -= card.goldCost;
  c.hand.splice(idx, 1);
  (card.exhaustOnPlay ? c.exhaustPile : c.discardPile).push(card);

  const comboTexts = [];

  if (card.type === 'attack' || card.isAttackToo) {
    const hits = card.hits || 1;
    let totalDmg = 0;
    let lastMult = 1;
    for (let h = 0; h < hits; h++) {
      c.turnAttackCount++;
      const mult = 1 + COMBO_STEP * (c.turnAttackCount - 1);
      lastMult = mult;
      const base = (card.baseDamage || 0) + (card.comboBonus ? card.comboBonus * (c.turnAttackCount - 1) : 0) + (c.soreLoserBonus || 0);
      totalDmg += Math.round(base * mult);
    }
    c.boss.hp = Math.max(0, c.boss.hp - totalDmg);
    c.turnDamageDealt += totalDmg;
    logMsg(`Played ${card.name}: dealt ${totalDmg} damage.`);
    if (lastMult > 1.001) comboTexts.push(`ATK x${lastMult.toFixed(2)}`);
  }

  if (card.block) {
    c.turnBlockCount++;
    const mult = 1 + COMBO_STEP * (c.turnBlockCount - 1);
    const blockGained = Math.round(card.block * mult);
    c.block += blockGained;
    logMsg(`${card.name} grants ${blockGained} block.`);
    if (mult > 1.001) comboTexts.push(`BLK x${mult.toFixed(2)}`);
  }

  if (card.damageFromBlockPercent) {
    const dmg = Math.round(c.block * card.damageFromBlockPercent);
    c.boss.hp = Math.max(0, c.boss.hp - dmg);
    c.turnDamageDealt += dmg;
    c.block = 0;
    logMsg(`${card.name} converts your block into ${dmg} damage.`);
  }

  if (card.selfDamage) {
    game.hp = Math.max(0, game.hp - card.selfDamage);
    logMsg(`${card.name} costs you ${card.selfDamage} HP.`);
  }

  if (card.retainBlock) {
    c.retainBlockNextReset = true;
    logMsg(`${card.name}: your block will carry over into next turn.`);
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
function beginDiscardSelection(card, count) {
  const c = game.combat;
  const remaining = Math.min(count, c.hand.length);
  if (remaining <= 0) {
    resolveDeferrableEffects(card);
    return;
  }
  c.discardSelection = { forCard: card, remaining };
  logMsg(`${card.name}: choose ${remaining} card(s) to discard.`);
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

  // resolve any bets on this turn's damage (Hit Job) before the counter resets
  resolvePendingBets();

  // boss attacks
  const dmg = c.boss.pattern[c.boss.patternIndex];
  c.boss.patternIndex = (c.boss.patternIndex + 1) % c.boss.pattern.length;
  fireEvent('playerAttacked', { damage: dmg }); // Spiked Armor-style retaliation
  const dealt = Math.max(0, dmg - c.block);
  game.hp = Math.max(0, game.hp - dealt);
  logMsg(`${c.boss.name} attacks for ${dmg}${c.block > 0 ? ` (blocked ${Math.min(dmg, c.block)})` : ''}, you take ${dealt}.`);
  if (c.retainBlockNextReset) {
    c.retainBlockNextReset = false;
  } else {
    c.block = 0;
  }
  clearTurnStatuses();

  if (game.hp <= 0) {
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
    const playable = !selecting && card.cost <= c.energy && (!card.goldCost || card.goldCost <= game.gold);
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
    div.innerHTML = `<div class="name">${offer.name}</div><div class="desc">${offer.desc}</div><div class="price">${owned ? 'Bought' : price + 'g'}</div>`;
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
