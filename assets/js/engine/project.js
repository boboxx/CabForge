// A job: construction standards, the room (walls and islands, see room.js)
// and the cabinets standing in it.

import { buildCabinet } from './build.js';
import { cutList } from './cutlist.js';
import { defaultConstruction, drawerBase, effectiveConstruction, endPanelThickness, hasPlinth, materialById, newCabinet, panelWidth, runOf } from './model.js';
import { bandEdges, box } from './part.js';
import { defaultRoom, locationOf, locations, placement, reversed } from './room.js';

/** A job with no cabinets. */
export function emptyProject(construction = defaultConstruction()) {
  return { id: null, name: 'New kitchen', construction, room: defaultRoom(), cabinets: [], nextId: 1 };
}

/** A sample job: drawer base, base, two wall cabinets and a tall one. */
export function newProject(construction = defaultConstruction()) {
  const p = emptyProject(construction);
  addCabinet(p, drawerBase(0, 3));
  addCabinet(p, newCabinet('base'));
  addCabinet(p, newCabinet('wall'));
  addCabinet(p, newCabinet('wall'));
  addCabinet(p, newCabinet('tall'));
  return p;
}

// Runs: at each wall or island, base cabinets form the lower run, wall
// cabinets the upper run, and tall cabinets occupy both. A filler belongs to
// the run it was made for.
const sharesRun = (a, b) => a === 'tall' || b === 'tall' || a === b;

/** The id of the wall or island a cabinet stands at. */
export function atOf(p, spec) {
  return locationOf(p, spec).id;
}

/** Whether two cabinets stand in the same run at the same wall or island. */
function sameRun(p, a, b) {
  return sharesRun(runOf(a), runOf(b)) && atOf(p, a) === atOf(p, b);
}

/** Left edge of the case for a cabinet placed after `before` in its run.
 *  End panels take up room on either side of the case. A corner cabinet
 *  stands in the corner at the end of its wall (or after the run, if that
 *  is already longer). */
function nextX(p, before, spec) {
  const right = before
    .filter((c) => sameRun(p, spec, c))
    .reduce((max, c) => Math.max(max, c.x + c.width + endPanelThickness(p.construction, c, 'right')), runStart(p, spec));
  const x = right + endPanelThickness(p.construction, spec, 'left');
  const loc = locationOf(p, spec);
  return spec.corner && loc.kind === 'wall' ? Math.max(x, loc.length - spec.width - standOff(p, spec)) : x;
}

/** Right edge of the case for a cabinet placed before `after` in its run,
 *  lining up from the end of the wall: against the next cabinet, or the
 *  corner cabinet at the end. The mirror of nextX. */
function prevX(p, after, spec) {
  const loc = locationOf(p, spec);
  if (spec.corner) return loc.length - spec.width - standOff(p, spec);
  const left = after
    .filter((c) => sameRun(p, spec, c))
    .reduce((min, c) => Math.min(min, c.x - endPanelThickness(p.construction, c, 'left')), loc.length);
  return left - endPanelThickness(p.construction, spec, 'right') - spec.width;
}

/**
 * How far a corner cabinet stands off both walls: its own setting, or so
 * its fronts line up with the run's cabinets (a 590 corner base among 600
 * deep cabinets stands 10 off, room to deal with an uneven corner). 0 for
 * other cabinets.
 */
export function standOff(p, spec) {
  if (!spec.corner) return 0;
  if (spec.corner.standOff != null) return spec.corner.standOff;
  const size = p.construction.cabinetSizes?.[spec.kind];
  return Math.max(0, (size?.depth ?? spec.depth) - spec.depth);
}

/** Maps the cabinet's space to world space (room.js placement). */
export function cabinetPlacement(p, spec) {
  return placement(locationOf(p, spec), spec, standOff(p, spec));
}

/**
 * Whether a wall's cabinets line up from its end (right to left) rather
 * than its start: its `from` setting, or on 'auto' when a corner cabinet
 * stands at its end and none returns onto its start.
 */
