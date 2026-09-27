/* Full Festival Gallery (/festival-gallery)
   Master gallery: gallery_media (Admin → Festival Gallery) + jury photos flagged "Show in Festival Gallery"
   (Admin → Jury). Jury items reference the jury member's own photo_url, so photo updates carry over.
   Filters: ?filter=all|photos|videos|<category key>|previous-jury (alias ?category=) · ?edition=all|<year>
   Editions come from the edition_year the admin assigns (never the upload date); the list is built from the
   years present in the data plus the current edition, newest first, and filtered server-side.

   Scales to large libraries: records are fetched from the database in batches of PAGE items (12 desktop / 8 phone),
   filtered server-side (edition / type / category / track / award); "Load more" fetches the next batch only.
   Cards use the small thumbnail (srcset → medium on dense screens); the full image loads only in the
   lightbox, which also preloads just the previous and next photo. Videos show a poster until opened. */
(function () {
  'use strict';

  const PAGE = window.matchMedia && matchMedia('(max-width: 700px)').matches ? 8 : 12;   // records per batch (first + each Load more)
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
  let winnerFacets = { tracks: [], awards: [] };
  let active = 'all';
  let edition = 'all';     // 'all' or a year string, e.g. '2025'
  let editions = [];       // years available, newest first
  let facetRows = [];      // light winner rows (track / award / year) for the sub-filters
  // current edition = the year of this edition's submission deadline (config.js), else the newest year in the data
  const CURRENT = (() => { try { const y = new Date(PORTAL_TIMELINES.submissionDeadline).getFullYear(); return y > 2000 ? y : 0; } catch (e) { return 0; } })();
  const byEdition = y => edition === 'all' || String(y) === edition;
  let subTrack = 'all', subGroup = 'all';   // subGroup: 'all' | award key (best_director…) | 'special' | legacy group (director, technical…)
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
    let award = a.name || m.award_name || 'Award';
    const group = awardGroup(a.key, award);
    // Special Jury variants ("Special Jury — Best Director") keep their stored label; they stay in the Special Jury filter
    if (group === 'special' && /^Special Jury — ./.test(m.award_name || '')) award = m.award_name;
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
      sb.from('award_categories').select('id,key,name,sort_order'),
      sb.from('gallery_media').select('category,competition_track,award_id,edition_year').limit(5000),
    ]);
    if (catRes.error) throw catRes.error;
    categories = catRes.data || [];
    (awRes && awRes.data || []).forEach(a => awardMap.set(String(a.id), a));
    juryAll = (juryRes.data || []).map(j => Object.assign(j, { name: tidy(j.name), designation: tidy(j.designation), bio: tidy(j.bio) }));
    previousJury = juryAll.filter(j => j.jury_type === 'previous');
    const rows = (facRes && facRes.data) || [];
    facetRows = rows.filter(r => r.category === 'award-winners');
    const years = new Set([...rows.map(r => r.edition_year), ...juryAll.filter(j => j.show_in_gallery || j.jury_type === 'previous').map(j => j.edition_year)]
      .filter(y => Number.isInteger(+y) && +y > 2000).map(Number));
    if (CURRENT) years.add(CURRENT);
    editions = [...years].sort((a, b) => b - a).map(String);
  }
  // track pills + award dropdown list only what exists for the selected edition (and track)
  function computeFacets() {
    const fac = facetRows.filter(r => byEdition(r.edition_year));
    winnerFacets.tracks = [...new Set(fac.map(r => r.competition_track).filter(Boolean))];
    const inTrack = fac.filter(r => subTrack === 'all' || r.competition_track === subTrack);
    const list = [], seenKey = new Set();
    let special = false, other = false;
    inTrack.map(r => awardMap.get(String(r.award_id))).sort((a, b) => ((a && a.sort_order) ?? 999) - ((b && b.sort_order) ?? 999)).forEach(a => {
      if (!a) { other = true; return; }
      if (awardGroup(a.key, a.name) === 'special') { special = true; return; }   // every Special Jury label → one option
      if (!seenKey.has(a.key)) { seenKey.add(a.key); list.push([a.key, a.name]); }
    });
    if (special) list.push(['special', 'Special Jury']);
    if (other) list.push(['other', 'Other Awards']);
    winnerFacets.awards = list;
  }
  const awardByKey = k => [...awardMap.values()].find(a => a.key === k);

  // Server-side filtered, paginated query for the current filter
  function pageQuery(from) {
    let q = sb.from('gallery_media').select(COLS)
      .order('is_featured', { ascending: false }).order('display_order').order('created_at').order('id');
    if (active === 'photos') q = q.eq('media_type', 'photo');
    else if (active === 'videos') q = q.eq('media_type', 'video');
    else if (active !== 'all') q = q.eq('category', active);
    if (edition !== 'all') q = q.eq('edition_year', +edition);
    if (active === 'award-winners') {
      if (subTrack !== 'all') q = q.eq('competition_track', subTrack);
      const one = subGroup !== 'special' && subGroup !== 'other' && awardByKey(subGroup);
      if (one) q = q.eq('award_id', one.id);
      else if (subGroup !== 'all') {
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
      batch.push(...juryAll.filter(j => j.show_in_gallery && j.photo_url && byEdition(j.edition_year)).map(juryItem).filter(isNew));
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
  // Edition selector — custom pills (All editions · newest year first); current / previous marked subtly
  function renderEditions() {
    const el = $('fgEditions');
    if (!el) return;
    if (!editions.length) { el.hidden = true; return; }
    const prev = editions.find(y => +y < CURRENT);
    const note = y => (+y === CURRENT ? 'Current' : y === prev ? 'Previous' : '');
    const btn = (k, label, sub) => `<button type="button" class="fg-ed${k === edition ? ' is-active' : ''}" aria-pressed="${k === edition}" data-ed="${esc(k)}">` +
      `<span class="fg-ed-label">${label}</span>${sub ? `<span class="fg-ed-note">${esc(sub)}</span>` : ''}</button>`;
    el.innerHTML = `<span class="fg-ed-title">Edition</span><div class="fg-ed-track">${btn('all', 'All<span class="fg-ed-long"> editions</span>', '')}${editions.map(y => btn(y, esc(y), note(y))).join('')}</div>`;
    el.hidden = false;
  }
  const emptyMsg = () => edition !== 'all'
    ? `<p class="fg-empty">More from the ${esc(edition)} edition will be added soon.</p>`
    : '<p class="fg-empty">Nothing here yet — new photographs and films will appear as they are added.</p>';

  function renderFilters() {
    $('fgFilters').innerHTML = filterKeys().map(([k, l]) =>
      `<button type="button" role="tab" class="fg-chip${k === active ? ' is-active' : ''}" aria-selected="${k === active}" data-k="${esc(k)}">${esc(l)}</button>`).join('');
  }
  // Track / award-type chips — shown only when there is enough winner data to split
  function renderSubFilters() {
    let el = $('fgSubFilters');
    if (!el) { el = document.createElement('div'); el.id = 'fgSubFilters'; el.className = 'fg-subfilters'; $('fgFilters').after(el); }
    if (active !== 'award-winners') { el.hidden = true; el.innerHTML = ''; return; }
    computeFacets();
    let html = '';
    if (winnerFacets.tracks.length > 1) {
      const opts = [['all', 'All'], ...winnerFacets.tracks.map(t => [t, TRACKS[t] || t])];
      html += `<div class="fg-sf-group"><span class="fg-sf-label" id="fgTrackLbl">Track</span><div class="fg-sf-pills" role="group" aria-labelledby="fgTrackLbl">${opts.map(([k, l]) =>
        `<button type="button" class="fg-subchip${k === subTrack ? ' is-active' : ''}" aria-pressed="${k === subTrack}" data-sub="track" data-k="${esc(k)}">${esc(l)}</button>`).join('')}</div></div>`;
    }
    const aw = [['all', 'All awards'], ...winnerFacets.awards];
    const cur = aw.find(([k]) => k === subGroup) || (subGroup !== 'all' ? [subGroup, (awardByKey(subGroup) || {}).name || (GROUPS.find(g => g[0] === subGroup) || [0, 'Selected award'])[1]] : aw[0]);
    if (winnerFacets.awards.length > 1 || subGroup !== 'all') {
      html += `<div class="fg-sf-group"><span class="fg-sf-label" id="fgAwardLbl">Award</span>
        <div class="fg-dd" id="fgAwardDd">
          <button type="button" class="fg-dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="fgAwardLbl fgAwardVal"><span id="fgAwardVal">${esc(cur[1])}</span><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
          <ul class="fg-dd-list" role="listbox" aria-labelledby="fgAwardLbl" tabindex="-1" hidden>${aw.map(([k, l]) =>
            `<li role="option" class="fg-dd-opt${k === cur[0] ? ' is-selected' : ''}" aria-selected="${k === cur[0]}" data-k="${esc(k)}">${esc(l)}</li>`).join('')}</ul>
        </div></div>`;
    }
    el.innerHTML = html; el.hidden = !html;
  }

  // one metadata line with a single year reference, e.g. "Best Director · General · 2025"
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
    const list = previousJury.filter(j => byEdition(j.edition_year));
    if (!list.length) { $('fgContent').innerHTML = edition !== 'all' ? emptyMsg() : '<p class="fg-empty">The previous jury will appear here soon.</p>'; return; }
    const groups = new Map();
    list.forEach(j => { const k = j.edition_year || 'Earlier'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); });
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
    if (!view.length) { $('fgContent').innerHTML = emptyMsg(); return; }
    const groups = new Map();
    view.forEach((it, i) => { const k = it.juryType === 'current' ? 'Current Jury' : (it.juryType === 'previous' ? (it.year ? it.year + ' Edition' : 'Previous Jury') : 'Jury Photographs'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([it, i]); });
    $('fgContent').innerHTML = [...groups].map(([t, list]) =>
      `<section class="fg-group"><h2 class="fg-group-title">${esc(t)}</h2><div class="fg-grid is-people">${list.map(([it, i]) => card(it, i)).join('')}</div></section>`).join('');
  }

  // quiet placeholder cards while a batch is on its way
  function skeletons(on) {
    const grid = $('fgGrid');
    if (!grid) return;
    grid.querySelectorAll('.fg-skel').forEach(n => n.remove());
    if (on) grid.insertAdjacentHTML('beforeend', Array.from({ length: Math.min(PAGE, view.length ? 4 : PAGE) },
      () => '<span class="fg-card fg-skel" aria-hidden="true"><span class="fg-thumb"></span><span class="fg-card-text"><span class="fg-skel-line"></span><span class="fg-skel-line is-short"></span></span></span>').join(''));
  }

  function appendCards(start) {
    if (active === 'jury') { if (!hasMore) renderJuryGroups(); return; }
    const grid = $('fgGrid');
    if (!grid) return;
    skeletons(false);
    if (!view.length) { $('fgContent').innerHTML = emptyMsg(); return; }
    grid.insertAdjacentHTML('beforeend', view.slice(start).map((it, k) => card(it, start + k)).join(''));
    // thumbnail fallbacks (maxres → sd → hq → placeholder) are handled globally by SKYouTube
  }

  function setMoreState(failed) {
    const btn = $('fgMore');
    if (!btn) return;
    btn.hidden = (!hasMore && !failed) || (loading && !view.length);
    btn.disabled = loading;
    btn.setAttribute('aria-busy', loading);
    btn.innerHTML = loading ? '<span class="fg-spin" aria-hidden="true"></span>Loading' : failed ? 'Try again' : 'Load more';
    skeletons(loading && !failed);
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
      <div class="fg-more-wrap"><button type="button" class="fg-more" id="fgMore" hidden>Load more</button></div>`;
    $('fgMore').addEventListener('click', loadMore);
    // one batch now; the next batch only when the visitor taps "Load more"
    loadMore().then(() => { if (!view.length && !hasMore) $('fgContent').innerHTML = emptyMsg(); });
  }

  function render() {
    renderEditions();
    renderFilters();
    renderSubFilters();
    if (active === 'previous-jury') { token++; return renderRoster(); }
    startFeed();
  }

  function syncUrl() {
    const q = new URLSearchParams();
    if (edition !== 'all') q.set('edition', edition);
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
    $('fgEditions').addEventListener('click', e => {
      const b = e.target.closest('.fg-ed'); if (!b || b.dataset.ed === edition) return;
      edition = b.dataset.ed; subTrack = 'all'; subGroup = 'all';
      render(); syncUrl();
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('.fg-subchip'); if (!b || b.dataset.k === subTrack) return;
      subTrack = b.dataset.k;
      render(); syncUrl();
    });
    // custom Award dropdown (no native <select>)
    const dd = () => $('fgAwardDd');
    const ddOpen = open => {
      const d = dd(); if (!d) return;
      const list = d.querySelector('.fg-dd-list'), btn = d.querySelector('.fg-dd-btn');
      list.hidden = !open; btn.setAttribute('aria-expanded', open); d.classList.toggle('is-open', open);
      if (open) { const sel = list.querySelector('.is-selected') || list.firstElementChild; list.querySelectorAll('.is-active').forEach(o => o.classList.remove('is-active')); sel.classList.add('is-active'); list.focus({ preventScroll: true }); sel.scrollIntoView({ block: 'nearest' }); }
    };
    const ddChoose = li => { ddOpen(false); if (!li || li.dataset.k === subGroup) return; subGroup = li.dataset.k; render(); syncUrl(); const b = dd() && dd().querySelector('.fg-dd-btn'); if (b) b.focus({ preventScroll: true }); };
    document.addEventListener('click', e => {
      const d = dd(); if (!d) return;
      if (e.target.closest('.fg-dd-btn')) return ddOpen(d.querySelector('.fg-dd-list').hidden);
      const li = e.target.closest('.fg-dd-opt'); if (li) return ddChoose(li);
      if (!d.contains(e.target)) ddOpen(false);
    });
    document.addEventListener('keydown', e => {
      const d = dd(); if (!d || !d.contains(document.activeElement)) return;
      const list = d.querySelector('.fg-dd-list'), opts = [...list.children];
      if (list.hidden) { if (['ArrowDown', 'ArrowUp'].includes(e.key) && e.target.closest('.fg-dd-btn')) { e.preventDefault(); ddOpen(true); } return; }
      let i = opts.findIndex(o => o.classList.contains('is-active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); opts.forEach((o, k) => o.classList.toggle('is-active', k === i)); opts[i].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ddChoose(opts[i]); }
      else if (e.key === 'Escape') { e.preventDefault(); ddOpen(false); d.querySelector('.fg-dd-btn').focus(); }
      else if (e.key === 'Tab') ddOpen(false);
    });
    document.addEventListener('mouseover', e => { const li = e.target.closest('.fg-dd-opt'); if (li) li.parentElement.querySelectorAll('.fg-dd-opt').forEach(o => o.classList.toggle('is-active', o === li)); });
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
    const f = qs.get('filter') || qs.get('category');
    active = ALIASES[f] || f || 'all';
    const ed = qs.get('edition');
    edition = ed && editions.includes(ed) ? ed : 'all';
    if (active === 'award-winners') { subTrack = qs.get('track') || 'all'; subGroup = qs.get('award') || 'all'; }
    render();
  });
})();
