// =============================================================================
//  PREVIEW SHEET -- renders every boss portrait at in-game size into one HTML page.
//
//      node tools/boss-art/sheet.js          ->  boss_sheet.html
//
//  Purely a convenience for judging art; nothing in the game reads it. It mirrors
//  the real .boss-portrait sizing (min(100%,620px) x clamp(...,300px)) and the real
//  .boss-area framing, so what you see here is what you see in a fight.
// =============================================================================
const fs = require('fs');
const path = require('path');
const store = {};
function el(id) {
  if (!store[id]) store[id] = {
    id, classList: { _s: new Set(), add(...c){c.forEach(x=>this._s.add(x))}, remove(...c){c.forEach(x=>this._s.delete(x))},
      contains(c){return this._s.has(c)}, toggle(c,f){ f ? this._s.add(c) : this._s.delete(c) } },
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '',
    appendChild(c){this.children.push(c)}, addEventListener(){}, removeEventListener(){},
    getContext(){return {}}, focus(){}, offsetWidth: 1,
  };
  return store[id];
}
global.document = { getElementById: el, querySelectorAll: () => [], querySelector: () => el('x'),
  createElement: (t) => el('created-' + t), addEventListener(){}, activeElement: null, body: el('body') };
global.window = global;
global.setTimeout = () => 0; global.clearTimeout = () => {};
global.setInterval = () => 0; global.clearInterval = () => {};
// The renderer lives in game.js, so load both files in the same order index.html does:
// boss-art.js for the data, game.js for bossPortraitSVG/BOSSES/BOSS_VIEWS.
const GAME = path.join(__dirname, '..', '..', 'game.js');
(0, eval)(fs.readFileSync(path.join(__dirname, '..', '..', 'boss-art.js'), 'utf8') +
  fs.readFileSync(GAME, 'utf8') +
  ';globalThis.__P=bossPortraitSVG;globalThis.__B=BOSSES;globalThis.__V=BOSS_VIEWS;');

const inner = (svg) => svg.replace(/^[^>]*>/, '').replace(/<\/svg>$/, '');

// mirror the real CSS box, scaled to whatever width we render the sheet at
// Matches the game's .boss-portrait box: width min(100%, 620px), height
// clamp(170px, 28vh, 300px). On a ~1080p window 28vh lands near the 300px ceiling;
// this sheet renders at that ceiling so what you see matches a large screen.
const SHEET_W = 620, SHEET_H = 300, SCALE = 1;

let rows = '';
for (const b of globalThis.__B) {
  const v = globalThis.__V[b.name];
  const asp = (v[2] / v[3]).toFixed(2);
  // what the art will actually occupy inside the fit box
  const boxAsp = SHEET_W / SHEET_H;
  const useW = (v[2] / v[3] > boxAsp) ? SHEET_W : Math.round(SHEET_H * v[2] / v[3]);
  const useH = (v[2] / v[3] > boxAsp) ? Math.round(SHEET_W * v[3] / v[2]) : SHEET_H;
  rows += `<div class="row">
  <div class="label">${b.name}<br><span class="hp">${b.maxHp} HP</span><br><span class="asp">art ${v[2]}×${v[3]} · ${asp}:1<br>renders ${useW}×${useH}px</span></div>
  <div class="frame">
    <div class="art"><svg class="base" viewBox="${v.join(' ')}" preserveAspectRatio="xMidYMid meet">${inner(globalThis.__P(b.name))}</svg><svg class="flash" viewBox="${v.join(' ')}" preserveAspectRatio="xMidYMid meet">${inner(globalThis.__P(b.name, 'flash'))}</svg></div>
    <div class="name">${b.name}</div>
    <div class="bar"><div class="fill" style="width:62%"></div></div>
    <div class="hptext">31/${b.maxHp}</div>
    <div class="intent">Intent: ${b.pattern[1]} damage next turn</div>
  </div>
</div>`;
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vault Runners — boss portraits</title><style>
body{background:#0b0b10;color:#fff;font:13px/1.45 'Courier New',monospace;margin:0;padding:20px}
h1{font-size:15px;letter-spacing:.15em;margin:0 0 4px}
.note{color:#8a8a96;margin-bottom:22px;max-width:640px}
.row{display:flex;align-items:flex-start;gap:20px;margin-bottom:10px}
.label{width:150px;flex:0 0 150px;font-size:14px;font-weight:700;padding-top:4px}
.hp{color:#ff5555;font-size:12px;font-weight:400}
.asp{color:#6a6a76;font-size:10px;font-weight:400;line-height:1.5}
/* the real .boss-area from style.css, so this is the actual in-game framing */
.frame{background:#000;border:2px solid #fff;padding:14px 18px;width:680px;position:relative}
.art{position:relative;width:${SHEET_W * SCALE}px;height:${SHEET_H * SCALE}px;margin:0 auto 8px;line-height:0}
.art svg{position:absolute;top:0;left:0;width:100%;height:100%;display:block}
.art .flash{opacity:0}
.art .flash rect{fill:#ff2d2d}
.art.hit .flash{animation:fl .5s ease-out}
.art.hit{animation:sh .28s ease-in-out}
@keyframes fl{0%{opacity:.85}40%{opacity:.6}100%{opacity:0}}
@keyframes sh{0%,100%{transform:translate(0,0)}20%{transform:translate(-5px,1px)}45%{transform:translate(4px,-1px)}70%{transform:translate(-2px,0)}}
.name{font-size:1.4rem;font-weight:700;margin-bottom:6px}
.bar{width:100%;height:18px;margin:6px 0;border:2px solid #fff;background:#000}
.fill{height:100%;background:#ff0000}
.hptext{color:#ff0000}
.intent{margin-top:8px;background:#000;display:inline-block;padding:6px 12px;border:2px solid #fff}
.tip{color:#6a6a76;font-size:11px;margin-top:10px}
</style></head><body>
<h1>VAULT RUNNERS — BOSS PORTRAITS</h1>
<div class="note">All ten, at the size and framing they render in the combat screen. The box is
<code>min(100%, 620px)</code> wide by <code>clamp(170px, 28vh, 300px)</code> tall — this sheet
renders it at the 300px ceiling, which is what a ~1080p window gets. Each portrait has
its own viewBox cropped tight to its art, so every boss fills the frame as much as its
own proportions allow: a wide boss like the Rock Golem is limited by width, a tall one
like the Iron Sentinel by height.</div>
${rows}
<div class="tip">Hit flash: add <code>class="hit"</code> to any <code>.art</code> div, or just play the
game and hit something.</div>
</body></html>`;

fs.writeFileSync(path.join(__dirname, '..', '..', 'boss_sheet.html'), html);
console.log('wrote boss_sheet.html', (html.length / 1024).toFixed(0) + ' KB');
for (const b of globalThis.__B) {
  const v = globalThis.__V[b.name];
  const boxAsp = SHEET_W / SHEET_H;
  const useW = (v[2] / v[3] > boxAsp) ? SHEET_W : Math.round(SHEET_H * v[2] / v[3]);
  console.log(`  ${b.name.padEnd(14)} art ${String(v[2] + '×' + v[3]).padEnd(7)} -> ${useW}×${SHEET_H}px in the box`);
}