export function fromEnd(p, loc) {
  if (loc.kind !== 'wall') return false;
  const from = loc.wall.from ?? 'auto';
  if (from !== 'auto') return from === 'end';
  const here = p.cabinets.filter((c) => atOf(p, c) === loc.id);
  return here.some((c) => c.corner) && !here.some((c) => runStart(p, c) > 0);
}

/** Whether a change to one cabinet at `loc` re-places all of them: when
 *  they line up from its end, or fill it backwards (room.js reversed). */
const relaysAll = (p, loc) => fromEnd(p, loc) || reversed(loc);

/** Where a run starts along its wall: after the return of a corner cabinet
 *  on the wall before (see build.js, corner cabinets), otherwise at 0. */
export function runStart(p, spec) {
  const loc = locationOf(p, spec);
  if (loc.kind !== 'wall' || loc.index === 0 || loc.wall.turn !== 'inside') return 0;
  const prev = locations(p)[loc.index - 1];
  return p.cabinets
    .filter((c) => c.corner && atOf(p, c) === prev.id && sharesRun(runOf(spec), runOf(c)))
    .reduce((max, c) => Math.max(max, c.corner.return + standOff(p, c)), 0);
}

function assignId(p, spec) {
  spec.id = p.nextId++;
  if (spec.name.endsWith(' 0')) spec.name = `${spec.name.slice(0, -2)} ${spec.id}`;
}

/** Adds a cabinet with a fresh id at the end of its run. Returns its index. */
export function addCabinet(p, spec) {
  assignId(p, spec);
  spec.at ??= locations(p)[0].id;
  spec.x = nextX(p, p.cabinets, spec);
  p.cabinets.push(spec);
  // Lining up from the wall's end (or filling a reversed island row) moves the others along.
  if (relaysAll(p, locationOf(p, spec))) relayout(p);
  return p.cabinets.length - 1;
}

/**
 * Re-places every cabinet in list order, each run closed up: left to right
 * from the start of its wall, or (fromEnd) right to left from the corner at
 * its end, the list order still reading left to right.
 */
export function relayout(p) {
  syncPanels(p);
  const ends = new Set(locations(p).filter((l) => fromEnd(p, l)).map((l) => l.id));
  const backwards = (spec) => ends.has(atOf(p, spec));
  // Reversed island rows fill from their start in reverse list order.
  const rev = new Set(locations(p).filter(reversed).map((l) => l.id));
  p.cabinets.forEach((spec, i) => {
    if (!backwards(spec) && !rev.has(atOf(p, spec))) spec.x = nextX(p, p.cabinets.slice(0, i), spec);
  });
  for (let i = p.cabinets.length - 1; i >= 0; i--) {
    const spec = p.cabinets[i];
    if (rev.has(atOf(p, spec))) spec.x = nextX(p, p.cabinets.slice(i + 1), spec);
  }
  // Corners first, then the rest from the last in the list back.
  const corners = p.cabinets.filter((c) => c.corner && backwards(c));
  for (const spec of corners) spec.x = prevX(p, [], spec);
  for (let i = p.cabinets.length - 1; i >= 0; i--) {
    const spec = p.cabinets[i];
    if (backwards(spec) && !spec.corner) spec.x = prevX(p, [...corners, ...p.cabinets.slice(i + 1).filter((c) => !c.corner)], spec);
  }
}

/** Keeps each standing panel as wide as its front material is thick (the
 *  material or its thickness may have changed). True if any changed. */
function syncPanels(p) {
  let changed = false;
  p.cabinets.forEach((spec, i) => {
    if (!spec.panel) return;
    const w = panelWidth(effectiveConstruction(jobFor(p, i), spec.overrides));
    if (w > 0 && w !== spec.width) [spec.width, changed] = [w, true];
  });
  return changed;
}

/** Inserts a cabinet (or filler) at `index` and closes up the runs. */
export function insertCabinet(p, spec, index) {
  assignId(p, spec);
  spec.at ??= p.cabinets[index - 1]?.at ?? locations(p)[0].id;
  p.cabinets.splice(index, 0, spec);
  relayout(p);
  return index;
}

