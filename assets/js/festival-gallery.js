/* Full Festival Gallery (/festival-gallery)
   Master gallery: gallery_media (Admin → Festival Gallery) + jury photos flagged "Show in Festival Gallery"
   (Admin → Jury). Jury items reference the jury member's own photo_url, so photo updates carry over.
   Filters: ?filter=all|photos|videos|<category key>|previous-jury

   Scales to large libraries: records are fetched from the database in pages of PAGE items, filtered
   server-side (type / category / track / award), and more load automatically near the bottom.
   Cards use the small thumbnail (srcset → medium on dense screens); the full image loads only in the
   lightbox, which also preloads just the previous and next photo. Videos show a poster until opened. */
(function () {
  'use strict';

  const PAGE = 18;                       // records per batch
  const EAGER = 4;                       // first visible cards load eagerly (LCP)
  const COLS = 'id,title,media_type,category,image_url,medium_url,thumbnail_url,video_url,description,edition_year,is_featured,' +
               'award_id,award_name,competition_track,winner_name,film_name,recipient_type,width,height';

  const tidy = t => String(t || '').replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7,4.5 19.5,12 7,19.5" fill="currentColor"/></svg>';
  const ALIASES = { winners: 'award-winners', moments: 'festival-moments', messages: 'messages-of-support', bts: 'behind-the-scenes', highlights: 'festival-highlights', photo: 'photos', video: 'videos' };
  // matches the real grid: 1 col ≤360px, 2 cols to ~1100px, then up to 4 cols of ≤~310px in the 1240px container
  const CARD_SIZES = '(max-width: 360px) 100vw, (max-width: 1100px) 50vw, 380px';
  const FEAT_SIZES = '(max-width: 700px) 100vw, 620px';
  const LB_SIZES = '(max-width: 1200px) 100vw, 1200px';

  let sb = null;
  let categories = [];     // media_categories rows
  let juryAll = [];        // visible jury members (small list)
  let previousJury = [];
  let awardMap = new Map();// award_categories id → { key, name }
  let winnerFacets = { tracks: [], groups: [] };
  let active = 'all';
  let subTrack = 'all', subGroup = 'all';
  const TRACKS = { general: 'General', campus: 'Campus' };
  const GROUPS = [['film', 'Best Film'], ['director', 'Director'], ['actor', 'Actor'], ['actress', 'Actress'], ['technical', 'Technical'], ['special', 'Special Jury'], ['other', 'Other Awards']];

  // feed state for the current filter
  let view = [];           // loaded items, in display (and lightbox) order
  let offset = 0, hasMore = false, loading = false, token = 0, juryDone = false;
  let seen = new Set();    // de-duplication for the current view (record id + image file)
  const fileKey = u => String(u || '').split('?')[0].replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '')
    .replace(/_(disp|thumb)_/, '_').replace(/Gallery\/(display|thumbs)\//, 'Gallery/').replace(/-(full|md|th)\.webp$/, '.webp').toLowerCase();
  // true the first time an item is seen; false for a repeat (same record, same image file or same video)
  function isNew(it) {
    const keys = [it.id ? 'id:' + it.id : '', it.ytid ? 'yt:' + it.ytid : '', it.full ? 'f:' + fileKey(it.full) : ''].filter(Boolean);
    if (keys.some(k => seen.has(k))) return false;
    keys.forEach(k => seen.add(k));
    return true;
  }
  let lbIndex = -1;
  let io = null;

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
  // shared helper (assets/js/youtube.js) — same parsing and thumbnails as the homepage and admin
  const ytId = url => (window.SKYouTube ? SKYouTube.id(url) : null) || '';
  function catLabel(key) {
    if (key === 'jury') return 'Jury';
    const c = categories.find(x => x.key === key);
    return c ? c.label : '';
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

  // DB row → display item. Older rows without thumbnail/medium fall back to the full image URL.
  function toItem(m) {
    const id = m.media_type === 'video' ? ytId(m.video_url) : '';
    return {
      id: m.id, type: m.media_type, category: m.category, title: m.title || '', desc: m.description || '', year: m.edition_year,
      featured: !!m.is_featured,
      full: m.image_url || '', medium: m.medium_url || '', w: m.width || 0,
      // custom thumbnail first; YouTube videos otherwise get maxres → sd → hq automatically; else branded placeholder
      thumb: m.media_type === 'video' ? (window.SKYouTube ? SKYouTube.thumbFor(m.thumbnail_url, m.video_url) : (m.thumbnail_url || ''))
           : (m.thumbnail_url || m.image_url || ''),
      video: m.video_url || '', ytid: id,
      winner: m.category === 'award-winners' && (m.award_id || m.award_name) ? winnerInfo(m) : null,
    };
  }
  const juryItem = j => ({
    type: 'photo', category: 'jury', title: j.name, desc: [j.designation, j.bio].filter(Boolean).join(' — '),
    year: j.edition_year, juryType: j.jury_type, full: j.photo_url, thumb: j.photo_url, portrait: true,
  });

  // Small reference data (categories, awards, jury, winner facets) — loaded once
  async function loadMeta() {
    if (!window.supabase || typeof SUPA_URL === 'undefined') throw new Error('offline');
    sb = window.supabase.createClient(SUPA_URL, SUPA_ANON);
    const [catRes, juryRes, awRes, facRes] = await Promise.all([
      sb.from('media_categories').select('key,label,sort_order,show_in_filter').order('sort_order'),
      sb.from('jury_members').select('id,name,designation,bio,photo_url,edition_year,jury_type,display_order,show_in_gallery')
        .order('edition_year', { ascending: false, nullsFirst: false }).order('display_order'),
      sb.from('award_categories').select('id,key,name'),
      sb.from('gallery_media').select('competition_track,award_id').eq('category', 'award-winners').limit(5000),
    ]);
    if (catRes.error) throw catRes.error;
    categories = catRes.data || [];
    (awRes && awRes.data || []).forEach(a => awardMap.set(String(a.id), a));
    juryAll = (juryRes.data || []).map(j => Object.assign(j, { name: tidy(j.name), designation: tidy(j.designation), bio: tidy(j.bio) }));
    previousJury = juryAll.filter(j => j.jury_type === 'previous');
    const fac = (facRes && facRes.data) || [];
    winnerFacets.tracks = [...new Set(fac.map(r => r.competition_track).filter(Boolean))];
    const gs = new Set(fac.map(r => { const a = awardMap.get(String(r.award_id)); return a ? awardGroup(a.key, a.name) : 'other'; }));
    winnerFacets.groups = GROUPS.filter(([g]) => gs.has(g));
  }

  // Server-side filtered, paginated query for the current filter
  function pageQuery(from) {
    let q = sb.from('gallery_media').select(COLS)
      .order('is_featured', { ascending: false }).order('display_order').order('created_at').order('id');
    if (active === 'photos') q = q.eq('media_type', 'photo');
    else if (active === 'videos') q = q.eq('media_type', 'video');
    else if (active !== 'all') q = q.eq('category', active);
    if (active === 'award-winners') {
      if (subTrack !== 'all') q = q.eq('competition_track', subTrack);
      if (subGroup !== 'all') {
        const ids = [...awardMap.values()].filter(a => awardGroup(a.key, a.name) === subGroup).map(a => a.id);
        if (subGroup === 'other') q = q.or(ids.length ? `award_id.is.null,award_id.in.(${ids.join(',')})` : 'award_id.is.null');
        else if (ids.length) q = q.in('award_id', ids);
        else return null;
      }
    }
    return q.range(from, from + PAGE); // PAGE + 1 rows → tells us whether more exist
  }
  // jury member photos join the end of All / Photos / Jury once the media list is exhausted
  const wantsJury = () => active === 'all' || active === 'photos' || active === 'jury';

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true; setMoreState();
    const my = token;
    const q = pageQuery(offset);
    let rows = [];
    if (q) {
      const res = await q;
      if (my !== token) return;                    // filter changed meanwhile — discard
      if (res.error) { loading = false; hasMore = false; setMoreState(true); console.warn('Gallery page failed', res.error); return; }
      rows = res.data || [];
    }
    if (my !== token) return;
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    offset += page.length;
    const batch = page.map(toItem).filter(isNew);
    hasMore = more;
    if (!hasMore && !juryDone && wantsJury()) {
      juryDone = true;
      batch.push(...juryAll.filter(j => j.show_in_gallery && j.photo_url).map(juryItem).filter(isNew));
    }
    const start = view.length;
    view.push(...batch);
    appendCards(start);
    loading = false; setMoreState();
    if (!batch.length && hasMore) return loadMore();   // a page of only repeats — fetch the next one
    if (lbPending) { const p = lbPending; lbPending = null; p(); }
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
  // Track / award-type chips — shown only when there is enough winner data to split
  function renderSubFilters() {
    let el = $('fgSubFilters');
    if (!el) { el = document.createElement('div'); el.id = 'fgSubFilters'; el.className = 'fg-subfilters'; $('fgFilters').after(el); }
    if (active !== 'award-winners') { el.hidden = true; el.innerHTML = ''; return; }
    const row = (name, cur, opts) => `<div class="fg-subrow" role="group" aria-label="${name}">${opts.map(([k, l]) =>
      `<button type="button" class="fg-subchip${k === cur ? ' is-active' : ''}" aria-pressed="${k === cur}" data-sub="${name}" data-k="${k}">${esc(l)}</button>`).join('')}</div>`;
    let html = '';
    if (winnerFacets.tracks.length > 1) html += row('track', subTrack, [['all', 'All tracks'], ...winnerFacets.tracks.map(t => [t, TRACKS[t] || t])]);
    if (winnerFacets.groups.length > 1) html += row('award', subGroup, [['all', 'All awards'], ...winnerFacets.groups]);
    el.innerHTML = html; el.hidden = !html;
  }

  function metaOf(it) {
    if (it.winner) return [it.winner.award, TRACKS[it.winner.track], it.year].filter(Boolean).join(' · ');
    return [catLabel(it.category), it.year].filter(Boolean).join(' · ');
  }

  function imgTag(it, idx, alt) {
    const eager = idx < EAGER;
    const feat = it.featured && active === 'all';
    // thumbnail in cards; offer the medium size only for dense screens / wide (featured) cards
    const set = it.medium && it.thumb !== it.full ? ` srcset="${esc(it.thumb)} 960w, ${esc(it.medium)} 1280w" sizes="${feat ? FEAT_SIZES : CARD_SIZES}"` : '';
    return `<img src="${esc(it.thumb)}"${set} alt="${esc(alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${idx < 2 ? ' fetchpriority="high"' : ''}${it.ytid ? ` data-ytid="${esc(it.ytid)}"` : ''}${it.type === 'video' ? ' data-yt-fallback' : ''}>`;
  }

  function card(it, idx) {
    const cls = ['fg-card', it.type === 'video' ? 'is-video' : '', it.portrait ? 'is-portrait' : '', it.featured && active === 'all' ? 'is-featured' : '', it.winner ? 'is-winner' : ''].join(' ').replace(/\s+/g, ' ').trim();
    const meta = metaOf(it);
    const title = it.winner ? it.winner.primary : it.title;
    return `<button type="button" class="${cls}" data-i="${idx}" aria-label="${it.type === 'video' ? 'Play' : 'Open'}: ${esc(it.winner ? meta + ' — ' + title : (title || meta))}">
        <span class="fg-thumb">${imgTag(it, idx, title)}${it.type === 'video' ? `<span class="fg-play">${PLAY}</span>` : ''}</span>
        <span class="fg-card-text">${meta ? `<span class="fg-card-meta">${esc(meta)}</span>` : ''}${title ? `<span class="fg-card-title">${esc(title)}</span>` : ''}${it.winner && it.winner.secondary ? `<span class="fg-card-sub">${esc(it.winner.secondary)}</span>` : ''}</span>
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
          const i = j.photo_url ? view.push(juryItem(j)) - 1 : -1;
          return `<article class="fg-person">
            ${i >= 0 ? `<button type="button" class="fg-card is-portrait" data-i="${i}" aria-label="Open: ${esc(j.name)}"><span class="fg-thumb"><img src="${esc(j.photo_url)}" alt="${esc(j.name)}" loading="lazy" decoding="async"></span></button>` : '<span class="fg-thumb fg-thumb-empty" aria-hidden="true"></span>'}
            <h3>${esc(j.name)}</h3>${j.designation ? `<p class="fg-person-role">${esc(j.designation)}</p>` : ''}${j.bio ? `<p class="fg-person-bio">${esc(j.bio)}</p><button type="button" class="fg-bio-toggle" aria-expanded="false" hidden>Read full bio</button>` : ''}
          </article>`;
        }).join('') + '</div></section>';
    });
    $('fgContent').innerHTML = html;
    $('fgContent').querySelectorAll('.fg-person-bio').forEach(p => {
      const btn = p.nextElementSibling;
      if (btn && p.scrollHeight > p.clientHeight + 2) btn.hidden = false;
    });
  }

  // Jury filter: grouped by current / edition (small set, so rendered in one go after all pages load)
  function renderJuryGroups() {
    if (!view.length) { $('fgContent').innerHTML = '<p class="fg-empty">Nothing here yet — new photographs and films will appear as they are added.</p>'; return; }
    const groups = new Map();
    view.forEach((it, i) => { const k = it.juryType === 'current' ? 'Current Jury' : (it.juryType === 'previous' ? (it.year ? it.year + ' Edition' : 'Previous Jury') : 'Jury Photographs'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([it, i]); });
    $('fgContent').innerHTML = [...groups].map(([t, list]) =>
      `<section class="fg-group"><h2 class="fg-group-title">${esc(t)}</h2><div class="fg-grid is-people">${list.map(([it, i]) => card(it, i)).join('')}</div></section>`).join('');
  }

  function appendCards(start) {
    if (active === 'jury') { if (!hasMore) renderJuryGroups(); return; }
    const grid = $('fgGrid');
    if (!grid) return;
    if (!view.length) { $('fgContent').innerHTML = '<p class="fg-empty">Nothing here yet — new photographs and films will appear as they are added.</p>'; return; }
    grid.insertAdjacentHTML('beforeend', view.slice(start).map((it, k) => card(it, start + k)).join(''));
    // thumbnail fallbacks (maxres → sd → hq → placeholder) are handled globally by SKYouTube
  }

  function setMoreState(failed) {
    const btn = $('fgMore');
    if (!btn) return;
    btn.hidden = !hasMore && !failed;
    btn.disabled = loading;
    btn.textContent = loading ? 'Loading…' : failed ? 'Try again' : 'Load more';
    if (failed) { btn.hidden = false; btn.onclick = () => { hasMore = true; loadMore(); }; }
  }

  // (re)start the feed for the current filter
  function startFeed() {
    token++;
    view = []; offset = 0; hasMore = true; loading = false; juryDone = false; seen = new Set();
    if (active === 'jury') {
      $('fgContent').innerHTML = '<p class="fg-empty">Loading…</p>';
      // jury sets are small: pull every page, then render grouped
      const my = token;
      (async function all() { while (hasMore && my === token) { await loadMore(); } })();
      return;
    }
    $('fgContent').innerHTML = `<div class="fg-grid" id="fgGrid"></div>
      <div class="fg-more-wrap"><button type="button" class="fg-more" id="fgMore" hidden>Load more</button></div>
      <div class="fg-sentinel" id="fgSentinel" aria-hidden="true"></div>`;
    $('fgMore').addEventListener('click', loadMore);
    if (io) io.disconnect();
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: '900px 0px' });
      io.observe($('fgSentinel'));
    }
    loadMore().then(() => { if (!view.length && !hasMore) $('fgContent').innerHTML = '<p class="fg-empty">Nothing here yet — new photographs and films will appear as they are added.</p>'; });
  }

  function render() {
    renderFilters();
    renderSubFilters();
    if (active === 'previous-jury') { token++; if (io) io.disconnect(); return renderRoster(); }
    startFeed();
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

  /* ---------- lightbox — full image only on demand ---------- */
  let lastFocus = null, lbPending = null;
  const fullSet = it => (it.medium ? `${it.medium} 1280w, ${it.full} ${it.w || 2200}w` : '');
  function preload(it) {
    if (!it || it.type !== 'photo' || it._pre) return;
    it._pre = true;
    const im = new Image();
    if (it.medium) { im.sizes = LB_SIZES; im.srcset = fullSet(it); }
    im.src = it.full || it.thumb;
  }
  function openLb(i) {
    if (!view[i]) return;
    lbIndex = i;
    const it = view[i];
    const media = $('fgLbMedia');
    if (it.type === 'video') {
      media.innerHTML = it.ytid
        ? `<div class="fg-lb-video"><iframe src="https://www.youtube.com/embed/${esc(it.ytid)}?autoplay=1&rel=0" title="${esc(it.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
        : `<div class="fg-lb-video"><video src="${esc(it.video)}" controls autoplay playsinline preload="metadata"></video></div>`;
    } else {
      const set = it.medium ? ` srcset="${esc(fullSet(it))}" sizes="${LB_SIZES}"` : '';
      media.innerHTML = `<img src="${esc(it.full || it.thumb)}"${set} alt="${esc(it.winner ? it.winner.primary : it.title)}" decoding="async">`;
    }
    $('fgLbMeta').textContent = metaOf(it);
    $('fgLbTitle').textContent = it.winner ? it.winner.primary : (it.title || '');
    $('fgLbDesc').textContent = it.winner ? [it.winner.secondary, it.desc && !/^winner \d{4}$/i.test(it.desc) ? it.desc : ''].filter(Boolean).join(' — ') : (it.desc || '');
    const multi = view.length > 1 || hasMore;
    $('fgLbPrev').hidden = !multi; $('fgLbNext').hidden = !multi;
    // neighbours only — never the whole library
    preload(view[i + 1]); preload(view[i - 1]);
    if (i >= view.length - 3 && hasMore) loadMore();
    const lb = $('fgLightbox');
    if (lb.hidden) { lastFocus = document.activeElement; lb.hidden = false; document.body.style.overflow = 'hidden'; $('fgLbClose').focus(); }
  }
  function closeLb() {
    const lb = $('fgLightbox');
    if (lb.hidden) return;
    lb.hidden = true; $('fgLbMedia').innerHTML = ''; document.body.style.overflow = '';
    lbIndex = -1; lbPending = null; if (lastFocus) lastFocus.focus();
  }
  function step(d) {
    if (lbIndex < 0 || !view.length) return;
    const n = lbIndex + d;
    if (n >= view.length && (hasMore || loading)) { lbPending = () => openLb(n < view.length ? n : 0); if (!loading) loadMore(); return; }
    openLb((n + view.length) % view.length);
  }

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
    const qs = new URLSearchParams(location.search);
    try { await loadMeta(); }
    catch (e) { $('fgContent').innerHTML = '<p class="fg-empty">The gallery could not be loaded right now. Please try again shortly.</p>'; console.warn('Festival gallery load failed', e); return; }
    const k = ALIASES[qs.get('filter')] || qs.get('filter') || 'all';
    active = k;
    if (active === 'award-winners') { subTrack = qs.get('track') || 'all'; subGroup = qs.get('award') || 'all'; }
    render();
  });
})();
