// =============================================================================
//  BOSS FIGURES -- the procedural source for the boss portraits.
//
//  This is the file to edit when redesigning a boss. Each boss is a short function
//  built from ellipses, polygons and tapered limbs, then outlined, then blitted
//  together. Compare that with placing ~2700 individual pixel runs by hand.
//
//  HOW A FIGURE IS ASSEMBLED
//    part(w, h, draw)   one body part on its own canvas, outlined and cropped.
//                       Use this for every piece of a figure. Parts keep their own
//                       black outline, which is the only thing that keeps two
//                       overlapping creatures legible -- a version drawn as one
//                       merged mass turned the rat swarm to mush.
//    Canvas#flipX()     mirror a part (arms, legs, pauldrons)
//    Canvas#mirrorInto(target)  seamless symmetric double; crop() the source first
//    Canvas#outline()   black edge around every filled region
//    Canvas#blit(fig, x, y)  place a part, back to front
//
//  INKS come from pixlib's INK table: K black outline, W white, G/D/L greys,
//  P pink, F flesh, A/M browns, E/N greens, B/C steel blues, U/V purples,
//  O/Y golds, R/T reds. One shared palette for all ten, so the set stays a set.
//
//  WORKFLOW
//    node build.js            regenerate ../../boss-art.js
//    node check.js            validate the generated art
//    node figures.js          ASCII proof sheet of all ten
//    node figures.js "Lich"   proof sheet of one
//    ANSI=1 node figures.js   true-colour version
// =============================================================================

const { W, H, INK, Canvas, toRuns, toAscii, toAnsi, validate } = require('./pixlib');

// =====================================================================
// Shared figure builders. Each returns a cropped canvas that has ALREADY
// been outlined, so blitting several together keeps their silhouettes
// separate -- which is what made the first rat attempt read as mush.
// =====================================================================

// ---- Rat Swarm ---------------------------------------------------------
function ratFigure(s = 1, face = true) {
  const c = new Canvas(40, 26);
  c.taper(26, 15, 34, 5, 1.4, 0.7, 'G');
  c.ell(24, 13, 7, 6.5, 'G');
  c.ell(17, 13, 10, 6.5, 'G');
  c.ell(9, 12, 6.5, 6, 'G');
  c.poly([[1, 12.5], [9.5, 9], [9.5, 16]], 'G');
  c.ell(12, 4, 4.5, 4.5, 'G');
  c.rect(13, 17, 17, 21, 'G');
  c.rect(22, 18, 26, 22, 'G');
  c.ell(15, 21.5, 2.6, 1.6, 'G');
  c.ell(24, 22.5, 2.6, 1.6, 'G');
  c.ellIn(17, 16, 8, 3, 'D');
  c.ellIn(24, 15, 5, 4, 'D');
  if (face) {
    c.ellIn(12, 4, 2.4, 2.4, 'P');
    c.ellIn(6, 11, 1.7, 1.7, 'K');
    c.set(5, 10, 'W');
    c.ellIn(1.5, 12.5, 1.5, 1.4, 'P');
    c.set(4, 15, 'W'); c.set(5, 15, 'W');
    c.ellIn(24, 22.5, 2, 1.2, 'P');
    c.ellIn(15, 21.5, 2, 1.2, 'P');
  }
  c.outline();
  if (s !== 1) { const o = new Canvas(Math.round(40 * s), Math.round(26 * s)); o.blitScaled(c, 0, 0, s); return o; }
  return c;
}
// Head-only rat, for the ones crowding around the big one. Read at 15-19px wide, so
// the eye is a full 2x2 block with a glint and the ears are separated by a clear gap
// -- an earlier 20x16 version merged the eye into the snout's outline and turned to
// mush the moment it was scaled down.
function ratHead(s = 1) {
  const c = new Canvas(24, 20);
  c.ell(8, 5, 4.5, 4.5, 'G');          // near ear
  c.ell(15, 5, 4.5, 4.5, 'G');         // far ear
  c.ell(12, 12, 7, 6, 'G');            // head
  c.poly([[1, 12], [7, 8.5], [7, 15.5]], 'G');   // snout
  c.ellIn(8, 5, 2.2, 2.2, 'P');
  c.ellIn(15, 5, 2.2, 2.2, 'P');
  c.ellIn(9, 11, 1.8, 1.8, 'K');       // eye
  c.set(9, 11, 'W');                   // glint
  c.ellIn(1, 12, 1.5, 1.3, 'P');       // nose
  c.set(3, 15, 'W'); c.set(5, 15, 'W'); // teeth
  c.outline();
  const o = new Canvas(Math.round(24 * s), Math.round(20 * s));
  o.blitScaled(c, 0, 0, s);
  return o;
}

