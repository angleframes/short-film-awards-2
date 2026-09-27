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
  let fCat = '', fType = '';
  let editing = null;          // working copy of the row being edited (id null = new)
  let orphans = [];            // storage URLs replaced/removed during the current edit
  let busy = false;

  const BUCKET = 'gallery';
  const SITE = 'https://sharankrishnashortfilmawards.com';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const slug = s => String(s || 'media').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'media';
  const ytId = url => { const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/i); return m ? m[1] : ''; };
  const thumbOf = r => r.thumbnail_url || r.image_url || (ytId(r.video_url) ? `https://i.ytimg.com/vi/${ytId(r.video_url)}/hqdefault.jpg` : '');
  const catLabel = k => (cats.find(c => c.key === k) || {}).label || k;
  const storagePath = url => { const m = String(url || '').match(/\/storage\/v1\/object\/public\/gallery\/(.+)$/); return m ? decodeURIComponent(m[1].split('?')[0]) : ''; };

  async function load() {
    const root = document.getElementById('mediaAdmin');
    if (!root || !sb) return;
    root.innerHTML = '<p class="muted-note">Loading…</p>';
    const [c, m] = await Promise.all([
      sb.from('media_categories').select('*').order('sort_order'),
      sb.from('gallery_media').select('*').order('display_order').order('created_at'),
    ]);
    if (c.error || m.error) { root.innerHTML = `<p class="muted-note">Festival gallery storage isn't available (${esc((c.error || m.error).message)}).</p>`; return; }
    cats = c.data || []; items = m.data || [];
    render();
  }

  function filtered() {
    return items.filter(r => (!fCat || r.category === fCat) && (!fType || r.media_type === fType));
  }

  function editorHtml() {
    const r = editing, isVideo = r.media_type === 'video';
    const img = isVideo ? r.thumbnail_url : r.image_url;
    const preview = img || (isVideo && ytId(r.video_url) ? `https://i.ytimg.com/vi/${ytId(r.video_url)}/hqdefault.jpg` : '');
    return `<div class="mg-editor" id="mgEditor">
      <div class="mg-editor-head"><h3>${r.id ? 'Edit' : 'Add'} ${isVideo ? 'video' : 'photo'}</h3>
        <div class="mg-type"><label><input type="radio" name="mgType" value="photo" ${!isVideo ? 'checked' : ''}> Photo</label><label><input type="radio" name="mgType" value="video" ${isVideo ? 'checked' : ''}> Video</label></div></div>
      <div class="mg-editor-grid">
        <div class="mg-preview-col">
          <div class="mg-preview">${preview ? `<img src="${esc(preview)}" alt="">` : `<span>${isVideo ? 'Thumbnail comes from YouTube' : 'No photo yet'}</span>`}</div>
          <div class="mg-preview-actions">
            <label class="btn-ghost btn-sm mg-upload">${img ? 'Replace' : 'Upload'} ${isVideo ? 'thumbnail' : 'photo'}<input type="file" accept="image/*" hidden id="mgFile"></label>
            ${img ? '<button type="button" class="btn-ghost btn-sm" id="mgRemoveImg">Remove</button>' : ''}
          </div>
          ${isVideo ? '<p class="muted-note">Optional — leave empty to use the YouTube thumbnail.</p>' : ''}
        </div>
        <div class="mg-fields">
          <div class="mg-field is-full"><label for="mgTitle">Media title</label><input type="text" id="mgTitle" value="${esc(r.title)}" maxlength="140"></div>
          ${isVideo ? `<div class="mg-field is-full"><label for="mgVideo">Video URL (YouTube)</label><input type="url" id="mgVideo" value="${esc(r.video_url || '')}" placeholder="https://www.youtube.com/watch?v=…"></div>` : ''}
          <div class="mg-field"><label for="mgCat">Category</label><select id="mgCat">${cats.map(c => `<option value="${esc(c.key)}" ${c.key === r.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
          <div class="mg-field"><label for="mgYear">Edition / year</label><input type="number" id="mgYear" min="2000" max="2100" value="${esc(r.edition_year || '')}" placeholder="e.g. 2025"></div>
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
        <a class="btn-ghost btn-sm" href="${SITE}/festival-gallery" target="_blank" rel="noopener">View gallery ↗</a>
      </div>
      ${editing ? editorHtml() : ''}
      <div class="mg-list">
        ${list.length ? list.map((r, i) => `
          <div class="mg-row${r.is_visible ? '' : ' is-hidden'}" data-id="${r.id}">
            <span class="mg-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="mg-thumb">${thumbOf(r) ? `<img src="${esc(thumbOf(r))}" alt="" loading="lazy">` : ''}${r.media_type === 'video' ? '<span class="mg-play">▶</span>' : ''}</span>
            <span class="mg-info"><b>${esc(r.title || '(untitled)')}</b>
              <small>${r.media_type === 'video' ? 'Video' : 'Photo'} · ${esc(catLabel(r.category))}${r.edition_year ? ' · ' + esc(r.edition_year) : ''}${r.is_featured ? ' · Featured' : ''}${r.is_visible ? '' : ' · Hidden'}</small></span>
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
    on('mgSave', 'click', save);
    on('mgFile', 'change', e => upload(e.target));
    on('mgRemoveImg', 'click', () => {
      readEditor();
      const key = editing.media_type === 'video' ? 'thumbnail_url' : 'image_url';
      orphans.push(editing[key]); editing[key] = '';
      if (editing.media_type === 'photo') { orphans.push(editing.thumbnail_url); editing.thumbnail_url = ''; }
      render();
    });
    root.querySelectorAll('input[name="mgType"]').forEach(r => r.addEventListener('change', () => { readEditor(); editing.media_type = r.value; render(); }));
    root.querySelectorAll('.mg-row').forEach(row => row.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = +row.dataset.id, r = items.find(x => x.id === id);
      const act = b.dataset.act;
      if (act === 'vis') toggleVisible(r, b.checked);
      else if (act === 'up' || act === 'down') move(r, act === 'up' ? -1 : 1);
      else if (act === 'edit') startEdit(Object.assign({}, r));
      else if (act === 'del') remove(r);
      else if (act === 'preview') window.open(r.media_type === 'video' ? r.video_url : r.image_url, '_blank', 'noopener');
    }));
    on('mgAddCat', 'click', addCategory);
    on('mgSaveCats', 'click', saveCategories);
  }

  function startEdit(r) {
    const nextOrder = items.reduce((m, x) => Math.max(m, x.display_order || 0), 0) + 10;
    editing = Object.assign({ id: null, title: '', category: fCat || (r.media_type === 'video' ? 'messages-of-support' : 'festival-moments'), image_url: '', video_url: '', thumbnail_url: '',
      description: '', edition_year: null, display_order: nextOrder, is_visible: true, is_featured: false }, r);
    orphans = [];
    render();
    const el = document.getElementById('mgEditor'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function uploadBlob(blob, name) {
    const path = `media/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${slug(name)}.webp`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: 'image/webp', cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function upload(input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify('Choose an image file.', 'err');
    if (file.size > 20 * 1024 * 1024) return notify('Image is larger than 20 MB.', 'err');
    readEditor();
    notify('Optimising and uploading…');
    try {
      const isVideo = editing.media_type === 'video';
      const full = await _optimizeImage(file, isVideo ? 1280 : 2200, 0.86);
      const url = await uploadBlob(full, editing.title || file.name);
      if (isVideo) { orphans.push(editing.thumbnail_url); editing.thumbnail_url = url; }
      else {
        const small = await _optimizeImage(file, 720, 0.8);
        const turl = await uploadBlob(small, (editing.title || file.name) + '-thumb');
        orphans.push(editing.image_url, editing.thumbnail_url);
        editing.image_url = url; editing.thumbnail_url = turl;
      }
      render();
      notify('Uploaded — click save to publish.', 'ok');
    } catch (e) { notify('Upload failed: ' + e.message, 'err'); }
  }

  // Remove storage files under media/ that no gallery row references any more.
  async function cleanup(urls) {
    const paths = [...new Set(urls.filter(Boolean))].filter(u => storagePath(u).startsWith('media/'))
      .filter(u => !items.some(r => r.image_url === u || r.thumbnail_url === u)).map(storagePath);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  }

  async function save() {
    if (busy) return;
    readEditor();
    const r = editing;
    if (r.media_type === 'photo' && !r.image_url) return notify('Upload a photo first.', 'err');
    if (r.media_type === 'video') {
      if (!/^https:\/\//i.test(r.video_url || '')) return notify('Enter the video link (https://…).', 'err');
      if (!ytId(r.video_url) && !/\.(mp4|webm)(\?|$)/i.test(r.video_url)) return notify('Use a YouTube link or a direct .mp4 / .webm link.', 'err');
    }
    const row = {
      title: r.title, media_type: r.media_type, category: r.category,
      image_url: r.media_type === 'photo' ? r.image_url : null,
      video_url: r.media_type === 'video' ? r.video_url : null,
      thumbnail_url: r.thumbnail_url || null, description: r.description, edition_year: r.edition_year,
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
    const ok = window.UI && UI.confirm
      ? await UI.confirm(`Delete “${esc(r.title || 'this item')}” from the festival gallery?`, { title: 'Delete media?', okText: 'Delete', cancelText: 'Cancel', danger: true })
      : confirm(`Delete “${r.title || 'this item'}” from the festival gallery?`);
    if (!ok) return;
    const { error } = await sb.from('gallery_media').delete().eq('id', r.id);
    if (error) return notify('Delete failed: ' + error.message, 'err');
    items = items.filter(x => x.id !== r.id);
    render();
    cleanup([r.image_url, r.thumbnail_url]).catch(() => {});
    notify('Deleted', 'ok');
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
