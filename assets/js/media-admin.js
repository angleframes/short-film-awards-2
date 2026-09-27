/* Admin → Festival Gallery: manage the master gallery shown at /festival-gallery.
   Rows live in public.gallery_media; categories in public.media_categories (reusable, admin-editable).
   Images go to the existing public "gallery" bucket under media/ (optimised to WebP in the browser).
   Files are only ever deleted from storage when they live under media/ and no other row references them,
   so photos shared with the homepage slideshow are never removed. */
window.MediaAdmin = (function () {
  'use strict';

  let sb = null;
  let items = [];
  let cats = [];
  let awards = [];             // award_categories (managed in Admin → Awards) — single source for winner awards
  let fCat = '', fType = '';
  let editing = null;          // working copy of the row being edited (id null = new)
  let orphans = [];            // storage URLs replaced/removed during the current edit
  let busy = false;

  const BUCKET = 'gallery';
  const SITE = 'https://sharankrishnashortfilmawards.com';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const slug = s => String(s || 'media').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'media';
  // shared YouTube helper (assets/js/youtube.js) — same parsing + thumbnails as the public site
  const ytId = url => (window.SKYouTube ? SKYouTube.id(url) : null) || '';
  const thumbOf = r => r.media_type === 'video'
    ? (window.SKYouTube ? SKYouTube.thumbFor(r.thumbnail_url, r.video_url) : (r.thumbnail_url || ''))
    : (r.thumbnail_url || r.image_url || '');
  const catLabel = k => (cats.find(c => c.key === k) || {}).label || k;
  const WINNERS = 'award-winners';
  const TRACKS = { general: 'General', campus: 'Campus' };
  const awardOf = id => awards.find(a => String(a.id) === String(id));

  // Which fields an award needs, from its key (falls back to the name, then to a generic winner + film form)
  function awardKind(a) {
    const k = ((a && (a.key || a.name)) || '').toLowerCase();
    if (/special/.test(k)) return { kind: 'special' };
    if (/short_film|campus_film|best short film|best campus film|best film/.test(k)) return { kind: 'film', person: 'Director name (optional)' };
    const people = [[/director/, 'Director name'], [/actress/, 'Actress name'], [/actor/, 'Actor name'], [/screenplay|writer/, 'Winner name'],
      [/cinematograph/, 'Cinematographer name'], [/edit/, 'Editor name'], [/music/, 'Music director / composer name'], [/child/, 'Artist name']];
    const hit = people.find(([re]) => re.test(k));
    return { kind: 'person', person: hit ? hit[1] : 'Winner name' };
  }

  // Special Jury variants (admin gallery labels only — never added to award_categories / the public Awards section).
  // Stored as the existing Special Jury award (award_id) + award_name "Special Jury — <award>", so filters stay unchanged.
  const SJ_PREFIX = 'Special Jury — ';
  const isSpecial = a => !!a && awardKind(a).kind === 'special';
  const specialAward = () => awards.find(a => a.key === 'special_jury') || awards.find(isSpecial);
  const sjBase = r => {
    const a = awardOf(r.award_id), n = String(r.award_name || '');
    if (!isSpecial(a) || !n.startsWith(SJ_PREFIX)) return null;
    return awards.find(x => !isSpecial(x) && x.name === n.slice(SJ_PREFIX.length)) || null;
  };
  // name shown for a row: "Special Jury — Best Director", else the award's current name
  const awardLabel = r => { const b = sjBase(r), a = awardOf(r.award_id); return b ? SJ_PREFIX + b.name : (a && a.name) || r.award_name || ''; };
  // fields follow the underlying award (e.g. Special Jury — Best Director asks for the director's name)
  const kindOf = r => { const b = sjBase(r), a = awardOf(r.award_id); return b ? awardKind(b) : a ? awardKind(a) : null; };
  const awardSel = r => { const b = sjBase(r); return b ? 'sj:' + b.id : (r.award_id ? String(r.award_id) : ''); };

  // Auto title from structured winner data
  function winnerTitle(r) {
    const a = awardOf(r.award_id);
    const name = awardLabel(r) || 'Award';
    const track = TRACKS[r.competition_track] || '';
    const withTrack = track && !new RegExp(track, 'i').test(name) ? `${name} (${track})` : name;
    const film = (r.film_name || '').trim(), person = (r.winner_name || '').trim();
    const kind = (kindOf(r) || awardKind(a || { name })).kind;
    if (kind === 'film' || (kind === 'special' && r.recipient_type !== 'person')) return `${withTrack} — ${film || '…'}${person ? ` · ${kind === 'film' ? 'Dir. ' : ''}${person}` : ''}`;
    return `${withTrack} — ${person || '…'}${film ? ` · Film: ${film}` : ''}`;
  }

  // Suggested editions: every year already used in the gallery + the current year (newest first)
  const editionYears = () => [...new Set([new Date().getFullYear(), ...items.map(x => +x.edition_year).filter(y => y > 2000)])].sort((a, b) => b - a);
  const validYear = y => Number.isInteger(y) && y >= 2000 && y <= 2100;

  const storagePath = url => { const m = String(url || '').match(/\/storage\/v1\/object\/public\/gallery\/(.+)$/); return m ? decodeURIComponent(m[1].split('?')[0]) : ''; };

  async function load() {
    const root = document.getElementById('mediaAdmin');
    if (!root || !sb) return;
    root.innerHTML = '<p class="muted-note">Loading…</p>';
    const [c, m, aw] = await Promise.all([
      sb.from('media_categories').select('*').order('sort_order'),
      sb.from('gallery_media').select('*').order('display_order').order('created_at'),
      sb.from('award_categories').select('id,key,name,active,sort_order').order('sort_order'),
    ]);
    if (c.error || m.error) { root.innerHTML = `<p class="muted-note">Festival gallery storage isn't available (${esc((c.error || m.error).message)}).</p>`; return; }
    cats = c.data || []; items = m.data || []; awards = (aw && aw.data) || [];
    render();
  }

  function filtered() {
    return items.filter(r => (!fCat || r.category === fCat) && (!fType || r.media_type === fType));
  }

  // Award Winner block: track → award → only the fields that award needs
  function winnerFieldsHtml(r) {
    const k = kindOf(r), sel = awardSel(r), base = sjBase(r);
    const activeAwards = awards.filter(x => x.active !== false || String(x.id) === String(r.award_id));
    const opt = (v, label) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
    const regular = activeAwards.filter(x => !isSpecial(x)), special = activeAwards.filter(isSpecial);
    const sjVariants = specialAward() ? awards.filter(x => !isSpecial(x) && (x.active !== false || (base && base.id === x.id))) : [];
    const awardOptions = `<optgroup label="Award Categories">${regular.map(x => opt(String(x.id), x.name)).join('')}</optgroup>` +
      (sjVariants.length || special.length ? `<optgroup label="Special Jury">${sjVariants.map(x => opt('sj:' + x.id, SJ_PREFIX + x.name)).join('')}${special.map(x => opt(String(x.id), x.name)).join('')}</optgroup>` : '');
    let fields = '';
    if (k && k.kind === 'special') {
      const isPerson = r.recipient_type === 'person';
      fields = `
        <div class="mg-field is-full"><span class="mg-label">Recognition for</span>
          <div class="mg-seg" role="radiogroup" aria-label="Recognition for">
            <label><input type="radio" name="mgRecip" value="film" ${!isPerson ? 'checked' : ''}><span>The film</span></label>
            <label><input type="radio" name="mgRecip" value="person" ${isPerson ? 'checked' : ''}><span>A person</span></label>
          </div></div>
        <div class="mg-field"><label for="mgFilm">Film name${isPerson ? ' (optional)' : ''}</label><input type="text" id="mgFilm" value="${esc(r.film_name || '')}" maxlength="120" data-w></div>
        <div class="mg-field"><label for="mgPerson">${isPerson ? 'Recipient name' : 'Person name (optional)'}</label><input type="text" id="mgPerson" value="${esc(r.winner_name || '')}" maxlength="120" data-w></div>`;
    } else if (k && k.kind === 'film') {
      fields = `
        <div class="mg-field"><label for="mgFilm">Film name</label><input type="text" id="mgFilm" value="${esc(r.film_name || '')}" maxlength="120" data-w></div>
        <div class="mg-field"><label for="mgPerson">${esc(k.person)}</label><input type="text" id="mgPerson" value="${esc(r.winner_name || '')}" maxlength="120" data-w></div>`;
    } else if (k) {
      fields = `
        <div class="mg-field"><label for="mgPerson">${esc(k.person)}</label><input type="text" id="mgPerson" value="${esc(r.winner_name || '')}" maxlength="120" data-w></div>
        <div class="mg-field"><label for="mgFilm">Film name</label><input type="text" id="mgFilm" value="${esc(r.film_name || '')}" maxlength="120" data-w></div>`;
    }
    return `<div class="mg-winner is-full">
        <div class="mg-field"><label for="mgTrack">${k && k.kind === 'special' ? 'Special Jury track' : 'Competition track'}</label>
          <select id="mgTrack"><option value="">Select track</option>${Object.entries(TRACKS).map(([v, l]) => `<option value="${v}" ${r.competition_track === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="mg-field"><label for="mgAward">Award category</label>
          <select id="mgAward"><option value="">Select award</option>${awardOptions}</select></div>
        ${fields || (awards.length ? '<p class="muted-note is-full">Choose the award to see its winner fields.</p>' : '<p class="muted-note is-full">No award categories yet — add them in the Awards tab.</p>')}
      </div>`;
  }

  function editorHtml() {
    const r = editing, isVideo = r.media_type === 'video', isWinner = r.category === WINNERS;
    const img = isVideo ? r.thumbnail_url : r.image_url;
    const preview = img || (isVideo && ytId(r.video_url) ? SKYouTube.thumb(ytId(r.video_url)) : '');
    return `<div class="mg-editor" id="mgEditor">
      <div class="mg-editor-head"><h3>${r.id ? 'Edit' : 'Add'} ${isVideo ? 'video' : 'photo'}</h3>
        <div class="mg-type"><label><input type="radio" name="mgType" value="photo" ${!isVideo ? 'checked' : ''}> Photo</label><label><input type="radio" name="mgType" value="video" ${isVideo ? 'checked' : ''}> Video</label></div></div>
      <div class="mg-editor-grid">
        <div class="mg-preview-col">
          <div class="mg-preview">${preview ? `<img src="${esc(preview)}" alt="">` : `<span>${isVideo ? 'Thumbnail comes from YouTube' : 'No photo yet'}</span>`}</div>
          <div class="mg-preview-actions">
            <label class="btn-ghost btn-sm mg-upload">${img ? 'Replace' : 'Upload'} ${isVideo ? 'thumbnail' : 'photo'}<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden id="mgFile"></label>
            ${img ? '<button type="button" class="btn-ghost btn-sm" id="mgRemoveImg">Remove</button>' : ''}
          </div>
          ${isVideo ? '<p class="muted-note">Optional — leave empty to use the YouTube thumbnail.</p>' : ''}
        </div>
        <div class="mg-fields">
          <div class="mg-field${isWinner ? ' is-full' : ''}"><label for="mgCat">Category</label><select id="mgCat">${cats.map(c => `<option value="${esc(c.key)}" ${c.key === r.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
          ${isWinner ? winnerFieldsHtml(r) : ''}
          <div class="mg-field is-full"><label for="mgTitle">${isWinner ? 'Display title' : 'Media title'}</label>
            <input type="text" id="mgTitle" value="${esc(isWinner && !r._customTitle ? winnerTitle(r) : r.title)}" maxlength="160" ${isWinner && !r._customTitle ? 'readonly' : ''}>
            ${isWinner ? `<label class="mg-inline-check"><input type="checkbox" id="mgTitleCustom" ${r._customTitle ? 'checked' : ''}> Edit title manually <small>(otherwise generated from the winner details)</small></label>` : ''}
          </div>
          ${isVideo ? `<div class="mg-field is-full"><label for="mgVideo">Video URL (YouTube)</label><input type="url" id="mgVideo" value="${esc(r.video_url || '')}" placeholder="https://www.youtube.com/watch?v=…"></div>` : ''}
          <div class="mg-field"><label for="mgYear">Edition / year <span class="mg-req" aria-hidden="true">*</span></label><input type="text" id="mgYear" inputmode="numeric" maxlength="4" autocomplete="off" required aria-required="true" value="${esc(r.edition_year || '')}" placeholder="e.g. ${editionYears()[0]}">
            <div class="mg-year-chips" role="group" aria-label="Suggested editions">${editionYears().map(y => `<button type="button" class="mg-year-chip${String(y) === String(r.edition_year) ? ' is-on' : ''}" data-year="${y}">${y}</button>`).join('')}</div></div>
          <div class="mg-field is-full"><label for="mgDesc">Description (optional)</label><textarea id="mgDesc" rows="3" maxlength="600">${esc(r.description || '')}</textarea></div>
          <div class="mg-field"><label for="mgOrder">Display order</label><input type="number" id="mgOrder" value="${esc(r.display_order || 0)}"></div>
          <div class="mg-field mg-checks"><label><input type="checkbox" id="mgVisible" ${r.is_visible !== false ? 'checked' : ''}> Visible</label><label><input type="checkbox" id="mgFeatured" ${r.is_featured ? 'checked' : ''}> Featured</label></div>
        </div>
      </div>
      <div class="mg-editor-foot">
        <button type="button" class="btn" id="mgSave">${r.id ? 'Save changes' : 'Add to gallery'}</button>
        <button type="button" class="btn-ghost btn-sm" id="mgCancel">Cancel</button>
      </div>
    </div>`;
  }

  function render() {
    const root = document.getElementById('mediaAdmin');
    const list = filtered();
    const counts = { photo: items.filter(r => r.media_type === 'photo').length, video: items.filter(r => r.media_type === 'video').length };
    root.innerHTML = `
      <div class="mg-toolbar">
        <button type="button" class="btn" id="mgAddPhoto">+ Upload photo</button>
        <button type="button" class="btn-ghost btn-sm" id="mgAddVideo">+ Add video</button>
        <span class="mg-spacer"></span>
        <select id="mgFCat" aria-label="Filter by category"><option value="">All categories</option>${cats.map(c => `<option value="${esc(c.key)}" ${c.key === fCat ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        <select id="mgFType" aria-label="Filter by type"><option value="">Photos &amp; videos</option><option value="photo" ${fType === 'photo' ? 'selected' : ''}>Photos (${counts.photo})</option><option value="video" ${fType === 'video' ? 'selected' : ''}>Videos (${counts.video})</option></select>
        ${needsOptimise().length ? `<button type="button" class="btn-ghost btn-sm" id="mgOptimise" title="Create optimised sizes for older photos">Optimise ${needsOptimise().length} older photo${needsOptimise().length > 1 ? 's' : ''}</button>` : ''}
        <a class="btn-ghost btn-sm" href="${SITE}/festival-gallery" target="_blank" rel="noopener">View gallery ↗</a>
      </div>
      ${editing ? editorHtml() : ''}
      <div class="mg-list">
        ${list.length ? list.map((r, i) => `
          <div class="mg-row${r.is_visible ? '' : ' is-hidden'}" data-id="${r.id}">
            <span class="mg-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="mg-thumb">${thumbOf(r) ? `<img src="${esc(thumbOf(r))}" alt="" loading="lazy">` : ''}${r.media_type === 'video' ? '<span class="mg-play">▶</span>' : ''}</span>
            <span class="mg-info"><b>${esc(r.title || '(untitled)')}</b>
              <small>${r.media_type === 'video' ? 'Video' : 'Photo'} · ${esc(catLabel(r.category))}${r.category === WINNERS && (r.award_id || r.award_name) ? ' · ' + esc(awardLabel(r)) + (TRACKS[r.competition_track] ? ' · ' + TRACKS[r.competition_track] : '') : ''}${r.edition_year ? ' · ' + esc(r.edition_year) : ' · No edition'}${r.is_featured ? ' · Featured' : ''}${r.is_visible ? '' : ' · Hidden'}</small></span>
            <span class="mg-actions">
              <label class="mg-vis" title="Show on the website"><input type="checkbox" data-act="vis" ${r.is_visible ? 'checked' : ''}> Visible</label>
              <button type="button" class="btn-ghost btn-xs" data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
              <button type="button" class="btn-ghost btn-xs" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
              <button type="button" class="btn-ghost btn-xs" data-act="preview">Preview</button>
              <button type="button" class="btn-ghost btn-xs" data-act="edit">Edit</button>
              <button type="button" class="btn-ghost btn-xs btn-danger" data-act="del">Delete</button>
            </span>
          </div>`).join('') : '<p class="muted-note">No media in this view yet.</p>'}
      </div>
      <details class="mg-cats"><summary>Manage categories</summary>
        <p class="muted-note">Categories marked “Filter” appear as filter buttons on the festival gallery. Others still show under All / Photos / Videos.</p>
        ${cats.map(c => `<div class="mg-cat-row" data-key="${esc(c.key)}"><input type="text" value="${esc(c.label)}" data-cf="label" aria-label="Category name"><label><input type="checkbox" data-cf="show_in_filter" ${c.show_in_filter ? 'checked' : ''}> Filter</label><code>${esc(c.key)}</code></div>`).join('')}
        <div class="mg-cat-row is-new"><input type="text" id="mgNewCat" placeholder="New category name"><button type="button" class="btn-ghost btn-sm" id="mgAddCat">Add</button><button type="button" class="btn-ghost btn-sm" id="mgSaveCats">Save categories</button></div>
      </details>`;
    bind(root);
  }

  function readEditor() {
    const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    if (!editing) return;
    editing.title = (v('mgTitle') || '').trim();
    if (editing.category === WINNERS) {
      const tc = document.getElementById('mgTitleCustom'); if (tc) editing._customTitle = tc.checked;
      if (v('mgTrack') !== undefined) editing.competition_track = v('mgTrack') || null;
      if (v('mgAward') !== undefined) {
        const sel = v('mgAward') || '', b = sel.startsWith('sj:') ? awardOf(sel.slice(3)) : null, sp = specialAward();
        if (b && sp) { editing.award_id = sp.id; editing.award_name = SJ_PREFIX + b.name; }
        else { editing.award_id = sel ? +sel : null; const a = awardOf(editing.award_id); editing.award_name = a ? a.name : null; }
      }
      if (v('mgFilm') !== undefined) editing.film_name = (v('mgFilm') || '').trim();
      if (v('mgPerson') !== undefined) editing.winner_name = (v('mgPerson') || '').trim();
      const rc = document.querySelector('input[name="mgRecip"]:checked'); if (rc) editing.recipient_type = rc.value;
    }
    if (editing.media_type === 'video') editing.video_url = (v('mgVideo') || '').trim();
    editing.category = v('mgCat') || editing.category;
    const y = parseInt(v('mgYear'), 10); editing.edition_year = isNaN(y) ? null : y;
    editing.description = (v('mgDesc') || '').trim();
    const o = parseInt(v('mgOrder'), 10); editing.display_order = isNaN(o) ? 0 : o;
    editing.is_visible = document.getElementById('mgVisible').checked;
    editing.is_featured = document.getElementById('mgFeatured').checked;
  }

  function bind(root) {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('mgAddPhoto', 'click', () => startEdit({ media_type: 'photo' }));
    on('mgAddVideo', 'click', () => startEdit({ media_type: 'video' }));
    on('mgFCat', 'change', e => { fCat = e.target.value; render(); });
    on('mgFType', 'change', e => { fType = e.target.value; render(); });
    on('mgCancel', 'click', () => { editing = null; orphans = []; render(); });
    // edition suggestions fill the year field; typing keeps digits only and highlights a matching suggestion
    const yr = document.getElementById('mgYear');
    const syncChips = () => document.querySelectorAll('.mg-year-chip').forEach(c => c.classList.toggle('is-on', c.dataset.year === yr.value));
    document.querySelectorAll('.mg-year-chip').forEach(c => c.addEventListener('click', () => { yr.value = c.dataset.year; syncChips(); }));
    on('mgYear', 'input', () => { yr.value = yr.value.replace(/\D/g, '').slice(0, 4); syncChips(); });
    on('mgSave', 'click', save);
    on('mgVideo', 'input', e => {
      if (!editing || editing.media_type !== 'video' || editing.thumbnail_url) return;   // custom thumbnail wins
      const box = document.querySelector('#mgEditor .mg-preview');
      if (!box) return;
      const vid = ytId(e.target.value);
      box.innerHTML = vid ? `<img src="${esc(SKYouTube.thumb(vid))}" alt="" data-yt-fallback>`
        : `<span>${e.target.value.trim() ? 'Not a YouTube link yet — check the URL' : 'Thumbnail comes from YouTube'}</span>`;
    });
    on('mgFile', 'change', e => upload(e.target));
    on('mgRemoveImg', 'click', () => {
      readEditor();
      const key = editing.media_type === 'video' ? 'thumbnail_url' : 'image_url';
      orphans.push(editing[key]); editing[key] = '';
      if (editing.media_type === 'photo') { orphans.push(editing.thumbnail_url, editing.medium_url); editing.thumbnail_url = ''; editing.medium_url = ''; editing.width = editing.height = editing.file_size = null; }
      render();
    });
    root.querySelectorAll('input[name="mgType"]').forEach(r => r.addEventListener('change', () => { readEditor(); editing.media_type = r.value; render(); }));
    // category / track / award / recipient changes re-render the form so only relevant fields show
    ['mgCat', 'mgTrack', 'mgAward'].forEach(id => on(id, 'change', () => { readEditor(); render(); }));
    root.querySelectorAll('input[name="mgRecip"]').forEach(r => r.addEventListener('change', () => { readEditor(); render(); }));
    // live auto-title while typing winner details
    root.querySelectorAll('[data-w]').forEach(inp => inp.addEventListener('input', () => {
      readEditor();
      const t = document.getElementById('mgTitle');
      if (t && !editing._customTitle) t.value = winnerTitle(editing);
    }));
    on('mgTitleCustom', 'change', e => {
      readEditor();
      const t = document.getElementById('mgTitle');
      if (!t) return;
      t.readOnly = !e.target.checked;
      if (!e.target.checked) t.value = winnerTitle(editing); else t.focus();
    });
    if (window.AdminDropdown) AdminDropdown.enhanceAll(root);
    root.querySelectorAll('.mg-row').forEach(row => row.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = +row.dataset.id, r = items.find(x => x.id === id);
      const act = b.dataset.act;
      if (act === 'vis') toggleVisible(r, b.checked);
      else if (act === 'up' || act === 'down') move(r, act === 'up' ? -1 : 1);
      else if (act === 'edit') startEdit(Object.assign({}, r));
      else if (act === 'del') remove(r);
      else if (act === 'preview') preview(r);
    }));
    on('mgAddCat', 'click', addCategory);
    on('mgOptimise', 'click', e => optimiseExisting(e.currentTarget));
    on('mgSaveCats', 'click', saveCategories);
  }

  function startEdit(r) {
    const nextOrder = items.reduce((m, x) => Math.max(m, x.display_order || 0), 0) + 10;
    editing = Object.assign({ id: null, title: '', category: fCat || (r.media_type === 'video' ? 'messages-of-support' : 'festival-moments'), image_url: '', video_url: '', thumbnail_url: '',
      description: '', edition_year: null, display_order: nextOrder, is_visible: true, is_featured: false }, r);
    if (editing.category === WINNERS) {
      editing.recipient_type = editing.recipient_type || 'film';
      // an existing title that differs from the generated one was written by hand — keep it editable
      editing._customTitle = !!(editing.id && editing.title && editing.title !== winnerTitle(editing));
    }
    orphans = [];
    render();
    const el = document.getElementById('mgEditor'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- image pipeline: validate → decode once → 3 WebP sizes → storage ---------- */
  const SIZES = { full: [2200, 0.9], md: [1280, 0.88], th: [960, 0.86] };    // longest side (px), WebP quality — high enough to keep skin tones, stage light and certificate text clean
  const MAX_INPUT = 30 * 1024 * 1024;
  const OK_TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

  // Check extension, declared MIME type and the file's real signature (magic bytes)
  async function validateImage(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'Use a JPG, PNG or WebP image.';
    if (!OK_TYPES[file.type]) return 'Use a JPG, PNG or WebP image.';
    if (file.size > MAX_INPUT) return 'Image is larger than 30 MB.';
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    if (!(isJpeg || isPng || isWebp)) return 'This file is not a valid image.';
    return '';
  }

  // Resize with step-down halving for clean downscales; output WebP. Aspect ratio preserved.
  async function encode(bitmap, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const tw = Math.round(bitmap.width * scale), th = Math.round(bitmap.height * scale);
    let src = bitmap, sw = bitmap.width, sh = bitmap.height;
    while (sw / 2 >= tw * 1.001 && sh / 2 >= th) {
      const c = document.createElement('canvas'); c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
      src = c; sw = c.width; sh = c.height;
    }
    const out = document.createElement('canvas'); out.width = tw; out.height = th;
    const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, tw, th);
    const blob = await new Promise((res, rej) => out.toBlob(b => (b ? res(b) : rej(new Error('WebP export failed'))), 'image/webp', quality));
    return { blob, width: tw, height: th };
  }
  async function decode(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ } }
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('This image could not be read.')); im.src = URL.createObjectURL(blob); });
  }
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  // festival-gallery/{edition}/{category}/{uuid}-{size}.webp — never the raw user filename
  function basePath(r) {
    const year = /^\d{4}$/.test(String(r.edition_year || '')) ? r.edition_year : 'undated';
    return `festival-gallery/${year}/${slug(r.category || 'other')}/${uid()}`;
  }
  async function put(blob, path) {
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: 'image/webp', cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  // Build full / medium / thumbnail from one decoded source
  async function makeVersions(source, r, sizes) {
    const bmp = await decode(source);
    const base = basePath(r);
    const out = { width: bmp.width, height: bmp.height };
    for (const key of sizes) {
      const [side, q] = SIZES[key];
      // an already web-ready WebP is stored as-is for the full size — no second round of compression
      if (key === 'full' && source.type === 'image/webp' && Math.max(bmp.width, bmp.height) <= side && source.size <= 1.5 * 1024 * 1024) {
        out.full = await put(source, `${base}-full.webp`);
        out.size = source.size;
        continue;
      }
      const enc = await encode(bmp, side, q);
      out[key] = await put(enc.blob, `${base}-${key}.webp`);
      if (key === 'full') { out.width = enc.width; out.height = enc.height; out.size = enc.blob.size; }
    }
    if (bmp.close) bmp.close();
    return out;
  }

  async function upload(input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    const bad = await validateImage(file);
    if (bad) return notify(bad, 'err');
    readEditor();
    notify('Optimising and uploading…');
    try {
      if (editing.media_type === 'video') {
        const v = await makeVersions(file, editing, ['md']);        // poster only
        orphans.push(editing.thumbnail_url); editing.thumbnail_url = v.md;
      } else {
        const v = await makeVersions(file, editing, ['full', 'md', 'th']);
        orphans.push(editing.image_url, editing.medium_url, editing.thumbnail_url);
        Object.assign(editing, { image_url: v.full, medium_url: v.md, thumbnail_url: v.th, width: v.width, height: v.height, file_size: v.size, mime_type: 'image/webp' });
      }
      render();
      notify('Uploaded — click save to publish.', 'ok');
    } catch (e) { notify('Upload failed: ' + e.message, 'err'); }
  }

  // Remove storage files this tool uploaded that no gallery row references any more
  const OWNED = p => p.startsWith('media/') || p.startsWith('festival-gallery/');
  async function cleanup(urls) {
    const paths = [...new Set(urls.filter(Boolean))].filter(u => OWNED(storagePath(u)))
      .filter(u => !items.some(r => r.image_url === u || r.thumbnail_url === u || r.medium_url === u)).map(storagePath);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  }

  // One-time: give older photos a medium + 800px thumbnail (reads the stored display image; nothing re-uploaded by hand)
  const needsOptimise = () => items.filter(r => r.media_type === 'photo' && r.image_url && !r.medium_url);
  async function optimiseExisting(btn) {
    const todo = needsOptimise();
    if (!todo.length) return;
    if (!(window.UI && UI.confirm)) return notify('Confirmation dialog unavailable — reload the page and try again.', 'err');
    const ok = await UI.confirm(`Create optimised thumbnail and medium sizes for ${todo.length} older photo${todo.length > 1 ? 's' : ''}? The original images stay exactly as they are.`,
      { title: 'Optimise existing photos?', okText: 'Optimise', cancelText: 'Cancel' });
    if (!ok) return;
    if (btn) btn.disabled = true;
    let done = 0, failed = 0;
    for (const r of todo) {
      try {
        if (btn) btn.textContent = `Optimising ${done + failed + 1} / ${todo.length}…`;
        const res = await fetch(new URL(r.image_url, location.origin).href, { mode: 'cors', cache: 'force-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const v = await makeVersions(blob, r, ['md', 'th']);
        const patch = { medium_url: v.md, thumbnail_url: v.th, width: v.width, height: v.height, file_size: blob.size, mime_type: blob.type || 'image/webp', updated_at: new Date().toISOString() };
        const { error } = await sb.from('gallery_media').update(patch).eq('id', r.id);
        if (error) throw error;
        Object.assign(r, patch); done++;
      } catch (e) { failed++; console.warn('Optimise failed for', r.id, e); }
    }
    render();
    notify(`Optimised ${done} photo${done === 1 ? '' : 's'}${failed ? ` · ${failed} could not be processed` : ''}.`, failed ? 'err' : 'ok');
  }

  async function save() {
    if (busy) return;
    readEditor();
    const r = editing;
    if (r.media_type === 'photo' && !r.image_url) return notify('Upload a photo first.', 'err');
    // Edition / year decides where the item appears in the Showcase edition filter — required for new media and award winners
    if (!validYear(r.edition_year) && (!r.id || r.category === WINNERS)) { const el = document.getElementById('mgYear'); if (el) el.focus(); return notify('Enter the edition / year (e.g. ' + editionYears()[0] + ').', 'err'); }
    if (r.media_type === 'video') {
      if (!/^https:\/\//i.test(r.video_url || '')) return notify('Enter the video link (https://…).', 'err');
      if (!ytId(r.video_url) && !/\.(mp4|webm)(\?|$)/i.test(r.video_url)) return notify('Use a YouTube link or a direct .mp4 / .webm link.', 'err');
    }
    const isWinner = r.category === WINNERS;
    if (isWinner) {
      const a = awardOf(r.award_id), k = kindOf(r);
      if (!r.competition_track) return notify('Choose the competition track (General or Campus).', 'err');
      if (!a) return notify('Choose the award category.', 'err');
      const film = (r.film_name || '').trim(), person = (r.winner_name || '').trim();
      if (k.kind === 'film' && !film) return notify('Enter the film name.', 'err');
      if (k.kind === 'person' && !person) return notify(`Enter the ${k.person.toLowerCase()}.`, 'err');
      if (k.kind === 'person' && !film) return notify('Enter the film name.', 'err');
      if (k.kind === 'special' && r.recipient_type !== 'person' && !film) return notify('Enter the film name.', 'err');
      if (k.kind === 'special' && r.recipient_type === 'person' && !person) return notify('Enter the recipient name.', 'err');
      if (!r._customTitle || !r.title) r.title = winnerTitle(r);
      r.recipient_type = k.kind === 'person' ? 'person' : k.kind === 'film' ? 'film' : (r.recipient_type || 'film');
      r.award_name = awardLabel(r);
    }
    const row = {
      award_id: isWinner ? r.award_id : null, award_name: isWinner ? r.award_name : null,
      competition_track: isWinner ? r.competition_track : null,
      winner_name: isWinner ? ((r.winner_name || '').trim() || null) : null,
      film_name: isWinner ? ((r.film_name || '').trim() || null) : null,
      recipient_type: isWinner ? r.recipient_type : null,
      title: r.title, media_type: r.media_type, category: r.category,
      image_url: r.media_type === 'photo' ? r.image_url : null,
      video_url: r.media_type === 'video' ? r.video_url : null,
      thumbnail_url: r.thumbnail_url || null, description: r.description, edition_year: r.edition_year,
      medium_url: r.media_type === 'photo' ? (r.medium_url || null) : null,
      width: r.media_type === 'photo' ? (r.width || null) : null, height: r.media_type === 'photo' ? (r.height || null) : null,
      file_size: r.media_type === 'photo' ? (r.file_size || null) : null, mime_type: r.media_type === 'photo' ? (r.mime_type || null) : null,
      display_order: r.display_order, is_visible: r.is_visible, is_featured: r.is_featured, updated_at: new Date().toISOString(),
    };
    if (r.media_type === 'video' && r.image_url) orphans.push(r.image_url);
    busy = true;
    const res = r.id ? await sb.from('gallery_media').update(row).eq('id', r.id).select().single()
                     : await sb.from('gallery_media').insert(row).select().single();
    busy = false;
    if (res.error) return notify('Save failed: ' + res.error.message, 'err');
    const i = items.findIndex(x => x.id === res.data.id);
    if (i >= 0) items[i] = res.data; else items.push(res.data);
    items.sort((a, b) => (a.display_order - b.display_order) || String(a.created_at).localeCompare(String(b.created_at)));
    const drop = orphans; orphans = []; editing = null;
    render();
    cleanup(drop).catch(() => {});
    notify('Saved — live in the festival gallery', 'ok');
  }

  async function toggleVisible(r, on) {
    const { error } = await sb.from('gallery_media').update({ is_visible: on, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { notify('Update failed: ' + error.message, 'err'); return render(); }
    r.is_visible = on; render();
  }

  async function move(r, dir) {
    const list = filtered();
    const i = list.indexOf(r), j = i + dir;
    if (j < 0 || j >= list.length) return;
    // renumber the whole list (10, 20, …) then swap the pair, saving only rows that changed
    const before = new Map(items.map(x => [x.id, x.display_order]));
    items.forEach((x, k) => { x.display_order = (k + 1) * 10; });
    const other = list[j];
    [r.display_order, other.display_order] = [other.display_order, r.display_order];
    items.sort((a, b) => a.display_order - b.display_order);
    render();
    const changed = items.filter(x => before.get(x.id) !== x.display_order);
    const results = await Promise.all(changed.map(x => sb.from('gallery_media').update({ display_order: x.display_order }).eq('id', x.id)));
    const err = results.find(x => x.error);
    if (err) { notify('Reorder failed: ' + err.error.message, 'err'); load(); }
  }

  async function remove(r) {
    if (!(window.UI && UI.confirm)) return notify('Confirmation dialog unavailable — reload the page and try again.', 'err');
    const ok = await UI.confirm(`Delete “${esc(r.title || 'this item')}” from the festival gallery?`, { title: 'Delete media?', okText: 'Delete', cancelText: 'Cancel', danger: true });
    if (!ok) return;
    const { error } = await sb.from('gallery_media').delete().eq('id', r.id);
    if (error) return notify('Delete failed: ' + error.message, 'err');
    items = items.filter(x => x.id !== r.id);
    render();
    cleanup([r.image_url, r.thumbnail_url, r.medium_url]).catch(() => {});
    notify('Deleted', 'ok');
  }

  // Styled preview window (no new browser tab)
  function preview(r) {
    const id = ytId(r.video_url);
    const media = r.media_type === 'video'
      ? (id ? `<div class="mg-pv-video"><iframe src="https://www.youtube.com/embed/${esc(id)}?autoplay=1&rel=0" title="${esc(r.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
            : `<div class="mg-pv-video"><video src="${esc(r.video_url)}" controls autoplay playsinline></video></div>`)
      : `<img src="${esc(r.image_url || thumbOf(r))}" alt="${esc(r.title)}">`;
    const wrap = document.createElement('div');
    wrap.className = 'mg-pv';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Preview');
    wrap.innerHTML = `<div class="mg-pv-box"><button type="button" class="mg-pv-close" aria-label="Close preview">&times;</button>${media}
      <div class="mg-pv-cap"><b>${esc(r.title || '(untitled)')}</b><small>${esc(catLabel(r.category))}${r.edition_year ? ' · ' + esc(r.edition_year) : ''}${r.is_visible ? '' : ' · Hidden'}</small></div></div>`;
    const last = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); if (last) last.focus(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('.mg-pv-close')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('.mg-pv-close').focus();
  }

  async function addCategory() {
    const input = document.getElementById('mgNewCat');
    const label = (input.value || '').trim();
    if (!label) return;
    const key = slug(label);
    if (cats.some(c => c.key === key)) return notify('That category already exists.', 'err');
    const { data, error } = await sb.from('media_categories').insert({ key, label, sort_order: cats.length + 1, show_in_filter: true }).select().single();
    if (error) return notify('Could not add category: ' + error.message, 'err');
    cats.push(data); render(); notify('Category added', 'ok');
  }

  async function saveCategories() {
    const rows = [...document.querySelectorAll('.mg-cat-row[data-key]')].map((row, i) => ({
      key: row.dataset.key, sort_order: i + 1,
      label: row.querySelector('[data-cf="label"]').value.trim() || row.dataset.key,
      show_in_filter: row.querySelector('[data-cf="show_in_filter"]').checked,
    }));
    const { error } = await sb.from('media_categories').upsert(rows, { onConflict: 'key' });
    if (error) return notify('Save failed: ' + error.message, 'err');
    cats = rows.map(r => Object.assign(cats.find(c => c.key === r.key) || {}, r));
    render(); notify('Categories saved', 'ok');
  }

  function init(client) { sb = client; }
  return { init, load };
})();
