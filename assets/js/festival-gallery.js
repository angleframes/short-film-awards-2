/* Full Festival Gallery (/festival-gallery)
   Master gallery: gallery_media (Admin → Festival Gallery) + jury photos flagged "Show in Festival Gallery"
   (Admin → Jury). Jury items reference the jury member's own photo_url, so photo updates carry over.
   Filters: ?filter=all|photos|videos|<category key>|previous-jury */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7,4.5 19.5,12 7,19.5" fill="currentColor"/></svg>';
  const ALIASES = { winners: 'award-winners', moments: 'festival-moments', messages: 'messages-of-support', bts: 'behind-the-scenes', highlights: 'festival-highlights', photo: 'photos', video: 'videos' };

  let items = [];          // normalised media
  let categories = [];     // media_categories rows
  let previousJury = [];   // all visible previous jury (roster view)
  let active = 'all';
  let view = [];           // items in the current filter (lightbox order)
  let lbIndex = -1;

  function ytId(url) {
    const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/i);
    return m ? m[1] : (/^[\w-]{11}$/.test(url || '') ? url : '');
  }
  function catLabel(key) {
    if (key === 'jury') return 'Jury';
    const c = categories.find(x => x.key === key);
    return c ? c.label : '';
  }

  async function load() {
    if (!window.supabase || typeof SUPA_URL === 'undefined') throw new Error('offline');
    const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON);
    const [catRes, medRes, juryRes] = await Promise.all([
      sb.from('media_categories').select('*').order('sort_order'),
      sb.from('gallery_media').select('*').order('is_featured', { ascending: false }).order('display_order').order('created_at'),
      sb.from('jury_members').select('id,name,designation,bio,photo_url,edition_year,jury_type,display_order,show_in_gallery')
        .order('edition_year', { ascending: false, nullsFirst: false }).order('display_order'),
    ]);
    if (medRes.error) throw medRes.error;
    categories = catRes.data || [];
    const media = (medRes.data || []).map(m => {
      const id = m.media_type === 'video' ? ytId(m.video_url) : '';
      return {
        type: m.media_type, category: m.category, title: m.title || '', desc: m.description || '', year: m.edition_year,
        featured: !!m.is_featured,
        full: m.image_url || '',
        thumb: m.thumbnail_url || m.image_url || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''),
        video: m.video_url || '', ytid: id,
      };
    });
    const jury = (juryRes.data || []);
    previousJury = jury.filter(j => j.jury_type === 'previous');
    const juryItems = jury.filter(j => j.show_in_gallery && j.photo_url).map(j => ({
      type: 'photo', category: 'jury', title: j.name, desc: [j.designation, j.bio].filter(Boolean).join(' — '),
      year: j.edition_year, juryType: j.jury_type, full: j.photo_url, thumb: j.photo_url, portrait: true,
    }));
    items = media.concat(juryItems);
  }

  function filterKeys() {
    const keys = [['all', 'All'], ['photos', 'Photos'], ['videos', 'Videos']];
    categories.filter(c => c.show_in_filter).forEach(c => keys.push([c.key, c.label]));
    if (!keys.some(k => k[0] === 'jury')) keys.push(['jury', 'Jury']);
    if (active === 'previous-jury') keys.push(['previous-jury', 'Previous Jury']);
    else if (!keys.some(k => k[0] === active)) keys.push([active, catLabel(active) || active]);
    return keys;
  }

  function renderFilters() {
    $('fgFilters').innerHTML = filterKeys().map(([k, l]) =>
      `<button type="button" role="tab" class="fg-chip${k === active ? ' is-active' : ''}" aria-selected="${k === active}" data-k="${esc(k)}">${esc(l)}</button>`).join('');
  }

  function select(key) {
    if (key === 'photos') return items.filter(i => i.type === 'photo');
    if (key === 'videos') return items.filter(i => i.type === 'video');
    if (key === 'all') return items;
    return items.filter(i => i.category === key);
  }

  function card(it, idx) {
    const cls = ['fg-card', it.type === 'video' ? 'is-video' : '', it.portrait ? 'is-portrait' : '', it.featured && active === 'all' ? 'is-featured' : ''].join(' ').trim();
    const meta = [catLabel(it.category), it.year].filter(Boolean).join(' · ');
    return `<button type="button" class="${cls}" data-i="${idx}" aria-label="${it.type === 'video' ? 'Play' : 'Open'}: ${esc(it.title || meta)}">
        <span class="fg-thumb"><img src="${esc(it.thumb)}" alt="${esc(it.title)}" loading="lazy" decoding="async"${it.ytid ? ` data-ytid="${esc(it.ytid)}"` : ''}>
          ${it.type === 'video' ? `<span class="fg-play">${PLAY}</span>` : ''}</span>
        <span class="fg-card-text">${meta ? `<span class="fg-card-meta">${esc(meta)}</span>` : ''}${it.title ? `<span class="fg-card-title">${esc(it.title)}</span>` : ''}</span>
      </button>`;
  }

  function renderRoster() {
    view = [];
    if (!previousJury.length) { $('fgContent').innerHTML = '<p class="fg-empty">The previous jury will appear here soon.</p>'; return; }
    const groups = new Map();
    previousJury.forEach(j => { const k = j.edition_year || 'Earlier'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); });
    let html = '';
    groups.forEach((list, year) => {
      html += `<section class="fg-group"><h2 class="fg-group-title">${esc(year)}${year === 'Earlier' ? ' Editions' : ' Edition'}</h2><div class="fg-roster">` +
        list.map(j => {
          const i = j.photo_url ? view.push({ type: 'photo', category: 'jury', title: j.name, desc: [j.designation, j.bio].filter(Boolean).join(' — '), year: j.edition_year, full: j.photo_url, thumb: j.photo_url }) - 1 : -1;
          return `<article class="fg-person">
            ${i >= 0 ? `<button type="button" class="fg-card is-portrait" data-i="${i}" aria-label="Open: ${esc(j.name)}"><span class="fg-thumb"><img src="${esc(j.photo_url)}" alt="${esc(j.name)}" loading="lazy" decoding="async"></span></button>` : '<span class="fg-thumb fg-thumb-empty" aria-hidden="true"></span>'}
            <h3>${esc(j.name)}</h3>${j.designation ? `<p class="fg-person-role">${esc(j.designation)}</p>` : ''}${j.bio ? `<p class="fg-person-bio">${esc(j.bio)}</p>` : ''}
          </article>`;
        }).join('') + '</div></section>';
    });
    $('fgContent').innerHTML = html;
  }

  function render() {
    renderFilters();
    if (active === 'previous-jury') return renderRoster();
    view = select(active);
    if (!view.length) { $('fgContent').innerHTML = '<p class="fg-empty">Nothing here yet — new photographs and films will appear as they are added.</p>'; return; }
    if (active === 'jury') {
      // group jury photos: current jury first, then previous editions by year
      const groups = new Map();
      view.forEach((it, i) => { const k = it.juryType === 'current' ? 'Current Jury' : (it.year ? it.year + ' Edition' : 'Previous Jury'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([it, i]); });
      $('fgContent').innerHTML = [...groups].map(([t, list]) =>
        `<section class="fg-group"><h2 class="fg-group-title">${esc(t)}</h2><div class="fg-grid is-people">${list.map(([it, i]) => card(it, i)).join('')}</div></section>`).join('');
    } else {
      $('fgContent').innerHTML = `<div class="fg-grid">${view.map(card).join('')}</div>`;
    }
    $('fgContent').querySelectorAll('img[data-ytid]').forEach(img => img.addEventListener('error', () => {
      if (!img.dataset.f) { img.dataset.f = 1; img.src = `https://i.ytimg.com/vi/${img.dataset.ytid}/mqdefault.jpg`; }
    }, { once: false }));
  }

  function setFilter(k, push) {
    active = ALIASES[k] || k || 'all';
    render();
    if (push !== false) {
      const url = active === 'all' ? location.pathname : `${location.pathname}?filter=${encodeURIComponent(active)}`;
      history.replaceState(null, '', url);
    }
  }

  /* ---------- lightbox ---------- */
  let lastFocus = null;
  function openLb(i) {
    if (!view[i]) return;
    lbIndex = i;
    const it = view[i];
    const media = $('fgLbMedia');
    if (it.type === 'video') {
      media.innerHTML = it.ytid
        ? `<div class="fg-lb-video"><iframe src="https://www.youtube.com/embed/${esc(it.ytid)}?autoplay=1&rel=0" title="${esc(it.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
        : `<div class="fg-lb-video"><video src="${esc(it.video)}" controls autoplay playsinline></video></div>`;
    } else {
      media.innerHTML = `<img src="${esc(it.full || it.thumb)}" alt="${esc(it.title)}">`;
    }
    $('fgLbMeta').textContent = [catLabel(it.category), it.year].filter(Boolean).join(' · ');
    $('fgLbTitle').textContent = it.title || '';
    $('fgLbDesc').textContent = it.desc || '';
    const multi = view.length > 1;
    $('fgLbPrev').hidden = !multi; $('fgLbNext').hidden = !multi;
    const lb = $('fgLightbox');
    if (lb.hidden) { lastFocus = document.activeElement; lb.hidden = false; document.body.style.overflow = 'hidden'; $('fgLbClose').focus(); }
  }
  function closeLb() {
    const lb = $('fgLightbox');
    if (lb.hidden) return;
    lb.hidden = true; $('fgLbMedia').innerHTML = ''; document.body.style.overflow = '';
    lbIndex = -1; if (lastFocus) lastFocus.focus();
  }
  const step = d => { if (lbIndex >= 0 && view.length) openLb((lbIndex + d + view.length) % view.length); };

  function bind() {
    $('fgFilters').addEventListener('click', e => { const b = e.target.closest('.fg-chip'); if (b) setFilter(b.dataset.k); });
    $('fgContent').addEventListener('click', e => { const c = e.target.closest('.fg-card'); if (c) openLb(+c.dataset.i); });
    $('fgLbClose').addEventListener('click', closeLb);
    $('fgLbPrev').addEventListener('click', () => step(-1));
    $('fgLbNext').addEventListener('click', () => step(1));
    $('fgLightbox').addEventListener('click', e => { if (e.target === $('fgLightbox')) closeLb(); });
    document.addEventListener('keydown', e => {
      if ($('fgLightbox').hidden) return;
      if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
    });
    let sx = 0, sy = 0;
    $('fgLbMedia').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    $('fgLbMedia').addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && view[lbIndex] && view[lbIndex].type !== 'video') step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bind();
    const q = new URLSearchParams(location.search).get('filter');
    try { await load(); }
    catch (e) { $('fgContent').innerHTML = '<p class="fg-empty">The gallery could not be loaded right now. Please try again shortly.</p>'; console.warn('Festival gallery load failed', e); return; }
    setFilter(q || 'all', false);
  });
})();
