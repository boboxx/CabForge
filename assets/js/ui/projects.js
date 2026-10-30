// Projects dialog: open, delete and import projects stored on the server.

import { h, mount } from './dom.js';
import { api } from './api.js';
import { cancelSave, clearProject, createProject, newProjectId, openProject, setState, state } from './store.js';

let list = null; // null while loading
let error = '';

export async function showProjects() {
  list = null;
  error = '';
  setState({ projectsOpen: true });
  try {
    list = await api.listProjects();
  } catch (e) {
    error = e.message;
    list = [];
  }
  setState({});
}

const close = () => setState({ projectsOpen: false });

async function open(id) {
  try {
    openProject(await api.getProject(id));
    close();
  } catch (e) {
    error = `Could not open: ${e.message}`;
    setState({});
  }
}

async function remove(p) {
  const current = state.project.id === p.id;
  const n = current ? state.project.cabinets.length : 0;
  const message = n
    ? `Delete "${p.name}"? It is the open job: its ${n} cabinet${n === 1 ? '' : 's'} will be removed from the cabinet list and no job will be open. This cannot be undone.`
    : `Delete "${p.name}"? This cannot be undone.`;
  if (!confirm(message)) return;
  // A queued autosave would write the deleted project straight back.
  if (current) cancelSave();
  try {
    await api.deleteProject(p.id);
    list = list.filter((x) => x.id !== p.id);
    if (current) clearProject();
  } catch (e) {
    error = `Could not delete: ${e.message}`;
  }
  setState({});
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const p = JSON.parse(reader.result);
      if (!Array.isArray(p?.cabinets) || typeof p?.construction !== 'object') throw new Error('Not a CabForge project');
      p.id = newProjectId();
      p.name = p.name || file.name.replace(/\.json$/i, '');
      openProject(p);
      // Save right away so it shows up in the list.
      api.saveProject(p).catch(() => {});
      close();
    } catch (e) {
      error = `Could not import ${file.name}: ${e.message}`;
      setState({});
    }
  };
  reader.readAsText(file);
}

export function renderProjects(container) {
  if (!state.projectsOpen) {
    container.replaceChildren();
    return;
  }
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: (e) => e.target.files[0] && importFile(e.target.files[0]),
  });
  const body =
    list === null
      ? h('p', { class: 'muted' }, 'Loading…')
      : h(
          'table',
          { class: 'project-list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Last saved'), h('th', {}), h('th', {}))),
          h(
            'tbody',
            {},
            list.length
              ? list.map((p) =>
                  h(
                    'tr',
                    { class: p.id === state.project.id ? 'current' : null },
                    h('td', {}, p.name),
                    h('td', {}, new Date(p.updated * 1000).toLocaleString()),
                    h('td', {}, h('button', { onclick: () => open(p.id) }, p.id === state.project.id ? 'Open (current)' : 'Open')),
                    h('td', {}, h('button', { class: 'danger', onclick: () => remove(p) }, 'Delete')),
                  ),
                )
              : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'No saved projects yet.')),
          ),
        );
  mount(
    container,
    h(
      'div',
      { class: 'modal-backdrop', onclick: close },
      h(
        'div',
        { class: 'modal narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Projects', onclick: (e) => e.stopPropagation() },
        h(
          'header',
          { class: 'modal-head' },
          h('h2', {}, 'Projects'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'icon-btn', 'aria-label': 'Close projects', onclick: close }, '✕'),
        ),
        h(
          'div',
          { class: 'modal-body' },
          h(
            'div',
            { class: 'add-row', style: { marginBottom: '10px' } },
            h(
              'button',
              {
                class: 'primary',
                onclick: () => {
                  createProject();
                  close();
                },
              },
              '+ New project',
            ),
            h('button', { onclick: () => fileInput.click() }, 'Import JSON…'),
            fileInput,
          ),
          error ? h('div', { class: 'error' }, error) : null,
          body,
        ),
      ),
    ),
  );
}
