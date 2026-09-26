/* Admin → About: edit the four homepage chapters and their "Know More" stories.
   Rows live in public.about_sections; the site falls back to ABOUT_SECTIONS in config.js
   until the first save. Saving always writes every chapter so the site never shows a partial set. */
window.AboutAdmin = (function () {
  'use strict';

  let sb = null;
  let rows = [];
  let defaults = [];
  let fromDb = false;
  let openKey = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const SITE = 'https://sharankrishnashortfilmawards.com';

  async function loadDefaults() {
    if (defaults.length) return defaults;
    try {
      const src = await (await fetch('assets/js/config.js?about=' + Date.now())).text();
      // config.js is plain constants; evaluate it in isolation to read ABOUT_SECTIONS.
      defaults = new Function(src + '\n;return (typeof ABOUT_SECTIONS !== "undefined") ? ABOUT_SECTIONS : [];')() || [];
    } catch (e) { defaults = []; }
    return defaults;
  }

  const toRow = (s, i) => ({
    key: s.key, sort_order: i, visible: s.visible !== false,
    kicker: s.kicker || '', title: s.title || '', subtitle: s.subtitle || '', intro: s.intro || '',
    image_url: s.image || '', image_alt: s.imageAlt || '', image_fit: s.imageFit === 'contain' ? 'contain' : 'cover',
    cta_label: s.cta || 'Know More', body: s.body || '', link_label: s.linkLabel || '', link_url: s.linkUrl || '',
  });

  const absImg = u => (!u ? '' : /^https?:/i.test(u) ? u : SITE + '/' + encodeURI(u.replace(/^\//, '')));

  async function load() {
    const root = document.getElementById('aboutAdmin');
    if (!root || !sb) return;
    root.innerHTML = '<p class="muted-note">Loading…</p>';
    const [{ data, error }] = await Promise.all([sb.from('about_sections').select('*').order('sort_order'), loadDefaults()]);
    if (error) {
      root.innerHTML = `<p class="muted-note">About content storage isn't available yet (${esc(error.message)}). The website is showing the built-in content.</p>`;
      return;
    }
    fromDb = !!(data && data.length);
    rows = fromDb ? data.map(r => Object.assign({}, r)) : defaults.map(toRow);
    render();
  }

  function field(key, name, label, value, opts) {
    opts = opts || {};
    const id = `ab_${key}_${name}`;
    const input = opts.textarea
      ? `<textarea id="${id}" data-k="${key}" data-f="${name}" rows="${opts.rows || 3}"${opts.mono ? ' class="ab-mono"' : ''}>${esc(value)}</textarea>`
      : `<input id="${id}" type="text" data-k="${key}" data-f="${name}" value="${esc(value)}"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>`;
    return `<div class="ab-field${opts.full ? ' is-full' : ''}"><label for="${id}">${label}</label>${input}${opts.hint ? `<small>${opts.hint}</small>` : ''}</div>`;
  }

  function render() {
    const root = document.getElementById('aboutAdmin');
    rows.forEach((r, i) => { r.sort_order = i; });
    root.innerHTML = `
      ${fromDb ? '' : '<p class="ab-banner">Showing the content currently on the website. Your first save stores it here so you can edit it any time.</p>'}
      <div class="ab-list">
        ${rows.map((r, i) => `
          <div class="ab-item${openKey === r.key ? ' is-open' : ''}${r.visible ? '' : ' is-hidden'}" data-key="${esc(r.key)}">
            <div class="ab-item-head">
              <span class="ab-item-num">${String(i + 1).padStart(2, '0')}</span>
              ${r.image_url ? `<img class="ab-item-thumb" src="${esc(absImg(r.image_url))}" alt="">` : '<span class="ab-item-thumb is-empty"></span>'}
              <button type="button" class="ab-item-title" onclick="AboutAdmin.toggle('${esc(r.key)}')">
                <span>${esc(r.title || '(untitled)')}</span><small>${esc(r.kicker || '')}${r.visible ? '' : ' · hidden'}</small>
              </button>
              <div class="ab-item-actions">
                <button type="button" class="btn-ghost btn-xs" ${i === 0 ? 'disabled' : ''} onclick="AboutAdmin.move(${i},-1)" title="Move up">↑</button>
                <button type="button" class="btn-ghost btn-xs" ${i === rows.length - 1 ? 'disabled' : ''} onclick="AboutAdmin.move(${i},1)" title="Move down">↓</button>
                <label class="ab-vis"><input type="checkbox" data-k="${esc(r.key)}" data-f="visible" ${r.visible ? 'checked' : ''}> Visible</label>
              </div>
            </div>
            <div class="ab-item-body">
              <div class="ab-grid">
                ${field(r.key, 'kicker', 'Section label', r.kicker, { placeholder: 'The Inspiration', hint: 'The number (01, 02…) is added automatically from the order.' })}
                ${field(r.key, 'title', 'Title', r.title)}
                ${field(r.key, 'subtitle', 'Subtitle / tagline', r.subtitle, { full: true })}
                ${field(r.key, 'intro', 'Short introduction (shown on the homepage)', r.intro, { textarea: true, rows: 3, full: true, hint: 'Keep it to one or two sentences.' })}
              </div>
              <div class="ab-image-row">
                <div class="ab-image-preview">${r.image_url ? `<img src="${esc(absImg(r.image_url))}" alt="">` : '<span>No image</span>'}</div>
                <div class="ab-grid">
                  ${field(r.key, 'image_url', 'Image or logo URL', r.image_url, { full: true })}
                  ${field(r.key, 'image_alt', 'Image description (for accessibility)', r.image_alt)}
                  <div class="ab-field"><label for="ab_${esc(r.key)}_fit">Image style</label>
                    <select id="ab_${esc(r.key)}_fit" data-k="${esc(r.key)}" data-f="image_fit">
                      <option value="cover" ${r.image_fit !== 'contain' ? 'selected' : ''}>Photo — fill the frame</option>
                      <option value="contain" ${r.image_fit === 'contain' ? 'selected' : ''}>Logo — fit inside</option>
                    </select></div>
                  <div class="ab-field is-full"><label class="btn-ghost btn-sm ab-upload">Upload image<input type="file" accept="image/*" hidden onchange="AboutAdmin.upload('${esc(r.key)}', this)"></label></div>
                </div>
              </div>
              <div class="ab-grid">
                ${field(r.key, 'cta_label', 'Button text', r.cta_label, { placeholder: 'Know More' })}
                <div></div>
                ${field(r.key, 'body', 'Full story (opens from the button)', r.body, { textarea: true, rows: 14, full: true, mono: true,
                  hint: '## Heading &nbsp;·&nbsp; blank line = new paragraph &nbsp;·&nbsp; - list item &nbsp;·&nbsp; &gt; closing quote &nbsp;·&nbsp; **bold** &nbsp;·&nbsp; *italic*' })}
                ${field(r.key, 'link_label', 'Link button text (optional)', r.link_label, { placeholder: 'Visit the official website' })}
                ${field(r.key, 'link_url', 'Link address (optional)', r.link_url, { placeholder: 'https://… or #prizes' })}
              </div>
              <div class="ab-item-foot">
                <a class="btn-ghost btn-sm" href="${SITE}/#about-${esc(r.key)}" target="_blank" rel="noopener">View on website ↗</a>
              </div>
            </div>
          </div>`).join('')}
      </div>
      <div class="ab-actions">
        <button type="button" class="btn" onclick="AboutAdmin.save(this)">Save About content</button>
        <button type="button" class="btn-ghost btn-sm" onclick="AboutAdmin.resetDefaults()">Reset to built-in content</button>
        <span class="muted-note" id="aboutSaved"></span>
      </div>`;
    root.querySelectorAll('[data-k][data-f]').forEach(el => {
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const r = rows.find(x => x.key === el.dataset.k);
        if (!r) return;
        r[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.f === 'visible') { el.closest('.ab-item').classList.toggle('is-hidden', !el.checked); }
      });
    });
  }

  function toggle(key) { openKey = openKey === key ? null : key; render(); }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    render();
  }

  async function upload(key, input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify('Choose an image file.', 'err');
    if (file.size > 15 * 1024 * 1024) return notify('Image is larger than 15 MB.', 'err');
    notify('Optimising and uploading…');
    let blob = file, ext = (file.name.split('.').pop() || 'jpg').toLowerCase(), type = file.type;
    if (typeof _optimizeImage === 'function' && file.type !== 'image/svg+xml') {
      try { blob = await _optimizeImage(file, 2200, 0.86); ext = 'webp'; type = 'image/webp'; } catch (e) { /* upload original */ }
    }
    const path = `about/${key}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('gallery').upload(path, blob, { upsert: false, contentType: type, cacheControl: '31536000' });
    if (error) return notify('Upload failed: ' + error.message, 'err');
    const url = sb.storage.from('gallery').getPublicUrl(path).data.publicUrl;
    const r = rows.find(x => x.key === key);
    if (r) { r.image_url = url; openKey = key; render(); }
    notify('Image uploaded — click Save About content to publish.', 'ok');
  }

  async function save(btn) {
    const bad = rows.find(r => !String(r.title || '').trim());
    if (bad) return notify('Every chapter needs a title.', 'err');
    const badLink = rows.find(r => r.link_url && !/^(https?:\/\/|#|mailto:|tel:)/i.test(r.link_url.trim()));
    if (badLink) return notify(`“${badLink.title}”: link must start with https://, # , mailto: or tel:`, 'err');
    if (btn) btn.disabled = true;
    const payload = rows.map((r, i) => ({
      key: r.key, sort_order: i, visible: !!r.visible,
      kicker: (r.kicker || '').trim(), title: r.title.trim(), subtitle: (r.subtitle || '').trim(), intro: (r.intro || '').trim(),
      image_url: (r.image_url || '').trim(), image_alt: (r.image_alt || '').trim(), image_fit: r.image_fit === 'contain' ? 'contain' : 'cover',
      cta_label: (r.cta_label || '').trim() || 'Know More', body: r.body || '',
      link_label: (r.link_label || '').trim(), link_url: (r.link_url || '').trim(), updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from('about_sections').upsert(payload, { onConflict: 'key' });
    if (btn) btn.disabled = false;
    if (error) return notify('Save failed: ' + error.message, 'err');
    fromDb = true;
    render();
    const el = document.getElementById('aboutSaved');
    if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString('en-IN') + ' — live on the website';
    notify('About content saved', 'ok');
  }

  async function resetDefaults() {
    await loadDefaults();
    if (!defaults.length) return notify('Built-in content could not be loaded.', 'err');
    rows = defaults.map(toRow);
    render();
    notify('Built-in content restored — click Save About content to publish.');
  }

  function init(client) { sb = client; }

  return { init, load, toggle, move, upload, save, resetDefaults };
})();
