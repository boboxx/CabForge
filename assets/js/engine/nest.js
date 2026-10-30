// Sheet nesting optimizer: lays every part of the job out on stock sheets,
// per material, using as few sheets as possible.
//
// Two packers:
//   'cnc' — MaxRects free nesting (any arrangement a router can cut).
//   'saw' — guillotine packing: every sheet can be cut apart with straight
//           edge-to-edge cuts, as on a panel saw.
// The optimizer runs both packers over many part orders and placement
// rules, then refines the best layout with a seeded random search, so the
// same job always gives the same plan.
//
// Sheet coordinates: x along the sheet length, y across its width, origin
// at the sheet corner. Parts are placed at their cut size. A part's length
// is its grain direction; on a material with grain it stays parallel to the
// sheet length, otherwise it may rotate.
//
// With grouping on, parts of the same size are also tried as strips laid
// side by side (one cut frees the strip, straight cuts part it), and a
// grouped layout wins whenever it needs no more sheets.

import { cutSize } from './part.js';
import { bandThickness, partMaterial } from './model.js';

/** Random-search iterations per effort level (after the fixed strategies). */
export const EFFORT_ITERATIONS = { quick: 0, normal: 800, thorough: 6000 };
/** Offcuts smaller than this on either side aren't reported. */
const MIN_OFFCUT = 100;
/** Hard cap so a huge job can never run away. */
const TIME_CAP_MS = 8000;

// Placement scores: lower is better.
const SCORE = {
  bssf: (f, w, h) => Math.min(f.w - w, f.h - h) * 1e5 + Math.max(f.w - w, f.h - h),
  blsf: (f, w, h) => Math.max(f.w - w, f.h - h) * 1e5 + Math.min(f.w - w, f.h - h),
  baf: (f, w, h) => (f.w * f.h - w * h) * 1e4 + Math.min(f.w - w, f.h - h),
  bl: (f) => f.y * 1e5 + f.x,
};

class MaxRectsSheet {
  constructor(width, height) {
    this.free = [{ x: 0, y: 0, w: width, h: height }];
    this.placed = [];
    this.used = 0;
  }

  find(w, h, allowRotate, rule) {
    let best = null;
    const score = SCORE[rule];
    for (const f of this.free) {
      for (const [bw, bh, rotated] of allowRotate && w !== h ? [[w, h, false], [h, w, true]] : [[w, h, false]]) {
        if (bw > f.w || bh > f.h) continue;
        const sc = score(f, bw, bh);
        if (!best || sc < best.score) best = { x: f.x, y: f.y, w: bw, h: bh, rotated, score: sc };
      }
    }
    return best;
  }

