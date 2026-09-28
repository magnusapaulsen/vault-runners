# Boss art

Everything about the boss portraits lives here or in `boss-art.js`. `game.js` contains
only the renderer — it has no art of its own and needs no changes when you redesign
anything in this folder.

## The two files

| File | What it is |
|---|---|
| `boss-art.js` | **The art.** Pure data: a colour table, a camera rectangle per boss, and the pixel runs. Safe to regenerate. |
| `tools/boss-art/figures.js` | **The source.** Each boss is a short function built from ellipses, polygons and tapered limbs. **This is the file to edit.** |

Hand-editing `boss-art.js` directly is possible but unpleasant — 2,735 individual runs
across ten bosses. Editing `figures.js` and regenerating is the sane route.

## Workflow

```bash
node tools/boss-art/figures.js "Lich"     # ASCII proof of one boss — fastest feedback
ANSI=1 node tools/boss-art/figures.js     # true-colour proof of all ten
node tools/boss-art/figures.js            # plain ASCII proof of all ten

node tools/boss-art/build.js              # regenerate boss-art.js from figures.js
node tools/boss-art/check.js              # validate          (exits non-zero on failure)
node tools/boss-art/mutation-test.js      # prove check.js works
node tools/boss-art/selftest.js           # prove the renderer contract holds
node tools/boss-art/sheet.js              # build boss_sheet.html preview
```

`check.js` is the one to run before you call it done. `sheet.js` writes
`boss_sheet.html` to the repo root — open it to see all ten at in-game size. It's
gitignored; it's a preview, not a source file.

## The contract

`boss-art.js` is a plain classic script that assigns exactly one global. No modules,
no imports, no code beyond the assignment.

```js
window.BOSS_ART = {
  ink:       { G: '#8d8d8d', ... },
  views:     { "Lich": [16, 0, 47, 44], ... },
  portraits: { "Lich": [[x, y, w, h, 'G'], ...], ... },
};
```

- **Names are keys.** Every `portraits` key must match a boss name in `game.js`'s
  `BOSSES` array exactly. Lookup is by name, not index, so reordering `BOSSES` can't
  mismatch art to a fight. A boss with no entry simply renders no portrait.
- **Runs** are `[column, row, width, height, inkLetter]`, integers, on a shared 78×44
  grid. Runs must not overlap — paint order is meaningless, so a later run just hides
  an earlier one.
- **`views`** is `[x, y, width, height]`, cropped tight to that boss's art. **This
  matters more than anything else in the file.** It is what makes each portrait fill
  its frame; a loose view rectangle is the single most common way to make a boss look
  small. `build.js` computes it for you.
- **`ink`** maps letters to CSS colours. One shared palette for all ten is deliberate —
  it's a lot of what makes the set read as a set.

## Drawing figures

`figures.js` gives you a small toolkit (`pixlib.js`):

| Helper | Use |
|---|---|
| `part(w, h, draw)` | One body part, outlined and cropped. **Use this for every piece.** |
| `Canvas#blit(fig, x, y)` | Place a part. Draw back to front. |
| `Canvas#flipX()` | Mirror a part — arms, legs, pauldrons. |
| `Canvas#mirrorInto(target)` | Seamless symmetric double. `crop()` the source first. |
| `Canvas#outline()` | Black edge around every filled region. |
| `ell` / `poly` / `taper` / `rect` | The drawing primitives. Inks: `K` black, `W` white, `G`/`D`/`L` greys, `P` pink, `F` flesh, `A`/`M` browns, `E`/`N` greens, `B`/`C` steels, `U`/`V` purples, `O`/`Y` golds, `R`/`T` reds. |

Three things that went wrong while building these, so you can avoid them:

1. **Draw parts separately, never as one mass.** A figure drawn on a single canvas
   loses all its internal edges — the rat swarm came out as an undifferentiated blob.
   `part()` exists precisely so each piece keeps its own black outline, which is what
   separates two overlapping creatures.

2. **Give figures distinct silhouettes, not just distinct palettes.** Bosses that
   render to the same outline are a design bug no automated check can catch. Right now
   the set spans a squat boulder (Rock Golem), a narrow knight (Iron Sentinel), a
   bowed troll, a crooked hag, and a wide-horned dragon. `check.js` warns if rendered
   areas vary by more than ~2×, which is a crude proxy for the same problem.

3. **Watch the aspect ratio.** A figure at 0.9:1 in a 1.7:1 frame is height-limited
   and ends up much narrower than its neighbours. That's correct behaviour, not a bug —
   but if a boss looks small next to the others, the fix is usually its proportions,
   not the view box.

## If you break something

Nothing here can take the game down. `game.js` defaults every table to `{}` when
`window.BOSS_ART` is missing or malformed, so a broken art file costs you the
portraits and nothing else. The console prints which of the two happened:

```
[boss art] loaded 10 portraits from boss-art.js
[boss art] boss-art.js loaded no portraits -- portraits are disabled
```

That safety net is deliberate and covered by `selftest.js`, so don't add code to
`game.js` that can throw on bad art.
