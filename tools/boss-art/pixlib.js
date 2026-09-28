// Build-time pixel-art toolkit for boss portraits. NOT shipped -- lives in the session
// temp dir. bossart.js imports this, runs it, and emits the run arrays pasted into game.js.
//
// Design notes:
//  - Figures are drawn on their own canvas so each can be outlined independently BEFORE
//    being blitted. That black outline is what keeps overlapping creatures legible; the
//    rat composition failed precisely because bodies merged without it.
//  - Depth is sold by size + vertical position: small figures low (closer to camera),
//    large figures high (further back).

const W = 78, H = 44;

// ---- the shared ink palette -------------------------------------------------
// One map for every boss, so game.js keeps a single BOSS_INK object. Letters are
// mnemonic: K outline, W white, G/D/L greys, F flesh, E/N greens, B/C steel blues,
// U/V purples, O/Y golds, R/T reds, M/A browns, P pink.
const INK = {
  K: '#000000', W: '#ffffff',
  G: '#8d8d8d', D: '#565656', L: '#c8c8c8',
  P: '#e08a94', F: '#f0c8a0', A: '#7a4a2a',
  E: '#6f9a4a', N: '#3f5c28',
  B: '#8a9ab8', C: '#4a5a7a',
  U: '#9a5cd4', V: '#5a2a8a',
  O: '#ffcc44', Y: '#b38a1a',
  R: '#cc3333', T: '#8a2a2a',
  M: '#8a6a3a',
};

class Canvas {
  constructor(w = W, h = H) {
    this.w = w; this.h = h;
    this.px = Array.from({ length: h }, () => new Array(w).fill(null));
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inside(x, y) ? this.px[y][x] : null; }
  set(x, y, ch) { if (this.inside(x, y)) this.px[y][x] = ch; }
  // only paints where a pixel is already set -> detail goes on top of a shape
  setIf(x, y, ch) { if (this.inside(x, y) && this.px[y][x]) this.px[y][x] = ch; }
  setIfNot(x, y, ch) { if (this.inside(x, y) && !this.px[y][x]) this.px[y][x] = ch; }
  clear(x, y) { if (this.inside(x, y)) this.px[y][x] = null; }

  rect(x0, y0, x1, y1, ch) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, ch);
    return this;
  }
  // paints only inside the existing silhouette
  rectIn(x0, y0, x1, y1, ch) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.setIf(x, y, ch);
    return this;
  }
  ell(cx, cy, rx, ry, ch) {
    for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
      for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, ch);
      }
    return this;
  }
  ellIn(cx, cy, rx, ry, ch) {
    for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
      for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.setIf(x, y, ch);
      }
    return this;
  }
  disc(cx, cy, r, ch) { return this.ell(cx, cy, r, r, ch); }
  discIn(cx, cy, r, ch) { return this.ellIn(cx, cy, r, r, ch); }

  // even-odd scanline polygon fill
  poly(pts, ch) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) this.set(x, y, ch);
    }
    return this;
  }
  polyIn(pts, ch) {
    const tmp = new Canvas(this.w, this.h);
    tmp.poly(pts, ch);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++)
      if (tmp.get(x, y)) this.setIf(x, y, ch);
    return this;
  }

  // thick line: walks the segment stamping a disc of radius r
  limb(x0, y0, x1, y1, r, ch) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, ch);
    }
    return this;
  }
  limbIn(x0, y0, x1, y1, r, ch) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.discIn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, ch);
    }
    return this;
  }
  // a tapered limb: radius lerps r0 -> r1 along the segment
  taper(x0, y0, x1, y1, r0, r1, ch) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, ch);
    }
    return this;
  }
  taperIn(x0, y0, x1, y1, r0, r1, ch) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.discIn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, ch);
    }
    return this;
  }

  // add a black outline around every filled region
  outline(ch = 'K') {
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (!this.get(x, y)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (!this.get(x + dx, y + dy)) { add.push([x + dx, y + dy]); break; }
      }
    for (const [x, y] of add) this.set(x, y, ch);
    return this;
  }

  // vertical gradient over the silhouette, for volume
  shadeRows(rows, ch) {
    for (const [y0, y1, c] of rows) this.rectIn(0, y0, this.w - 1, y1, c);
    return this;
  }

  // copy another canvas in at an offset; empty source pixels do NOT erase
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c) this.set(x + dx, y + dy, c);
      }
    return this;
  }
  // same, but scaled by an integer-ish factor (nearest neighbour)
  blitScaled(src, dx, dy, s) {
    for (let y = 0; y < src.h * s; y++)
      for (let x = 0; x < src.w * s; x++) {
        const c = src.get(Math.floor(x / s), Math.floor(y / s));
        if (c) this.set(dx + x, dy + y, c);
      }
    return this;
  }

  isEmpty() {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y)) return false;
    return true;
  }
  bounds() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (this.get(x, y)) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    return x0 === 1e9 ? null : { x0, y0, x1, y1 };
  }
  // trim empty margins so a figure can be positioned by its own box
  crop() {
    const b = this.bounds();
    if (!b) return this;
    const out = new Canvas(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) out.set(x, y, this.get(b.x0 + x, b.y0 + y));
    this.px = out.px; this.w = out.w; this.h = out.h;
    return this;
  }
  flipX() {
    const out = new Canvas(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) out.set(this.w - 1 - x, y, this.get(x, y));
    this.px = out.px;
    return this;
  }
  // Append a mirrored copy of this canvas immediately to its right edge, producing a
  // seamless symmetric double. Crop this FIRST if it has empty margins: the mirror
  // position is derived from this.w, so any transparent padding opens a gap down the
  // centre instead of closing the seam.
  //   const half = new Canvas(...).outline().crop();
  //   half.mirrorInto(target);
  mirrorInto(target, dx = 0, dy = 0) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const ch = this.get(x, y);
        if (ch) target.set(dx + 2 * this.w - 1 - x, dy + y, ch);
      }
    return target;
  }
  // mirror the left half onto the right for symmetric creatures
  mirrorSelf(axis) {
    const snapshot = this.px.map(r => r.slice());
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const mx = Math.round(2 * axis - x);
        if (mx >= 0 && mx < this.w && mx > x) this.px[y][x] = snapshot[y][mx];
      }
    return this;
  }
}

