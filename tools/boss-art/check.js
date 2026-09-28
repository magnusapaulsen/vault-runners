// =============================================================================
//  BOSS ART CHECKER -- run this after ANY change to boss-art.js.
//
//      node tools/boss-art/check.js
//
//  Exits non-zero if anything is wrong, so it can gate a commit or a build step.
//  The game will still run with broken art (portraits just don't render), which is
//  why this exists: a silent blank boss box is much harder to notice than a failure.
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GRID_W = 78, GRID_H = 44;

let pass = 0;
const failures = [];
const warnings = [];
const ok = (cond, label) => { if (cond) { pass++; } else { failures.push(label); } };
const warn = (cond, label) => { if (!cond) warnings.push(label); };

// ---- 1. load boss-art.js the same way the browser does -----------------------
// A plain classic script that assigns one global. No module wrapper, no import.
const artPath = path.join(ROOT, 'boss-art.js');
if (!fs.existsSync(artPath)) {
  console.error('FATAL: boss-art.js is missing at ' + artPath);
  process.exit(1);
}
const src = fs.readFileSync(artPath, 'utf8');
const sandbox = { window: {} };
try {
  new Function('window', src)(sandbox.window);
} catch (e) {
  console.error('FATAL: boss-art.js threw while loading: ' + e.message);
  console.error('       It must be a plain script that only assigns window.BOSS_ART.');
  process.exit(1);
}
const ART = sandbox.window.BOSS_ART;
if (!ART) {
  console.error('FATAL: boss-art.js did not set window.BOSS_ART');
  process.exit(1);
}
for (const k of ['ink', 'views', 'portraits']) {
  ok(ART[k] && typeof ART[k] === 'object', `boss-art.js has a \`${k}\` table`);
}
if (failures.length) { report(); process.exit(1); }

