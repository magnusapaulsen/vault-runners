// =============================================================================
//  BOSS ART SELF-TEST -- verifies the contract between boss-art.js and game.js.
//
//      node tools/boss-art/selftest.js
//
//  This is the "it just works" guarantee. It loads boss-art.js and game.js into a
//  stubbed DOM the way a browser would, and checks three things:
//    1. every boss in BOSSES renders a real portrait
//    2. a MISSING or MALFORMED boss-art.js degrades to no portraits, not a crash
//    3. the hit reaction still fires
//  Together with check.js (which validates the data) this covers both halves.
// =============================================================================

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok   ' + l); } else { console.log('  FAIL ' + l); process.exitCode = 1; } };

// ---- minimal DOM, enough for game.js to boot and render ---------------------
function makeDom() {
  const store = {};
  const el = (id) => {
    if (!store[id]) store[id] = {
      id,
      classList: { _s: new Set(), add(...c){c.forEach(x=>this._s.add(x))},
                   remove(...c){c.forEach(x=>this._s.delete(x))},
                   contains(c){return this._s.has(c)}, toggle(c,f){ f ? this._s.add(c) : this._s.delete(c) } },
      style: {}, dataset: {}, children: [], disabled: false, textContent: '', innerHTML: '',
      appendChild(c){this.children.push(c)}, addEventListener(){}, removeEventListener(){},
      getContext(){return {}}, focus(){}, offsetWidth: 1,
    };
    return store[id];
  };
  global.document = { getElementById: el, querySelectorAll: () => [], querySelector: () => el('x'),
    createElement: (t) => el('c' + t), addEventListener(){}, activeElement: null, body: el('body') };
  global.setTimeout = () => 0; global.clearTimeout = () => {};
  global.setInterval = () => 0; global.clearInterval = () => {};
  return store;
}

// game.js is one big top-level script; eval it and grab the bindings we need.
function loadGame() {
  const src = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
  (0, eval)(src + `
;globalThis.__t = { BOSSES, BOSS_ART, BOSS_PORTRAITS, BOSS_VIEWS, BOSS_INK,
  newRun, startCombat, renderCombat, bossPortraitSVG, endTurn, get game(){ return game } };`);
  return globalThis.__t;
}

function clearBetweenRuns() {
  // game.js declares top-level const/let; re-evaluating needs a fresh global scope for
  // the bindings, so drop the previous extraction between loads
  delete globalThis.__t;
}

// ============================================================================
console.log('\n1. art present: every boss renders');
// ============================================================================
const store = makeDom();
const art = fs.readFileSync(path.join(ROOT, 'boss-art.js'), 'utf8');
globalThis.window = globalThis;
(0, eval)(art);
const t = loadGame();
ok(Object.keys(t.BOSS_PORTRAITS).length === t.BOSSES.length,
   `all ${t.BOSSES.length} bosses have art`);
for (const b of t.BOSSES) {
  const svg = t.bossPortraitSVG(b.name, 'base', 'base');
  ok(svg.startsWith('<svg') && svg.includes('viewBox=') && !svg.includes('undefined'),
     `${b.name}: renders a valid viewBox'd svg`);
}
t.newRun();
t.renderCombat();
ok(store['boss-portrait'].innerHTML.includes('<svg'), 'portrait lands in the DOM');
ok(store['boss-portrait'].classList.contains('empty') === false, 'and is visible');

// hit reaction
t.game.combat.boss.hp -= 5;
t.renderCombat();
ok(store['boss-portrait'].classList.contains('hit'), 'hit reaction fires');
clearBetweenRuns();

// ============================================================================
console.log('\n2. boss-art.js MISSING: game still runs, portraits just vanish');
// ============================================================================
{
  const s2 = makeDom();
  globalThis.window = globalThis;
  delete globalThis.window.BOSS_ART;      // simulate the file not being there
  const t2 = loadGame();
  let threw = null;
  try {
    t2.newRun();
    t2.renderCombat();
    t2.game.combat.boss.hp -= 5;
    t2.renderCombat();
    t2.endTurn();
    t2.renderCombat();
  } catch (e) { threw = e; }
  ok(!threw, `game boots and plays with no art${threw ? ' -- threw: ' + threw.message : ''}`);
  ok(t2.bossPortraitSVG('Lich') === '', 'portraits render as empty strings');
  ok(s2['boss-portrait'].classList.contains('empty'), 'portrait div is hidden, not broken');
  ok(s2['boss-hp-text'].textContent.includes('/'), 'the boss HP readout still updates');
  clearBetweenRuns();
}

// ============================================================================
console.log('\n3. boss-art.js MALFORMED: syntax error, bad shape, wrong type');
// ============================================================================
{
  const cases = {
    'syntax error':    'window.BOSS_ART = { ink: { portraits: [ }',
    'not an object':   'window.BOSS_ART = 42;',
    'missing tables':  'window.BOSS_ART = { portraits: {} };',
    'wrong ink type':  'window.BOSS_ART = { ink: 5, views: {}, portraits: {} };',
    'throws on load':  'window.BOSS_ART = (function(){ throw new Error("boom"); })();',
  };
  for (const [label, body] of Object.entries(cases)) {
    const s3 = makeDom();
    globalThis.window = globalThis;
    try { (0, eval)(body); } catch (e) { /* a bad art file may not even parse */ }
    const t3 = loadGame();
    let threw = null;
    try { t3.newRun(); t3.renderCombat(); t3.game.combat.boss.hp -= 3; t3.renderCombat(); }
    catch (e) { threw = e; }
    ok(!threw, `"${label}" does not take the game down${threw ? ' -- threw: ' + threw.message : ''}`);
    clearBetweenRuns();
  }
}

console.log(`\n${pass} passed, ${process.exitCode ? 'FAILURES' : 'all green'}\n`);
