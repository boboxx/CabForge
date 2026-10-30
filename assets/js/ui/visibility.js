// Floating "Visibility" panel in the 3D view: hide part groups, isolate the
// selected cabinet, and bring back individually hidden parts.

import { PART_GROUPS } from '../engine/part.js';
import { h, mount } from './dom.js';
import { setState, setVisibility, state } from './store.js';

export function renderVisibility(container) {
  const toggle = h(
    'button',
    {
      'aria-expanded': String(state.visibilityOpen),
      onclick: () => setState({ visibilityOpen: !state.visibilityOpen }),
    },
    'Visibility ',
    state.visibilityOpen ? '▴' : '▾',
  );
  if (!state.visibilityOpen) {
    mount(container, toggle);
    return;
  }
  const groupBox = (id, label) =>
    h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        checked: !state.hiddenGroups.has(id),
        onchange: (e) => setVisibility((s) => (e.target.checked ? s.hiddenGroups.delete(id) : s.hiddenGroups.add(id))),
      }),
      label,
    );
  const hiddenCount = state.hiddenParts.size;
  mount(
    container,
    toggle,
    h(
      'div',
      { class: 'visibility-panel' },
      Object.entries(PART_GROUPS).map(([id, label]) => groupBox(id, label)),
      h('hr'),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: state.isolate,
          onchange: (e) => setVisibility((s) => (s.isolate = e.target.checked)),
        }),
        'Selected cabinet only',
      ),
      h(
        'div',
        { class: 'add-row' },
        h(
          'button',
          {
            disabled: !hiddenCount,
            onclick: () => setVisibility((s) => s.hiddenParts.clear()),
          },
          hiddenCount ? `Show ${hiddenCount} hidden part${hiddenCount > 1 ? 's' : ''}` : 'No hidden parts',
        ),
        h(
          'button',
          {
            onclick: () =>
              setVisibility((s) => {
                s.hiddenGroups.clear();
                s.hiddenParts.clear();
                s.isolate = false;
              }),
          },
          'Show all',
        ),
      ),
      h('p', { class: 'muted' }, 'Hide single parts with the checkboxes in the parts table.'),
    ),
  );
}
