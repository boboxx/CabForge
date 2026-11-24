// Nesting view: optimized sheet layouts for every part of the job, per
// material, with a numbered layout plan for each sheet. The optimizer runs
// in a Web Worker so editing never stalls.

import { materialLabel } from '../engine/model.js';
import { nestGroup, nestGroups } from '../engine/nest.js';
import { partGroup } from '../engine/part.js';
import { checkboxField, h, lenField, mount, s, selectField } from './dom.js';
import { partKey, setState, setVisibility, state, updateProject } from './store.js';
import { fmtLen, fmtSize } from '../engine/units.js';

let worker = null;
let requestId = 0;
// Two plans: 'all' nests every part (the Materials report buys sheets from
// it); 'shown' leaves out the parts hidden in the parts list or the
// Visibility menu (the Nesting view). With nothing hidden they are the same
// plan. Each keeps its latest finished result and what it was computed for.
const newPlan = () => ({ key: null, groups: [], error: '', pendingKey: null, requestId: 0, left: 0 });
const plans = { all: newPlan(), shown: newPlan() };
/** Worker request id -> plan name. */
const inflight = new Map();

function getWorker() {
  if (worker === null) {
    try {
      // Workers don't see the page's import map: pass this module's version along.
      const version = new URL(import.meta.url).search;
      worker = new Worker(new URL(`../engine/nest.worker.js${version}`, import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const plan = plans[inflight.get(e.data.id)];
        inflight.delete(e.data.id);
        if (!plan || e.data.id !== plan.requestId) return; // superseded by a newer request
        Object.assign(plan, { key: plan.pendingKey, groups: e.data.result ?? [], error: e.data.error ?? '', pendingKey: null });
        setState({});
      };
      worker.onerror = () => {
        worker = false; // fall back to the main thread from now on
      };
    } catch {
      worker = false;
    }
  }
  return worker || null;
}

/** What is hidden, as text: '' when nothing is. */
function hiddenKey() {
  if (!state.hiddenGroups.size && !state.hiddenParts.size) return '';
  return `${[...state.hiddenGroups].sort()}|${[...state.hiddenParts].sort()}`;
}

/** The built cabinets, without the hidden parts when `shownOnly`.
 *  Returns them and how many parts were left out. */
function jobCabinets(shownOnly) {
  const cabinets = [];
  let left = 0;
  state.built.forEach((b, i) => {
    if (!b.cabinet) return;
    if (!shownOnly) return cabinets.push(b.cabinet);
    const spec = state.project.cabinets[i];
    const parts = b.cabinet.parts.filter((p, j) => !state.hiddenGroups.has(partGroup(p.role)) && !state.hiddenParts.has(partKey(spec, j)));
    left += b.cabinet.parts.length - parts.length;
    cabinets.push({ ...b.cabinet, parts });
  });
  return { cabinets, left };
}

/** The plan for `name` ('all' or 'shown'); 'shown' is 'all' when nothing
 *  is hidden. Starts nesting when the job, the nesting settings or (for
 *  'shown') what is hidden changed. */
function ensureNested(name) {
  const hidden = name === 'shown' ? hiddenKey() : '';
  if (!hidden) name = 'all';
  const plan = plans[name];
  const key = `${state.version}|${hidden}`;
  if (plan.key === key || plan.pendingKey === key) return plan;
  const nesting = state.project.construction.nesting;
  const { cabinets, left } = jobCabinets(name === 'shown');
  const groups = nestGroups(cabinets, state.project.construction);
  plan.pendingKey = key;
  plan.left = left;
  const w = getWorker();
  if (w) {
    plan.requestId = ++requestId;
    inflight.set(requestId, name);
    w.postMessage({ id: requestId, groups, nesting });
  } else {
    // No worker support: compute here with the quick settings.
    Object.assign(plan, { key, groups: groups.map((g) => nestGroup(g, { ...nesting, effort: 'quick' })), error: '', pendingKey: null });
  }
  return plan;
}

/** Sheets needed per library material id once the whole job is nested
 *  (hidden parts included: they still have to be cut), or null while the
 *  plan is being worked out. Starts nesting if needed. */
export function sheetsNeeded() {
  const plan = ensureNested('all');
  if (plan.key !== `${state.version}|`) return null;
  return new Map(plan.groups.map((g) => [g.material.id, g.sheets.length]));
}

/** Lightens a #rrggbb colour toward white so labels stay readable. */
function tint(hex, k = 0.55) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#dddddd';
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `rgb(${c.join(',')})`;
}

