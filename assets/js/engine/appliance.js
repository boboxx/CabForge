// Sketches of the appliances in their spaces for the 3D view: a dishwasher,
// a range and a fridge built from boxes, sized to the space. They are not
// parts (nothing to cut), so they stay out of the cut list and supplies.
//
// Boxes are in the space's own cabinet space (x along the run, y up from the
// floor, z = 0 at the back, the cabinet fronts' face at depth + front
// thickness), each with a tone the view colours: 'steel', 'trim' (darker
// steel), 'black' or 'handle'.

const box = (min, size, tone) => ({ min, size, tone });

/** Room the sketch leaves at each side of its space. */
const SIDE_GAP = 3;

function dishwasher(w, h, d, ft) {
  const x0 = SIDE_GAP;
  const wi = w - 2 * SIDE_GAP;
  const top = h - 5; // under the countertop
  const kick = 100;
  const face = d + ft;
  return [
    box([x0, kick, 20], [wi, top - kick, d - 20], 'trim'),
    box([x0 + 20, 0, 0], [wi - 40, kick, face - 50], 'black'),
    // The door, its control strip along the top and a bar handle.
    box([x0, kick, d], [wi, top - kick - 70, ft], 'steel'),
    box([x0, top - 70, d], [wi, 70, ft], 'trim'),
    box([x0 + wi * 0.2, top - 115, face], [wi * 0.6, 14, 22], 'handle'),
  ];
}

/** A freestanding range: its cooktop at countertop height (`top` above the space). */
function range(w, h, d, ft, top) {
  const x0 = SIDE_GAP;
  const wi = w - 2 * SIDE_GAP;
  const ht = h + top;
  const face = d + ft;
  const burner = Math.min(180, wi / 2 - 60);
  const out = [
    box([x0, 0, 0], [wi, ht - 12, d], 'trim'),
    // Storage drawer, oven door with its window, and the handle over it.
    box([x0, 20, d], [wi, 110, ft], 'steel'),
    box([x0, 140, d], [wi, ht - 12 - 140 - 90, ft], 'steel'),
    box([x0 + wi * 0.15, 200, face], [wi * 0.7, ht - 12 - 200 - 200, 1], 'black'),
    box([x0 + wi * 0.15, ht - 12 - 145, face], [wi * 0.7, 14, 25], 'handle'),
    // Control knobs strip, the cooktop and the backguard.
    box([x0, ht - 12 - 90, d], [wi, 90, ft], 'trim'),
    box([x0, ht - 12, 0], [wi, 12, face], 'black'),
    box([x0, ht, 0], [wi, 100, 60], 'trim'),
  ];
  // Four burners.
  for (const fx of [0.27, 0.73]) {
    for (const fz of [0.32, 0.72]) {
      out.push(box([x0 + wi * fx - burner / 2, ht, face * fz - burner / 2], [burner, 4, burner], 'trim'));
    }
  }
  return out;
}

/** A French-door fridge with a freezer drawer, the full height of its space
 *  (set the space's height to fit it under a cabinet). */
function fridge(w, h, d, ft) {
  const x0 = 5;
  const wi = w - 10;
  const ht = h;
  const doorZ = d + ft;
  const split = Math.round(ht * 0.38);
  const kick = 40;
  const gap = 4;
  const half = (wi - gap) / 2;
  return [
    box([x0, kick, 0], [wi, ht - kick, d + ft], 'trim'),
    box([x0 + 30, 0, 0], [wi - 60, kick, d], 'black'),
    // Freezer drawer and its handle.
    box([x0, kick, doorZ], [wi, split - kick - gap, 45], 'steel'),
    box([x0 + wi * 0.2, split - 90, doorZ + 45], [wi * 0.6, 18, 30], 'handle'),
    // Two doors, their handles on the inside edges.
    box([x0, split, doorZ], [half, ht - split, 45], 'steel'),
    box([x0 + half + gap, split, doorZ], [half, ht - split, 45], 'steel'),
    box([x0 + half - 60, split + 150, doorZ + 45], [18, ht - split - 400, 30], 'handle'),
    box([x0 + half + gap + 42, split + 150, doorZ + 45], [18, ht - split - 400, 30], 'handle'),
  ];
}

/**
 * The appliance sketch for a space, or [] for a plain space. `ft` is the
 * front thickness (the sketches line up with the doors), `top` the
 * countertop thickness (a range comes up to the countertop).
 */
export function applianceSketch(spec, { ft = 19, top = 30 } = {}) {
  if (spec.kind !== 'space') return [];
  const { width: w, height: h, depth: d } = spec;
  if (w < 100 || h < 200 || d < 100) return [];
  switch (spec.preset) {
    case 'dishwasher':
      return dishwasher(w, h, d, ft);
    case 'range':
      return range(w, h, d, ft, top);
    case 'fridge':
      return fridge(w, h, d, ft);
    default:
      return [];
  }
}