// Build one body part on its own canvas, outline it, and return it cropped and
// ready to blit. Every humanoid below is assembled from these rather than drawn as
// one mass -- overlapping parts in a single canvas lose their internal edges, which
// is exactly how heads sink into shoulders and the whole figure goes to mush.
function part(w, h, draw) {
  const c = new Canvas(w, h);
  draw(c);
  c.outline();
  return c.crop();
}

// ---- Cave Troll -------------------------------------------------------
// Hunched forward, head low between the shoulders. The previous version sat the head
// straight on the torso with no neck, so the two merged; the horns were 1px diagonal
// strokes that read as scratches; and the splayed legs left a hole in the middle.
// Fixed by giving it a real neck, solid horns, and legs close enough to read as a pair.
function caveTroll() {
  const head = part(26, 22, c => {
    c.ell(13, 13, 9, 8, 'G');                 // skull
    c.ellIn(13, 17, 7, 5, 'D');               // heavy jaw shadow
    c.poly([[4, 4], [13, 1], [13, 9]], 'L');  // solid horns, not strokes
    c.poly([[22, 4], [13, 1], [13, 9]], 'L');
    c.polyIn([[6, 6], [12, 4], [12, 9]], 'D');
    c.polyIn([[20, 6], [14, 4], [14, 9]], 'D');
    c.poly([[5, 10], [21, 10], [21, 13], [5, 13]], 'D');   // brow shelf
    c.ell(9, 15, 2, 1.8, 'O');                // eyes
    c.ell(17, 15, 2, 1.8, 'O');
    c.ellIn(9, 15, 0.8, 0.8, 'K');
    c.ellIn(17, 15, 0.8, 0.8, 'K');
    c.ellIn(13, 19, 5, 2, 'K');               // mouth
    c.poly([[8, 18], [10, 18], [9, 14]], 'W'); // tusks
    c.poly([[16, 18], [18, 18], [17, 14]], 'W');
  });
  const neck = part(12, 10, c => {
    c.ell(6, 5, 5, 5, 'G');
    c.ellIn(6, 7, 4, 3, 'D');
  });
  const torso = part(30, 26, c => {
    c.poly([[3, 2], [27, 2], [29, 12], [24, 25], [6, 25], [1, 12]], 'G');
    c.polyIn([[16, 2], [27, 2], [29, 12], [24, 25], [16, 25]], 'D');
    c.ellIn(10, 8, 7, 5, 'D');                 // chest
    c.polyIn([[5, 17], [25, 17], [24, 25], [6, 25]], 'M');  // loincloth
  });
  const armL = part(18, 32, c => {            // hangs outside the torso
    c.taper(14, 2, 6, 10, 6, 5, 'G');
    c.taper(6, 10, 8, 25, 5, 4.5, 'G');
    c.ell(8, 28, 5.5, 4.5, 'G');              // fist
    c.taperIn(8, 13, 10, 25, 3.2, 3, 'D');
  });
  const armR = armL.flipX();
  const legL = part(15, 22, c => {
    c.taper(9, 0, 6, 17, 6.5, 5.5, 'G');
    c.ell(5, 19, 6.5, 3, 'G');                // foot
    c.taperIn(9, 4, 7, 17, 4, 3.4, 'D');
  });
  const legR = legL.flipX();

  const c = new Canvas(60, 44);
  c.blit(armL, 0, 8);
  c.blit(armR, 42, 8);
  c.blit(legL, 15, 22);
  c.blit(legR, 30, 22);
  c.blit(torso, 15, 4);
  c.blit(neck, 24, 8);
  c.blit(head, 17, 0);
  return c.crop();
}