/** Moves the cabinet at `from` to `to` in the list and re-lays the wall. */
export function moveCabinet(p, from, to) {
  if (from === to || !p.cabinets[from] || to < 0 || to >= p.cabinets.length) return;
  const [spec] = p.cabinets.splice(from, 1);
  p.cabinets.splice(to, 0, spec);
  relayout(p);
}

/** Cabinets laid out in the same run (and at the same wall or island) as
 *  the one at `index`, in list order, as { index, spec }. */
export function runNeighbours(p, index) {
  const me = p.cabinets[index];
  return p.cabinets.flatMap((spec, i) => (i !== index && sameRun(p, me, spec) ? [{ index: i, spec }] : []));
}

/** The id of the cabinet the one at `index` follows in its run, or null at the start. */
export function placedAfter(p, index) {
  return runNeighbours(p, index).filter((n) => n.index < index).pop()?.spec.id ?? null;
}

/** Moves the cabinet at `index` to just after cabinet `afterId` in its run,
 *  or to the start of the run when `afterId` is null. Returns its new index. */
export function placeAfter(p, index, afterId) {
  const neighbours = runNeighbours(p, index);
  let to;
  if (afterId === null) {
    const first = neighbours[0]?.index;
    if (first === undefined) return index;
    to = first > index ? first - 1 : first;
  } else {
    const target = neighbours.find((n) => n.spec.id === afterId)?.index;
    if (target === undefined) return index;
    to = target > index ? target : target + 1;
  }
  moveCabinet(p, index, to);
  return to;
}

// Settings a filler takes from the cabinet beside it, so it matches that
// cabinet's base: no toe kick beside a cabinet without one.
const BASE_KEYS = ['plinth', 'toeKickHeight', 'toeKickSetback', 'toeKickCover'];

/** The cabinet a filler takes its base from: the one it follows in its run,
 *  or the next one when it starts the run. Null for cabinets. */
export function baseSource(p, index) {
  if (p.cabinets[index]?.kind !== 'filler') return null;
  const cabs = runNeighbours(p, index).filter((n) => n.spec.kind !== 'filler' && n.spec.kind !== 'space' && hasPlinth(n.spec));
  return (cabs.filter((n) => n.index < index).pop() ?? cabs.find((n) => n.index > index))?.spec ?? null;
}

/** The construction the cabinet at `index` starts from before its own
 *  overrides: the job's, with a filler's base matched to its cabinet. */
export function jobFor(p, index) {
  const over = baseSource(p, index)?.overrides ?? {};
  const picked = Object.fromEntries(BASE_KEYS.filter((k) => k in over).map((k) => [k, over[k]]));
  return Object.keys(picked).length ? { ...p.construction, ...picked } : p.construction;
}

/** Changes a cabinet's width and slides the cabinets to its right in the
 *  same run by the difference. A shifted tall cabinet carries both runs. */
export function resizeCabinet(p, index, width) {
  const spec = p.cabinets[index];
  if (!spec) return;
  const oldRight = spec.x + spec.width;
  const delta = width - spec.width;
  spec.width = width;
  if (delta === 0) return;
  if (relaysAll(p, locationOf(p, spec))) {
    relayout(p);
    return;
  }
  const run = runOf(spec);
  const here = (c) => atOf(p, c) === atOf(p, spec);
  // Everything right of the leftmost shifted tall cabinet moves regardless of run.
  const tallEdge = p.cabinets
    .filter((c, i) => i !== index && here(c) && runOf(c) === 'tall' && c.x >= oldRight - 0.5)
    .reduce((min, c) => Math.min(min, c.x), Infinity);
  p.cabinets.forEach((c, i) => {
    if (i !== index && here(c) && c.x >= oldRight - 0.5 && (sharesRun(run, runOf(c)) || c.x >= tallEdge - 0.5)) c.x += delta;
  });
  // A corner cabinet's return moves the start of the next wall's runs.
  if (spec.corner) relayout(p);
}

/** One entry per cabinet: { cabinet } or { error }. Plinth rails of
 *  cabinets and fillers standing side by side are joined (joinPlinths). */
