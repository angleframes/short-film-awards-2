/* Festival Resources — shared markup for the data-driven sections (Guidelines, Updates, Jury).
   Used twice with identical output:
   • tools/build-pages.mjs pre-renders it into the static pages, so search engines see real content;
   • assets/js/resources.js re-renders it in the browser from live data (config.js / Supabase).
   Plain functions, no DOM access — safe to load in Node. */
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidy = t => String(t || '').replace(/\s+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');

  // numbered guideline cards (titles/texts come from config.js GUIDELINES_ITEMS or the homepage rules — trusted site copy)
  function guidelinesHtml(items) {
    return (items || []).map((g, i) => `<li class="rs-card rs-guide">
        <span class="rs-guide-num" aria-hidden="true">${pad(i + 1)}</span>
        <h3 class="rs-card-title"><span class="rs-sr">${i + 1}. </span>${g.title}</h3>
        <p class="rs-card-text">${g.text}</p></li>`).join('');
  }

  // updates: [{ date, title, text }] — same badge rules as the former homepage feed
  function updatesHtml(list) {
    if (!list || !list.length) return '<div class="rs-note"><p>No festival updates yet. New announcements will appear here soon.</p></div>';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return list.map(u => {
      const d = tidy(u.date), parsed = new Date(d);
      const date = d && !isNaN(parsed) && /\d{4}/.test(d)
        ? `<span class="rs-upd-day">${parsed.getDate()}</span><span class="rs-upd-month">${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}</span>`
        : `<span class="rs-upd-label">${esc(d || '—')}</span>`;
      const all = ((u.title || '') + ' ' + (u.text || '')).toLowerCase();
      const badge = /important|urgent|deadline|last.?day/.test(all) ? 'Important' : /open|new|launch|announcing|coming|release|reveal|first/.test(all) ? 'New' : 'Info';
      return `<article class="rs-card rs-update">
          <div class="rs-upd-date">${date}</div>
          <div class="rs-upd-body"><span class="rs-upd-badge is-${badge.toLowerCase()}">${badge}</span>
            <h3 class="rs-card-title">${esc(u.title)}</h3><p class="rs-card-text">${esc(u.text)}</p></div>
        </article>`;
    }).join('');
  }

  // jury members as published in Admin → Jury (RLS returns visible members only)
  function jurorHtml(m) {
    const photo = m.photo_url || m.src || '', name = tidy(m.name), role = tidy(m.designation || m.role), bio = tidy(m.bio);
    return `<article class="rs-card rs-juror">
        <div class="rs-juror-photo">${photo ? `<img src="${esc(photo)}" alt="${esc(name)}, jury member — Sharankrishna Short Film Awards${m.edition_year ? ' ' + esc(m.edition_year) : ''}" width="96" height="96" loading="lazy" decoding="async">` : '<span aria-hidden="true"></span>'}</div>
        <h3 class="rs-card-title">${esc(name)}</h3>${role ? `<p class="rs-juror-role">${esc(role)}</p>` : ''}${bio ? `<p class="rs-card-text rs-juror-bio">${esc(bio)}</p>` : ''}
      </article>`;
  }
  // current jury (incl. earlier members re-appointed via current_edition) + an archive grouped by each member's own edition
  function juryHtml(members, note, edition) {
    const real = (members || []).filter(m => m && tidy(m.name) && !/to be announced/i.test(m.name));
    const byOrder = (a, b) => (a.display_order || 0) - (b.display_order || 0);
    const isCur = m => (m.jury_type || 'current') === 'current' || (edition && Number(m.current_edition) === Number(edition));
    const current = real.filter(isCur).sort(byOrder);
    const previous = real.filter(m => m.jury_type === 'previous');
    let html = `<section class="rs-group" aria-labelledby="rsJuryCurrent"><h2 class="rs-group-title" id="rsJuryCurrent">${edition ? esc(edition) + ' Edition Jury' : 'Current Edition'}</h2>`;
    html += current.length ? `<div class="rs-grid rs-jury">${current.map(jurorHtml).join('')}</div>`
      : `<div class="rs-note"><p>${note}</p><a class="rs-link" href="/#section-jury">View the Jury section <span aria-hidden="true">&rarr;</span></a></div>`;
    html += '</section>';
    const years = [...new Set(previous.map(m => m.edition_year || ''))].sort((a, b) => (b || 0) - (a || 0));
    years.forEach(y => {
      const list = previous.filter(m => (m.edition_year || '') === y).sort(byOrder);
      html += `<section class="rs-group" aria-labelledby="rsJury${y || 'Earlier'}"><h2 class="rs-group-title" id="rsJury${y || 'Earlier'}">${y ? esc(y) + ' Edition Jury' : 'Previous Jury'}</h2>
        <div class="rs-grid rs-jury">${list.map(jurorHtml).join('')}</div></section>`;
    });
    return html;
  }

  root.SKResources = { esc, guidelinesHtml, updatesHtml, juryHtml };
})(typeof window !== 'undefined' ? window : globalThis);