// ---- Bandit Chief ------------------------------------------------------
// A green orc chieftain: heavy brow, tusked jaw, crude iron, one huge cleaver.
// Silhouette is BOWED -- the cleaver is raised on a diagonal, so the figure reads
// differently from the Cave Troll (symmetric, arms-down) and the Iron Sentinel
// (rigid and vertical).
function banditChief() {
  const head = part(26, 24, c => {
    c.ell(13, 12, 9, 8.5, 'E');            // skull
    c.poly([[4, 6], [0, 3], [3, 11]], 'E'); // pointed ear, left
    c.poly([[22, 6], [26, 3], [23, 11]], 'E');
    c.ellIn(6, 6, 4, 2.5, 'N');            // heavy brow
    c.ellIn(9, 12, 2, 1.8, 'O');           // eyes
    c.ellIn(17, 12, 2, 1.8, 'O');
    c.ellIn(9.5, 12, 0.8, 0.8, 'K');
    c.ellIn(17.5, 12, 0.8, 0.8, 'K');
    c.ellIn(13, 18, 7, 4, 'N');            // jaw
    c.ellIn(13, 17, 5, 2, 'K');            // mouth
    c.poly([[7, 16], [9, 16], [8, 11]], 'W');   // tusks
    c.poly([[17, 16], [19, 16], [18, 11]], 'W');
    c.ellIn(13, 22, 1.6, 1.2, 'R');        // scar
  });
  const torso = part(30, 24, c => {
    c.poly([[5, 0], [25, 0], [27, 22], [3, 22]], 'E');
    c.polyIn([[17, 0], [25, 0], [27, 22], [17, 22]], 'N');
    c.polyIn([[9, 3], [21, 3], [22, 9], [8, 9]], 'N');  // pecs
    c.polyIn([[5, 14], [25, 14], [27, 22], [3, 22]], 'M'); // loincloth
    c.rectIn(3, 14, 27, 15, 'Y');                       // belt
  });
  const pauldron = part(14, 12, c => {       // crude riveted iron
    c.ell(7, 6, 7, 5, 'D');
    c.ellIn(7, 6, 4, 3, 'L');
    c.ell(3, 4, 1.2, 1.2, 'L'); c.ell(10, 4, 1.2, 1.2, 'L');
  });
  const armL = part(14, 24, c => {
    c.taper(11, 2, 5, 14, 4, 3.4, 'E');
    c.ell(4, 18, 4.5, 4, 'E');
  });
  const armR = part(16, 22, c => {          // raised, gripping the haft
    c.taper(4, 20, 12, 2, 3.6, 3.2, 'E');
    c.ell(13, 2, 4, 4, 'E');
  });
  const legL = part(16, 20, c => {
    c.taper(8, 0, 4, 15, 6, 5, 'E');
    c.ell(3, 17, 6, 2.5, 'N');              // bare foot
    c.rect(1, 15, 9, 17, 'D');              // sandal
  });
  const legR = legL.flipX();
  const cleaver = part(30, 44, c => {       // big crude blade, diagonal
    c.poly([[6, 0], [10, 2], [26, 40], [18, 43]], 'D');
    c.polyIn([[8, 3], [11, 5], [24, 38], [20, 39]], 'L');
    c.poly([[4, 0], [12, 4], [10, 8], [2, 4]], 'Y');    // collar on the haft
    c.taper(2, 4, 0, 20, 1.6, 1.6, 'A');                // haft
  });

  const c = new Canvas(56, 44);
  c.blit(legL, 10, 24);
  c.blit(legR, 26, 24);
  c.blit(cleaver, 32, 0);
  c.blit(armL, 4, 12);
  c.blit(torso, 13, 10);
  c.blit(pauldron, 6, 10);
  c.blit(head, 15, 2);
  c.blit(armR, 32, 12);
  return c.crop();
}

