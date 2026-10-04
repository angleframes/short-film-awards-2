/* Admin → Jury: current and previous jury members (public.jury_members).
   Photos go to the existing public "gallery" bucket under jury/. The festival gallery reads photo_url
   straight from this table when "Show in Festival Gallery" is on — one stored image, no duplicate upload. */
window.JuryAdmin = (function () {
  'use strict';

  let sb = null;
  let members = [];
  let tab = 'current';
  let editing = null;
  let orphans = [];
  let busy = false;

  const BUCKET = 'gallery';
  const SITE = 'https://sharankrishnashortfilmawards.com';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const slug = s => String(s || 'jury').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'jury';
  const storagePath = url => { const m = String(url || '').match(/\/storage\/v1\/object\/public\/gallery\/(.+)$/); return m ? decodeURIComponent(m[1].split('?')[0]) : ''; };
  // Current festival edition (year of site_config.submission_deadline). An earlier edition's member is re-appointed to the
  // current jury by setting current_edition — same row, photo and bio; jury_type/edition_year stay as the historical record.
  let EDITION = new Date().getFullYear();
  const isCur = m => m.jury_type === 'current' || Number(m.current_edition) === EDITION;
  const sortFn = (a, b) => ((b.edition_year || 0) - (a.edition_year || 0)) || ((a.display_order || 0) - (b.display_order || 0)) || String(a.created_at).localeCompare(String(b.created_at));

  async function load() {
    const root = document.getElementById('juryAdmin');
    if (!root || !sb) return;
    root.innerHTML = '<p class="muted-note">Loading…</p>';
    const [{ data, error }, cfg] = await Promise.all([
      sb.from('jury_members').select('*'),
      sb.from('site_config').select('submission_deadline').eq('id', 1).maybeSingle(),
    ]);
    const y = cfg && cfg.data && cfg.data.submission_deadline ? new Date(cfg.data.submission_deadline).getFullYear() : 0;
    if (y > 2000) EDITION = y;
    if (error) { root.innerHTML = `<p class="muted-note">Jury storage isn't available (${esc(error.message)}).</p>`; return; }
    members = (data || []).sort(sortFn);
    render();
  }

  const ofTab = () => members.filter(m => (tab === 'current' ? isCur(m) : m.jury_type === 'previous')).sort(sortFn);

  function groups() {
    const list = ofTab();
    if (tab === 'current') return [['', list]];
    const g = new Map();
    list.forEach(m => { const k = m.edition_year ? `${m.edition_year} Edition` : 'Edition not set'; if (!g.has(k)) g.set(k, []); g.get(k).push(m); });
    return [...g];
  }

  function editorHtml() {
    const r = editing, cur = r.jury_type === 'current';
    return `<div class="mg-editor" id="jmEditor">
      <div class="mg-editor-head"><h3>${r.id ? 'Edit' : 'Add'} jury member</h3></div>
      <div class="mg-editor-grid">
        <div class="mg-preview-col">
          <div class="mg-preview is-portrait">${r.photo_url ? `<img src="${esc(r.photo_url)}" alt="">` : '<span>No photo yet</span>'}</div>
          <div class="mg-preview-actions">
            <label class="btn-ghost btn-sm mg-upload">${r.photo_url ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/*" hidden id="jmFile"></label>
            ${r.photo_url ? '<button type="button" class="btn-ghost btn-sm" id="jmRemovePhoto">Remove</button>' : ''}
          </div>
          <p class="muted-note">Portrait photos work best (shown at 4:5).</p>
        </div>
        <div class="mg-fields">
          <div class="mg-field is-full"><label for="jmName">Full name</label><input type="text" id="jmName" value="${esc(r.name)}" maxlength="120"></div>
          <div class="mg-field is-full"><label for="jmRole">Profession / designation</label><input type="text" id="jmRole" value="${esc(r.designation)}" maxlength="140" placeholder="e.g. Film Director"></div>
          <div class="mg-field is-full"><label for="jmBio">Short bio / credentials</label><textarea id="jmBio" rows="5" maxlength="1500">${esc(r.bio)}</textarea><small class="jm-count" id="jmBioCount">${(r.bio || '').length} / 1500</small></div>
          <div class="mg-field"><label for="jmType">Jury</label><select id="jmType"><option value="current" ${cur ? 'selected' : ''}>Current jury</option><option value="previous" ${!cur ? 'selected' : ''}>Previous jury</option></select></div>
          <div class="mg-field"><label for="jmYear">Edition / year</label><input type="number" id="jmYear" min="2000" max="2100" value="${esc(r.edition_year || '')}" placeholder="e.g. 2026"></div>
          <div class="mg-field"><label for="jmOrder">Display order</label><input type="number" id="jmOrder" value="${esc(r.display_order || 0)}"></div>
          <div class="mg-field mg-checks">
            <label><input type="checkbox" id="jmVisible" ${r.is_visible !== false ? 'checked' : ''}> Visible</label>
            ${cur ? `<label><input type="checkbox" id="jmActive" ${r.is_active !== false ? 'checked' : ''}> Active</label>` : ''}
            <label><input type="checkbox" id="jmGallery" ${r.show_in_gallery ? 'checked' : ''}> Show in Festival Gallery</label>
          </div>
          <div class="mg-field"><label for="jmIg">Instagram (optional)</label><input type="url" id="jmIg" value="${esc(r.instagram_url || '')}" placeholder="https://instagram.com/…"></div>
          <div class="mg-field"><label for="jmImdb">IMDb (optional)</label><input type="url" id="jmImdb" value="${esc(r.imdb_url || '')}" placeholder="https://www.imdb.com/name/…"></div>
          <div class="mg-field is-full"><label for="jmWeb">Website / professional link (optional)</label><input type="url" id="jmWeb" value="${esc(r.website_url || '')}" placeholder="https://…"></div>
        </div>
      </div>
      <div class="mg-editor-foot">
        <button type="button" class="btn" id="jmSave">${r.id ? 'Save changes' : 'Add member'}</button>
        <button type="button" class="btn-ghost btn-sm" id="jmCancel">Cancel</button>
      </div>
    </div>`;
  }

  function rowHtml(m, i, n) {
    const reappointed = m.jury_type === 'previous' && isCur(m);
    const flags = [m.is_visible ? '' : 'Hidden', m.jury_type === 'current' && !m.is_active ? 'Inactive' : '', m.show_in_gallery ? 'In gallery' : '',
      reappointed ? (tab === 'current' ? `Also ${m.edition_year || 'previous'} jury` : `${EDITION} Jury`) : ''].filter(Boolean).join(' · ');
    const promote = m.jury_type === 'previous'
      ? `<button type="button" class="btn-ghost btn-xs${reappointed ? '' : ' jm-promote'}" data-act="promote">${reappointed ? `Remove from ${EDITION} Jury` : `Add to ${EDITION} Jury`}</button>` : '';
    return `<div class="mg-row${m.is_visible ? '' : ' is-hidden'}" data-id="${m.id}">
      <span class="mg-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="mg-thumb is-portrait">${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="" loading="lazy">` : ''}</span>
      <span class="mg-info"><b>${esc(m.name)}</b><small>${esc(m.designation || '—')}${m.edition_year ? ' · ' + esc(m.edition_year) : ''}${flags ? ' · ' + flags : ''}</small></span>
      <span class="mg-actions">
        <label class="mg-vis"><input type="checkbox" data-act="vis" ${m.is_visible ? 'checked' : ''}> Visible</label>
        <label class="mg-vis"><input type="checkbox" data-act="gal" ${m.show_in_gallery ? 'checked' : ''}> In gallery</label>
        <button type="button" class="btn-ghost btn-xs" data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button type="button" class="btn-ghost btn-xs" data-act="down" ${i === n - 1 ? 'disabled' : ''} title="Move down">↓</button>
        ${promote}
        <button type="button" class="btn-ghost btn-xs" data-act="preview">Preview</button>
        <button type="button" class="btn-ghost btn-xs" data-act="edit">Edit</button>
        <button type="button" class="btn-ghost btn-xs btn-danger" data-act="del">Delete</button>
      </span>
    </div>`;
  }

  function render() {
    const root = document.getElementById('juryAdmin');
    const nCur = members.filter(isCur).length, nPrev = members.filter(m => m.jury_type === 'previous').length;
    const g = groups();
    root.innerHTML = `
      <div class="jm-tabs" role="tablist">
        <button type="button" role="tab" class="jm-tab${tab === 'current' ? ' is-active' : ''}" data-tab="current" aria-selected="${tab === 'current'}">Current Jury <span>${nCur}</span></button>
        <button type="button" role="tab" class="jm-tab${tab === 'previous' ? ' is-active' : ''}" data-tab="previous" aria-selected="${tab === 'previous'}">Previous Jury <span>${nPrev}</span></button>
      </div>
      <div class="mg-toolbar">
        <button type="button" class="btn" id="jmAdd">+ Add ${tab === 'current' ? 'current' : 'previous'} jury member</button>
        <span class="mg-spacer"></span>
        <a class="btn-ghost btn-sm" href="${SITE}/${tab === 'current' ? '#section-jury' : 'festival-gallery?filter=previous-jury'}" target="_blank" rel="noopener">View on website ↗</a>
      </div>
      <p class="muted-note">${tab === 'current'
        ? `The ${EDITION} jury shown on the website. Re-appoint an earlier edition's member from the Previous Jury tab (“Add to ${EDITION} Jury”) — their photo and bio are reused, nothing is copied. While no visible member is on the ${EDITION} jury, the homepage shows “Jury Announcement Coming Soon”.`
        : `Grouped by edition — the historical record. “Add to ${EDITION} Jury” makes the same profile part of the ${EDITION} jury without changing this history; the homepage never shows a person twice.`}</p>
      ${editing ? editorHtml() : ''}
      <div class="mg-list">
        ${ofTab().length ? g.map(([title, list]) => `${title ? `<h4 class="jm-group">${esc(title)}</h4>` : ''}${list.map((m, i) => rowHtml(m, i, list.length)).join('')}`).join('')
          : `<p class="muted-note">No ${tab} jury members yet.</p>`}
      </div>`;
    bind(root);
  }

  function readEditor() {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    if (!editing) return;
    editing.name = v('jmName'); editing.designation = v('jmRole'); editing.bio = v('jmBio');
    editing.jury_type = v('jmType') || editing.jury_type;
    const y = parseInt(v('jmYear'), 10); editing.edition_year = isNaN(y) ? null : y;
    const o = parseInt(v('jmOrder'), 10); editing.display_order = isNaN(o) ? 0 : o;
    editing.is_visible = document.getElementById('jmVisible').checked;
    const act = document.getElementById('jmActive'); if (act) editing.is_active = act.checked;
    editing.show_in_gallery = document.getElementById('jmGallery').checked;
    editing.instagram_url = v('jmIg'); editing.imdb_url = v('jmImdb'); editing.website_url = v('jmWeb');
  }

  function bind(root) {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    root.querySelectorAll('.jm-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; editing = null; orphans = []; render(); }));
    on('jmAdd', 'click', () => startEdit({}));
    on('jmCancel', 'click', () => { editing = null; orphans = []; render(); });
    on('jmSave', 'click', save);
    on('jmFile', 'change', e => upload(e.target));
    on('jmType', 'change', () => { readEditor(); render(); });
    on('jmBio', 'input', e => { const c = document.getElementById('jmBioCount'); if (c) c.textContent = e.target.value.length + ' / 1500'; });
    on('jmRemovePhoto', 'click', () => { readEditor(); orphans.push(editing.photo_url); editing.photo_url = ''; render(); });
    root.querySelectorAll('.mg-row').forEach(row => row.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const m = members.find(x => x.id === +row.dataset.id);
      const act = b.dataset.act;
      if (act === 'vis') patch(m, { is_visible: b.checked });
      else if (act === 'gal') patch(m, { show_in_gallery: b.checked });
      else if (act === 'up' || act === 'down') move(m, act === 'up' ? -1 : 1);
      else if (act === 'edit') startEdit(Object.assign({}, m));
      else if (act === 'del') remove(m);
      else if (act === 'promote') patch(m, { current_edition: isCur(m) ? null : EDITION });
      else if (act === 'preview') window.open(`${SITE}/${isCur(m) ? '#section-jury' : 'festival-gallery?filter=previous-jury'}`, '_blank', 'noopener');
    }));
  }

  function startEdit(m) {
    const same = members.filter(x => x.jury_type === tab);
    editing = Object.assign({ id: null, name: '', designation: '', bio: '', photo_url: '', jury_type: tab,
      edition_year: tab === 'current' ? new Date().getFullYear() : null,
      display_order: same.reduce((mx, x) => Math.max(mx, x.display_order || 0), 0) + 10,
      is_visible: true, is_active: true, show_in_gallery: false, instagram_url: '', imdb_url: '', website_url: '' }, m);
    orphans = [];
    render();
    const el = document.getElementById('jmEditor'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function upload(input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify('Choose an image file.', 'err');
    if (file.size > 20 * 1024 * 1024) return notify('Image is larger than 20 MB.', 'err');
    readEditor();
    notify('Optimising and uploading…');
    try {
      const blob = await _optimizeImage(file, 1400, 0.86);
      const path = `jury/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${slug(editing.name || file.name)}.webp`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: 'image/webp', cacheControl: '31536000' });
      if (error) throw error;
      orphans.push(editing.photo_url);
      editing.photo_url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      render();
      notify('Photo uploaded — click save to publish.', 'ok');
    } catch (e) { notify('Upload failed: ' + e.message, 'err'); }
  }

  async function cleanup(urls) {
    const paths = [...new Set(urls.filter(Boolean))].filter(u => storagePath(u).startsWith('jury/'))
      .filter(u => !members.some(m => m.photo_url === u)).map(storagePath);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  }

  const okUrl = u => !u || /^https:\/\//i.test(u);

  async function save() {
    if (busy) return;
    readEditor();
    const r = editing;
    if (!r.name) return notify('Enter the full name.', 'err');
    if (![r.instagram_url, r.imdb_url, r.website_url].every(okUrl)) return notify('Links must start with https://', 'err');
    const row = {
      name: r.name, designation: r.designation, bio: r.bio, photo_url: r.photo_url || null,
      edition_year: r.edition_year, jury_type: r.jury_type, display_order: r.display_order,
      is_visible: r.is_visible, is_active: r.jury_type === 'current' ? r.is_active !== false : true,
      show_in_gallery: r.show_in_gallery,
      instagram_url: r.instagram_url || null, imdb_url: r.imdb_url || null, website_url: r.website_url || null,
      updated_at: new Date().toISOString(),
    };
    busy = true;
    const res = r.id ? await sb.from('jury_members').update(row).eq('id', r.id).select().single()
                     : await sb.from('jury_members').insert(row).select().single();
    busy = false;
    if (res.error) return notify('Save failed: ' + res.error.message, 'err');
    const i = members.findIndex(x => x.id === res.data.id);
    if (i >= 0) members[i] = res.data; else members.push(res.data);
    members.sort(sortFn);
    tab = res.data.jury_type;
    const drop = orphans; orphans = []; editing = null;
    render();
    cleanup(drop).catch(() => {});
    notify('Saved — live on the website', 'ok');
  }

  async function patch(m, fields) {
    const { error } = await sb.from('jury_members').update(Object.assign({ updated_at: new Date().toISOString() }, fields)).eq('id', m.id);
    if (error) { notify('Update failed: ' + error.message, 'err'); return render(); }
    Object.assign(m, fields); render();
  }

  async function move(m, dir) {
    // reorder within the same group (current list, or one previous edition)
    const grp = groups().find(([, list]) => list.includes(m))[1];
    const i = grp.indexOf(m), j = i + dir;
    if (j < 0 || j >= grp.length) return;
    grp.forEach((x, k) => { x._new = (k + 1) * 10; });
    [m._new, grp[j]._new] = [grp[j]._new, m._new];
    const changed = grp.filter(x => x._new !== x.display_order);
    changed.forEach(x => { x.display_order = x._new; });
    grp.forEach(x => delete x._new);
    members.sort(sortFn); render();
    const results = await Promise.all(changed.map(x => sb.from('jury_members').update({ display_order: x.display_order }).eq('id', x.id)));
    const err = results.find(x => x.error);
    if (err) { notify('Reorder failed: ' + err.error.message, 'err'); load(); }
  }

  async function remove(m) {
    const ok = window.UI && UI.confirm
      ? await UI.confirm(`Delete jury member “${esc(m.name)}”? Their photo is also removed from the festival gallery.`, { title: 'Delete jury member?', okText: 'Delete', cancelText: 'Cancel', danger: true })
      : confirm(`Delete jury member “${m.name}”?`);
    if (!ok) return;
    const { error } = await sb.from('jury_members').delete().eq('id', m.id);
    if (error) return notify('Delete failed: ' + error.message, 'err');
    members = members.filter(x => x.id !== m.id);
    render();
    cleanup([m.photo_url]).catch(() => {});
    notify('Deleted', 'ok');
  }

  function init(client) { sb = client; }
  return { init, load };
})();
