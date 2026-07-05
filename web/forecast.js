// Oracle signup: submit inline, swap the row for the verdict. Without JS the
// form still POSTs to /api/subscribe and gets a plain confirmation page.
document.querySelectorAll('form.signup-row').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    const email = form.querySelector('input[type="email"]').value;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
      const { ok, message } = await res.json();
      if (ok) {
        form.outerHTML = `<div class="signup-done">${message}</div>`;
      } else {
        button.disabled = false;
        button.textContent = form.dataset.cta;
        showNote(form, message);
      }
    } catch {
      button.disabled = false;
      button.textContent = form.dataset.cta;
      showNote(form, 'Signup hiccuped — try again in a minute.');
    }
  });
});

function showNote(form, message) {
  let note = form.querySelector('.signup-err');
  if (!note) {
    note = document.createElement('span');
    note.className = 'signup-err';
    form.appendChild(note);
  }
  note.textContent = message;
}
