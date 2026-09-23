/**
 * River guide index — one live reading per card. Same data path as a river
 * page (gauge-core fetch + cache, river-view decides), but several hosts on
 * one page, so this loops where river.js takes the first [data-river] only.
 * The cards are static links; if nothing loads they still navigate.
 */
import { REFRESH_MS, fetchGauges, readCache, writeCache } from './gauge-core.js';
import { buildView } from './river-view.js';

const hosts = Array.from(document.querySelectorAll('[data-river]'));

const render = (host, view) => {
  const flow = host.querySelector('[data-flow]');
  const age = host.querySelector('[data-age]');
  const trend = host.querySelector('[data-trend]');
  if (flow) flow.textContent = view.live ? view.flow : '—';
  if (age) {
    age.textContent = view.age?.label ?? (view.live ? '' : 'no reading');
    age.className = view.age?.cls ?? '';
  }
  if (trend) {
    trend.textContent = view.trend?.glyph ?? '';
    if (view.trend?.title) trend.title = view.trend.title;
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
  const cached = readCache();
  for (const host of hosts) render(host, buildView({ rows, cached, key: host.dataset.river }));
};

if (hosts.length) {
  load();
  setInterval(load, REFRESH_MS);
}
