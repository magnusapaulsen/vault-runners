// Mutation test for tools/boss-art/check.js.
// Each case breaks boss-art.js in one specific way; the checker MUST report it.
// Run: node tools/boss-art/mutation-test.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ART = path.join(__dirname, '..', '..', 'boss-art.js');
const CHECK = path.join(__dirname, 'check.js');
const original = fs.readFileSync(ART, 'utf8');

function runCheck() {
  try {
    return execFileSync('node', [CHECK], { encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

// insert a run into the LAST portrait entry, i.e. definitely inside `portraits`
function injectRun(literal) {
  const i = original.indexOf('portraits: {');
  const k = original.indexOf('"God": [', i) + '"God": ['.length;
  return original.slice(0, k) + '\n    ' + literal + ',' + original.slice(k);
}
// remove a whole portrait entry, key line through its closing "],"
function dropPortrait(name) {
  const i = original.indexOf('portraits: {');
  const k = original.indexOf(`  "${name}": [`, i);
  const end = original.indexOf('\n  ],', k) + '\n  ],'.length;
  return original.slice(0, k) + original.slice(end);
}
// replace a portrait's run array with an empty one
function emptyPortrait(name) {
  const i = original.indexOf('portraits: {');
  const k = original.indexOf(`  "${name}": [`, i);
  const end = original.indexOf('\n  ],', k) + '\n  ],'.length;
  return original.slice(0, k) + `  "${name}": [],` + original.slice(end);
}
function loosenView(name) {
  const m = /(views: \{)([\s\S]*?)(\n  \},)/.exec(original);
  const obj = JSON.parse('{' + m[2] + '}');
  obj[name] = [0, 0, 78, 44];
  return original.replace(m[0], m[1] + '\n' + JSON.stringify(obj, null, 2).slice(1, -1) + m[3]);
}
function renameKey(from, to) {
  const i = original.indexOf('portraits: {');
  const k = original.indexOf(`"${from}"`, i);
  return original.slice(0, k) + `"${to}"` + original.slice(k + from.length + 2);
}

const CASES = [
  ['overlapping run',             () => injectRun("[1,1,20,20,'G']"),   'pixels covered twice'],
  ['unknown ink letter',          () => injectRun("[3,3,4,4,'Q']"),   'unknown: Q'],
  ['run outside the grid',        () => injectRun("[76,42,9,9,'G']"), 'inside the 78x44 grid'],
  ['non-integer coordinate',      () => injectRun("[3.5,3,4,4,'G']"), 'malformed'],
  ['zero-width run',              () => injectRun("[5,5,0,4,'G']"),  'zero or negative'],
  ['typo in a portrait name',     () => renameKey('Iron Sentinel', 'Iron Sentael'), 'no typo / stale entry'],
  ['boss with no art',            () => dropPortrait('Lich'),        'portrait exists for "Lich"'],
  ['empty portrait array',        () => emptyPortrait('Swamp Hag'),  'portrait is empty'],
  ['view not tight to the art',   () => loosenView('Iron Sentinel'), 'is tight to the art'],
  ['no outline ink used',         () => {
     // strip every 'K' run from Void Herald -- a figure with no outline reads as a blob
     const i = original.indexOf('portraits: {');
     const k = original.indexOf('  "Void Herald": [', i);
     const end = original.indexOf('\n  ],', k);
     return original.slice(0, k) + original.slice(k, end)
       .replace(/\[[-\d]+,[-\d]+,[\d]+,[\d]+,'K'\],?/g, '') + original.slice(end);
  }, 'no \'K\' outline ink used'],
  ['whole file is a syntax error', () => 'window.BOSS_ART = { ink: { portraits: [ }', 'FATAL'],
  ['file sets nothing',           () => '// nothing here',            'FATAL'],
  ['file throws on load',         () => 'window.BOSS_ART = (function(){ throw new Error("boom"); })();', 'FATAL'],
];

let bad = 0;
console.log('\nMUTATION TEST — does check.js actually catch broken art?\n' + '='.repeat(64));
for (const [label, mutate, expect] of CASES) {
  fs.writeFileSync(ART, mutate());
  const out = runCheck();
  const caught = out.includes(expect);
  if (!caught) bad++;
  console.log(`  ${caught ? 'caught  ' : 'MISSED  '} ${label.padEnd(28)} (looking for "${expect}")`);
  if (!caught) {
    console.log('           checker output: ' + out.split('\n').filter(l => /FAIL|FATAL/.test(l)).slice(0, 2).join(' | '));
  }
}
fs.writeFileSync(ART, original);

console.log('-'.repeat(64));
const clean = runCheck();
console.log(clean.includes('0 failed') ? '  restored: boss-art.js is valid' : '  RESTORE FAILED');
console.log(bad === 0 ? `\nall ${CASES.length} mutations caught\n` : `\n${bad} of ${CASES.length} mutations MISSED\n`);
process.exit(bad === 0 ? 0 : 1);
