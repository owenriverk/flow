/**
 * River page controller — the thin DOM half. All the deciding lives in
 * river-view.js (pure, unit-tested); this file only puts the result on screen.
 *
 * Each page declares its run in markup:
 *   <div data-river="mf salmon"> … [data-flow] [data-age] [data-note] … </div>
 *
 * The evergreen half of the page (the number to text, the key, the QR, the
 * paragraph) is static HTML and is never touched here, so it survives every
 * failure state — including no network at all, which is the case that matters
 * most for someone checking a page before they drive to a put-in.
 */

import { REFRESH_MS, fetchGauges, readCache, writeCache } from './gauge-core.js';
import { buildView, stateNote } from './river-view.js';

const host = document.querySelector('[data-river]');

if (host) {
  const key = host.dataset.river;
  const el = (name) => host.querySelector(`[data-${name}]`);

  const render = (view) => {
    const flow = el('flow');
    const age = el('age');
    const note = el('note');
    const trend = el('trend');

    // textContent everywhere: nothing here is markup, so nothing needs escaping.
    if (flow) flow.textContent = view.live ? view.flow : '—';
    if (age) {
      age.textContent = view.age?.label ?? '';
      age.className = `river-age${view.age?.cls ? ` ${view.age.cls}` : ''}`;
    }
    if (trend) {
      trend.textContent = view.trend?.glyph ?? '';
      trend.className = `trend${view.trend?.cls ? ` ${view.trend.cls}` : ''}`;
      if (view.trend?.title) trend.title = view.trend.title;
    }
    if (note) {
      const text = stateNote(view);
      note.textContent = text;
      note.hidden = !text;
    }
    host.dataset.state = view.state;
    if (view.status) host.dataset.status = view.status;
  };

  const load = async () => {
    let rows = null;
    try {
      rows = await fetchGauges();
      writeCache(rows);
    } catch (e) {
      console.error('[lateboof] live gauge fetch failed', e);
    }
    const view = buildView({ rows, cached: readCache(), key });
    // A key the API doesn't know means the roster drifted out from under this
    // page (rename, typo, a run pulled). Worth a console line — it is a content
    // bug someone has to fix, not a network condition that clears on its own.
    if (view.state === 'unavailable' && view.reason === 'missing-key') {
      console.error(`[lateboof] no gauge named "${key}" in the roster — page needs updating`);
    }
    render(view);
  };

  load();
  setInterval(load, REFRESH_MS);
}