export function buildAll(p) {
  if (syncPanels(p)) relayout(p);
  const built = p.cabinets.map((spec, i) => {
    try {
      return { cabinet: buildCabinet(spec, jobFor(p, i)) };
    } catch (e) {
      if (e.name !== 'BuildError') throw e;
      return { error: e.message };
    }
  });
  joinPlinths(p, built);
  return built;
}

// ---- plinths across a run ----------------------------------------------------

/** Longest board the material can give: the sheet length less the trim
 *  (either sheet side when there's no grain). */
export function maxBoardLength(c, materialId) {
  const m = materialById(c, materialId);
  if (!m) return Infinity;
  const usable = m.grain ? m.sheetLength : Math.max(m.sheetLength, m.sheetWidth);
  return usable - 2 * (c.nesting?.trim ?? 0);
}

const RAILS = ['toeKick', 'plinthRear', 'toeKickCover'];
const TOUCH = 0.5;

/** Splits a chain of rail segments (side by side, left to right) into
 *  boards no longer than `max`, breaking only between segments, which are
 *  cabinet edges with cross members under them. A single segment longer
 *  than `max` is cut into equal lengths. Returns [[x0, x1], …]. */
export function splitBoards(segments, max) {
  const spans = segments.flatMap(([x0, x1]) => {
    const n = Math.ceil((x1 - x0) / max - 1e-9);
    return Array.from({ length: n }, (_, k) => [x0 + ((x1 - x0) * k) / n, x0 + ((x1 - x0) * (k + 1)) / n]);
  });
  const boards = [];
  for (const [x0, x1] of spans) {
    const last = boards[boards.length - 1];
    if (last && x1 - last[0] <= max + 1e-6) last[1] = x1;
    else boards.push([x0, x1]);
  }
  return boards;
}

/** Plinth parts with the given roles in world x, grouped by everything else
 *  (role, material, height, depth), each group sorted left to right. */
function plinthLines(p, built, roles) {
  const lines = new Map();
  p.cabinets.forEach((spec, ci) => {
    for (const part of built[ci]?.cabinet?.parts ?? []) {
      if (!roles.includes(part.role)) continue;
      const b = part.bbox;
      if (part.frame) continue; // turned parts of corner cabinets stay as they are
      const key = [atOf(p, spec), part.role, part.materialId, ...[spec.elevation + b.min[1], b.min[2], b.size[1], b.size[2]].map((v) => v.toFixed(1))].join('|');
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ ci, spec, part, x0: spec.x + b.min[0], x1: spec.x + b.min[0] + b.size[0] });
    }
  });
  return [...lines.values()].map((segs) => segs.sort((a, b) => a.x0 - b.x0));
}

/**
 * Joins the plinth fronts / toe kicks (and the rear rails of plinth frames)
 * of cabinets and fillers that stand side by side at the same height, depth
 * and material into single boards, split at cabinet edges where a board
 * would be longer than the material allows. Each board belongs to the
 * cabinet it starts under. Where two cabinets meet, their cross members
 * become one, centred on the joint; a filler at the end of a frame gets one
 * at its open end.
 */
function joinPlinths(p, built) {
  for (const segs of plinthLines(p, built, RAILS)) {
    segs.sort((a, b) => a.x0 - b.x0);
    let chain = [];
    for (const seg of [...segs, null]) {
      const last = chain[chain.length - 1];
      if (seg && (!last || Math.abs(seg.x0 - last.x1) < TOUCH)) {
        chain.push(seg);
        continue;
      }
      joinChain(p, built, chain);
      chain = seg ? [seg] : [];
    }
  }
  // Cross members back to back at a joint: one, centred on it.
  for (const ends of plinthLines(p, built, ['plinthEnd'])) {
    for (let i = 0; i + 1 < ends.length; i++) {
      const [a, b] = [ends[i], ends[i + 1]];
      if (Math.abs(a.x1 - b.x0) >= TOUCH) continue;
      const t = a.part.bbox.size[0];
      const remove = built[b.ci].cabinet.parts;
      remove.splice(remove.indexOf(b.part), 1);
      a.part.bbox = box([a.x1 - t / 2 - a.spec.x, a.part.bbox.min[1], a.part.bbox.min[2]], a.part.bbox.size);
      i++; // b is gone
    }
  }
}