  place(r, item) {
    const next = [];
    for (const f of this.free) {
      if (!(r.x < f.x + f.w && r.x + r.w > f.x && r.y < f.y + f.h && r.y + r.h > f.y)) {
        next.push(f);
        continue;
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // Drop rectangles contained in another (keep one of identical pairs).
    this.free = next.filter(
      (a, i) =>
        !next.some(
          (b, j) =>
            i !== j &&
            a.x >= b.x &&
            a.y >= b.y &&
            a.x + a.w <= b.x + b.w &&
            a.y + a.h <= b.y + b.h &&
            (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || i > j),
        ),
    );
    this.placed.push({ ...r, item });
    this.used += r.w * r.h;
  }
}

class GuillotineSheet {
  constructor(width, height, split) {
    this.free = [{ x: 0, y: 0, w: width, h: height }];
    this.placed = [];
    this.used = 0;
    this.split = split;
  }

  find(w, h, allowRotate, rule) {
    let best = null;
    const score = SCORE[rule];
    this.free.forEach((f, index) => {
      for (const [bw, bh, rotated] of allowRotate && w !== h ? [[w, h, false], [h, w, true]] : [[w, h, false]]) {
        if (bw > f.w || bh > f.h) continue;
        const sc = score(f, bw, bh);
        if (!best || sc < best.score) best = { x: f.x, y: f.y, w: bw, h: bh, rotated, score: sc, index };
      }
    });
    return best;
  }

  place(r, item) {
    const f = this.free[r.index];
    this.free.splice(r.index, 1);
    const [dw, dh] = [f.w - r.w, f.h - r.h];
    // Which way the cut through the leftover runs.
    const horizontal = {
      sas: dw <= dh,
      las: dw > dh,
      minas: r.w * dh > dw * r.h,
      maxas: r.w * dh <= dw * r.h,
    }[this.split];
    const above = { x: f.x, y: f.y + r.h, w: horizontal ? f.w : r.w, h: dh };
    const right = { x: f.x + r.w, y: f.y, w: dw, h: horizontal ? r.h : f.h };
    if (above.w > 0 && above.h > 0) this.free.push(above);
    if (right.w > 0 && right.h > 0) this.free.push(right);
    this.placed.push({ ...r, item });
    this.used += r.w * r.h;
  }
}

const ORDERS = {
  area: (a, b) => b.l * b.w - a.l * a.w,
  longSide: (a, b) => Math.max(b.l, b.w) - Math.max(a.l, a.w) || b.l * b.w - a.l * a.w,
  shortSide: (a, b) => Math.min(b.l, b.w) - Math.min(a.l, a.w) || b.l * b.w - a.l * a.w,
  perimeter: (a, b) => b.l + b.w - (a.l + a.w),
  length: (a, b) => b.l - a.l || b.w - a.w,
  width: (a, b) => b.w - a.w || b.l - a.l,
};

const STRATEGIES = {
  cnc: ['bssf', 'blsf', 'baf', 'bl'].flatMap((rule) => ['first', 'best'].map((fit) => ({ rule, fit }))),
  saw: [
    ['baf', 'sas'],
    ['baf', 'las'],
    ['baf', 'minas'],
    ['bssf', 'sas'],
    ['bssf', 'minas'],
    ['blsf', 'las'],
    ['blsf', 'maxas'],
  ].flatMap(([rule, split]) => ['first', 'best'].map((fit) => ({ rule, split, fit }))),
};

/** One packing pass with a fixed part order and strategy. */
function pack(order, strategy, ctx) {
  const sheets = [];
  const unplaced = [];
  const newSheet = () =>
    ctx.mode === 'saw' ? new GuillotineSheet(ctx.width, ctx.height, strategy.split) : new MaxRectsSheet(ctx.width, ctx.height);
  for (const item of order) {
    let target = null;
    for (const sheet of sheets) {
      const spot = sheet.find(item.l, item.w, !ctx.grain, strategy.rule);
      if (spot && (!target || spot.score < target.spot.score)) {
        target = { sheet, spot };
        if (strategy.fit === 'first') break;
      }
    }
    if (!target) {
      const sheet = newSheet();
      const spot = sheet.find(item.l, item.w, !ctx.grain, strategy.rule);
      if (!spot) {
        unplaced.push(item);
        continue;
      }
      sheets.push(sheet);
      target = { sheet, spot };
    }
    target.sheet.place(target.spot, item);
  }
  // Cost, compared lexicographically: unplaced parts, sheets, pieces to
  // place when grouping (fewer = more parts in strips), then the area used on
  // the least-used sheet (smaller = one bigger offcut left over).
  const leastUsed = sheets.reduce((m, s) => Math.min(m, s.used), Infinity);
  const unplacedParts = unplaced.reduce((n, b) => n + b.members.length, 0);
  return { sheets, unplaced, cost: [unplacedParts, sheets.length, ctx.group ? order.length : 0, sheets.length ? leastUsed : 0] };
}

const better = (a, b) => {
  for (let i = 0; i < a.cost.length; i++) if (a.cost[i] !== b.cost[i]) return a.cost[i] < b.cost[i];
  return false;
};

/** Small seeded PRNG (mulberry32) so layouts are repeatable. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(items) {
  let hsh = 2166136261;
  for (const it of items) {
    for (const v of [it.l, it.w]) hsh = Math.imul(hsh ^ Math.round(v * 10), 16777619);
  }
  return hsh;
}

const sizeKey = (p) => `${Math.round(p.l * 10)}x${Math.round(p.w * 10)}`;

/**
 * Pieces to pack: every part on its own, or with `dir` set, parts of the
 * same size as strips of up to `cap` laid side by side across the sheet
 * ('y': widths side by side) or along it ('x': lengths end to end).
 * A piece is { i, l, w, members, dir }.
 */
function pieces(parts, ctx, dir = null, cap = Infinity) {
  if (!dir) return parts.map((p) => ({ i: p.i, l: p.l, w: p.w, members: [p], dir: null }));
  const bySize = new Map();
  for (const p of parts) {
    if (!bySize.has(sizeKey(p))) bySize.set(sizeKey(p), []);
    bySize.get(sizeKey(p)).push(p);
  }
  const out = [];
  for (const same of bySize.values()) {
    const { l, w } = same[0];
    const step = dir === 'y' ? w : l;
    // Longest strip that fits the sheet, either way round without grain.
    const room = ctx.grain ? (dir === 'y' ? ctx.height : ctx.width) : Math.max(ctx.width, ctx.height);
    const k = Math.min(cap, Math.floor(room / step + 1e-9), same.length);
    if (k < 2) {
      out.push(...pieces(same, ctx));
      continue;
    }
    // Even strips: 6 parts in strips of up to 4 make 3 + 3, not 4 + 2.
    const n = Math.ceil(same.length / k);
    let at = 0;
    for (let s = 0; s < n; s++) {
      const size = Math.floor(same.length / n) + (s < same.length % n ? 1 : 0);
      const members = same.slice(at, (at += size));
      out.push({ i: members[0].i, l: dir === 'x' ? l * size : l, w: dir === 'y' ? w * size : w, members, dir });
    }
  }
  return out;
}

/**
 * Nests one material's parts. `items` are { length, width, ...info } at cut
 * size. Options: sheetLength, sheetWidth, kerf, trim, grain, mode ('cnc' |
 * 'saw'), effort ('quick' | 'normal' | 'thorough'), group (strips of
 * same-size parts).
 *
 * Returns { sheets: [{ parts: [{ ...info, length, width, x, y, sizeX, sizeY,
 * rotated, number }], used, offcut: { length, width } }], unplaced }.
 */
export function nestItems(
  items,
  { sheetLength, sheetWidth, kerf = 0, trim = 0, grain = false, mode = 'cnc', effort = 'normal', group = false },
) {
  // Each part reserves a kerf on its far sides; the usable area grows by one
  // kerf so a part may finish exactly at the trim line.
  const ctx = { width: sheetLength - 2 * trim + kerf, height: sheetWidth - 2 * trim + kerf, grain, mode, group };
  const parts = items.map((item, i) => ({ i, item, l: item.length + kerf, w: item.width + kerf }));
  const pools = [pieces(parts, ctx)];
  if (group) {
    for (const dir of ['y', 'x']) for (const cap of [Infinity, 4, 2]) pools.push(pieces(parts, ctx, dir, cap));
  }

  let best = null;
  const consider = (order, strategy) => {
    const res = pack(order, strategy, ctx);
    if (!best || better(res, best)) best = { ...res, order, strategy };
  };
  for (const pool of pools) {
    for (const cmp of Object.values(ORDERS)) {
      const order = [...pool].sort((a, b) => cmp(a, b) || a.i - b.i);
      for (const strategy of STRATEGIES[mode]) consider(order, strategy);
    }
  }

  // Refine: perturb the best order (swap a few parts, sometimes switch rule).
  const random = rng(seedOf(parts));
  const strategies = STRATEGIES[mode];
  const iterations = EFFORT_ITERATIONS[effort] ?? EFFORT_ITERATIONS.normal;
  const stop = (globalThis.performance?.now() ?? Date.now()) + TIME_CAP_MS;
  for (let n = 0; n < iterations && best.order.length > 1; n++) {
    if ((globalThis.performance?.now() ?? Date.now()) > stop) break;
    const order = [...best.order];
    const swaps = 1 + Math.floor(random() * 3);
    for (let k = 0; k < swaps; k++) {
      const a = Math.floor(random() * order.length);
      const b = Math.floor(random() * order.length);
      [order[a], order[b]] = [order[b], order[a]];
    }
    const strategy = random() < 0.7 ? best.strategy : strategies[Math.floor(random() * strategies.length)];
    consider(order, strategy);
  }

  const sheetArea = sheetLength * sheetWidth;
  let number = 0;
  return {
    sheets: best.sheets.map((s) => {
      // Unpack strips into their parts, numbered in order so identical parts
      // run consecutively.
      const parts = s.placed.flatMap((r) => {
        // Strips stack across the sheet ('y') unless laid end to end; rotating swaps that.
        const alongY = (r.item.dir === 'y') !== r.rotated;
        return r.item.members.map((m, j) => {
          const [sx, sy] = r.rotated ? [m.w, m.l] : [m.l, m.w];
          return {
            ...m.item,
            x: r.x + (alongY ? 0 : j * sx) + trim,
            y: r.y + (alongY ? j * sy : 0) + trim,
            // Footprint on the sheet (swapped when rotated).
            sizeX: sx - kerf,
            sizeY: sy - kerf,
            rotated: r.rotated,
            number: ++number,
          };
        });
      });
      // Largest leftover worth keeping (both sides at least MIN_OFFCUT).
      const offcut = s.free
        .filter((f) => f.w - kerf >= MIN_OFFCUT && f.h - kerf >= MIN_OFFCUT)
        .reduce((m, f) => (f.w * f.h > m.w * m.h ? f : m), { w: 0, h: 0 });
      return {
        parts,
        used: parts.reduce((a, p) => a + p.length * p.width, 0) / sheetArea,
        offcut: { length: Math.max(0, offcut.w - kerf), width: Math.max(0, offcut.h - kerf) },
      };
    }),
    unplaced: best.unplaced.flatMap((b) => b.members.map((m) => m.item)),
  };
}

/**
 * Groups the built cabinets' parts by library material, ready for nesting:
 * [{ material, items: [{ length, width, name, cabinet }] }].
 */
export function nestGroups(cabinets, c) {
  const groups = new Map();
  for (const cab of cabinets) {
    for (const part of cab.parts) {
      const mat = partMaterial(c, part);
      if (!mat) continue;
      const [length, width] = cutSize(part, bandThickness(c, part));
      if (!groups.has(mat.id)) groups.set(mat.id, { material: mat, items: [] });
      groups.get(mat.id).items.push({ length, width, name: part.name, cabinet: cab.name });
    }
  }
  return [...groups.values()].sort((a, b) => a.material.id - b.material.id);
}

/** Nests one material group with the job's nesting settings. */
export function nestGroup({ material, items }, nesting) {
  const result = nestItems(items, {
    sheetLength: material.sheetLength,
    sheetWidth: material.sheetWidth,
    kerf: nesting.kerf,
    trim: nesting.trim,
    grain: material.grain,
    mode: nesting.mode,
    effort: nesting.effort,
    group: nesting.group,
  });
  const placedArea = result.sheets.reduce((a, s) => a + s.used, 0);
  return {
    material,
    ...result,
    partCount: items.length,
    // Share of the used sheets covered by parts.
    yield: result.sheets.length ? placedArea / result.sheets.length : 0,
  };
}

/** Nests every part of the built cabinets, grouped by library material. */
export function nestJob(cabinets, c) {
  const nesting = { kerf: 0, trim: 0, mode: 'cnc', effort: 'normal', ...c.nesting };
  return nestGroups(cabinets, c).map((g) => nestGroup(g, nesting));
}
