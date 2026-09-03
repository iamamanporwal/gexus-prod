// The GEXUS letterforms, defined once and shared by every generator.
//
// The mark is typography only — no emblem. Each glyph is drawn as a uniform
// stroke on a 100x100 grid whose centrelines run 6.5..93.5, so a 13-unit
// stroke lands its outer edge exactly on the box. Arcs are true circles
// (r = 43.5) rather than eyeballed beziers, which is what gives the set its
// geometric, single-radius feel and lets the same numbers drive the SVG paths,
// the PNG rasteriser and the 3D point cloud without any of them drifting apart.

export const BOX = 100; // glyph box: cap height and advance width
export const INSET = 6.5; // stroke centreline inset from the box edge
export const R = 43.5; // the one radius the whole alphabet is built from
export const STROKE = 13; // wordmark stroke weight
export const MARK_STROKE = 16; // monogram: heavier, to survive a 16px favicon
export const TRACKING = 32; // gap between glyph boxes (~0.2em of tracking)

const LO = INSET; // 6.5
const HI = BOX - INSET; // 93.5
const MID = BOX / 2; // 50
const E_MID_BAR = HI - 9; // the middle bar sits a touch short, as E's do

const rad = (deg) => (deg * Math.PI) / 180;

// G: a three-quarter circle opened across the right quadrant, with the jaw —
// a short vertical spur and the crossbar — filling that opening. The spur is
// what separates a G from an e: without it the bowl just closes onto the bar.
const G_OPEN_DEG = 45; // half the opening, measured either side of the right
const G_JAW_X = MID + R * Math.cos(rad(G_OPEN_DEG));
const G_JAW_Y = MID + R * Math.sin(rad(G_OPEN_DEG));
const G_BAR_END = 52; // how far the crossbar reaches back into the bowl

// S: two bowls stacked and joined at the waist, each half the cap height.
//
// The bowls are ellipses, not circles. Circles would tie the bowl width to
// half the height — a 43.5-wide S next to four 100-wide glyphs — and to reach
// terminals from that narrow a bowl each arc has to wrap so far round that it
// closes into a ring, so the letter reads as two stacked o's. Widening the
// bowls to the full box keeps them flat and open, which is what makes an S an
// S: the arcs still sweep 300 degrees of parameter, but across a 2:1 ellipse
// that lands the terminals tucked under the shoulder where they belong.
const S_RX = R; // 43.5 — same width as every other glyph
const S_RY = R / 2; // 21.75 — two bowls stack to the full cap height
const S_TOP_CY = LO + S_RY; // 28.25
const S_BOT_CY = HI - S_RY; // 71.75
// Each terminal stops just *above* its bowl's own axis, which leaves the whole
// bottom-right quadrant of the top bowl (and top-left of the bottom bowl) open
// for the waist to sweep through. Putting it below the axis instead is what
// makes an S close up into a ring.
const S_TERMINAL_DEG = 20; // how far above the horizontal each terminal stops
const S_START = [
  MID + S_RX * Math.cos(rad(-S_TERMINAL_DEG)),
  S_TOP_CY + S_RY * Math.sin(rad(-S_TERMINAL_DEG)),
];
const S_END = [
  MID + S_RX * Math.cos(rad(180 - S_TERMINAL_DEG)),
  S_BOT_CY + S_RY * Math.sin(rad(180 - S_TERMINAL_DEG)),
];

const f = (n) => Number(n.toFixed(2));

/**
 * SVG path data per glyph, each in its own 100x100 box.
 */
export const GLYPH_PATHS = {
  G:
    `M${f(G_JAW_X)} ${f(BOX - G_JAW_Y)}A${R} ${R} 0 1 0 ${f(G_JAW_X)} ${f(G_JAW_Y)}` +
    `V${MID}H${G_BAR_END}`,
  E: `M${LO} ${LO}H${HI}M${LO} ${MID}H${E_MID_BAR}M${LO} ${HI}H${HI}M${LO} ${LO}V${HI}`,
  X: `M${LO} ${LO}L${HI} ${HI}M${HI} ${LO}L${LO} ${HI}`,
  U: `M${LO} ${LO}V${MID}A${R} ${R} 0 0 0 ${HI} ${MID}V${LO}`,
  S:
    `M${f(S_START[0])} ${f(S_START[1])}` +
    `A${S_RX} ${S_RY} 0 1 0 ${MID} ${MID}` +
    `A${S_RX} ${S_RY} 0 1 1 ${f(S_END[0])} ${f(S_END[1])}`,
};

export const WORD = ['G', 'E', 'X', 'U', 'S'];