function joinChain(p, built, chain) {
  const first = chain[0];
  const max = maxBoardLength(p.construction, first.part.materialId);
  if (chain.length > 1 || first.x1 - first.x0 > max) {
    for (const seg of chain) {
      const parts = built[seg.ci].cabinet.parts;
      parts.splice(parts.indexOf(seg.part), 1);
    }
    for (const [x0, x1] of splitBoards(chain.map((s) => [s.x0, s.x1]), max)) {
      // The board belongs to the cabinet it starts under.
      const owner = chain.findLast((s) => s.x0 <= x0 + TOUCH);
      const b = owner.part.bbox;
      built[owner.ci].cabinet.parts.push({
        ...owner.part,
        length: x1 - x0,
        bbox: box([x0 - owner.spec.x, b.min[1], b.min[2]], [x1 - x0, b.size[1], b.size[2]]),
        ops: [],
      });
    }
  }
  // A frame ending at a filler: close it with a cross member there.
  if (first.part.role !== 'plinthRear') return;
  for (const [seg, atLeft] of [[first, true], [chain[chain.length - 1], false]]) {
    if (seg.spec.kind !== 'filler') continue;
    const c = effectiveConstruction(jobFor(p, seg.ci), seg.spec.overrides);
    const { thickness: t, width: h } = seg.part;
    const depth = seg.spec.depth - c.toeKickSetback - t - t;
    if (seg.spec.width < t || depth <= 0) continue;
    built[seg.ci].cabinet.parts.push({
      name: 'Plinth end',
      role: 'plinthEnd',
      material: 'case',
      materialId: seg.part.materialId,
      bandId: seg.part.bandId,
      length: depth,
      width: h,
      thickness: t,
      edges: bandEdges(c, 'plinthEnd'),
      bbox: box([atLeft ? 0 : seg.spec.width - t, seg.part.bbox.min[1], t], [t, h, depth]),
      ops: [],
    });
  }
}

export function projectCutList(p, built = buildAll(p)) {
  return cutList(
    built.filter((b) => b.cabinet).map((b) => b.cabinet),
    p.construction,
  );
}

/**
 * World-space placement of every part of successfully built cabinets:
 * { cabinet, index, part, map, min, size, cuts }. `map` takes the part's own
 * space (its bbox space: cabinet space, or a corner cabinet's turned frame)
 * to world space; min/size and the cuts are world-space bounding boxes.
 */
export function placedParts(p, built) {
  const out = [];
  p.cabinets.forEach((spec, cabinet) => {
    const cab = built[cabinet]?.cabinet;
    if (!cab) return;
    const place = cabinetPlacement(p, spec);
    cab.parts.forEach((part, index) => {
      const map = partMap(part, place);
      const bounds = (b) => boxBounds(b, map.point);
      const { min, size } = bounds(part.bbox);
      out.push({ cabinet, index, part, map, min, size, cuts: (part.cuts ?? []).map(bounds) });
    });
  });
  return out;
}

/** A part's own space → world, through its frame (if any) and the cabinet's placement. */
export function partMap(part, place) {
  const f = part.frame;
  if (!f) return place;
  const local = ([x, y, z]) => [f.origin[0] + f.u[0] * x + f.n[0] * z, y, f.origin[1] + f.u[1] * x + f.n[1] * z];
  const dir = ([x, y, z]) => [f.u[0] * x + f.n[0] * z, y, f.u[1] * x + f.n[1] * z];
  return { point: (q) => place.point(local(q)), dir: (v) => place.dir(dir(v)) };
}

/** The bounding box of box `b` mapped through `point`. */
export function boxBounds(b, point) {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    point([0, 1, 2].map((a) => b.min[a] + ((i >> a) & 1 ? b.size[a] : 0))),
  );
  const min = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a])));
  const max = [0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a])));
  return box(min, max.map((v, a) => v - min[a]));
}
