// Runs the nesting optimizer off the main thread so the page stays
// responsive. Message in: { id, groups, nesting }; out: { id, result }.

// Loaded with the worker's own version (workers don't see the page's import
// map), so a deploy can't leave a stale copy.
const nest = import(`./nest.js${self.location.search}`);

self.onmessage = async (e) => {
  const { id, groups, nesting } = e.data;
  try {
    const { nestGroup } = await nest;
    self.postMessage({ id, result: groups.map((g) => nestGroup(g, nesting)) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
