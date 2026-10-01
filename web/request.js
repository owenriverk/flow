// "Request a gauge" bar under the homepage table. Posts the run or gauge name to
// the bot Worker's /api/request (src/gaugeRequest.ts), which emails the owner.
// Separate from gauges.js on purpose: that file is the table's controller, and a
// failure here must never take the table down with it.

const bar = document.getElementById('request-bar');
const form = document.getElementById('request-form');
const input = document.getElementById('request-input');
const button = document.getElementById('request-btn');
const note = document.getElementById('request-note');
const filter = document.getElementById('filter-input');

const MIN = 3; // mirrors REQUEST_MIN in src/gaugeRequest.ts; the Worker re-checks

function say(state, message) {
  note.dataset.state = state;
  note.textContent = message;
}

if (bar && form && input && button && note) {
  bar.hidden = false;

  // Searching for a run and finding nothing is exactly when someone wants to
  // request it — carry the search text over so they don't type it twice.
  input.addEventListener('focus', () => {
    if (input.value || !filter || !filter.value.trim()) return;
    const noMatches = document.querySelector('#gauge-body .message-row');
    if (noMatches) input.value = filter.value.trim();
  });

  input.addEventListener('input', () => say('', ''));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const request = input.value.trim();
    if (request.length < MIN) {
      say('error', 'Name the run or gauge you want added.');
      input.focus();
      return;
    }

    button.disabled = true;
    say('busy', 'Sending…');
    try {
      const res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ request, website: form.elements.website.value }),
      });
      // The Worker always answers JSON; anything else (a 404 page while the
      // route is still deploying, an edge error) falls through to the catch.
      const data = await res.json();
      if (res.ok && data.ok) {
        say('ok', data.message);
        input.value = '';
      } else {
        say('error', data.message || 'Could not send that — try again in a minute.');
      }
    } catch {
      say('error', 'Could not send that — check your connection and try again.');
    } finally {
      button.disabled = false;
    }
  });
}