function sheetSvg(group, sheet, index) {
  const m = group.material;
  const { trim } = state.project.construction.nesting;
  const [L, W] = [m.sheetLength, m.sheetWidth];
  const fill = tint(m.color);
  const parts = sheet.parts.map((p) => {
    const dims = `${fmtSize(p.length, p.width)}`;
    const cx = p.x + p.sizeX / 2;
    const cy = p.y + p.sizeY / 2;
    // Number always; name and size when the part is big enough to read.
    const big = Math.min(46, p.sizeY * 0.2, (p.sizeX / Math.max(p.name.length, dims.length)) * 1.6);
    const small = Math.min(60, p.sizeY * 0.6, p.sizeX * 0.4);
    return s(
      'g',
      {},
      s('title', {}, `#${p.number} ${p.name} — ${p.cabinet}\n${dims} mm${p.rotated ? ' (rotated)' : ''}`),
      s('rect', { class: 'nest-part', x: p.x, y: p.y, width: p.sizeX, height: p.sizeY, style: { fill } }),
      big >= 14
        ? s(
            'text',
            { class: 'nest-label', x: cx, y: cy, 'font-size': big, 'text-anchor': 'middle' },
            s('tspan', { x: cx, dy: '-0.7em', 'font-weight': '700' }, `#${p.number}`),
            s('tspan', { x: cx, dy: '1.2em' }, p.name),
            s('tspan', { x: cx, dy: '1.2em' }, dims),
          )
        : s('text', { class: 'nest-label', x: cx, y: cy + small * 0.35, 'font-size': small, 'text-anchor': 'middle', 'font-weight': '700' }, `${p.number}`),
    );
  });
  const off = sheet.offcut;
  return h(
    'figure',
    { class: 'sheet' },
    s(
      'svg',
      { viewBox: `-20 -20 ${L + 40} ${W + 40}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': `Sheet ${index + 1}` },
      s('rect', { class: 'nest-sheet', x: 0, y: 0, width: L, height: W }),
      trim > 0 ? s('rect', { class: 'nest-trim', x: trim, y: trim, width: L - 2 * trim, height: W - 2 * trim }) : null,
      parts,
    ),
    h(
      'figcaption',
      {},
      // Printed one sheet per page: say which material it is on every page.
      h('strong', { class: 'sheet-material' }, `${materialLabel(m)} · `),
      h('strong', {}, `Sheet ${index + 1} of ${group.sheets.length}`),
      ` · ${sheet.parts.length} parts · ${Math.round(sheet.used * 100)}% used`,
      off.length > 0 && off.width > 0 ? ` · largest offcut ${fmtSize(off.length, off.width)}` : '',
    ),
    h(
      'div',
      { class: 'sheet-list' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, 'Part'), h('th', {}, 'Cabinet'), h('th', { class: 'num' }, 'L × W'), h('th', { class: 'num' }, 'X, Y'), h('th', {}, '')),
        ),
        h(
          'tbody',
          {},
          sheet.parts.map((p) =>
            h(
              'tr',
              {},
              h('td', { class: 'num' }, p.number),
              h('td', {}, p.name),
              h('td', {}, p.cabinet),
              h('td', { class: 'num' }, `${fmtSize(p.length, p.width)}`),
              h('td', { class: 'num' }, `${fmtLen(p.x)}, ${fmtLen(p.y)}`),
              h('td', {}, p.rotated ? '↻ rotated' : ''),
            ),
          ),
        ),
      ),
    ),
  );
}

export function renderNesting(container) {
  const plan = ensureNested('shown');
  // While the first layout without the hidden parts is worked out, show the
  // full one (greyed out as stale) rather than nothing.
  const result = plan.key === null && plan !== plans.all ? plans.all : plan;
  const c = state.project.construction;
  const n = c.nesting;
  const editNesting = (key, parse = (v) => Math.max(0, v)) => (v) =>
    updateProject((p) => (p.construction.nesting[key] = parse(v)));
  const busy = plan.pendingKey !== null;
  const left = hiddenKey() ? plan.left : 0;
  const groups = result.groups;
  const totalSheets = groups.reduce((t, g) => t + g.sheets.length, 0);

  mount(
    container,
    h(
      'div',
      { class: 'nest-toolbar' },
      selectField(
        'Cutting',
        'nestMode',
        [
          ['cnc', 'CNC router (free nesting)'],
          ['saw', 'Panel saw (guillotine cuts)'],
        ],
        n.mode,
        editNesting('mode', String),
      ),
      selectField(
        'Optimization',
        'nestEffort',
        [
          ['quick', 'Quick'],
          ['normal', 'Normal'],
          ['thorough', 'Thorough'],
        ],
        n.effort,
        editNesting('effort', String),
      ),
      lenField('Saw kerf / bit Ø', 'kerf', n.kerf, editNesting('kerf'), { step: 0.5 }),
      lenField('Edge trim', 'trim', n.trim, editNesting('trim'), { step: 1 }),
      checkboxField('Group identical parts', 'nestGroup', n.group, editNesting('group', Boolean)),
      h('div', { class: 'spacer' }),
      h(
        'span',
        { class: busy ? 'nest-status busy' : 'nest-status', role: 'status' },
        busy ? 'Optimizing…' : `${totalSheets} sheet${totalSheets === 1 ? '' : 's'} in total`,
      ),
      h('button', { onclick: () => window.print(), disabled: busy }, 'Print'),
    ),
    result.error ? h('div', { class: 'error' }, `Nesting failed: ${result.error}`) : null,
    left > 0
      ? h(
          'div',
          { class: 'nest-hidden-note' },
          `${left} hidden part${left === 1 ? ' is' : 's are'} left out of this layout. The Materials report still counts sheets for every part. `,
          h(
            'button',
            {
              onclick: () =>
                setVisibility((s) => {
                  s.hiddenGroups.clear();
                  s.hiddenParts.clear();
                }),
            },
            'Show all parts',
          ),
        )
      : null,
    groups.map((g) =>
      h(
        'section',
        { class: busy ? 'nest-group stale' : 'nest-group' },
        h(
          'h2',
          {},
          materialLabel(g.material),
          h(
            'label',
            { class: 'grain-toggle', title: 'Keep each part\'s length along the sheet length (no rotating)' },
            h('input', {
              type: 'checkbox',
              'data-key': `grain-${g.material.id}`,
              checked: g.material.grain,
              onchange: (e) =>
                updateProject((p) => {
                  const m = p.construction.library.find((m) => m.id === g.material.id);
                  if (m) m.grain = e.target.checked;
                }),
            }),
            'Follow grain',
          ),
          h(
            'span',
            { class: 'muted' },
            ` · sheet ${fmtSize(g.material.sheetLength, g.material.sheetWidth)}` +
              `${g.material.grain ? ' · grain along length' : ''}` +
              ` · ${g.sheets.length} sheet${g.sheets.length === 1 ? '' : 's'} · ${g.partCount} parts · ${Math.round(g.yield * 100)}% used`,
          ),
        ),
        g.unplaced.length
          ? h(
              'div',
              { class: 'error' },
              `${g.unplaced.length} part${g.unplaced.length > 1 ? 's do' : ' does'} not fit on a sheet: `,
              g.unplaced.map((p) => `${p.name} (${p.cabinet}) ${fmtSize(p.length, p.width)}`).join('; '),
            )
          : null,
        h(
          'div',
          { class: 'sheet-grid' },
          g.sheets.map((sheet, i) => sheetSvg(g, sheet, i)),
        ),
      ),
    ),
  );
}
