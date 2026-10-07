/* Admin password reset — completes Supabase's "reset password" email link.
   The link opens admin.html with a recovery session in the URL; this shows a "Set new password" panel
   (admin glass style, no browser popups), saves it with supabase.auth.updateUser, then continues to the panel.
   Normal email + password login is unchanged. Requires the global `sb` client from admin.js. */
(function () {
  'use strict';
  const flag = window.__skRecovery || {};
  if (!flag.recovery && !flag.error) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wrap = document.createElement('div');
  wrap.className = 'sk-reset-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'skResetTitle');
  document.body.appendChild(wrap);
  const clean = () => history.replaceState(null, '', location.pathname);

  if (flag.error) {
    wrap.innerHTML = `<div class="card sksfa-login-card sk-reset-card">
        <h1 id="skResetTitle">Link expired</h1>
        <p class="sub">${esc(flag.error)}</p>
        <p class="sk-reset-msg">Reset links work once and expire after a short time. Ask for a new reset email, then open the newest one.</p>
        <button type="button" class="btn" id="skResetBack">Back to login</button></div>`;
    wrap.querySelector('#skResetBack').addEventListener('click', () => { clean(); wrap.remove(); });
    return;
  }

  wrap.innerHTML = `<form class="card sksfa-login-card sk-reset-card" id="skResetForm" novalidate>
      <h1 id="skResetTitle">Set new password</h1>
      <p class="sub">Choose a new admin password</p>
      <label for="skPw1">New password</label>
      <input type="password" id="skPw1" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters">
      <label for="skPw2">Confirm password</label>
      <input type="password" id="skPw2" autocomplete="new-password" minlength="8" required placeholder="Type it again">
      <p class="sk-reset-msg" id="skResetMsg" role="alert"></p>
      <button type="submit" class="btn" id="skResetSave">Save password</button>
    </form>`;
  const form = wrap.querySelector('#skResetForm'), msg = wrap.querySelector('#skResetMsg'), save = wrap.querySelector('#skResetSave');
  setTimeout(() => wrap.querySelector('#skPw1').focus(), 50);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const a = wrap.querySelector('#skPw1').value, b = wrap.querySelector('#skPw2').value;
    msg.className = 'sk-reset-msg';
    if (a.length < 8) { msg.textContent = 'Use at least 8 characters.'; msg.classList.add('is-err'); return; }
    if (a !== b) { msg.textContent = 'The two passwords do not match.'; msg.classList.add('is-err'); return; }
    save.disabled = true; save.textContent = 'Saving…';
    // the recovery session comes from the link; wait briefly for supabase-js to pick it up
    let session = null;
    for (let i = 0; i < 20 && !session; i++) { session = (await sb.auth.getSession()).data.session; if (!session) await new Promise(r => setTimeout(r, 250)); }
    if (!session) { save.disabled = false; save.textContent = 'Save password'; msg.textContent = 'This reset link is no longer valid. Request a new reset email.'; msg.classList.add('is-err'); return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { save.disabled = false; save.textContent = 'Save password'; msg.textContent = error.message || 'Could not save the password.'; msg.classList.add('is-err'); return; }
    msg.textContent = 'Password saved. Opening the admin panel…'; msg.classList.add('is-ok');
    setTimeout(() => { clean(); location.reload(); }, 1200);
  });
})();