// ---- Rock Golem --------------------------------------------------------
// A squat boulder with two enormous fists, in the Geodude mould. Deliberately
// WIDER than it is tall, which makes it the only boss with that proportion -- the
// opposite of the Bandit Chief and the Iron Sentinel. The fists are separate
// outlined parts so they read as gripped masses rather than merging into the body.
function rockGolem() {
  const body = part(38, 34, c => {
    c.ell(19, 17, 18, 16, 'G');            // the boulder
    c.ell(15, 8, 9, 4.5, 'L');             // small lit cap, not the whole crown
    c.ellIn(19, 25, 15, 8, 'D');           // shaded underside
    // brow: a heavy rock shelf -- the main thing that makes the face read as angry
    c.poly([[6, 11], [32, 11], [32, 15], [6, 15]], 'D');
    c.ell(13, 16, 2.6, 2.4, 'K');         // eyes
    c.ell(25, 16, 2.6, 2.4, 'K');
    c.set(13, 16, 'O'); c.set(25, 16, 'O');
    c.ellIn(19, 22, 5, 2, 'K');            // mouth
    c.limb(11, 5, 15, 9, 0.7, 'D');        // cracks
    c.limb(15, 9, 12, 15, 0.7, 'D');
    c.limb(28, 6, 26, 12, 0.7, 'D');
    c.limb(8, 19, 12, 23, 0.7, 'D');
  });
  // Fists are a lighter tone than the body so the two masses separate at a glance
  // even though both are rock.
  const arm = part(22, 22, c => {
    c.taper(20, 8, 10, 11, 5, 5.5, 'G');
    c.ell(7, 12, 8, 8.5, 'L');             // the fist
    c.ell(5, 8, 4.5, 4, 'W');              // knuckle highlight
    c.ellIn(7, 16, 5.5, 4, 'D');
  });
  const armR = arm.flipX();
  const foot = part(14, 12, c => {
    c.taper(7, 0, 6, 7, 4.5, 5, 'G');
    c.ell(6, 8, 6, 3.5, 'D');
  });
  const footR = foot.flipX();

  const c = new Canvas(78, 44);
  c.blit(arm, 0, 8);
  c.blit(armR, 56, 8);
  c.blit(body, 20, 3);
  c.blit(foot, 24, 32);
  c.blit(footR, 40, 32);
  return c.crop();
}

// ---- Swamp Hag ---------------------------------------------------------
// Gaunt, hunched, dripping, one gnarled staff. Asymmetric on purpose.
function swampHag() {
  // Hunched and asymmetric on purpose -- she is the only boss leaning off-vertical.
  // The staff is a separate part so it reads as an object held, not a leg.
  const robe = part(38, 40, c => {
    c.poly([[8, 0], [22, 0], [34, 39], [0, 39]], 'N');
    c.polyIn([[15, 0], [22, 0], [34, 39], [18, 39]], 'G');   // lit side
    c.rectIn(8, 1, 22, 2, 'E');
    for (let i = 0; i < 3; i++) c.limb(11 + i, 8 + i * 8, 10 + i, 20 + i * 6, 0.7, 'E'); // algae drips
  });
  const hunch = part(30, 22, c => {
    c.ell(20, 14, 12, 8, 'N');        // humped back
    c.ellIn(20, 17, 9, 5, 'G');
  });
  const head = part(20, 20, c => {
    c.ell(10, 11, 6.5, 6, 'E');
    c.ellIn(7.5, 10, 1.8, 1.8, 'O'); c.ellIn(12.5, 10, 1.8, 1.8, 'O');
    c.ellIn(8, 10, 0.7, 0.7, 'K'); c.ellIn(13, 10, 0.7, 0.7, 'K');
    c.ellIn(10, 15, 3.5, 1.8, 'K');   // mouth
    c.poly([[4, 5], [10, 0], [16, 5]], 'N');   // hood peak
  });
  const claw = part(22, 18, c => {            // clawing arm, reaching right
    c.taper(2, 14, 16, 5, 3, 1.6, 'E');
    c.poly([[16, 3], [21, 5], [16, 7]], 'E');
    c.poly([[16, 6], [21, 9], [16, 10]], 'E');
  });
  const staff = part(14, 44, c => {
    c.taper(6, 6, 8, 43, 1.6, 1.8, 'M');
    c.ell(6, 4, 4, 4, 'N');              // skull finial
    c.ellIn(4.5, 3, 1.2, 1.2, 'R'); c.ellIn(7.5, 3, 1.2, 1.2, 'R');
    c.polyIn([[4, 6], [8, 6], [6, 8]], 'K');
  });

  const c = new Canvas(52, 44);
  c.blit(staff, 0, 0);
  c.blit(robe, 10, 5);
  c.blit(hunch, 12, 0);
  c.blit(claw, 26, 8);
  c.blit(head, 14, 0);
  return c.crop();
}

