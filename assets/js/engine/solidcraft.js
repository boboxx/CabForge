// SolidCraft export: the job as a .solidcraft design (plain JSON, which
// SolidCraft opens like its own files). See github.com/tangency-labs/solidcraft,
// crates/doc/src/document.rs for the format.
//
// Each cabinet is a component holding one component per part. A part is a
// box body with its dadoes cut out, and its drilling as Hole features at the
// points of a sketch on the drilled face, one per kind of hole. Every cut
// names the part's body as its only participant, so it never reaches the
// parts beside it. The part's material, sizes and edge banding are the
// component's properties, which SolidCraft's bill of materials reads.
//
// SolidCraft is Z-up: CabForge (x, y, z) is SolidCraft (x, -z, y), so the
// cabinet fronts face -Y (SolidCraft's front view).

import { bandThickness, fmtMm, materialById, partMaterial } from './model.js';
import { boreFace, bores, cutSize, edgeCode } from './part.js';
import { placedParts } from './project.js';

// Component properties (format 28) are the newest thing written.
export const SOLIDCRAFT_FORMAT = 'solidcraft/28';

const BORE_NAMES = { system: 'System holes', hingeCup: 'Hinge cups', hingePlate: 'Hinge plate holes', slide: 'Slide screw holes' };

const round = (v) => Math.round(v * 1e6) / 1e6 + 0; // + 0 turns -0 into 0
const sc = ([x, y, z]) => [round(x), round(-z), round(y)];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const num = (v) => fmtMm(v);

/** Unique names: the second "Drawer front" becomes "Drawer front 2". */
function uniqueNames(names) {
  const total = new Map();
  for (const n of names) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return total.get(n) > 1 ? `${n} ${k}` : n;
  });
}

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  const n = m ? parseInt(m[1], 16) : 0xcccccc;
  return [n >> 16, (n >> 8) & 255, n & 255];
};

