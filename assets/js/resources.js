/* Festival Resources (/resources) — How To Submit, Guidelines, Updates, Jury Panel, FAQ, Privacy, Terms, Refunds.
   One page, one section visible at a time. ?section=<key> keeps the choice in the URL (homepage links use it).
   Content is the same as the former homepage popup: static sections live in resources.html; Guidelines come from
   config.js (GUIDELINES_ITEMS), Updates from updates_feed (fallback UPDATES_FEED) and the jury from jury_members
   (fallback JURY_PANEL), exactly as before. */
(function () {
  'use strict';

  const KEYS = ['submit', 'guidelines', 'updates', 'jury', 'faq', 'privacy', 'terms', 'refunds'];
  const ALIAS = { 'how-to-submit': 'submit', refund: 'refunds', 'jury-panel': 'jury', rules: 'guidelines' };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidy = t => String(t || '').replace(/\s+/g, ' ').trim();
  let current = 'submit';

  /* ---------- sections ---------- */
  function keyFrom(v) { v = String(v || '').toLowerCase(); v = ALIAS[v] || v; return KEYS.includes(v) ? v : null; }
  function show(key, opts) {
    key = keyFrom(key) || 'submit';
    current = key;
    KEYS.forEach(k => {
      const on = k === key, tab = $('rsTab-' + k), pane = $('rsPane-' + k);
      if (pane) pane.hidden = !on;
      if (tab) { tab.classList.toggle('is-active', on); tab.setAttribute('aria-selected', on); tab.tabIndex = on ? 0 : -1; }
    });
    const tab = $('rsTab-' + key);
    if (tab && tab.scrollIntoView) {   // keep the active tab visible in the scrollable bar on phones
      const bar = tab.parentElement, l = tab.offsetLeft - bar.offsetLeft, r = l + tab.offsetWidth;
      if (l < bar.scrollLeft || r > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: l - 16, behavior: opts && opts.initial ? 'auto' : 'smooth' });
    }
    if (!opts || !opts.initial) {
      const url = '/resources' + (key === 'submit' ? '' : '?section=' + key);
      if (opts && opts.replace) history.replaceState({ section: key }, '', url); else history.pushState({ section: key }, '', url);
      // bring the section header into view if the visitor has scrolled past the tabs
      const nav = document.querySelector('.rs-nav');
      if (nav && nav.getBoundingClientRect().top < 0) window.scrollTo({ top: nav.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
    }
    document.title = (key === 'submit' ? 'Festival Resources' : ($('rsHead-' + key) || {}).textContent || 'Festival Resources') + ' | Sharankrishna Short Film Awards';
  }

  document.addEventListener('click', e => {
    const tab = e.target.closest('.rs-tab');
    if (tab && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); if (tab.dataset.section !== current) show(tab.dataset.section); return; }
    // in-FAQ links (same targets as before: other resource sections, the rules popup, homepage sections)
    const go = e.target.closest('a[data-faq-go]');
    if (go) {
      const t = go.dataset.faqGo;
      if (keyFrom(t) && t !== 'rules') { e.preventDefault(); show(t); }
      else if (t === 'rules') { e.preventDefault(); location.href = '/#rules'; }
      else if (/^section-/.test(t)) { e.preventDefault(); location.href = '/#' + t; }
    }
  });
  document.addEventListener('keydown', e => {
    const tab = e.target.closest && e.target.closest('.rs-tab');
    if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const i = KEYS.indexOf(tab.dataset.section), n = KEYS[(i + (e.key === 'ArrowRight' ? 1 : -1) + KEYS.length) % KEYS.length];
    show(n); $('rsTab-' + n).focus();
  });
  window.addEventListener('popstate', () => show(new URLSearchParams(location.search).get('section') || 'submit', { initial: true }));

  /* ---------- FAQ accordion (single open) ---------- */
  const faq = $('faqAccordion');
  if (faq) faq.addEventListener('click', e => {
    const btn = e.target.closest('.faq-q'); if (!btn) return;
    const item = btn.closest('.faq-item'), opening = !item.classList.contains('open');
    faq.querySelectorAll('.faq-item.open').forEach(i => { i.classList.remove('open'); i.querySelector('.faq-q').setAttribute('aria-expanded', 'false'); });
    if (opening) { item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  });

  /* ---------- Guidelines (config.js) ---------- */
  function renderGuidelines() {
    const box = $('guidelinesListContainer');
    if (!box || typeof GUIDELINES_ITEMS === 'undefined') return;
    box.innerHTML = GUIDELINES_ITEMS.map((g, i) => `<li class="rs-card rs-guide">
        <span class="rs-guide-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <h3 class="rs-card-title"><span class="rs-sr">${i + 1}. </span>${g.title}</h3>
        <p class="rs-card-text">${g.text}</p></li>`).join('');
  }

  /* ---------- Updates (updates_feed → fallback UPDATES_FEED) ---------- */
  function renderUpdates(list) {
    const box = $('updatesListContainer');
    if (!box) return;
    if (!list || !list.length) { box.innerHTML = '<div class="rs-note"><p>No festival updates yet. New announcements will appear here soon.</p></div>'; return; }
    box.innerHTML = list.map(u => {
      const d = tidy(u.date), parsed = new Date(d);
      const date = d && !isNaN(parsed) && /\d{4}/.test(d)
        ? `<span class="rs-upd-day">${parsed.getDate()}</span><span class="rs-upd-month">${parsed.toLocaleDateString('en-IN', { month: 'short' })} ${parsed.getFullYear()}</span>`
        : `<span class="rs-upd-label">${esc(d || '—')}</span>`;
      const all = ((u.title || '') + ' ' + (u.text || '')).toLowerCase();
      const badge = /important|urgent|deadline|last.?day/.test(all) ? 'Important' : /open|new|launch|announcing|coming|release|reveal|first/.test(all) ? 'New' : 'Info';
      return `<article class="rs-card rs-update">
          <div class="rs-upd-date">${date}</div>
          <div class="rs-upd-body"><span class="rs-upd-badge is-${badge.toLowerCase()}">${badge}</span>
            <h3 class="rs-card-title">${u.title || ''}</h3><p class="rs-card-text">${u.text || ''}</p></div>
        </article>`;
    }).join('');
  }

  /* ---------- Jury panel (jury_members → fallback JURY_PANEL) ---------- */
  function renderJury(members) {
    const grid = $('juryPanelGrid'), note = $('juryPanelNote');
    if (!grid) return;
    const list = (members || []).filter(m => m && tidy(m.name) && !/to be announced/i.test(m.name));
    grid.innerHTML = list.map(m => {
      const photo = m.photo_url || m.src || '', role = tidy(m.designation || m.role);
      return `<article class="rs-card rs-juror">
          <div class="rs-juror-photo">${photo ? `<img src="${esc(photo)}" alt="${esc(tidy(m.name))}" loading="lazy" decoding="async">` : '<span aria-hidden="true"></span>'}</div>
          <h3 class="rs-card-title">${esc(tidy(m.name))}</h3>${role ? `<p class="rs-card-text">${esc(role)}</p>` : ''}
        </article>`;
    }).join('');
    grid.hidden = !list.length;
    if (note) note.hidden = !!list.length;
  }

  /* ---------- start ---------- */
  renderGuidelines();
  renderUpdates(typeof UPDATES_FEED !== 'undefined' ? UPDATES_FEED : []);
  renderJury(typeof JURY_PANEL !== 'undefined' ? JURY_PANEL : []);
  show(new URLSearchParams(location.search).get('section') || 'submit', { initial: true });
  if (window.supabase && typeof SUPA_URL !== 'undefined') {
    const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON);
    sb.from('updates_feed').select('*').order('sort_order').order('created_at', { ascending: false }).then(r => {
      if (r && !r.error && Array.isArray(r.data) && r.data.length) renderUpdates(r.data.map(u => ({ date: u.date_label || '', title: u.title || '', text: u.body || '' })));
    });
    sb.from('jury_members').select('name,designation,photo_url,jury_type,display_order').eq('jury_type', 'current').order('display_order').then(r => {
      if (r && !r.error && Array.isArray(r.data)) renderJury(r.data);
    });
  }
})();