// ---- Iron Sentinel -----------------------------------------------------
// Armoured knight. Symmetric by construction, so it reads as a machine.
function ironSentinel() {
  // Human proportions, not a slab: narrow shoulders, a waist, arms hanging clear of
  // the torso. Built as a mirrored half ~19px wide, so the figure comes out around
  // 38 wide by 44 tall -- roughly a person's build. The first version was 60 wide and
  // read as a tank, not a knight.
  const half = new Canvas(21, 44);
  half.poly([[11, 1], [20, 1], [20, 13], [9, 13]], 'B');     // helm
  half.polyIn([[16, 2], [20, 2], [20, 12], [15, 12]], 'C');
  half.rectIn(9, 6, 20, 7, 'K');                              // visor slit
  half.rectIn(12, 6, 12, 6, 'O');                             // eye glow
  half.poly([[15, 1], [16, 0], [17, 0], [18, 1]], 'R');       // plume
  half.poly([[8, 13], [20, 13], [20, 17], [7, 17]], 'C');     // gorget
  half.ell(9, 18, 6, 4.5, 'B');                               // pauldron
  half.ellIn(9, 18, 3.5, 2.5, 'C');
  half.poly([[8, 17], [20, 17], [20, 27], [10, 27]], 'B');    // breastplate
  half.polyIn([[15, 17], [20, 17], [20, 27], [15, 27]], 'C');
  half.poly([[10, 27], [20, 27], [20, 31], [11, 31]], 'C');   // faulds (skirt)
  half.rect(4, 20, 7, 30, 'B');                               // arm, clear of torso
  half.rectIn(4, 25, 7, 30, 'C');
  half.rect(3, 30, 9, 36, 'C');                               // gauntlet
  half.rectIn(3, 30, 5, 36, 'B');
  half.rect(10, 31, 20, 37, 'C');                             // leg
  half.rect(8, 37, 20, 42, 'B');                              // sabaton
  half.rectIn(8, 37, 13, 42, 'C');
  half.outline();
  half.crop();

  // sword: unchanged from the version that read well. A separate part overlapping the
  // gauntlet so it reads as held rather than floating beside the figure.
  const sword = part(12, 44, c => {
    c.poly([[4, 2], [8, 0], [9, 32], [3, 32]], 'L');
    c.polyIn([[5, 4], [7, 2], [7, 30], [5, 30]], 'W');
    c.rect(1, 31, 10, 34, 'Y');       // crossguard
    c.rect(4, 34, 7, 42, 'A');        // grip
  });

  const c = new Canvas(70, 44);
  c.blit(half, 6, 0);
  half.mirrorInto(c, 6, 0);
  c.blit(sword, 34, 0);
  return c.crop();
}