// ---- output -----------------------------------------------------------------

// Greedy maximal-rectangle decomposition. Much smaller than per-row runs for the
// solid shapes these portraits are made of.
function toRuns(canvas) {
  const used = Array.from({ length: canvas.h }, () => new Array(canvas.w).fill(false));
  const runs = [];
  for (let y = 0; y < canvas.h; y++) {
    for (let x = 0; x < canvas.w; x++) {
      if (used[y][x] || !canvas.get(x, y)) continue;
      const ch = canvas.get(x, y);
      let w = 1;
      while (x + w < canvas.w && !used[y][x + w] && canvas.get(x + w, y) === ch) w++;
      let h = 1;
      grow: while (y + h < canvas.h) {
        for (let i = 0; i < w; i++) {
          if (used[y + h][x + i] || canvas.get(x + i, y + h) !== ch) break grow;
        }
        h++;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[y + j][x + i] = true;
      runs.push([x, y, w, h, ch]);
    }
  }
  return runs;
}

// ASCII proof so shapes can be judged without a browser. Every ink gets its OWN
// character -- collapsing several inks onto one glyph hides exactly the
// silhouette-vs-interior confusion these figures are prone to.
const PROOF = {
  K: '#', W: '@', G: 'g', D: 'd', L: 'l', P: 'p', F: 'f', A: 'a',
  E: 'e', N: 'n', B: 'b', C: 'c', U: 'u', V: 'v', O: 'o', Y: 'y',
  R: 'r', T: 't', M: 'm',
};
function proofChar(ch) {
  if (!ch) return ' ';
  const p = PROOF[ch];
  if (!p) return '?';
  return p;
}
function toAscii(canvas) {
  const lines = [];
  for (let y = 0; y < canvas.h; y++) {
    let line = '';
    for (let x = 0; x < canvas.w; x++) line += proofChar(canvas.get(x, y));
    lines.push(line.replace(/\s+$/, ''));
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n');
}

// Full 256-color-ish render for a truer look: ANSI truecolor background blocks.
function toAnsi(canvas) {
  const out = [];
  for (let y = 0; y < canvas.h; y++) {
    let line = '';
    for (let x = 0; x < canvas.w; x++) {
      const ch = canvas.get(x, y);
      if (!ch) { line += '  '; continue; }
      const hex = INK[ch] || '#ff00ff';
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      line += `\x1b[48;2;${r};${g};${b}m  `;
    }
    out.push(line + '\x1b[0m');
  }
  return out.join('\n');
}

function validate(canvas, label) {
  const problems = [];
  for (let y = 0; y < canvas.h; y++)
    for (let x = 0; x < canvas.w; x++) {
      const ch = canvas.get(x, y);
      if (ch && !INK[ch]) problems.push(`unknown ink '${ch}' at ${x},${y}`);
    }
  const b = canvas.bounds();
  if (!b) problems.push('completely empty');
  return { problems, bounds: b };
}

module.exports = { W, H, INK, Canvas, toRuns, toAscii, toAnsi, validate };
