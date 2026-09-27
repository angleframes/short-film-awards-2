/* Full Festival Gallery (/festival-gallery)
   Master gallery: gallery_media (Admin → Festival Gallery) + jury photos flagged "Show in Festival Gallery"
   (Admin → Jury). Jury items reference the jury member's own photo_url, so photo updates carry over.
   Filters: ?filter=all|photos|videos|<category key>|previous-jury */
(function () {
  'use strict';

  const tidy = t => String(t || '').replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7,4.5 19.5,12 7,19.5" fill="currentColor"/></svg>';
  const ALIASES = { winners: 'award-winners', moments: 'festival-moments', messages: 'messages-of-support', bts: 'behind-the-scenes', highlights: 'festival-highlights', photo: 'photos', video: 'videos' };

  let items = [];          // normalised media
  let categories = [];     // media_categories rows
  let previousJury = [];   // all visible previous jury (roster view)
  let active = 'all';
  let subTrack = 'all', subGroup = 'all';   // extra filters inside Award Winners
  let awardMap = new Map();                 // award_categories id → { key, name } (live names from Admin → Awards)
  const TRACKS = { general: 'General', campus: 'Campus' };
  const GROUPS = [['film', 'Best Film'], ['director', 'Director'], ['actor', 'Actor'], ['actress', 'Actress'], ['technical', 'Technical'], ['special', 'Special Jury'], ['other', 'Other Awards']];
  function awardGroup(key, name) {
    const k = String(key || name || '').toLowerCase();
    if (/special/.test(k)) return 'special';
    if (/short_film|campus_film|best short film|best campus film|best film/.test(k)) return 'film';
    if (/director/.test(k) && !/music/.test(k)) return 'director';
    if (/actress/.test(k)) return 'actress';
    if (/actor/.test(k)) return 'actor';
    if (/screenplay|writer|cinematograph|edit|music|sound|art/.test(k)) return 'technical';
    return 'other';
  }
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
    const [catRes, medRes, juryRes, awRes] = await Promise.all([
      sb.from('media_categories').select('*').order('sort_order'),
      sb.from('gallery_media').select('*').order('is_featured', { ascending: false }).order('display_order').order('created_at'),
      sb.from('jury_members').select('id,name,designation,bio,photo_url,edition_year,jury_type,display_order,show_in_gallery')
        .order('edition_year', { ascending: false, nullsFirst: false }).order('display_order'),
      sb.from('award_categories').select('id,key,name'),
    ]);
    (awRes && awRes.data || []).forEach(a => awardMap.set(String(a.id), a));
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
        winner: m.category === 'award-winners' && (m.award_id || m.award_name) ? winnerInfo(m) : null,
      };
    });
    const jury = (juryRes.data || []).map(j => Object.assign(j, { name: tidy(j.name), designation: tidy(j.designation), bio: tidy(j.bio) }));
    previousJury = jury.filter(j => j.jury_type === 'previous');
    const juryItems = jury.filter(j => j.show_in_gallery && j.photo_url).map(j => ({
      type: 'photo', category: 'jury', title: j.name, desc: [j.designation, j.bio].filter(Boolean).join(' — '),
      year: j.edition_year, juryType: j.jury_type, full: j.photo_url, thumb: j.photo_url, portrait: true,
    }));
    items = media.concat(juryItems);
  }

  // Structured award-winner display: award · track · year / primary name / secondary line
  function winnerInfo(m) {
    const a = awardMap.get(String(m.award_id)) || {};
    const award = a.name || m.award_name || 'Award';
    const group = awardGroup(a.key, award);
    const film = tidy(m.film_name), person = tidy(m.winner_name);
    const filmFirst = group === 'film' || (group === 'special' && m.recipient_type !== 'person');
    const primary = filmFirst ? (film || person) : (person || film);
    let secondary = '';
    if (filmFirst && person && film) secondary = group === 'film' ? `Directed by ${person}` : person;
    if (!filmFirst && person && film) secondary = `Film: ${film}`;
    return { award, group, track: m.competition_track || '', primary, secondary };
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
    const list = items.filter(i => i.category === key);
    if (key !== 'award-winners') return list;
    return list.filter(i => (subTrack === 'all' || (i.winner && i.winner.track === subTrack))
      && (subGroup === 'all' || (i.winner ? i.winner.group : 'other') === subGroup));
  }

  // Track / award-type chips — shown only when there is enough winner data to split
  function renderSubFilters() {
    let el = $('fgSubFilters');
    if (!el) { el = document.createElement('div'); el.id = 'fgSubFilters'; el.className = 'fg-subfilters'; $('fgFilters').after(el); }
    if (active !== 'award-winners') { el.hidden = true; el.innerHTML = ''; return; }
    const winners = items.filter(i => i.category === 'award-winners');
    const tracks = [...new Set(winners.map(i => i.winner && i.winner.track).filter(Boolean))];
    const groups = GROUPS.filter(([g]) => winners.some(i => (i.winner ? i.winner.group : 'other') === g));
    const row = (name, cur, opts) => `<div class="fg-subrow" role="group" aria-label="${name}">${opts.map(([k, l]) =>
      `<button type="button" class="fg-subchip${k === cur ? ' is-active' : ''}" aria-pressed="${k === cur}" data-sub="${name}" data-k="${k}">${esc(l)}</button>`).join('')}</div>`;
    let html = '';
    if (tracks.length > 1) html += row('track', subTrack, [['all', 'All tracks'], ...tracks.map(t => [t, TRACKS[t] || t])]);
    if (groups.length > 1) html += row('award', subGroup, [['all', 'All awards'], ...groups]);
    el.innerHTML = html; el.hidden = !html;
  }

  function metaOf(it) {
    if (it.winner) return [it.winner.award, TRACKS[it.winner.track], it.year].filter(Boolean).join(' · ');
    return [catLabel(it.category), it.year].filter(Boolean).join(' · ');
  }

  function card(it, idx) {
    const cls = ['fg-card', it.type === 'video' ? 'is-video' : '', it.portrait ? 'is-portrait' : '', it.featured && active === 'all' ? 'is-featured' : ''].join(' ').trim();
    const meta = metaOf(it);
    if (it.winner) {
      return `<button type="button" class="${cls} is-winner" data-i="${idx}" aria-label="Open: ${esc(meta)} — ${esc(it.winner.primary)}">
        <span class="fg-thumb"><img src="${esc(it.thumb)}" alt="${esc(it.winner.primary)}" loading="lazy" decoding="async"${it.ytid ? ` data-ytid="${esc(it.ytid)}"` : ''}>
          ${it.type === 'video' ? `<span class="fg-play">${PLAY}</span>` : ''}</span>
        <span class="fg-card-text"><span class="fg-card-meta">${esc(meta)}</span><span class="fg-card-title">${esc(it.winner.primary)}</span>${it.winner.secondary ? `<span class="fg-card-sub">${esc(it.winner.secondary)}</span>` : ''}</span>
      </button>`;
    }
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
            <h3>${esc(j.name)}</h3>${j.designation ? `<p class="fg-person-role">${esc(j.designation)}</p>` : ''}${j.bio ? `<p class="fg-person-bio">${esc(j.bio)}</p><button type="button" class="fg-bio-toggle" aria-expanded="false" hidden>Read full bio</button>` : ''}
          </article>`;
        }).join('') + '</div></section>';
    });
    $('fgContent').innerHTML = html;
    // show "Read full bio" only where the clamp actually hides text
    $('fgContent').querySelectorAll('.fg-person-bio').forEach(p => {
      const btn = p.nextElementSibling;
      if (btn && p.scrollHeight > p.clientHeight + 2) btn.hidden = false;
    });
  }

  function render() {
    renderFilters();
    renderSubFilters();
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

  function syncUrl() {
    const q = new URLSearchParams();
    if (active !== 'all') q.set('filter', active);
    if (active === 'award-winners' && subTrack !== 'all') q.set('track', subTrack);
    if (active === 'award-winners' && subGroup !== 'all') q.set('award', subGroup);
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  }
  function setFilter(k, push) {
    const next = ALIASES[k] || k || 'all';
    if (next !== active) { subTrack = 'all'; subGroup = 'all'; }
    active = next;
    render();
    if (push !== false) syncUrl();
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
    $('fgLbMeta').textContent = metaOf(it);
    $('fgLbTitle').textContent = it.winner ? it.winner.primary : (it.title || '');
    $('fgLbDesc').textContent = it.winner ? [it.winner.secondary, it.desc && !/^winner \d{4}$/i.test(it.desc) ? it.desc : ''].filter(Boolean).join(' — ') : (it.desc || '');
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
    document.addEventListener('click', e => {
      const b = e.target.closest('.fg-subchip'); if (!b) return;
      if (b.dataset.sub === 'track') subTrack = b.dataset.k; else subGroup = b.dataset.k;
      render(); syncUrl();
    });
    $('fgContent').addEventListener('click', e => {
      const t = e.target.closest('.fg-bio-toggle');
      if (t) { const open = t.previousElementSibling.classList.toggle('is-open'); t.setAttribute('aria-expanded', open); t.textContent = open ? 'Show less' : 'Read full bio'; return; }
      const c = e.target.closest('.fg-card'); if (c) openLb(+c.dataset.i);
    });
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
    const qs = new URLSearchParams(location.search);
    setFilter(q || 'all', false);
    if (active === 'award-winners' && (qs.get('track') || qs.get('award'))) { subTrack = qs.get('track') || 'all'; subGroup = qs.get('award') || 'all'; render(); }
  });
})();