// ---- The Dragon --------------------------------------------------------
// Head, neck, and wings spread to both edges. The only boss that uses the full
// 78-wide grid, which is what makes it feel like the biggest thing in the game.
function dragon() {
  // A head-and-shoulders portrait, not a whole body. At 78x44 a full dragon with
  // two spread wings turns into a symmetric blob; a profile head reads instantly.
  // The single raised wing behind it supplies the width.
  const wing = part(30, 32, c => {
    c.poly([[2, 26], [10, 2], [22, 8], [15, 13], [20, 20], [9, 19], [0, 28]], 'T');
    c.polyIn([[3, 24], [10, 5], [19, 9], [13, 13], [17, 18], [9, 17], [2, 26]], 'R');
    c.limbIn(2, 26, 10, 2, 0.9, 'K');
    c.limbIn(10, 2, 22, 8, 0.9, 'K');
    c.limbIn(15, 13, 20, 20, 0.9, 'K');
    c.limbIn(9, 19, 0, 28, 0.9, 'K');
  });
  // Neck: a short thick column directly under the back of the skull. An angled or
  // elongated neck just draws a diagonal streak across the empty lower half.
  const neck = part(30, 26, c => {
    c.taper(20, 0, 16, 22, 8, 13, 'N');
    for (let i = 0; i < 3; i++) c.rectIn(12 + i * 2, 8 + i * 5, 15 + i * 2, 10 + i * 5, 'E');
  });
  const head = part(46, 30, c => {
    // skull mass at the left of the part
    c.ell(14, 12, 11, 9, 'N');
    // UPPER jaw: tapers to a narrow snout tip. Drawn as its own wedge rather than a
    // rectangle, so the profile narrows the way a reptile's does.
    c.poly([[20, 6], [40, 10], [44, 13], [40, 16], [20, 17]], 'N');
    c.polyIn([[21, 8], [38, 11], [41, 13], [38, 14], [21, 15]], 'E');
    // LOWER jaw, shorter and set below, leaving a black mouth gap between the two
    c.poly([[22, 19], [38, 19], [36, 23], [24, 23]], 'N');
    c.polyIn([[23, 20], [36, 20], [35, 22], [25, 22]], 'T');
    c.rect(21, 17, 40, 18, 'K');                    // the mouth gap
    // teeth hanging from the upper jaw into the gap
    for (let i = 0; i < 6; i++) c.set(24 + i * 3, 18, 'W');
    // horns swept back over the skull
    c.poly([[11, 5], [0, 0], [5, 8]], 'L');
    c.poly([[19, 4], [15, 0], [23, 6]], 'L');
    c.poly([[9, 9], [1, 7], [7, 12]], 'L');
    // crest spikes down the back of the skull
    for (let i = 0; i < 4; i++) c.poly([[6 - i, 16 + i], [0, 14 + i], [6 - i, 19 + i]], 'T');
    // eye socket + glowing eye, and a nostril near the snout tip
    c.ellIn(18, 10, 3, 2.4, 'T');
    c.ellIn(18, 10, 1.6, 1.2, 'O');
    c.set(18, 10, 'K');
    c.ellIn(39, 12, 1.2, 1, 'K');
  });

  const c = new Canvas(78, 44);
  c.blit(wing, 0, 2);
  c.blit(neck, 0, 14);
  c.blit(head, 10, 0);
  return c.crop();
}

