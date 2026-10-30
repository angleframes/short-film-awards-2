/* Admin → Sponsors: "Co-Powered By" logos on the homepage (public.sponsors).
   Logos go to the existing public "gallery" bucket under sponsors/ (admin-only writes, same as jury photos). */
window.SponsorsAdmin = (function () {
  'use strict';

  let sb = null;
  let list = [];
  let editing = null;
  let orphans = [];
  let busy = false;

  const BUCKET = 'gallery';
  const SITE = 'https://sharankrishnashortfilmawards.com';
  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const slug = s => String(s || 'sponsor').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sponsor';
  const nameFromFile = f => String(f.name || 'Sponsor').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sponsor';
  const storagePath = url => { const m = String(url || '').match(/\/storage\/v1\/object\/public\/gallery\/(.+)$/); return m ? decodeURIComponent(m[1].split('?')[0]) : ''; };
  const sortFn = (a, b) => ((a.display_order || 0) - (b.display_order || 0)) || (a.id - b.id);
  const nextOrder = () => list.reduce((mx, x) => Math.max(mx, x.display_order || 0), 0) + 10;

  async function load() {
    const root = document.getElementById('sponsorsAdmin');
    if (!root || !sb) return;
    root.innerHTML = '<p class="muted-note">Loading…</p>';
    const { data, error } = await sb.from('sponsors').select('*');
    if (error) { root.innerHTML = `<p class="muted-note">Sponsor storage isn't available yet (${esc(error.message)}).</p>`; return; }
    list = (data || []).sort(sortFn);
    render();
  }

  function editorHtml() {
    const r = editing;
    return `<div class="mg-editor" id="spEditor">
      <div class="mg-editor-head"><h3>${r.id ? 'Edit sponsor' : 'Add sponsor'}</h3></div>
      <div class="mg-editor-grid">
        <div class="mg-preview-col">
          <div class="mg-preview sp-preview${r.on_light ? ' is-plate' : ''}">${r.logo_url ? `<img src="${esc(r.logo_url)}" alt="">` : '<span>No logo yet</span>'}</div>
          <div class="mg-preview-actions">
            <label class="btn-ghost btn-sm mg-upload">${r.logo_url ? 'Replace logo' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden id="spFile"></label>
          </div>
          <p class="muted-note">PNG with a transparent background works best. JPG or WebP also accepted, up to 10 MB.</p>
        </div>
        <div class="mg-fields">
          <div class="mg-field is-full"><label for="spName">Sponsor name</label><input type="text" id="spName" value="${esc(r.name)}" maxlength="120" placeholder="e.g. Company name"></div>
          <div class="mg-field mg-checks is-full">
            <label><input type="checkbox" id="spActive" ${r.is_active !== false ? 'checked' : ''}> Show on website</label>
            <label><input type="checkbox" id="spPlate" ${r.on_light ? 'checked' : ''}> Light background (for dark logos)</label>
          </div>
          <p class="muted-note mg-field is-full">Logos keep their own colours. Turn on the light background only if the logo is hard to see on black.</p>
        </div>
      </div>
      <div class="mg-editor-foot">
        <button type="button" class="btn" id="spSave">${r.id ? 'Save changes' : 'Add sponsor'}</button>
        <button type="button" class="btn-ghost btn-sm" id="spCancel">Cancel</button>
      </div>
    </div>`;
  }

  function rowHtml(s, i, n) {
    return `<div class="mg-row${s.is_active ? '' : ' is-hidden'}" data-id="${s.id}">
      <span class="mg-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="mg-thumb sp-thumb${s.on_light ? ' is-plate' : ''}"><img src="${esc(s.logo_url)}" alt="" loading="lazy"></span>
      <span class="mg-info"><b>${esc(s.name)}</b><small>${s.is_active ? 'Shown on website' : 'Hidden'}${s.on_light ? ' · Light background' : ''}</small></span>
      <span class="mg-actions">
        <label class="mg-vis"><input type="checkbox" data-act="active" ${s.is_active ? 'checked' : ''}> Show</label>
        <button type="button" class="btn-ghost btn-xs" data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">↑</button>
        <button type="button" class="btn-ghost btn-xs" data-act="down" ${i === n - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">↓</button>
        <button type="button" class="btn-ghost btn-xs" data-act="edit">Edit</button>
        <button type="button" class="btn-ghost btn-xs btn-danger" data-act="del">Delete</button>
      </span>
    </div>`;
  }

  function render() {
    const root = document.getElementById('sponsorsAdmin');
    const shown = list.filter(s => s.is_active).length;
    root.innerHTML = `
      <div class="mg-toolbar">
        <button type="button" class="btn" id="spAdd">+ Add sponsor</button>
        <label class="btn-ghost btn-sm mg-upload">Upload several logos<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden id="spBulk"></label>
        <span class="mg-spacer"></span>
        <a class="btn-ghost btn-sm" href="${SITE}/#section-sponsors" target="_blank" rel="noopener">View on website ↗</a>
      </div>
      <p class="muted-note">${shown} of ${list.length} sponsor${list.length === 1 ? '' : 's'} shown under “Co-Powered By”. When all logos fit on one line they stay still; when there are too many to fit, the row scrolls smoothly on its own. The section is hidden while no sponsor is shown.</p>
      ${editing ? editorHtml() : ''}
      <div class="mg-list">
        ${list.length ? list.map((s, i) => rowHtml(s, i, list.length)).join('') : '<p class="muted-note">No sponsors yet. Add one, or upload several logos at once.</p>'}
      </div>`;
    bind(root);
  }

  function readEditor() {
    if (!editing) return;
    const nm = document.getElementById('spName'); if (nm) editing.name = nm.value.trim();
    const ac = document.getElementById('spActive'); if (ac) editing.is_active = ac.checked;
    const pl = document.getElementById('spPlate'); if (pl) editing.on_light = pl.checked;
  }

  function bind(root) {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('spAdd', 'click', () => startEdit({}));
    on('spBulk', 'change', e => bulkUpload(e.target));
    on('spCancel', 'click', () => { const drop = orphans; orphans = []; editing = null; render(); cleanup(drop).catch(() => {}); });
    on('spSave', 'click', save);
    on('spFile', 'change', e => uploadOne(e.target));
    on('spPlate', 'change', () => { readEditor(); render(); });
    root.querySelectorAll('.mg-row').forEach(row => row.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const s = list.find(x => x.id === +row.dataset.id);
      const act = b.dataset.act;
      if (act === 'active') patch(s, { is_active: b.checked });
      else if (act === 'up' || act === 'down') move(s, act === 'up' ? -1 : 1);
      else if (act === 'edit') startEdit(Object.assign({}, s));
      else if (act === 'del') remove(s);
    }));
  }

  function startEdit(s) {
    editing = Object.assign({ id: null, name: '', logo_url: '', is_active: true, on_light: false, display_order: nextOrder() }, s);
    orphans = [];
    render();
    const el = document.getElementById('spEditor'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function checkFile(file) {
    if (!TYPES.includes(file.type)) return 'PNG, JPG or WebP only (SVG is not supported).';
    if (file.size > 10 * 1024 * 1024) return 'Logo is larger than 10 MB.';
    return null;
  }

  // Resize large logos (transparency kept) and store under sponsors/ with a unique name.
  async function storeLogo(file, name) {
    const blob = await _optimizeImage(file, 900, 0.9);
    const isWebp = blob.type === 'image/webp';
    const type = isWebp ? 'image/webp' : 'image/png';
    const path = `sponsors/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${slug(name)}.${isWebp ? 'webp' : 'png'}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: type, cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function uploadOne(input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    const bad = checkFile(file); if (bad) return notify(bad, 'err');
    readEditor();
    notify('Uploading logo…');
    try {
      const url = await storeLogo(file, editing.name || nameFromFile(file));
      if (editing.logo_url) orphans.push(editing.logo_url);
      editing.logo_url = url;
      if (!editing.name) editing.name = nameFromFile(file);
      render();
      notify('Logo uploaded — click save to publish.', 'ok');
    } catch (e) { notify('Upload failed: ' + e.message, 'err'); }
  }

  async function bulkUpload(input) {
    const files = Array.from(input.files || []); input.value = '';
    if (!files.length || busy) return;
    busy = true;
    let order = nextOrder(), added = 0;
    const failed = [];
    for (const file of files) {
      const bad = checkFile(file);
      if (bad) { failed.push(file.name + ': ' + bad); continue; }
      notify(`Uploading ${added + failed.length + 1} of ${files.length}…`);
      try {
        const name = nameFromFile(file);
        const url = await storeLogo(file, name);
        const res = await sb.from('sponsors').insert({ name, logo_url: url, display_order: order, is_active: true, on_light: false }).select().single();
        if (res.error) { await sb.storage.from(BUCKET).remove([storagePath(url)]); throw res.error; }
        list.push(res.data); order += 10; added++;
      } catch (e) { failed.push(file.name + ': ' + e.message); }
    }
    busy = false;
    list.sort(sortFn);
    render();
    if (failed.length) notify(`${added} added, ${failed.length} failed — ${failed[0]}`, 'err');
    else notify(`${added} sponsor${added === 1 ? '' : 's'} added — live on the website. Edit each to correct the name.`, 'ok');
  }

  async function cleanup(urls) {
    const paths = [...new Set(urls.filter(Boolean))]
      .filter(u => storagePath(u).startsWith('sponsors/'))
      .filter(u => !list.some(s => s.logo_url === u))
      .map(storagePath);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  }

  async function save() {
    if (busy) return;
    readEditor();
    const r = editing;
    if (!r.name) return notify('Enter the sponsor name.', 'err');
    if (!r.logo_url) return notify('Upload a logo first.', 'err');
    const row = { name: r.name, logo_url: r.logo_url, is_active: r.is_active !== false, on_light: !!r.on_light,
      display_order: r.display_order, updated_at: new Date().toISOString() };
    busy = true;
    const res = r.id ? await sb.from('sponsors').update(row).eq('id', r.id).select().single()
                     : await sb.from('sponsors').insert(row).select().single();
    busy = false;
    if (res.error) return notify('Save failed: ' + res.error.message, 'err');
    const i = list.findIndex(x => x.id === res.data.id);
    if (i >= 0) list[i] = res.data; else list.push(res.data);
    list.sort(sortFn);
    const drop = orphans; orphans = []; editing = null;
    render();
    cleanup(drop).catch(() => {});
    notify('Saved — live on the website', 'ok');
  }

  async function patch(s, fields) {
    const { error } = await sb.from('sponsors').update(Object.assign({ updated_at: new Date().toISOString() }, fields)).eq('id', s.id);
    if (error) { notify('Update failed: ' + error.message, 'err'); return render(); }
    Object.assign(s, fields); render();
    notify(fields.is_active === false ? 'Hidden from the website' : 'Shown on the website', 'ok');
  }

  async function move(s, dir) {
    const i = list.indexOf(s), j = i + dir;
    if (j < 0 || j >= list.length) return;
    list.forEach((x, k) => { x._new = (k + 1) * 10; });
    [s._new, list[j]._new] = [list[j]._new, s._new];
    const changed = list.filter(x => x._new !== x.display_order);
    changed.forEach(x => { x.display_order = x._new; });
    list.forEach(x => delete x._new);
    list.sort(sortFn); render();
    const results = await Promise.all(changed.map(x => sb.from('sponsors').update({ display_order: x.display_order }).eq('id', x.id)));
    const err = results.find(x => x.error);
    if (err) { notify('Reorder failed: ' + err.error.message, 'err'); load(); }
  }

  async function remove(s) {
    const ok = window.UI && UI.confirm
      ? await UI.confirm(`Delete sponsor “${esc(s.name)}”? The logo is removed from the website and from storage.`, { title: 'Delete sponsor?', okText: 'Delete', cancelText: 'Cancel', danger: true })
      : false;
    if (!ok) return;
    const { error } = await sb.from('sponsors').delete().eq('id', s.id);
    if (error) return notify('Delete failed: ' + error.message, 'err');
    list = list.filter(x => x.id !== s.id);
    render();
    cleanup([s.logo_url]).catch(() => {});
    notify('Deleted', 'ok');
  }

  function init(client) { sb = client; }
  return { init, load };
})();
