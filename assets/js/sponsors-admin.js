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
            ${r.logo_url ? '<button type="button" class="btn-ghost btn-sm" id="spAdjust">Adjust / crop</button>' : ''}
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
    on('spAdjust', 'click', adjustExisting);
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
    const adjusted = await openCropper(file, editing.on_light);
    if (!adjusted) return;
    notify('Uploading logo…');
    try {
      const url = await storeLogo(adjusted, editing.name || nameFromFile(file));
      if (editing.logo_url) orphans.push(editing.logo_url);
      editing.logo_url = url;
      if (!editing.name) editing.name = nameFromFile(file);
      render();
      notify('Logo uploaded — click save to publish.', 'ok');
    } catch (e) { notify('Upload failed: ' + e.message, 'err'); }
  }

  async function adjustExisting() {
    readEditor();
    if (!editing || !editing.logo_url) return;
    let blob;
    try {
      const res = await fetch(editing.logo_url, { mode: 'cors', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      blob = await res.blob();
    } catch (e) { return notify('Could not open the current logo: ' + e.message, 'err'); }
    const adjusted = await openCropper(blob, editing.on_light);
    if (!adjusted) return;
    notify('Saving adjusted logo…');
    try {
      const url = await storeLogo(adjusted, editing.name || 'sponsor');
      orphans.push(editing.logo_url);
      editing.logo_url = url;
      render();
      notify('Logo adjusted — click save to publish.', 'ok');
    } catch (e) { notify('Upload failed: ' + e.message, 'err'); }
  }

  /* ---- Logo adjust: size, position, frame shape, trim. Output keeps transparency. ---- */
  const OUT_H = 360;
  const SHAPES = [['orig', 'Original'], ['3', 'Wide 3:1'], ['2', '2:1'], ['1', 'Square']];

  function openCropper(source, plate) {
    return new Promise(resolve => {
      const src = URL.createObjectURL(source);
      const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(src); notify('Could not read this image.', 'err'); resolve(null); };
      img.onload = () => build();
      img.src = src;

      function build() {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const origAr = Math.min(6, Math.max(0.5, iw / ih));
        const st = { ar: origAr, shape: 'orig', zoom: 1, ox: 0, oy: 0, plate: !!plate };
        const ov = document.createElement('div');
        ov.className = 'sp-crop-overlay';
        ov.innerHTML = `<div class="sp-crop" role="dialog" aria-modal="true" aria-labelledby="spCropTitle">
          <div class="sp-crop-head">
            <h3 id="spCropTitle">Adjust logo</h3>
            <p>Drag the logo to position it. Use Size to make it smaller or larger inside the frame — the frame is what appears on the website. Trim removes empty borders.</p>
          </div>
          <div class="sp-crop-stage${st.plate ? ' is-plate' : ''}" id="spCropStage"><canvas id="spCropCanvas" aria-label="Logo preview — drag to move"></canvas></div>
          <div class="sp-crop-controls">
            <label class="sp-crop-size"><span>Size</span><input type="range" id="spCropZoom" min="20" max="400" step="1" value="100" aria-label="Logo size"><output id="spCropZoomVal">100%</output></label>
            <div class="sp-crop-row">
              <div class="sp-crop-shapes" role="group" aria-label="Frame shape">${SHAPES.map(([k, l]) => `<button type="button" class="btn-ghost btn-xs" data-shape="${k}" aria-pressed="${k === 'orig'}">${l}</button>`).join('')}</div>
              <div class="sp-crop-tools">
                <button type="button" class="btn-ghost btn-xs" data-tool="trim">Trim margins</button>
                <button type="button" class="btn-ghost btn-xs" data-tool="fit">Fit</button>
                <button type="button" class="btn-ghost btn-xs" data-tool="plate" aria-pressed="${st.plate}">Light preview</button>
                <button type="button" class="btn-ghost btn-xs" data-tool="reset">Reset</button>
              </div>
            </div>
          </div>
          <div class="sp-crop-foot">
            <button type="button" class="btn" id="spCropApply">Use this logo</button>
            <button type="button" class="btn-ghost btn-sm" id="spCropCancel">Cancel</button>
          </div>
        </div>`;
        document.body.appendChild(ov);
        const canvas = ov.querySelector('#spCropCanvas');
        const stage = ov.querySelector('#spCropStage');
        const zoomEl = ov.querySelector('#spCropZoom');
        const zoomVal = ov.querySelector('#spCropZoomVal');
        const ctx = canvas.getContext('2d');

        const outW = () => Math.round(st.ar * OUT_H);
        const baseScale = () => Math.min(outW() / iw, OUT_H / ih);

        function sizeCanvas() {
          canvas.width = outW(); canvas.height = OUT_H;
          const maxW = Math.max(200, stage.clientWidth - 32), maxH = Math.min(340, window.innerHeight * 0.42);
          const k = Math.min(maxW / canvas.width, maxH / canvas.height);
          canvas.style.width = Math.round(canvas.width * k) + 'px';
          canvas.style.height = Math.round(canvas.height * k) + 'px';
        }
        function draw(target) {
          const c = target || ctx, w = outW(), s = baseScale() * st.zoom;
          c.clearRect(0, 0, w, OUT_H);
          c.imageSmoothingQuality = 'high';
          c.drawImage(img, w / 2 + st.ox - iw * s / 2, OUT_H / 2 + st.oy - ih * s / 2, iw * s, ih * s);
        }
        function syncZoom() {
          zoomEl.max = String(Math.max(400, Math.ceil(st.zoom * 100)));
          zoomEl.value = String(Math.round(st.zoom * 100));
          zoomVal.textContent = Math.round(st.zoom * 100) + '%';
        }
        function setShape(k) {
          st.shape = k;
          st.ar = k === 'orig' ? origAr : Number(k);
          ov.querySelectorAll('[data-shape]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shape === k)));
          sizeCanvas(); draw();
        }
        function fit() { st.zoom = 1; st.ox = 0; st.oy = 0; syncZoom(); draw(); }

        // Find the logo's real edges: ignore transparent pixels, or pixels matching the corner colour (solid backgrounds).
        function trim() {
          const k = Math.min(1, 800 / Math.max(iw, ih));
          const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, 0, 0, w, h);
          const d = x.getImageData(0, 0, w, h).data;
          const at = (px, py) => (py * w + px) * 4;
          const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
          const clear = corners.every(i => d[i + 3] < 16);
          const ref = corners[0];
          const isBg = i => clear ? d[i + 3] < 16
            : (d[i + 3] < 16 || (Math.abs(d[i] - d[ref]) + Math.abs(d[i + 1] - d[ref + 1]) + Math.abs(d[i + 2] - d[ref + 2]) < 60));
          let x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
            if (!isBg(at(px, py))) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
          }
          if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) { notify('No empty border found to trim.'); return; }
          const bx = x0 / k, by = y0 / k, bw = (x1 - x0 + 1) / k, bh = (y1 - y0 + 1) / k;
          st.shape = 'trim';
          st.ar = Math.min(6, Math.max(0.5, bw / bh));
          ov.querySelectorAll('[data-shape]').forEach(b => b.setAttribute('aria-pressed', 'false'));
          sizeCanvas();
          const pad = 0.94, s = Math.min(outW() * pad / bw, OUT_H * pad / bh);
          st.zoom = s / baseScale();
          st.ox = (iw / 2 - (bx + bw / 2)) * s;
          st.oy = (ih / 2 - (by + bh / 2)) * s;
          syncZoom(); draw();
        }

        // Drag to position (mouse and touch)
        let drag = null;
        canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }; canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener('pointermove', e => {
          if (!drag) return;
          const k = canvas.width / canvas.getBoundingClientRect().width;
          st.ox = drag.ox + (e.clientX - drag.x) * k; st.oy = drag.oy + (e.clientY - drag.y) * k; draw();
        });
        const endDrag = () => { drag = null; };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('wheel', e => {
          e.preventDefault();
          st.zoom = Math.min(Number(zoomEl.max) / 100, Math.max(0.2, st.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
          syncZoom(); draw();
        }, { passive: false });
        zoomEl.addEventListener('input', () => { st.zoom = Number(zoomEl.value) / 100; zoomVal.textContent = zoomEl.value + '%'; draw(); });
        ov.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => setShape(b.dataset.shape)));
        ov.querySelector('[data-tool="trim"]').addEventListener('click', trim);
        ov.querySelector('[data-tool="fit"]').addEventListener('click', fit);
        ov.querySelector('[data-tool="reset"]').addEventListener('click', () => { setShape('orig'); fit(); });
        ov.querySelector('[data-tool="plate"]').addEventListener('click', e => {
          st.plate = !st.plate; stage.classList.toggle('is-plate', st.plate); e.currentTarget.setAttribute('aria-pressed', String(st.plate));
        });

        const onResize = () => { sizeCanvas(); draw(); };
        const onKey = e => { if (e.key === 'Escape') close(null); };
        window.addEventListener('resize', onResize);
        document.addEventListener('keydown', onKey);

        function close(result) {
          window.removeEventListener('resize', onResize);
          document.removeEventListener('keydown', onKey);
          URL.revokeObjectURL(src);
          ov.remove();
          resolve(result);
        }
        ov.querySelector('#spCropCancel').addEventListener('click', () => close(null));
        ov.addEventListener('click', e => { if (e.target === ov) close(null); });
        ov.querySelector('#spCropApply').addEventListener('click', () => {
          const out = document.createElement('canvas'); out.width = outW(); out.height = OUT_H;
          draw(out.getContext('2d'));
          out.toBlob(b => { if (b) close(b); else notify('Could not create the adjusted logo.', 'err'); }, 'image/webp', 0.92);
        });

        sizeCanvas(); syncZoom(); draw();
        ov.querySelector('#spCropApply').focus();
      }
    });
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
    else notify(`${added} sponsor${added === 1 ? '' : 's'} added — live on the website. Use Edit to correct names or adjust / crop logos.`, 'ok');
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