// ---- Lich --------------------------------------------------------------
// Skeletal, crowned, robed, hovering slightly. Skull face is the focal point.
function lich() {
  // Skull-first: the face is the focal point, so it is drawn LAST and sits clear of
  // the hood. The robe is a narrow A-line, not a wide cone -- a cone at this aspect
  // ratio swallows the whole lower half of the frame.
  const robe = part(40, 30, c => {
    c.poly([[13, 0], [27, 0], [38, 29], [2, 29]], 'V');
    c.polyIn([[20, 0], [27, 0], [38, 29], [22, 29]], 'U');
    c.rectIn(13, 1, 27, 2, 'O');                 // collar trim
    c.limbIn(18, 4, 12, 28, 0.6, 'U');           // folds
    c.limbIn(23, 4, 29, 28, 0.6, 'U');
  });
  const armL = part(16, 20, c => {                // bony arm, raised
    c.taper(13, 18, 5, 4, 2, 1.4, 'W');
    c.ell(4, 3, 2, 2, 'W');
  });
  const armR = armL.flipX();
  const hand = part(12, 14, c => {                 // green soul-flame in the right hand
    c.ell(6, 6, 3, 4, 'E');
    c.ell(6, 7, 1.4, 2, 'L');
    c.limb(4, 9, 6, 12, 0.8, 'E');
  });
  const hood = part(28, 26, c => {
    c.ell(14, 15, 13, 11, 'U');
    c.polyIn([[2, 24], [14, 4], [26, 24]], 'V');   // cowl opening
    c.polyIn([[2, 24], [8, 8], [10, 24]], 'U');    // fold
  });
  const skull = part(22, 22, c => {
    c.ell(11, 10, 8.5, 9, 'W');
    c.poly([[5, 15], [17, 15], [15, 21], [7, 21]], 'W');  // jaw
    c.ellIn(7.5, 9, 3, 3.4, 'K');                         // sockets
    c.ellIn(14.5, 9, 3, 3.4, 'K');
    c.ellIn(7.5, 9, 1.4, 1.8, 'T');                       // red pinpricks
    c.ellIn(14.5, 9, 1.4, 1.8, 'T');
    c.polyIn([[10, 13], [12, 13], [11, 16]], 'K');         // nose hole
    for (let i = 0; i < 4; i++) c.set(8 + i * 2, 18, 'K'); // teeth gaps
  });
  const crown = part(26, 10, c => {
    c.poly([[2, 9], [24, 9], [22, 4], [18, 8], [13, 3], [8, 8], [4, 4]], 'O');
    c.rectIn(2, 8, 24, 9, 'Y');
  });

  const c = new Canvas(52, 44);
  c.blit(robe, 6, 16);
  c.blit(armL, 2, 12);
  c.blit(armR, 34, 12);
  c.blit(hand, 40, 3);
  c.blit(hood, 12, 2);
  c.blit(skull, 15, 7);
  c.blit(crown, 13, 0);
  return c.crop();
}

// ---- Void Herald -------------------------------------------------------
// No body, just a void, a mask, and reaching tendrils. Reads as a rift.
function voidHerald() {
  // No body. A rift, a mask floating in it, and four tendrils. Built as parts so the
  // tendrils pass BEHIND the mask instead of being drawn into the same canvas.
  const void0 = part(44, 44, c => {
    c.ell(22, 22, 21, 20, 'V');
    c.ell(22, 22, 17, 16, 'K');        // the dark core
    for (const [x, y] of [[10, 14], [30, 12], [16, 30], [32, 28], [22, 8], [8, 24]]) c.set(x, y, 'W');
  });
  const tendril = part(28, 44, c => {
    c.taper(24, 22, 6, 4, 3, 0.6, 'V');
    c.taper(24, 24, 8, 40, 2.6, 0.6, 'V');
  });
  const mask = part(30, 34, c => {
    c.ell(15, 17, 12, 15, 'W');
    c.ellIn(15, 17, 9, 12, 'L');
    c.polyIn([[7, 15], [13, 16], [13, 18], [7, 17]], 'K');   // slit eyes
    c.polyIn([[23, 15], [17, 16], [17, 18], [23, 17]], 'K');
    c.polyIn([[12, 24], [15, 22], [18, 24], [15, 26]], 'K'); // mouth
    c.ellIn(9, 9, 2, 2, 'U'); c.ellIn(21, 9, 2, 2, 'U');     // sigils
  });
  const horn = part(14, 18, c => { c.poly([[7, 17], [0, 0], [12, 15]], 'U'); });

  const c = new Canvas(72, 44);
  c.blit(tendril, 0, 0);
  c.blit(tendril.flipX(), 44, 0);
  c.blit(void0, 14, 0);
  c.blit(horn, 8, 0); c.blit(horn.flipX(), 50, 0);
  c.blit(mask, 21, 5);
  return c.crop();
}

