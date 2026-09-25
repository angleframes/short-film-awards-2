/* Certificate engine — Sharankrishna Short Film Awards admin.
   Template backgrounds (logos, heading, signatures, texture) live in the private
   "certificate-assets" bucket; only the dynamic text is drawn on top.
   Layout units are the 2000×1414 reference artboard (A4 landscape), so any
   background resolution works. PDF text is vector; JPG is rendered at ≥300 dpi. */
window.Certs = (function () {
  'use strict';

  const BUCKET = 'certificate-assets';
  const CONFIG_PATH = 'config.json';
  const REF_W = 2000, REF_H = 1414;
  const PAGE_MM = { w: 297, h: 210 };
  const PRINT_W = 3508; // A4 @ 300 dpi
  const NAVY = '#041C52';
  const INK = '#0a0a0a';

  const FONTS = {
    'PlayfairDisplay-SemiBold': 'assets/fonts/cert/PlayfairDisplay-SemiBold.ttf',
    'PlayfairDisplay-Regular':  'assets/fonts/cert/PlayfairDisplay-Regular.ttf',
    'Poppins-Regular':          'assets/fonts/cert/Poppins-Regular.ttf',
    'Poppins-SemiBold':         'assets/fonts/cert/Poppins-SemiBold.ttf',
  };
  const BODY_REG = 'Poppins-Regular', BODY_BOLD = 'Poppins-SemiBold';

  // Positions measured from the supplied reference certificates.
  const LAYOUTS = {
    participation: {
      title: { font: 'PlayfairDisplay-SemiBold', size: 80.7, baseline: 540, maxWidth: 1640, minSize: 36, color: NAVY },
      body:  { size: 41.7, minSize: 29, lineHeight: 1.592, maxWidth: 1690, top: 590, bottom: 1010, color: INK },
    },
    award: {
      label: { font: 'PlayfairDisplay-Regular', size: 29.7, tracking: 0.244, baseline: 480, maxWidth: 1560, minSize: 19, color: INK },
      title: { font: 'PlayfairDisplay-SemiBold', size: 82.2, baseline: 562, maxWidth: 1700, minSize: 36, color: NAVY },
      body:  { size: 37, minSize: 27, lineHeight: 1.545, maxWidth: 1750, top: 600, bottom: 971, color: INK },
    },
  };

  const DEFAULT_CONFIG = {
    version: 1,
    edition: 'Sharankrishna Short Film Awards 2025',
    eventDate: '12 February 2026',
    uppercaseNames: true,
    backgrounds: { participation: null, award: null },
    texts: {
      participation:
        'This is to certify that **{FILM}**, directed by **{DIRECTOR}**,\n' +
        'has successfully participated in the ‘{EDITION}’ organized by Angle Frames, in association with JAIN (Deemed-to-be University), Kochi, held on {DATE}. ' +
        'We appreciate the participant’s creativity, effort, and contribution to the art of filmmaking, and wish them great success in their future endeavors.',
      awardPerson:
        'This is to certify that **{AWARDEE}** has been honored with the {AWARD} for the film “**{FILM}**” at the ‘{EDITION}’ organized by Angle Frames, ' +
        'in association with JAIN (Deemed-to-be University), Kochi, held on {DATE}. {CITATION} We congratulate the awardee and wish them great success in their artistic career.',
      awardFilm:
        'This is to certify that the film “**{FILM}**”, directed by **{DIRECTOR}**, has been honored with the {AWARD} at the ‘{EDITION}’ organized by Angle Frames, ' +
        'in association with JAIN (Deemed-to-be University), Kochi, held on {DATE}. {CITATION} We congratulate the entire team and wish them great success in their future endeavors.',
    },
    citations: {
      best_short_film:     'This award recognizes outstanding storytelling, artistic vision, and excellence in filmmaking.',
      best_campus_film:    'This award recognizes an exceptional student film that reflects creativity, conviction, and a bright future in cinema.',
      best_director:       'This award recognizes visionary direction and a remarkable command of cinematic storytelling.',
      best_screenplay:     'This award recognizes compelling writing, memorable characters, and a masterful narrative structure.',
      best_cinematography: 'This award recognizes striking visual artistry and exceptional craft behind the camera.',
      best_editing:        'This award recognizes precise, rhythmic editing that shapes the emotional power of the film.',
      best_music_director: 'This award recognizes an evocative musical score that elevates the storytelling.',
      best_actor:          'This award recognizes an outstanding performance, remarkable screen presence, and exceptional dedication to the craft of acting.',
      best_actress:        'This award recognizes an outstanding performance, remarkable screen presence, and exceptional dedication to the craft of acting.',
      best_child_artist:   'This award recognizes a remarkable young performance marked by honesty, talent, and great promise.',
      special_jury:        'This mention recognizes a distinctive work that left a lasting impression on the jury.',
      _person:             'This award recognizes exceptional talent and dedication to the craft of filmmaking.',
      _film:               'This award recognizes outstanding storytelling and excellence in filmmaking.',
    },
  };

  let sb = null;
  let config = null;
  let configPromise = null;
  let fontBytes = {};            // name -> base64
  let fontPromise = null;
  let canvasFontsReady = null;
  const bgCache = {};            // kind -> { img, jpeg, w, h, path }
  let winners = {};              // entry_id -> [evaluation rows]

  /* ── helpers ───────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\*/g, '').replace(/\s{2,}/g, ' ').trim();
  const notify = (msg, kind) => (typeof window.toast === 'function' ? window.toast(msg, kind) : console.log(msg));
  const cfgKey = kind => (kind === 'participation' ? 'participation' : 'award');

  function safeFilename(...parts) {
    const base = parts.filter(Boolean).map(p =>
      String(p).normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    ).filter(Boolean).join('_').replace(/_+/g, '_');
    return (base || 'Certificate').slice(0, 120);
  }

  function b64FromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ── config + assets ───────────────────────────────────── */
  function mergeConfig(saved) {
    const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (!saved || typeof saved !== 'object') return c;
    ['edition', 'eventDate', 'uppercaseNames'].forEach(k => { if (saved[k] !== undefined && saved[k] !== '') c[k] = saved[k]; });
    Object.assign(c.backgrounds, saved.backgrounds || {});
    Object.keys(saved.texts || {}).forEach(k => { if (saved.texts[k]) c.texts[k] = saved.texts[k]; });
    Object.keys(saved.citations || {}).forEach(k => { if (saved.citations[k]) c.citations[k] = saved.citations[k]; });
    return c;
  }

  function loadConfig(force) {
    if (config && !force) return Promise.resolve(config);
    if (configPromise && !force) return configPromise;
    configPromise = (async () => {
      const { data, error } = await sb.storage.from(BUCKET).download(CONFIG_PATH + '?t=' + Date.now());
      if (error || !data) { config = mergeConfig(null); config._missing = true; config._err = error ? error.message : ''; return config; }
      try { config = mergeConfig(JSON.parse(await data.text())); }
      catch (e) { config = mergeConfig(null); }
      return config;
    })();
    return configPromise;
  }

  async function saveConfig(next) {
    const body = JSON.stringify({
      version: 1, edition: next.edition, eventDate: next.eventDate, uppercaseNames: next.uppercaseNames,
      backgrounds: next.backgrounds, texts: next.texts, citations: next.citations,
      updated_at: new Date().toISOString(),
    }, null, 2);
    const { error } = await sb.storage.from(BUCKET).upload(CONFIG_PATH, new Blob([body], { type: 'application/json' }),
      { upsert: true, contentType: 'application/json', cacheControl: '0' });
    if (error) throw new Error(error.message);
    config = mergeConfig(JSON.parse(body));
  }

  function loadFonts() {
    if (fontPromise) return fontPromise;
    fontPromise = Promise.all(Object.entries(FONTS).map(async ([name, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Font missing: ' + url);
      const buf = await res.arrayBuffer();
      fontBytes[name] = b64FromBuffer(buf);
      if (window.FontFace && document.fonts) {
        const ff = new FontFace('SSFA_' + name, buf);
        await ff.load();
        document.fonts.add(ff);
      }
    })).catch(err => { fontPromise = null; throw err; });
    return fontPromise;
  }

  async function loadBackground(kind) {
    await loadConfig();
    const key = cfgKey(kind);
    const path = config.backgrounds[key];
    if (!path) throw new Error('No ' + (key === 'award' ? 'Award (gold)' : 'Participation (silver)') + ' template uploaded yet. Add it in the Certificates tab.');
    if (bgCache[key] && bgCache[key].path === path) return bgCache[key];
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error('Could not load template: ' + (error ? error.message : 'not found'));
    const img = await createImageBitmap(data);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const jpeg = c.toDataURL('image/jpeg', 0.92);
    bgCache[key] = { img, jpeg, w: img.width, h: img.height, path };
    return bgCache[key];
  }

  /* ── painters (PDF = vector text, canvas = raster) ─────── */
  function pdfPainter(doc) {
    const k = PAGE_MM.w / REF_W;               // mm per layout unit
    const PT_PER_MM = 72 / 25.4;
    return {
      setFont(name, size) { doc.setFont(name, 'normal'); doc.setFontSize(size * k * PT_PER_MM); },
      measure(t) { return doc.getTextWidth(t) / k; },
      text(t, x, y, color) { doc.setTextColor(color); doc.text(t, x * k, y * k, { baseline: 'alphabetic' }); },
    };
  }

  function canvasPainter(ctx, scale) {
    return {
      setFont(name, size) { ctx.font = (size * scale) + 'px "SSFA_' + name + '"'; },
      measure(t) { return ctx.measureText(t).width / scale; },
      text(t, x, y, color) { ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x * scale, y * scale); },
    };
  }

  /* ── layout engine ─────────────────────────────────────── */
  function fitSize(p, font, text, size, minSize, maxWidth, tracking) {
    const width = s => { p.setFont(font, s); return p.measure(text) + (tracking ? tracking * s * (text.length - 1) : 0); };
    let s = size, w = width(s);
    if (w > maxWidth) {
      s = Math.max(minSize, s * maxWidth / w);
      w = width(s);
      if (w > maxWidth) { s = s * maxWidth / w; w = width(s); } // never overflow, even below the soft minimum
    }
    return { size: s, width: w };
  }

  function drawLine(p, spec, text) {
    if (!text) return;
    const f = fitSize(p, spec.font, text, spec.size, spec.minSize, spec.maxWidth, spec.tracking || 0);
    p.setFont(spec.font, f.size);
    if (spec.tracking) {
      let x = REF_W / 2 - f.width / 2;
      const gap = spec.tracking * f.size;
      for (const ch of text) { p.text(ch, x, spec.baseline, spec.color); x += p.measure(ch) + gap; }
    } else {
      p.text(text, REF_W / 2 - f.width / 2, spec.baseline, spec.color);
    }
  }

  // "**bold**" markup -> paragraphs of words, each word = pieces [{t, b}]
  function parseRich(src) {
    return String(src).split('\n').map(par => {
      const runs = [];
      par.split(/(\*\*[^*]*\*\*)/).forEach(chunk => {
        if (!chunk) return;
        const bold = /^\*\*[^*]*\*\*$/.test(chunk);
        runs.push({ t: bold ? chunk.slice(2, -2) : chunk, b: bold });
      });
      const words = []; let cur = [];
      runs.forEach(r => {
        r.t.split(/( +)/).forEach(part => {
          if (!part) return;
          if (/^ +$/.test(part)) { if (cur.length) { words.push(cur); cur = []; } }
          else cur.push({ t: part, b: r.b });
        });
      });
      if (cur.length) words.push(cur);
      return words;
    });
  }

  function wordWidth(p, word, size) {
    return word.reduce((w, pc) => { p.setFont(pc.b ? BODY_BOLD : BODY_REG, size); return w + p.measure(pc.t); }, 0);
  }

  function wrap(p, paragraphs, size, maxWidth) {
    p.setFont(BODY_REG, size);
    const space = p.measure(' ');
    const lines = [];
    paragraphs.forEach(words => {
      const pl = []; let line = [], lw = 0;
      words.forEach(word => {
        const ww = wordWidth(p, word, size);
        const add = line.length ? space + ww : ww;
        if (line.length && lw + add > maxWidth) { pl.push({ words: line, width: lw }); line = [word]; lw = ww; }
        else { line.push(word); lw += add; }
      });
      if (line.length) pl.push({ words: line, width: lw });
      // avoid a single orphaned word on the last line
      if (pl.length > 1 && pl[pl.length - 1].words.length === 1 && pl[pl.length - 2].words.length > 3) {
        const prev = pl[pl.length - 2], last = pl[pl.length - 1];
        const moved = prev.words.pop();
        const mw = wordWidth(p, moved, size);
        prev.width -= space + mw;
        if (last.width + space + mw <= maxWidth) { last.words.unshift(moved); last.width += space + mw; }
        else prev.words.push(moved), prev.width += space + mw;
      }
      lines.push(...pl);
    });
    return { lines, space };
  }

  function drawBody(p, spec, markup) {
    const paragraphs = parseRich(markup);
    const boxH = spec.bottom - spec.top;
    let size = spec.size, res;
    for (; size >= spec.minSize; size -= 0.5) {
      res = wrap(p, paragraphs, size, spec.maxWidth);
      const visual = (res.lines.length - 1) * size * spec.lineHeight + size * 0.72;
      if (visual <= boxH) break;
    }
    if (size < spec.minSize) { size = spec.minSize; res = wrap(p, paragraphs, size, spec.maxWidth); }
    const pitch = size * spec.lineHeight;
    const visual = (res.lines.length - 1) * pitch + size * 0.72;
    let y = (spec.top + spec.bottom) / 2 - visual / 2 + size * 0.72;
    res.lines.forEach(line => {
      let x = REF_W / 2 - line.width / 2;
      line.words.forEach((word, i) => {
        if (i) x += res.space;
        word.forEach(pc => {
          p.setFont(pc.b ? BODY_BOLD : BODY_REG, size);
          p.text(pc.t, x, y, spec.color);
          x += p.measure(pc.t);
        });
      });
      y += pitch;
    });
  }

  /* ── certificate models ────────────────────────────────── */
  function catDef(key) { try { return (typeof AWARD_CATS !== 'undefined' ? AWARD_CATS : []).find(c => c.key === key) || null; } catch (e) { return null; } }
  function catName(key) {
    try { const db = (typeof _awardCats !== 'undefined' ? _awardCats : []).find(c => c.key === key); if (db && db.name) return db.name; } catch (e) {}
    const d = catDef(key); if (d) return d.label;
    return String(key || 'Award').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  }
  const awardPhrase = label => (/\b(award|mention)\b/i.test(label) ? label : label + ' Award');

  function fill(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }

  function participationModel(entry) {
    const up = config.uppercaseNames;
    const film = clean(entry.film_name) || 'Untitled';
    const director = clean(entry.director) || '—';
    const F = up ? film.toUpperCase() : film, D = up ? director.toUpperCase() : director;
    return {
      kind: 'participation',
      title: F,
      body: fill(config.texts.participation, { FILM: F, DIRECTOR: D, EDITION: clean(config.edition), DATE: clean(config.eventDate) }),
      filename: safeFilename(film, 'Participation_Certificate'),
      docTitle: film + ' — Participation Certificate',
    };
  }

  function awardModel(entry, ev) {
    const up = config.uppercaseNames;
    const key = ev.award_category;
    const def = catDef(key);
    const label = catName(key);
    const phrase = awardPhrase(label);
    const film = clean(entry.film_name) || 'Untitled';
    const director = clean(entry.director);
    const nominee = clean(def && def.field ? (entry[def.field] || ev.candidate_name) : ev.candidate_name);
    const isFilm = def ? (def.type === 'film' || (def.type === 'flexible' && (!nominee || nominee === film))) : (!nominee || nominee === film);
    const awardee = isFilm ? film : nominee;
    const U = s => (up ? s.toUpperCase() : s);
    const citation = config.citations[key] || (isFilm ? config.citations._film : config.citations._person);
    const tpl = isFilm ? config.texts.awardFilm : config.texts.awardPerson;
    let body = fill(tpl, {
      FILM: U(film), DIRECTOR: U(director || '—'), AWARDEE: U(awardee), AWARD: phrase,
      EDITION: clean(config.edition), DATE: clean(config.eventDate), CITATION: clean(citation),
    });
    if (isFilm && !director) body = body.replace(/, directed by \*\*—\*\*,/, ',');
    return {
      kind: 'award',
      label: phrase.toUpperCase(),
      title: U(awardee),
      body,
      filename: safeFilename(awardee, phrase),
      docTitle: awardee + ' — ' + phrase,
    };
  }

  function drawModel(p, model) {
    const L = LAYOUTS[model.kind];
    if (model.kind === 'award') drawLine(p, L.label, model.label);
    drawLine(p, L.title, model.title);
    drawBody(p, L.body, model.body);
  }

  /* ── renderers ─────────────────────────────────────────── */
  async function prepare(kind) {
    await loadConfig();
    const [bg] = await Promise.all([loadBackground(kind), loadFonts()]);
    return bg;
  }

  async function renderPdf(model) {
    const bg = await prepare(model.kind);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    Object.keys(FONTS).forEach(name => {
      doc.addFileToVFS(name + '.ttf', fontBytes[name]);
      doc.addFont(name + '.ttf', name, 'normal');
    });
    doc.addImage(bg.jpeg, 'JPEG', 0, 0, PAGE_MM.w, PAGE_MM.h, undefined, 'FAST');
    drawModel(pdfPainter(doc), model);
    doc.setProperties({ title: model.docTitle, subject: clean(config.edition), author: 'Angle Frames', creator: 'Sharankrishna Short Film Awards' });
    return doc;
  }

  async function renderCanvas(model, width) {
    const bg = await prepare(model.kind);
    const W = Math.round(width || Math.max(PRINT_W, bg.w));
    const H = Math.round(W * PAGE_MM.h / PAGE_MM.w);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bg.img, 0, 0, W, H);
    drawModel(canvasPainter(ctx, W / REF_W), model);
    return c;
  }

  async function output(model, fmt) {
    if (fmt === 'jpg') {
      const c = await renderCanvas(model);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
      downloadBlob(blob, model.filename + '.jpg');
    } else if (fmt === 'preview') {
      openPreview(model);
    } else {
      const doc = await renderPdf(model);
      doc.save(model.filename + '.pdf');
    }
  }

  async function run(fn, btn) {
    const old = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try { await fn(); }
    catch (e) { notify(e.message || String(e), 'err'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  }

  /* ── preview modal ─────────────────────────────────────── */
  function ensurePreviewModal() {
    let el = document.getElementById('certPreviewOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'certPreviewOverlay';
    el.className = 'cert-preview-overlay';
    el.innerHTML = `
      <div class="cert-preview-box" role="dialog" aria-modal="true" aria-labelledby="certPreviewTitle">
        <div class="cert-preview-head">
          <div><div class="cert-preview-eyebrow">Certificate preview</div><h3 id="certPreviewTitle"></h3></div>
          <div class="cert-preview-actions">
            <button type="button" class="btn btn-sm" data-cert-fmt="pdf">Download PDF</button>
            <button type="button" class="btn-ghost btn-sm" data-cert-fmt="jpg">Download JPG</button>
            <button type="button" class="btn-ghost btn-sm cert-preview-close" aria-label="Close preview">✕</button>
          </div>
        </div>
        <div class="cert-preview-stage"><div class="cert-preview-loading">Rendering…</div><img alt="Certificate preview"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('.cert-preview-close')) closePreview(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('open')) closePreview(); });
    return el;
  }

  function closePreview() {
    const el = document.getElementById('certPreviewOverlay');
    if (el) el.classList.remove('open');
  }

  async function openPreview(model) {
    const el = ensurePreviewModal();
    const img = el.querySelector('img');
    const loading = el.querySelector('.cert-preview-loading');
    el.querySelector('#certPreviewTitle').textContent = model.docTitle;
    img.removeAttribute('src'); loading.style.display = '';
    el.querySelectorAll('[data-cert-fmt]').forEach(b => { b.onclick = () => run(() => output(model, b.dataset.certFmt), b); });
    el.classList.add('open');
    try {
      const c = await renderCanvas(model, 2000);
      img.src = c.toDataURL('image/jpeg', 0.9);
      loading.style.display = 'none';
    } catch (e) { loading.textContent = e.message; }
  }

  /* ── entry integration ─────────────────────────────────── */
  function entryById(id) {
    try { return (typeof _allEntries !== 'undefined' ? _allEntries : []).find(r => r.id === id) || null; } catch (e) { return null; }
  }
  const isPaid = r => String(r && r.payment_status || '').toUpperCase() === 'PAID';

  async function refreshWinners() {
    const { data, error } = await sb.from('award_evaluations').select('*').in('status', ['winner', 'selected']);
    if (error) return winners;
    winners = {};
    (data || []).forEach(ev => { (winners[ev.entry_id] = winners[ev.entry_id] || []).push(ev); });
    return winners;
  }

  function awardsFor(entryId) { return winners[entryId] || []; }

  async function participation(entryId, fmt, btn) {
    const entry = entryById(entryId);
    if (!entry) return notify('Entry not found.', 'err');
    await run(async () => { await loadConfig(); await output(participationModel(entry), fmt || 'pdf'); }, btn);
  }

  async function award(entryId, evalId, fmt, btn) {
    const entry = entryById(entryId);
    const ev = awardsFor(entryId).find(e => String(e.id) === String(evalId));
    if (!entry || !ev) return notify('Award record not found — refresh and try again.', 'err');
    await run(async () => { await loadConfig(); await output(awardModel(entry, ev), fmt || 'pdf'); }, btn);
  }

  // Row button: one award downloads directly; several open the entry details.
  function awardFromRow(entryId, btn) {
    const list = awardsFor(entryId);
    if (list.length === 1) return award(entryId, list[0].id, 'pdf', btn);
    const idx = (typeof _filtered !== 'undefined' ? _filtered : []).findIndex(r => r.id === entryId);
    if (idx >= 0 && typeof openDrawer === 'function') {
      openDrawer(idx).then(() => { const s = document.getElementById('emCertSection'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }
  }

  function rowButtonsHtml(r) {
    if (!isPaid(r)) return '';
    const n = awardsFor(r.id).length;
    let html = `<button class="btn-ghost btn-xs cert-row-btn" onclick="Certs.participation(${r.id},'pdf',this)" title="Download participation certificate (PDF)">Certificate</button>`;
    if (n) html += `<button class="btn-ghost btn-xs cert-row-btn is-award" onclick="Certs.awardFromRow(${r.id},this)" title="${n > 1 ? n + ' awards — choose in details' : 'Download award certificate (PDF)'}">★ Award${n > 1 ? ' ×' + n : ''}</button>`;
    return html;
  }

  function sectionHtml(r) {
    if (!isPaid(r)) {
      return `<div class="em-section-title">CERTIFICATES</div>
        <p class="cert-note">Certificates are available once the entry fee is paid.</p>`;
    }
    const row = (title, sub, tone, onPrefix) => `
      <div class="cert-item ${tone}">
        <div class="cert-item-info"><span class="cert-item-title">${esc(title)}</span><span class="cert-item-sub">${esc(sub)}</span></div>
        <div class="cert-item-actions">
          <button type="button" class="btn-ghost btn-xs" onclick="${onPrefix},'preview',this)">Preview</button>
          <button type="button" class="btn-ghost btn-xs" onclick="${onPrefix},'pdf',this)">PDF</button>
          <button type="button" class="btn-ghost btn-xs" onclick="${onPrefix},'jpg',this)">JPG</button>
        </div>
      </div>`;
    let html = `<div class="em-section-title">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2.5" width="12" height="9" rx="1.2" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="9.5" r="1.8" stroke="currentColor" stroke-width="1.1"/><path d="M3.5 5.5h5M3.5 7.5h3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
        CERTIFICATES</div><div class="cert-list">`;
    html += row('Participation certificate', 'Silver · ' + (clean(r.film_name) || 'Untitled') + (r.director ? ' — ' + clean(r.director) : ''), 'is-silver', `Certs.participation(${r.id}`);
    awardsFor(r.id).forEach(ev => {
      const label = awardPhrase(catName(ev.award_category));
      const def = catDef(ev.award_category);
      const who = clean(def && def.field ? (r[def.field] || ev.candidate_name) : (ev.candidate_name || r.film_name));
      html += row(label, 'Gold · ' + (who || clean(r.film_name)), 'is-gold', `Certs.award(${r.id},${ev.id}`);
    });
    html += '</div>';
    if (!awardsFor(r.id).length) html += '<p class="cert-note">Award certificates appear here once this entry is marked Winner (or Selected for Special Jury Mention).</p>';
    return html;
  }

  /* ── Certificates management tab ───────────────────────── */
  const SAMPLE_ENTRY = { id: 0, film_name: 'Aardram', director: 'Sreejith V V', actor: 'Raghunath Paleri' };

  async function sampleModel(kind) {
    await loadConfig();
    if (kind === 'participation') return participationModel(SAMPLE_ENTRY);
    return awardModel({ ...SAMPLE_ENTRY, film_name: 'Golden Love' }, { award_category: 'best_actor', candidate_name: 'Raghunath Paleri' });
  }

  async function previewSample(kind, btn) { await run(async () => openPreview(await sampleModel(kind)), btn); }
  async function downloadSample(kind, fmt, btn) { await run(async () => output(await sampleModel(kind), fmt), btn); }

  async function renderManagement() {
    const root = document.getElementById('certMgmt');
    if (!root) return;
    root.innerHTML = '<div class="card"><p class="cert-note">Loading certificate settings…</p></div>';
    await loadConfig(true);
    const c = config;
    const storageDown = c._missing && /bucket|not found/i.test(c._err || '') && !/object/i.test(c._err || '');
    const cats = (() => { try { return (_awardCats && _awardCats.length) ? _awardCats.map(x => ({ key: x.key, name: x.name })) : AWARD_CATS.map(x => ({ key: x.key, name: x.label })); } catch (e) { return []; } })();

    const tplCard = (kind, title, theme) => {
      const key = cfgKey(kind);
      const has = !!c.backgrounds[key];
      return `<div class="cert-tpl-card ${theme}">
        <div class="cert-tpl-thumb" id="certThumb_${key}">${has ? '<span class="cert-note">Rendering sample…</span>' : '<span class="cert-tpl-empty">No template uploaded</span>'}</div>
        <div class="cert-tpl-body">
          <div class="cert-tpl-title">${title}</div>
          <div class="cert-tpl-meta">${has ? 'Template: ' + esc(c.backgrounds[key].split('/').pop()) : 'Upload the blank background to enable downloads.'}</div>
          <div class="cert-tpl-actions">
            <label class="btn btn-sm cert-upload-btn">${has ? 'Replace background' : 'Upload background'}
              <input type="file" accept="image/jpeg,image/png" hidden onchange="Certs.uploadTemplate('${key}', this)"></label>
            <button type="button" class="btn-ghost btn-sm" ${has ? '' : 'disabled'} onclick="Certs.previewSample('${kind}', this)">Preview sample</button>
            <button type="button" class="btn-ghost btn-sm" ${has ? '' : 'disabled'} onclick="Certs.downloadSample('${kind}','pdf', this)">Sample PDF</button>
          </div>
        </div>
      </div>`;
    };

    root.innerHTML = `
      ${storageDown ? `<div class="card cert-warn">Certificate storage is not set up yet (${esc(c._err)}). Ask your developer to run the certificate storage migration.</div>` : ''}
      <div class="card">
        <div class="card-head"><div class="sksfa-card-head-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 10h7M7 13h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="17" cy="14" r="2" stroke="currentColor" stroke-width="1.5"/></svg>
          <div><h2>Templates</h2><p class="sksfa-card-sub">Blank A4-landscape backgrounds — logos, heading, signatures and texture included; film names, award line and body text removed.</p></div>
        </div></div>
        <div class="cert-tpl-grid">
          ${tplCard('participation', 'Participation · Silver', 'is-silver')}
          ${tplCard('award', 'Award / Achievement · Gold', 'is-gold')}
        </div>
        <p class="cert-note">Best quality: 3508 × 2480 px (A4 at 300 dpi), JPG or PNG, up to 15 MB. Other sizes work if the shape is A4 landscape.</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="sksfa-card-head-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 9h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <div><h2>Event details</h2><p class="sksfa-card-sub">Printed on every certificate.</p></div>
        </div></div>
        <div class="grid2">
          <div><label for="certEdition">Edition name</label><input id="certEdition" type="text" value="${esc(c.edition)}"></div>
          <div><label for="certDate">Ceremony date (as printed)</label><input id="certDate" type="text" value="${esc(c.eventDate)}"></div>
        </div>
        <label class="cert-check"><input id="certUpper" type="checkbox" ${c.uppercaseNames ? 'checked' : ''}> Print film and people names in CAPITALS</label>
        <details class="cert-adv">
          <summary>Certificate wording</summary>
          <p class="cert-note">Placeholders: {FILM} {DIRECTOR} {AWARDEE} {AWARD} {EDITION} {DATE} {CITATION}. Wrap text in **double asterisks** for bold. A line break forces a new line.</p>
          <label for="certTxtPart">Participation</label><textarea id="certTxtPart" rows="4">${esc(c.texts.participation)}</textarea>
          <label for="certTxtPerson">Award — person (actor, director…)</label><textarea id="certTxtPerson" rows="4">${esc(c.texts.awardPerson)}</textarea>
          <label for="certTxtFilm">Award — film (Best Short Film…)</label><textarea id="certTxtFilm" rows="4">${esc(c.texts.awardFilm)}</textarea>
          <button type="button" class="btn-ghost btn-sm" onclick="Certs.resetWording()">Reset wording to default</button>
        </details>
        <details class="cert-adv">
          <summary>Award citations (one sentence per category)</summary>
          ${cats.map(k => `<label for="certCit_${esc(k.key)}">${esc(k.name)}</label><textarea id="certCit_${esc(k.key)}" data-cit="${esc(k.key)}" rows="2" placeholder="${esc(DEFAULT_CONFIG.citations[k.key] || DEFAULT_CONFIG.citations._person)}">${esc(c.citations[k.key] || '')}</textarea>`).join('')}
        </details>
        <button type="button" class="btn" onclick="Certs.saveSettings(this)">Save certificate settings</button>
      </div>`;

    ['participation', 'award'].forEach(async kind => {
      const key = cfgKey(kind);
      if (!c.backgrounds[key]) return;
      const box = document.getElementById('certThumb_' + key);
      try {
        const cv = await renderCanvas(await sampleModel(kind), 900);
        box.innerHTML = `<img alt="${kind} template sample" src="${cv.toDataURL('image/jpeg', 0.85)}">`;
      } catch (e) { box.innerHTML = `<span class="cert-tpl-empty">${esc(e.message)}</span>`; }
    });
  }

  async function saveSettings(btn) {
    await run(async () => {
      const next = JSON.parse(JSON.stringify(config));
      next.edition = clean(document.getElementById('certEdition').value) || DEFAULT_CONFIG.edition;
      next.eventDate = clean(document.getElementById('certDate').value) || DEFAULT_CONFIG.eventDate;
      next.uppercaseNames = document.getElementById('certUpper').checked;
      next.texts = {
        participation: document.getElementById('certTxtPart').value.trim() || DEFAULT_CONFIG.texts.participation,
        awardPerson: document.getElementById('certTxtPerson').value.trim() || DEFAULT_CONFIG.texts.awardPerson,
        awardFilm: document.getElementById('certTxtFilm').value.trim() || DEFAULT_CONFIG.texts.awardFilm,
      };
      const cits = Object.assign({}, DEFAULT_CONFIG.citations);
      document.querySelectorAll('[data-cit]').forEach(t => { const v = clean(t.value); if (v) cits[t.dataset.cit] = v; });
      next.citations = cits;
      await saveConfig(next);
      notify('Certificate settings saved', 'ok');
      renderManagement();
    }, btn);
  }

  function resetWording() {
    document.getElementById('certTxtPart').value = DEFAULT_CONFIG.texts.participation;
    document.getElementById('certTxtPerson').value = DEFAULT_CONFIG.texts.awardPerson;
    document.getElementById('certTxtFilm').value = DEFAULT_CONFIG.texts.awardFilm;
  }

  async function uploadTemplate(key, input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) return notify('Use a JPG or PNG image.', 'err');
    if (file.size > 15 * 1024 * 1024) return notify('Image is larger than 15 MB.', 'err');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { return notify('Could not read that image.', 'err'); }
    const ratio = bmp.width / bmp.height, target = PAGE_MM.w / PAGE_MM.h;
    if (Math.abs(ratio - target) / target > 0.02) {
      return notify(`Template must be A4 landscape (about 1.414 : 1). This image is ${bmp.width}×${bmp.height}.`, 'err');
    }
    if (bmp.width < 2000) notify(`Low resolution (${bmp.width}px wide) — prints may look soft. 3508px is recommended.`, 'err');
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `templates/${key}-${Date.now()}.${ext}`;
    notify('Uploading template…');
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (error) return notify('Upload failed: ' + error.message, 'err');
    await loadConfig(true);
    const old = config.backgrounds[key];
    const next = JSON.parse(JSON.stringify(config));
    next.backgrounds[key] = path;
    try { await saveConfig(next); }
    catch (e) { await sb.storage.from(BUCKET).remove([path]); return notify('Could not save settings: ' + e.message, 'err'); }
    if (old && old !== path) sb.storage.from(BUCKET).remove([old]);
    delete bgCache[key];
    notify('Template updated', 'ok');
    renderManagement();
  }

  function init(client) {
    sb = client;
    loadConfig().catch(() => {});
  }

  return {
    init, refreshWinners, awardsFor, rowButtonsHtml, sectionHtml,
    participation, award, awardFromRow,
    renderManagement, saveSettings, resetWording, uploadTemplate, previewSample, downloadSample,
    _safeFilename: safeFilename, _participationModel: participationModel, _awardModel: awardModel,
  };
})();