/** What the bill of materials shows for a part. */
function partProperties(c, cabinetName, part) {
  const mat = partMaterial(c, part);
  const band = materialById(c, part.bandId);
  const edges = edgeCode(part.edges);
  const [cutL, cutW] = cutSize(part, bandThickness(c, part));
  const props = {
    Cabinet: cabinetName,
    Material: mat ? `${mat.name} ${num(mat.thickness)} mm` : '',
    'Finished size': `${num(part.length)} × ${num(part.width)} × ${num(part.thickness)} mm`,
    'Cut size': `${num(cutL)} × ${num(cutW)} mm`,
    'Edge banding': edges ? `${edges}${band ? ` · ${band.name}` : ''}` : 'none',
  };
  if (mat?.grain) props.Grain = 'along the length';
  const holes = bores(part);
  if (holes.length) {
    const kinds = new Map();
    for (const b of holes) {
      const key = `${BORE_NAMES[b.purpose] ?? b.purpose} Ø${num(b.diameter)} × ${num(b.depth)}`;
      kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
    props.Drilling = [...kinds].map(([k, n]) => `${n} × ${k}`).join('; ');
  }
  return props;
}

/**
 * The design for a job: `built` is buildAll(project) (cabinets that failed
 * to build are left out).
 */
export function solidcraftDesign(project, built) {
  const c = project.construction;
  let nextId = 1;
  const id = () => nextId++;
  const features = [];
  const components = [];
  const occurrences = [];
  const groups = [];
  const appearances = {};
  const usedBodies = new Set();

  const byCabinet = new Map();
  // SolidCraft bodies here are boxes along the axes: a corner cabinet's 45°
  // parts (its diagonal door, the back across the corner) are left out.
  const square = (pp) => !pp.part.frame || pp.part.frame.u.some((v) => Math.abs(v) < 1e-9);
  for (const pp of placedParts(project, built).filter(square)) {
    if (!byCabinet.has(pp.cabinet)) byCabinet.set(pp.cabinet, []);
    byCabinet.get(pp.cabinet).push(pp);
  }
  const cabIndexes = [...byCabinet.keys()];
  const cabNames = uniqueNames(cabIndexes.map((i) => built[i].cabinet.name || project.cabinets[i].name));

  cabIndexes.forEach((cabIndex, ci) => {
    const cabName = cabNames[ci];
    const cabComp = id();
    components.push({ id: cabComp, name: cabName, parent: 0 });
    occurrences.push({ id: id(), component: cabComp, parent: 0, name: `${cabName}:1`, grounded: true });
    const cabGroup = { id: id(), name: cabName, features: [] };
    groups.push(cabGroup);

    const parts = byCabinet.get(cabIndex);
    const partNames = uniqueNames(parts.map((pp) => pp.part.name));
    parts.forEach((pp, pi) => {
      const { part, min, size } = pp;
      const partName = partNames[pi];
      let body = `${cabName} · ${partName}`;
      while (usedBodies.has(body)) body += "'";
      usedBodies.add(body);

      const comp = id();
      components.push({ id: comp, name: partName, parent: cabComp, properties: partProperties(c, cabName, part) });
      occurrences.push({ id: id(), component: comp, parent: cabComp, name: `${partName}:1`, grounded: true });
      const group = { id: id(), name: partName, parent: cabGroup.id, features: [] };
      groups.push(group);
      const add = (f) => {
        const fid = id();
        features.push({ id: fid, suppressed: false, component: comp, ...f });
        group.features.push(fid);
        return fid;
      };
      // A box from a CabForge min corner and size.
      const boxAt = (lo, s) => ({
        corner: sc([lo[0], lo[1], lo[2] + s[2]]),
        length: num(s[0]),
        width: num(s[2]),
        height: num(s[1]),
      });

      add({ name: partName, body_names: [body], type: 'box', ...boxAt(min, size), operation: 'new_body' });
      pp.cuts.forEach((cut, k) => {
        add({ name: `Dado ${k + 1}`, participants: [body], type: 'box', ...boxAt(cut.min, cut.size), operation: 'cut' });
      });

      // The drilled face in the part's own space, mapped into the room.
      const own = boreFace(part, part.bbox.min, part.bbox.size);
      const face = own && { at: (x, y) => pp.map.point(own.at(x, y)), out: pp.map.dir(own.out) };
      const holes = bores(part);
      if (face && holes.length) {
        // The sketch plane lies on the drilled face, its normal (x × y) out of it,
        // so each hole goes against the normal into the part.
        const out = sc(face.out);
        const xDir = Math.abs(out[2]) > 0.5 ? [1, 0, 0] : [0, 0, 1];
        const yDir = cross(out, xDir);
        const origin = sc(face.at(0, 0));
        const kinds = new Map();
        for (const b of holes) {
          const key = `${b.purpose}|${b.diameter}|${b.depth}`;
          if (!kinds.has(key)) kinds.set(key, []);
          kinds.get(key).push(b);
        }
        for (const list of kinds.values()) {
          const { purpose, diameter, depth } = list[0];
          const label = `${BORE_NAMES[purpose] ?? purpose} Ø${num(diameter)} × ${num(depth)}`;
          const spots = list.map((b) => sc(face.at(b.x, b.y)));
          const sketch = add({
            name: `${label} (points)`,
            type: 'sketch',
            plane: { type: 'custom', plane: { origin, x_dir: xDir, y_dir: yDir } },
            sketch: {
              points: [
                { id: 'origin', pos: [0, 0], fixed: true },
                ...spots.map((p, k) => {
                  const d = sub(p, origin);
                  return { id: `q${k}`, pos: [round(dot(d, xDir)), round(dot(d, yDir))], fixed: true };
                }),
              ],
              curves: [],
              constraints: [],
              counters: {},
            },
          });
          add({
            name: label,
            participants: [body],
            type: 'hole',
            position: spots[0],
            direction: out.map((v) => -v + 0),
            diameter: num(diameter),
            depth: num(depth),
            hole: { type: 'simple' },
            points: { sketch, ids: spots.map((_, k) => `q${k}`) },
          });
        }
      }

      const mat = partMaterial(c, part);
      appearances[body] = { name: mat?.name ?? 'Material', color: hexRgb(mat?.color), opacity: 1 };
    });
  });

  return {
    format: SOLIDCRAFT_FORMAT,
    name: project.name || 'Cabinets',
    units: 'mm',
    metadata: { project: project.name || '', description: 'Exported from CabForge' },
    params: [],
    features,
    next_id: nextId,
    components,
    occurrences,
    appearances: { bodies: appearances },
    timeline_groups: groups,
  };
}

export function solidcraftJson(project, built) {
  return JSON.stringify(solidcraftDesign(project, built), null, 1);
}