// ---- God ---------------------------------------------------------------
// The last one. Halo, mantle, a seated geometric calm. Symmetric, gold + white.
function godPortrait() {
  // An old man: white mane, long white beard, weathered face. The beard is the whole
  // silhouette -- it is what separates him from every other humanoid here, since the
  // head, hair and beard are the only three shapes that matter at this size.
  // Built as a mirrored half so he is exactly symmetric, and calm where the others
  // are not: no raised weapon, no spread limbs, just the beard falling.
  const half = new Canvas(25, 44);
  // hair: a full mane behind and above the face
  half.ell(17, 9, 8, 9, 'W');
  half.ell(11, 14, 5, 6, 'W');
  // face, set into the mane
  half.ell(17, 11, 5.5, 6.5, 'F');
  half.ellIn(17, 8, 4, 2, 'D');            // brow, heavy with age
  half.rectIn(14, 11, 15, 12, 'K');        // eyes, narrowed
  half.rectIn(19, 11, 20, 12, 'K');
  half.limbIn(13, 15, 16, 15, 0.5, 'D');   // cheek lines
  half.limbIn(21, 15, 18, 15, 0.5, 'D');
  half.rectIn(16, 17, 18, 17, 'D');        // mouth line
  // beard: wide at the jaw, falling to a point -- the dominant shape
  half.poly([[11, 14], [24, 14], [24, 22], [20, 33], [14, 30], [11, 21]], 'W');
  half.polyIn([[15, 17], [24, 17], [24, 22], [20, 31], [16, 28]], 'L');
  half.limbIn(18, 19, 20, 29, 0.6, 'D');
  half.limbIn(21, 18, 22, 26, 0.6, 'D');
  // robe
  half.poly([[3, 24], [24, 24], [24, 44], [0, 44]], 'W');
  half.polyIn([[3, 24], [8, 24], [8, 44], [0, 44]], 'L');
  half.ell(7, 26, 5, 4, 'W');             // shoulder
  half.rectIn(3, 24, 24, 25, 'O');         // gold trim
  half.limbIn(11, 28, 8, 42, 0.6, 'L');   // folds
  half.ell(4, 32, 3, 2.5, 'W');           // hand resting on the robe
  half.outline();
  half.crop();

  const c = new Canvas(78, 44);
  c.blit(half, 12, 0);
  half.mirrorInto(c, 12, 0);
  return c.crop();
}

// =====================================================================
const BUILDERS = {
  'Rat Swarm': () => {
    // One large rat centre-frame, everything else reduced to heads arcing along the
    // bottom edge. Earlier attempts used a second full-body rat, but at that scale its
    // limbs merged with the leader's and neither read. Heads are unambiguous at 15px.
    // Minimum scale is 0.75: below that the 2px eye and its glint are lost.
    const c = new Canvas(W, H);
    c.blit(ratFigure(1.0, true).crop(), 22, 2);
    c.blit(ratHead(0.85).crop(), 5, 24);
    c.blit(ratHead(0.80).crop(), 20, 30);
    c.blit(ratHead(0.78).crop(), 36, 33);
    c.blit(ratHead(0.80).crop(), 52, 29);
    c.blit(ratHead(0.75).crop(), 64, 20);
    return c;
  },
  'Cave Troll': caveTroll,
  'Bandit Chief': banditChief,
  'Rock Golem': rockGolem,
  'Swamp Hag': swampHag,
  'Iron Sentinel': ironSentinel,
  'The Dragon': dragon,
  'Lich': lich,
  'Void Herald': voidHerald,
  'God': godPortrait,
};

// `node figures.js` prints an ASCII proof of every figure, which is the fast way to
// judge a silhouette without opening a browser. `node figures.js "Lich"` narrows it.
const only = process.argv[2];
if (require.main === module) {
  for (const [name, build] of Object.entries(BUILDERS)) {
    if (only && name !== only) continue;
    const fig = build();
    const c = new Canvas(W, H);
    c.blit(fig, Math.round((W - fig.w) / 2), Math.round((H - fig.h) / 2));
    const v = validate(c, name);
    const runs = toRuns(c);
    const b = c.bounds();
    console.log(`\n=== ${name} === art ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}  ` +
                `runs=${runs.length}  problems=${v.problems.length}`);
    if (v.problems.length) console.log('  ' + v.problems.slice(0, 5).join('\n  '));
    console.log(process.env.A ? toAnsi(c) : toAscii(c));
  }
}

module.exports = { BUILDERS, W, H };