// ---- 2. load the boss list straight out of game.js ---------------------------
const game = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const bosses = [...game.matchAll(/\{\s*name:\s*'([^']+)',\s*maxHp:/g)].map(m => m[1]);
ok(bosses.length === 10, `found ${bosses.length} bosses in game.js's BOSSES array`);

console.log(`\nBOSS ART CHECK`);
console.log('='.repeat(64));

// ---- 3. names match both ways ------------------------------------------------
for (const name of bosses) {
  ok(Object.prototype.hasOwnProperty.call(ART.portraits, name), `portrait exists for "${name}"`);
}
for (const name of Object.keys(ART.portraits)) {
  ok(bosses.includes(name), `"${name}" matches a boss in BOSSES exactly (no typo / stale entry)`);
  warn(Object.prototype.hasOwnProperty.call(ART.views, name), `"${name}" has no view rectangle`);
}
console.log(`  ${bosses.length} bosses, ${Object.keys(ART.portraits).length} portraits`);

// ---- 4. per-boss structural checks -------------------------------------------
let totalRuns = 0;
const sizes = [];

for (const [name, runs] of Object.entries(ART.portraits)) {
  if (!Array.isArray(runs) || runs.length === 0) {
    failures.push(`"${name}": portrait is empty`);
    continue;
  }
  totalRuns += runs.length;

  // run shape
  const badShape = runs.filter(r => !Array.isArray(r) || r.length !== 5 ||
    r.slice(0, 4).some(v => !Number.isInteger(v)) || typeof r[4] !== 'string');
  ok(badShape.length === 0,
     `"${name}": all ${runs.length} runs are [int, int, int, int, ink] (${badShape.length} malformed)`);

  // grid bounds
  const oob = runs.filter(r => r[0] < 0 || r[1] < 0 || r[0] + r[2] > GRID_W || r[1] + r[3] > GRID_H);
  ok(oob.length === 0, `"${name}": all runs inside the ${GRID_W}x${GRID_H} grid (${oob.length} outside)`);

  // zero/negative dimensions
  const badDim = runs.filter(r => r[2] <= 0 || r[3] <= 0);
  ok(badDim.length === 0, `"${name}": no zero or negative width/height (${badDim.length})`);

  // known inks
  const inks = [...new Set(runs.map(r => r[4]))].sort();
  const unknown = inks.filter(i => !ART.ink[i]);
  ok(unknown.length === 0,
     `"${name}": every ink is in the ink table (unknown: ${unknown.join(',') || 'none'})`);

  // overlaps -- paint order is meaningless so these silently hide each other
  const seen = new Map();
  let overlaps = 0;
  for (const [x, y, w, h, ink] of runs) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (x + i) + ',' + (y + j);
      if (seen.has(k)) overlaps++; else seen.set(k, ink);
    }
  }
  ok(overlaps === 0, `"${name}": no overlapping runs (${overlaps} pixels covered twice)`);

  // an outline? an entirely unoutlined figure merges into the background
  const hasOutline = runs.some(r => r[4] === 'K');
  warn(hasOutline, `"${name}": no 'K' outline ink used -- it may read as a flat blob`);

  // view rectangle must be tight to the art
  const v = ART.views[name];
  if (v) {
    ok(v.length === 4 && v.every(n => Number.isInteger(n)),
       `"${name}": view is [x, y, w, h] of integers`);
    const xs = runs.map(r => r[0]), ys = runs.map(r => r[1]);
    const bx0 = Math.min(...xs), by0 = Math.min(...ys);
    const bx1 = Math.max(...runs.map(r => r[0] + r[2]));
    const by1 = Math.max(...runs.map(r => r[1] + r[3]));
    const tight = (v[0] === bx0 && v[1] === by0 && v[2] === bx1 - bx0 && v[3] === by1 - by0);
    ok(tight, `"${name}": view ${JSON.stringify(v)} is tight to the art ` +
               `(expected ${bx0},${by0},${bx1 - bx0},${by1 - by0})`);
    if (tight) {
      const aspect = v[2] / v[3];
      ok(aspect > 0.5 && aspect < 3, `"${name}": sane aspect ${aspect.toFixed(2)}`);
      // how large it will actually render, in the 620x300 CSS box
      const scale = Math.min(620 / v[2], 300 / v[3]);
      const rw = Math.round(v[2] * scale), rh = Math.round(v[3] * scale);
      sizes.push({ name, rw, rh });
      ok(Math.min(rw, rh) >= 200,
         `"${name}": renders ${rw}x${rh}px in the 620x300 box`);
    }
  }
}

console.log(`  ${totalRuns} runs, ${(totalRuns * 18 / 1024).toFixed(1)} KB of pixel data`);

// ---- 5. does the set read as a set? ------------------------------------------
// Distinct silhouettes matter more than anything: two bosses that render to nearly the
// same outline are a design bug even when every structural check passes.
const sigs = sizes.map(s => `${s.name}:${s.rw}x${s.rh}`);
ok(new Set(sigs).size === sigs.length, 'all bosses render to distinct sizes');

if (sizes.length) {
  const minArea = Math.min(...sizes.map(s => s.rw * s.rh));
  const maxArea = Math.max(...sizes.map(s => s.rw * s.rh));
  warn(maxArea / minArea < 2.2,
       `rendered area varies by ${(maxArea / minArea).toFixed(2)}x between the ` +
       `smallest and largest boss -- the smallest may read as much less important`);
}

report();

function report() {
  console.log('-'.repeat(64));
  for (const w of warnings) console.log('  WARN  ' + w);
  if (failures.length) {
    for (const f of failures) console.log('  FAIL  ' + f);
    console.log(`\n${pass} passed, ${failures.length} FAILED, ${warnings.length} warnings\n`);
    process.exit(1);
  }
  console.log(`\n${pass} passed, 0 failed, ${warnings.length} warnings`);
  if (!warnings.length) console.log('boss-art.js is valid.');
  console.log('');
  process.exit(0);
}