/** x offset of glyph `i`'s box within the wordmark. */
export const glyphOffset = (i) => i * (BOX + TRACKING);

export const WORDMARK_WIDTH = glyphOffset(WORD.length - 1) + BOX;

// ---------------------------------------------------------------------------
// The same shapes again, but as primitives that can be measured rather than
// only drawn — the PNG rasteriser needs a distance field and the point cloud
// needs to walk along each stroke.
//
// A segment is {a:[x,y], b:[x,y]}. An arc is {c:[x,y], r, from, to} covering
// the angles from..to in degrees, where the point at angle t sits at
// (cx + r*cos t, cy + r*sin t) with y pointing DOWN — so 0 is the right of the
// circle, 90 the bottom, 180 the left, 270 the top. Ranges may run past 360;
// only the span matters, not the direction a pen would travel it.
// ---------------------------------------------------------------------------

export const GLYPH_SHAPES = {
  G: [
    // Everything but the wedge across the right, where the jaw goes.
    { c: [MID, MID], r: R, from: G_OPEN_DEG, to: 360 - G_OPEN_DEG },
    { a: [G_JAW_X, G_JAW_Y], b: [G_JAW_X, MID] },
    { a: [G_JAW_X, MID], b: [G_BAR_END, MID] },
  ],
  E: [
    { a: [LO, LO], b: [HI, LO] },
    { a: [LO, MID], b: [E_MID_BAR, MID] },
    { a: [LO, HI], b: [HI, HI] },
    { a: [LO, LO], b: [LO, HI] },
  ],
  X: [
    { a: [LO, LO], b: [HI, HI] },
    { a: [HI, LO], b: [LO, HI] },
  ],
  U: [
    { a: [LO, LO], b: [LO, MID] },
    { c: [MID, MID], r: R, from: 0, to: 180 },
    { a: [HI, MID], b: [HI, LO] },
  ],
  S: [
    // Each bowl runs from the waist round to its terminal, leaving open the
    // wedge the other bowl's stroke sweeps through.
    {
      c: [MID, S_TOP_CY],
      rx: S_RX,
      ry: S_RY,
      from: 90,
      to: 360 - S_TERMINAL_DEG,
    },
    {
      c: [MID, S_BOT_CY],
      rx: S_RX,
      ry: S_RY,
      from: 270,
      to: 540 - S_TERMINAL_DEG,
    },
  ],
};

/**
 * An arc's radii. Circular arcs carry a single `r`; the S's bowls are ellipses
 * and carry `rx`/`ry`.
 */
export function arcRadii(shape) {
  return { rx: shape.rx ?? shape.r, ry: shape.ry ?? shape.r };
}

/** Shortest distance from a point to a shape primitive. */
export function distanceToShape(shape, x, y) {
  if (shape.a) {
    const [ax, ay] = shape.a;
    const [bx, by] = shape.b;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }

  const [cx, cy] = shape.c;
  const { rx, ry } = arcRadii(shape);

  if (rx !== ry) {
    // No closed form for point-to-ellipse, and none needed: this path only
    // feeds the debug preview, since the rasteriser draws the (circular) G.
    // Walking the arc finely enough is accurate to well under a pixel.
    let best = Infinity;
    const steps = 512;
    for (let s = 0; s <= steps; s++) {
      const t = rad(shape.from + (shape.to - shape.from) * (s / steps));
      best = Math.min(
        best,
        Math.hypot(x - (cx + rx * Math.cos(t)), y - (cy + ry * Math.sin(t))),
      );
    }
    return best;
  }

  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) {
    return rx;
  }

  // Clamp the point's bearing into the arc's angular range; if it already lies
  // within it the answer is the plain radial distance, otherwise the nearest
  // endpoint wins.
  const span = shape.to - shape.from;
  let t = (Math.atan2(dy, dx) * 180) / Math.PI;
  t = (((t - shape.from) % 360) + 360) % 360; // offset from `from`, in [0, 360)
  if (t <= span) {
    return Math.abs(dist - rx);
  }
  const clamped = rad(shape.from + (t - span < 360 - t ? span : 0));
  return Math.hypot(
    x - (cx + rx * Math.cos(clamped)),
    y - (cy + ry * Math.sin(clamped)),
  );
}

/** Shortest distance from a point to the whole word, laid out as the wordmark. */
export function distanceToWord(x, y, word = WORD) {
  let best = Infinity;
  word.forEach((letter, i) => {
    const lx = x - glyphOffset(i);
    for (const shape of GLYPH_SHAPES[letter]) {
      best = Math.min(best, distanceToShape(shape, lx, y));
    }
  });
  return best;
}
