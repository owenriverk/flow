// Filters for the generated camp guides (/main-salmon-camps). Every camp is
// already in the page (scripts/build-camp-guide.mjs); this only hides the ones
// that don't fit and lights up the capacity for the water level you picked. A
// failure here leaves the full list readable, which is the fallback anyway.

const guide = document.querySelector('.camp-guide');
const bar = document.getElementById('camp-filters');

if (guide && bar) {
  const camps = [...guide.querySelectorAll('.camp')].map((el) => ({
    el,
    lo: Number(el.dataset.lo),
    hi: Number(el.dataset.hi),
    res: el.dataset.res,
    tags: new Set((el.dataset.tags || '').split(' ').filter(Boolean)),
  }));
  const sections = [...guide.querySelectorAll('.camp-section')];
  const size = document.getElementById('camp-size');
  const count = document.getElementById('camp-count');
  const empty = document.getElementById('camp-empty');
  const resetBtn = document.getElementById('camp-reset');

  const state = { level: 'any', res: 'all', wants: new Map() };

  // One button of a group is on at a time (water level, camp type).
  function exclusive(attr, onPick) {
    const buttons = [...bar.querySelectorAll(`[data-${attr}]`)];
    for (const b of buttons) {
      b.addEventListener('click', () => {
        for (const other of buttons) {
          const on = other === b;
          other.classList.toggle('active', on);
          other.setAttribute('aria-pressed', String(on));
        }
        onPick(b.dataset[attr]);
        apply();
      });
    }
  }
  exclusive('level', (v) => { state.level = v; guide.dataset.level = v; });
  exclusive('res', (v) => { state.res = v; });

  for (const chip of bar.querySelectorAll('.camp-chip')) {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      if (on) state.wants.set(chip.dataset.key, chip.dataset.want.split(' '));
      else state.wants.delete(chip.dataset.key);
      apply();
    });
  }
  size.addEventListener('input', apply);

  function apply() {
    const group = Math.max(0, Math.floor(Number(size.value)) || 0);
    const filtering = group > 0 || state.res !== 'all' || state.wants.size > 0 || state.level !== 'any';
    let shown = 0;
    for (const c of camps) {
      // With no level picked, a camp counts if it fits the group at either one.
      const cap = state.level === 'low' ? c.lo : state.level === 'high' ? c.hi : Math.max(c.lo, c.hi);
      // A camp with no capacity at this level is not a camp at this level. The
      // Forest Service capacity is a hard limit, so a bigger group is filtered out.
      const fits = cap > 0 && cap >= group;
      const type = state.res === 'all' || c.res === state.res;
      const wanted = [...state.wants.values()].every((any) => any.some((t) => c.tags.has(t)));
      const ok = fits && type && wanted;
      c.el.hidden = !ok;
      if (ok) shown++;
    }
    for (const s of sections) s.hidden = !s.querySelector('.camp:not([hidden])');
    empty.hidden = shown > 0;
    resetBtn.hidden = !filtering;
    // The strip map (camp-rail.js) fades hidden camps and re-times the boat.
    document.dispatchEvent(new CustomEvent('camps:change'));
    const level = state.level === 'any' ? '' : ` at ${state.level} water`;
    count.textContent = filtering
      ? `${shown} of ${camps.length} camps${level}${group ? ` for a group of ${group}` : ''}.`
      : `Showing all ${camps.length} camps.`;
  }

  function reset() {
    state.level = 'any';
    state.res = 'all';
    state.wants.clear();
    guide.dataset.level = 'any';
    size.value = '';
    for (const b of bar.querySelectorAll('.status-btn')) {
      const on = b.dataset.level === 'any' || b.dataset.res === 'all';
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const chip of bar.querySelectorAll('.camp-chip')) chip.setAttribute('aria-pressed', 'false');
    apply();
  }
  resetBtn.addEventListener('click', reset);

  // The "by group" lists link to camps by id. A link to a camp the filters are
  // hiding would go nowhere, so following one clears the filters first.
  function revealTarget() {
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.classList.contains('camp') && target.hidden) {
      reset();
      target.scrollIntoView();
    }
  }
  window.addEventListener('hashchange', revealTarget);

  bar.hidden = false;
  apply();
}
