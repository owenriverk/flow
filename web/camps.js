// Filters for the generated camp guides (/main-salmon-camps, /mf-salmon-camps).
// Every camp is already in the page (scripts/build-camp-guide.mjs); this only
// hides the ones that don't fit and lights up the capacity for the water level
// you picked. A failure here leaves the full list readable, which is the
// fallback anyway.
//
// Each camp carries data-cap: one capacity per level, "-" where the Forest
// Service list gives no number. data-types holds whatever the river's type
// filter matches on (the Main's reservable class, the Middle Fork's hot-springs
// / heritage / layover flags).

import { fetchGauges, readCache, writeCache } from './gauge-core.js';

const guide = document.querySelector('.camp-guide');
const bar = document.getElementById('camp-filters');

if (guide && bar) {
  const camps = [...guide.querySelectorAll('.camp')].map((el) => ({
    el,
    caps: (el.dataset.cap || '').split(' ').map((v) => (v === '-' ? null : Number(v))),
    types: new Set((el.dataset.types || '').split(' ').filter(Boolean)),
    tags: new Set((el.dataset.tags || '').split(' ').filter(Boolean)),
    cells: [...el.querySelectorAll('.camp-cap-cell')],
  }));
  const sections = [...guide.querySelectorAll('.camp-section')];
  const size = document.getElementById('camp-size');
  const count = document.getElementById('camp-count');
  const empty = document.getElementById('camp-empty');
  const resetBtn = document.getElementById('camp-reset');
  const levelButtons = [...bar.querySelectorAll('[data-level]')];

  const state = { level: 'any', type: 'all', wants: new Map() };

  function press(buttons, picked) {
    for (const b of buttons) {
      const on = b === picked;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function setLevel(value) {
    state.level = value;
    guide.dataset.level = value;
    press(levelButtons, levelButtons.find((b) => b.dataset.level === value));
  }

  // One button of a group is on at a time (water level, camp type).
  for (const b of levelButtons) b.addEventListener('click', () => { setLevel(b.dataset.level); apply(); });
  const typeButtons = [...bar.querySelectorAll('[data-type]')];
  for (const b of typeButtons) {
    b.addEventListener('click', () => {
      state.type = b.dataset.type;
      press(typeButtons, b);
      apply();
    });
  }

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
    const level = state.level === 'any' ? null : Number(state.level);
    const filtering = group > 0 || state.type !== 'all' || state.wants.size > 0 || level != null;
    let shown = 0;
    for (const c of camps) {
      // With no level picked, a camp counts if it fits the group at any level.
      // A blank on the list ("Not listed") is unknown, so it never counts as a fit:
      // the page says so rather than guess what the camp holds.
      const listed = (level == null ? c.caps : [c.caps[level]]).filter((v) => v != null);
      const fits = level == null && group === 0 ? true : listed.some((v) => v > 0 && v >= group);
      const type = state.type === 'all' || c.types.has(state.type);
      const wanted = [...state.wants.values()].every((any) => any.some((t) => c.tags.has(t)));
      const ok = fits && type && wanted;
      c.el.hidden = !ok;
      if (ok) shown++;
      // Light the chosen level's number; the others stay legible but quieter.
      for (const cell of c.cells) cell.classList.toggle('dim', level != null && Number(cell.dataset.i) !== level);
    }
    for (const s of sections) s.hidden = !s.querySelector('.camp:not([hidden])');
    empty.hidden = shown > 0;
    resetBtn.hidden = !filtering;
    // The strip map (camp-rail.js) fades hidden camps and re-times the boat.
    document.dispatchEvent(new CustomEvent('camps:change'));
    const label = level == null ? '' : ` at ${levelButtons.find((b) => b.dataset.level === state.level).dataset.label}`;
    count.textContent = filtering
      ? `${shown} of ${camps.length} camps${label}${group ? ` for a group of ${group}` : ''}.`
      : `Showing all ${camps.length} camps.`;
  }

  function reset() {
    setLevel('any');
    state.type = 'all';
    press(typeButtons, typeButtons.find((b) => b.dataset.type === 'all'));
    state.wants.clear();
    size.value = '';
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
  showLiveLevel();

  /**
   * Today's reading against the list's columns, for rivers rated in gauge feet
   * (the Middle Fork). Information only: a trip is weeks out, so it offers the
   * matching level rather than choosing it. Falls back to the last cached
   * reading; with nothing to show, the line stays hidden.
   */
  async function showLiveLevel() {
    const line = document.getElementById('camp-live');
    if (!line) return;
    const key = line.dataset.gaugeKey;
    const marks = line.dataset.levelsFt.split(',').map(Number);
    let rows = null;
    try {
      rows = await fetchGauges();
      writeCache(rows);
    } catch {
      rows = readCache()?.rows ?? null;
    }
    const g = Array.isArray(rows) ? rows.find((r) => r && r.key === key) : null;
    if (!g || g.stage == null || g.stage_unit !== 'ft') return;
    const ft = Number(g.stage);
    // At or under the first mark: that column. At or over the last: that one.
    // In between, the nearest of the middle columns.
    let col;
    if (ft <= marks[0]) col = 0;
    else if (ft >= marks[marks.length - 1]) col = marks.length - 1;
    else {
      col = 1;
      for (let i = 1; i < marks.length - 1; i++) if (Math.abs(ft - marks[i]) < Math.abs(ft - marks[col])) col = i;
    }
    const button = levelButtons.find((b) => b.dataset.level === String(col));
    const when = g.reading_time
      ? new Date(g.reading_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
    const flow = g.discharge != null ? ` (${Math.round(Number(g.discharge)).toLocaleString('en-US')} ${g.discharge_unit})` : '';
    line.textContent = `${line.dataset.gaugeName} gauge ${when ? `at ${when}` : 'now'}: ${ft.toFixed(2)} ft${flow}. Closest column on the list: ${button.textContent.toLowerCase()}. `;
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'camp-reset';
    use.textContent = 'Show camps at that level';
    use.addEventListener('click', () => { setLevel(String(col)); apply(); });
    line.append(use);
    line.hidden = false;
  }
}
