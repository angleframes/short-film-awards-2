/* Festival Resources pages (/how-to-submit, /guidelines, /festival-updates, /jury, /faq, policies) and category pages.
   The HTML is pre-rendered by tools/build-pages.mjs so every page is crawlable; this script only adds
   behaviour and refreshes the data-driven sections from live data (same markup via resources-render.js). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  // keep the active tab visible in the scrollable section bar on phones
  const active = document.querySelector('.rs-tab.is-active');
  if (active) {
    const bar = active.parentElement, b = bar.getBoundingClientRect(), r = active.getBoundingClientRect();
    if (r.right > b.right) bar.scrollLeft += r.left - b.left - 16;
  }

  // FAQ accordion (single open)
  const faq = $('faqAccordion');
  if (faq) {
    const openItem = (item, on) => { item.classList.toggle('open', on); item.querySelector('.faq-q').setAttribute('aria-expanded', on); };
    faq.addEventListener('click', e => {
      const btn = e.target.closest('.faq-q'); if (!btn) return;
      const item = btn.closest('.faq-item'), opening = !item.classList.contains('open');
      faq.querySelectorAll('.faq-item.open').forEach(i => openItem(i, false));
      if (opening) openItem(item, true);
    });
  }

  // live refresh of the data-driven sections (pre-rendered HTML stays if anything fails)
  const R = window.SKResources;
  if (!R) return;
  const g = $('guidelinesListContainer');
  if (g && typeof GUIDELINES_ITEMS !== 'undefined') g.innerHTML = R.guidelinesHtml(GUIDELINES_ITEMS);
  if (!window.supabase || typeof SUPA_URL === 'undefined') return;
  const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON);
  const upd = $('updatesListContainer');
  if (upd) sb.from('updates_feed').select('date_label,title,body').order('sort_order').order('created_at', { ascending: false }).then(r => {
    if (r && !r.error && Array.isArray(r.data) && r.data.length) upd.innerHTML = R.updatesHtml(r.data.map(u => ({ date: u.date_label || '', title: u.title || '', text: u.body || '' })));
  });
  const jury = $('juryPanelGrid');
  if (jury) sb.from('jury_members').select('id,name,designation,bio,photo_url,edition_year,jury_type,current_edition,display_order,instagram_url,imdb_url,website_url')
    .order('edition_year', { ascending: false, nullsFirst: false }).order('display_order').then(r => {
      if (r && !r.error && Array.isArray(r.data)) { if (window.SKJury) SKJury.register(r.data); jury.innerHTML = R.juryHtml(r.data, jury.dataset.note || '', jury.dataset.edition); }
    });
})();
