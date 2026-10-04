/* Jury profile popup — shared by the homepage Jury sections and the /jury archive page.
   Cards carry data-jury-id; profiles come from jury_members (registered by the page after it loads them),
   so admin edits show up automatically and nothing is duplicated. Reuses the site's .ad-overlay / .ad-panel modal shell. */
window.SKJury = (function () {
  'use strict';

  const profiles = new Map();          // id → jury_members row
  let modal = null, lastFocus = null;
  const EDITION = (() => { try { const y = new Date(PORTAL_TIMELINES.submissionDeadline).getFullYear(); return y > 2000 ? y : 0; } catch (e) { return 0; } })();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidy = t => String(t || '').replace(/[ \t]+/g, ' ').trim();
  const isUrl = u => /^https?:\/\//i.test(u || '');

  function register(list) { (list || []).forEach(m => { if (m && m.id != null) profiles.set(String(m.id), m); }); }

  // editions this one profile has served — "2026 Jury" first, then earlier editions
  function editionsOf(m) {
    const out = [];
    if (m.jury_type === 'current' || (EDITION && Number(m.current_edition) === EDITION)) out.push((EDITION || m.edition_year || '') + ' Jury');
    if (m.jury_type === 'previous' && m.edition_year && Number(m.edition_year) !== EDITION) out.push(m.edition_year + ' Edition Jury');
    return out.filter(s => /\S/.test(s.replace('Jury', '')));
  }

  function build() {
    modal = document.createElement('div');
    modal.id = 'juryProfileModal';
    modal.className = 'ad-overlay jp-overlay';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'jpName');
    modal.innerHTML = `<div class="ad-panel jp-panel">
        <button type="button" class="ad-close" aria-label="Close jury profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="ad-scroll"><article class="jp-body" id="jpBody"></article></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.ad-close')) close(); });
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;                       // keep focus inside the dialog
      const f = [...modal.querySelectorAll('button, a[href]')].filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function open(id, origin) {
    const m = profiles.get(String(id));
    if (!m) return false;
    if (!modal) build();
    const name = tidy(m.name), role = tidy(m.designation || m.role), photo = m.photo_url || m.src || '';
    const bio = String(m.bio || '').split(/\n\s*\n|\r?\n/).map(tidy).filter(Boolean);
    const links = [['imdb_url', 'IMDb'], ['instagram_url', 'Instagram'], ['website_url', 'Website']].filter(([k]) => isUrl(m[k]));
    const eds = editionsOf(m);
    modal.querySelector('#jpBody').innerHTML = `
      <div class="jp-photo">${photo ? `<img src="${esc(photo)}" alt="${esc(name)}">` : '<span class="jp-silhouette" aria-hidden="true"></span>'}</div>
      <div class="jp-info">
        ${eds.length ? `<p class="jp-edition">${eds.map(esc).join(' · ')}</p>` : ''}
        <h2 class="jp-name" id="jpName">${esc(name)}</h2>
        ${role ? `<p class="jp-role">${esc(role)}</p>` : ''}
        ${bio.length ? `<div class="jp-bio">${bio.map(p => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
        ${links.length ? `<p class="jp-links">${links.map(([k, l]) => `<a href="${esc(m[k])}" target="_blank" rel="noopener noreferrer">${l} <span aria-hidden="true">&nearr;</span></a>`).join('')}</p>` : ''}
      </div>`;
    lastFocus = origin || document.activeElement;   // the card itself, so focus returns there on close
    modal.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-open')));
    document.body.style.overflow = 'hidden';            // page stays where it was — closing returns to the same spot
    const sc = modal.querySelector('.ad-scroll'); if (sc) sc.scrollTop = 0;
    setTimeout(() => { const c = modal.querySelector('.ad-close'); if (c) c.focus({ preventScroll: true }); }, 60);
    return true;
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { modal.hidden = true; }, 420);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  // any card or photo with data-jury-id opens its profile (its own links still work normally)
  document.addEventListener('click', e => {
    const card = e.target.closest('[data-jury-id]');
    if (!card || e.target.closest('a[href]')) return;
    if (open(card.dataset.juryId, card)) e.preventDefault();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest && e.target.closest('[data-jury-id]');
    if (!card || e.target !== card) return;
    e.preventDefault(); open(card.dataset.juryId, card);
  });

  return { register, open, close };
})();
