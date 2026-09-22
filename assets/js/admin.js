/* ═══════════════════════════════════════════════════════
   CSELECT — Accessible custom dropdown component
════════════════════════════════════════════════════════ */
class CSelect {
  constructor(container, options, value, onChange) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.options = options; // [{value, label}]
    this.value = value;
    this.onChange = onChange;
    this.isOpen = false;
    this._render();
  }
  _render() {
    const sel = this.options.find(o => o.value === this.value) || this.options[0];
    this.container.innerHTML = '';
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'cselect-btn';
    this.btn.setAttribute('role', 'combobox');
    this.btn.setAttribute('aria-haspopup', 'listbox');
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.innerHTML = `<span class="cselect-val">${esc(sel?.label||'')}</span><span class="cselect-arrow">▾</span>`;
    this.dd = document.createElement('div');
    this.dd.className = 'cselect-dropdown';
    this.dd.setAttribute('role', 'listbox');
    this.dd.style.display = 'none';
    this._renderOpts();
    this.container.appendChild(this.btn);
    this.container.appendChild(this.dd);
    this.btn.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
    this.btn.addEventListener('keydown', e => this._key(e));
    this._docClick = e => { if (!this.container.contains(e.target)) this._close(); };
    document.addEventListener('click', this._docClick);
  }
  _renderOpts() {
    this.focusIdx = this.options.findIndex(o => o.value === this.value);
    if (this.focusIdx < 0) this.focusIdx = 0;
    this.dd.innerHTML = this.options.map((o, i) =>
      `<div class="cselect-opt${o.value===this.value?' selected':''}" role="option" aria-selected="${o.value===this.value}" data-idx="${i}">${esc(o.label)}</div>`
    ).join('');
    this.dd.querySelectorAll('.cselect-opt').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); this._pick(+el.dataset.idx); });
      el.addEventListener('mouseenter', () => { this.focusIdx = +el.dataset.idx; this._hi(); });
    });
  }
  _toggle() { this.isOpen ? this._close() : this._open(); }
  _open() {
    this.isOpen = true;
    this.btn.setAttribute('aria-expanded', 'true');
    this.dd.style.display = 'block';
    this._hi();
  }
  _close() {
    this.isOpen = false;
    this.btn.setAttribute('aria-expanded', 'false');
    this.dd.style.display = 'none';
  }
  _hi() {
    this.dd.querySelectorAll('.cselect-opt').forEach((el,i) => el.classList.toggle('focused', i===this.focusIdx));
  }
  _pick(idx) {
    this.value = this.options[idx].value;
    this.btn.querySelector('.cselect-val').textContent = this.options[idx].label;
    this._renderOpts();
    this._close();
    if (this.onChange) this.onChange(this.value);
  }
  _key(e) {
    if (!this.isOpen) {
      if (['Enter',' ','ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); this._open(); } return;
    }
    if (e.key === 'Escape') { e.preventDefault(); this._close(); this.btn.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.focusIdx = Math.min(this.focusIdx+1, this.options.length-1); this._hi(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); this.focusIdx = Math.max(this.focusIdx-1, 0); this._hi(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._pick(this.focusIdx); return; }
  }
  setValue(val) {
    this.value = val;
    const s = this.options.find(o => o.value === val);
    if (s && this.btn) this.btn.querySelector('.cselect-val').textContent = s.label;
    this._renderOpts();
  }
  destroy() { document.removeEventListener('click', this._docClick); }
}

// Global CSelect instances
const _csel = {};

/* ═══════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════ */
const SUPABASE_URL  = "https://flwlbraeyyrofkhxnvwt.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2xicmFleXlyb2ZraHhudnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDQzNDEsImV4cCI6MjEwNDM4MDM0MX0.0apM1gnHcYzTSLs0wTfi1fgaNCf0RKbeginWPXg5EbY";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Award categories definition — order is render order
const AWARD_CATS = [
  { key:'best_short_film',    label:'Best Short Film',     field:null,              type:'film'     },
  { key:'best_campus_film',   label:'Best Campus Film',    field:null,              type:'film',     campusOnly:true },
  { key:'best_director',      label:'Best Director',       field:'director',        type:'person'   },
  { key:'best_screenplay',    label:'Best Screenplay',     field:'writer',          type:'person'   },
  { key:'best_cinematography',label:'Best Cinematography', field:'cinematographer', type:'person'   },
  { key:'best_editing',       label:'Best Editing',        field:'editor',          type:'person'   },
  { key:'best_music_director',label:'Best Music Director', field:'music_director',  type:'person'   },
  { key:'best_actor',         label:'Best Actor',          field:'actor',           type:'person'   },
  { key:'best_actress',       label:'Best Actress',        field:'actress',         type:'person'   },
  { key:'best_child_artist',  label:'Best Child Artist',   field:'child_artist',    type:'person'   },
  { key:'special_jury',       label:'Special Jury Mention',field:null,              type:'flexible' },
];

const STATUS_LABELS = {
  not_reviewed: '— Not Reviewed',
  under_review:  'Under Review',
  shortlisted:   'Shortlisted',
  winner:        'Winner',
  selected:      'Selected',
};

let _allEntries  = [];
let _filtered    = [];
let _page        = 1;
const PAGE_SIZE  = 25;
let _evaluations = {};       // entry_id → { award_category → eval_row }
let _allEvals    = [];       // flat list from DB (Awards tab)
let _evalsLoaded = false;
let _activeDrawerEntryId = null;
let _activeCatKey = null;
let _galCategories = ['events', 'winners2025', 'winners2026'];

function formatCatLabel(slug) {
  return (slug || '')
    .replace(/_/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ═══════════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════════════ */
function toast(msg, kind) {
  if (window.UI) {
    const typeMap = { ok: 'success', err: 'error', warn: 'warn' };
    UI.toast(msg, typeMap[kind] || 'info');
    return;
  }
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + (kind || '');
  clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast ' + (kind || ''), 3500);
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe = v => v == null ? '' : String(v);
const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };
const fmtDateTime = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const isUrl = s => { try { return /^https?:\/\//i.test(s) && !!new URL(s); } catch { return false; } };

/* ═══════════════════════════════════════════════════════
   TAB SWITCHING
════════════════════════════════════════════════════════ */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'awards') refreshAwardsTab();
  if (name === 'videos') { loadVideoCategories(); loadTestimonials(); }
}

/* ═══════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════════ */
async function doLogin() {
  const email = document.getElementById('lg-email').value.trim();
  const password = document.getElementById('lg-pass').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return toast(error.message, 'err');
  await gate();
}
async function doLogout() { await sb.auth.signOut(); location.reload(); }

async function gate() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show('login');
  const { data: isAdmin, error: adErr } = await sb.rpc('is_admin');
  if (adErr) return toast('Admin check failed: ' + adErr.message, 'err');
  if (!isAdmin) { toast('This account is not an admin.', 'err'); await sb.auth.signOut(); return show('login'); }
  document.getElementById('whoami').textContent = ' — ' + session.user.email;
  show('dash');
  await Promise.all([loadConfig(), loadGalleryCategories(), loadGallery(), loadUpdates(), loadEntries(), loadLinks()]);
  _initAdminRealtime();
  if (window.UI) UI.CFileUpload('#gFileWrap');
}
function show(v) {
  document.getElementById('loginView').classList.toggle('hidden', v !== 'login');
  document.getElementById('dashView').classList.toggle('hidden', v !== 'dash');
  if (v === 'dash') initCSelects();
}

function initCSelects() {
  if (_csel._ready) return;
  _csel._ready = true;

  _csel.track = new CSelect('csTrack', [
    { value: '',        label: 'All Tracks' },
    { value: 'general', label: 'General' },
    { value: 'campus',  label: 'Campus' },
  ], '', () => applyFilters());

  _csel.sort = new CSelect('csSort', [
    { value: 'newest',    label: 'Newest first' },
    { value: 'oldest',    label: 'Oldest first' },
    { value: 'film',      label: 'Film A–Z' },
    { value: 'applicant', label: 'Applicant A–Z' },
  ], 'newest', () => applyFilters());

  // galCat is built/rebuilt by loadGalleryCategories() to stay in sync with DB
}

/* ═══════════════════════════════════════════════════════
   CONFIG
════════════════════════════════════════════════════════ */
function applyConfig(data) {
  const open = !!data.registration_open;
  document.getElementById('gateToggle').checked = open;
  setGatePill(open);
  document.getElementById('cfgDeadline').value = toLocalInput(data.submission_deadline);
  document.getElementById('cfgEvent').value = toLocalInput(data.awards_event_date);
  document.getElementById('cfgDeadlineLabel').value = data.deadline_label || '';
  document.getElementById('cfgEventLabel').value = data.event_label || '';
  document.getElementById('statDeadline').textContent = data.deadline_label || fmtDate(data.submission_deadline);
}
function setGatePill(open) {
  ['gatePill','statReg'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = open ? 'Open' : 'Closed'; el.className = 'pill ' + (open ? 'open' : 'closed');
  });
  document.getElementById('statRegTop').textContent = 'Reg: ' + (open ? 'Open' : 'Closed');
}
async function loadConfig() {
  const { data, error } = await sb.from('site_config').select('*').eq('id', 1).single();
  if (error) return toast(error.message, 'err');
  applyConfig(data);
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'gateToggle') return;
  const toggle = e.target, open = toggle.checked;
  setGatePill(open); toggle.disabled = true;
  const { data, error } = await sb.from('site_config').update({ registration_open: open, updated_at: new Date().toISOString() }).eq('id', 1).select().single();
  toggle.disabled = false;
  if (error || !data) { toggle.checked = !open; setGatePill(!open); return toast('Could not save: ' + (error ? error.message : 'no permission'), 'err'); }
  setGatePill(!!data.registration_open);
  toast('Registration ' + (data.registration_open ? 'OPEN' : 'CLOSED') + ' — saved', 'ok');
});
async function saveConfig(ev) {
  const btn = ev && ev.target ? ev.target : null;
  const dl = document.getElementById('cfgDeadline').value, evt = document.getElementById('cfgEvent').value;
  const d1 = dl ? new Date(dl) : null, d2 = evt ? new Date(evt) : null;
  if ((dl && isNaN(d1)) || (evt && isNaN(d2))) return toast('Invalid date/time.', 'err');
  const payload = {
    registration_open: document.getElementById('gateToggle').checked,
    submission_deadline: d1 ? d1.toISOString() : null,
    awards_event_date: d2 ? d2.toISOString() : null,
    deadline_label: document.getElementById('cfgDeadlineLabel').value.trim(),
    event_label: document.getElementById('cfgEventLabel').value.trim(),
    updated_at: new Date().toISOString()
  };
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const { data, error } = await sb.from('site_config').update(payload).eq('id', 1).select().single();
  if (btn) { btn.disabled = false; btn.textContent = 'Save settings'; }
  if (error) return toast('Save failed: ' + error.message, 'err');
  applyConfig(data);
  document.getElementById('cfgSaved').textContent = 'Saved ' + new Date().toLocaleTimeString('en-IN');
  toast('Settings saved', 'ok');
}

/* ═══════════════════════════════════════════════════════
   ENTRIES — LOAD
════════════════════════════════════════════════════════ */
async function loadEntries() {
  const body = document.getElementById('entriesBody');
  body.innerHTML = '<tr><td colspan="7" class="skeleton">Loading…</td></tr>';
  const { data, error } = await sb.from('film_entries').select('*').order('created_at', { ascending: false });
  if (error) {
    body.innerHTML = `<tr><td colspan="7" class="skeleton">Cannot load: ${esc(error.message)}</td></tr>`;
    return;
  }
  // Show only paid + non-archived entries
  _allEntries = (data || []).filter(r =>
    (r.payment_status || '').toUpperCase() === 'PAID' && !r.archived
  );
  updatePaidCounters();
  _page = 1;
  applyFilters();
}

function updatePaidCounters() {
  const today = new Date().toISOString().slice(0,10);
  const total   = _allEntries.length;
  const general = _allEntries.filter(r => (r.category||'').toLowerCase().includes('general')).length;
  const campus  = _allEntries.filter(r => (r.category||'').toLowerCase().includes('campus')).length;
  const todayN  = _allEntries.filter(r => r.created_at && r.created_at.startsWith(today)).length;
  document.getElementById('stTotal').textContent   = total;
  const el = document.getElementById('statEntries');
  if (el) el.textContent = total;
  document.getElementById('stGeneral').textContent = general;
  document.getElementById('stCampus').textContent  = campus;
  document.getElementById('stToday').textContent   = todayN;
}

/* ═══════════════════════════════════════════════════════
   ENTRIES — FILTER / SORT / RENDER
════════════════════════════════════════════════════════ */
function applyFilters() {
  const q    = (document.getElementById('entSearch').value || '').toLowerCase().trim();
  const track= (_csel.track ? _csel.track.value : '').toLowerCase();
  const sort = _csel.sort ? _csel.sort.value : 'newest';

  _filtered = _allEntries.filter(r => {
    if (track && !(r.category||'').toLowerCase().includes(track)) return false;
    if (q) {
      const haystack = [
        r.applicant_name, r.email, r.phone, r.film_name,
        r.cashfree_order_id, r.cashfree_payment_id,
        r.director, r.producer, r.writer, r.cinematographer,
        r.editor, r.music_director, r.actor, r.actress, r.child_artist,
        String(r.id)
      ].map(safe).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  _filtered.sort((a,b) => {
    if (sort === 'oldest')    return new Date(a.created_at) - new Date(b.created_at);
    if (sort === 'film')      return safe(a.film_name).localeCompare(safe(b.film_name));
    if (sort === 'applicant') return safe(a.applicant_name).localeCompare(safe(b.applicant_name));
    return new Date(b.created_at) - new Date(a.created_at);
  });

  _page = 1;
  renderEntriesPage();
}

function renderEntriesPage() {
  const body   = document.getElementById('entriesBody');
  const cards  = document.getElementById('entryCards');
  const total  = _filtered.length;
  const pages  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  _page = Math.min(_page, pages);
  const start  = (_page - 1) * PAGE_SIZE;
  const slice  = _filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('entriesCount').textContent = `${total} result${total !== 1 ? 's' : ''} (${_allEntries.length} total)`;

  if (!slice.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="em-icon">🎞️</div><h3>No film entries yet</h3><p>New submissions will appear here automatically.</p></div></td></tr>';
    cards.innerHTML = '<div class="empty-state"><div class="em-icon">🎞️</div><h3>No film entries yet</h3><p>New submissions will appear here automatically.</p></div>';
    renderPagination(0,1,1); return;
  }

  const trackTag = r => {
    if ((r.category||'').toLowerCase().includes('campus')) return '<span class="tag campus">Campus</span>';
    return '<span class="tag general">General</span>';
  };

  // Desktop table
  body.innerHTML = slice.map((r, i) => {
    const gIdx = start + i;
    return `<tr>
      <td style="color:var(--mut);font-size:0.76rem;">${fmtDate(r.created_at)}</td>
      <td>
        <div style="font-weight:500;">${esc(r.applicant_name||'—')}</div>
        <div style="color:var(--mut);font-size:0.73rem;">${esc(r.email||'')}</div>
      </td>
      <td style="font-weight:500;">${esc(r.film_name||'—')}</td>
      <td>${trackTag(r)}</td>
      <td><span class="tag paid">Paid</span></td>
      <td>
        <button class="btn-ghost btn-xs" onclick="openDrawer(${gIdx})">View Details</button>
        <button class="btn-ghost btn-xs btn-del" onclick="archiveEntry(${r.id}, '${esc(r.film_name||'')}', '${esc(r.applicant_name||'')}')">Delete</button>
      </td>
    </tr>`;
  }).join('');

  // Mobile cards
  cards.innerHTML = slice.map((r, i) => {
    const gIdx = start + i;
    return `<div class="entry-card">
      <div class="ec-film">${esc(r.film_name||'—')}</div>
      <div class="ec-meta">${esc(r.applicant_name||'—')} · ${fmtDate(r.created_at)}</div>
      <div class="ec-row">${trackTag(r)} <span class="tag paid">Paid</span>
        <button class="btn-ghost btn-xs" style="margin-left:auto;" onclick="openDrawer(${gIdx})">View Details</button>
        <button class="btn-ghost btn-xs btn-del" onclick="archiveEntry(${r.id}, '${esc(r.film_name||'')}', '${esc(r.applicant_name||'')}')">Delete</button>
      </div>
    </div>`;
  }).join('');

  renderPagination(total, pages, _page);
}

function renderPagination(total, pages, current) {
  const box = document.getElementById('entriesPagination');
  if (pages <= 1) { box.innerHTML = ''; return; }
  let html = `<button class="btn-ghost btn-sm" onclick="changePage(${current-1})" ${current<=1?'disabled':''}>← Prev</button>`;
  html += `<span class="pg-info">Page ${current} of ${pages} · ${total} entries</span>`;
  html += `<button class="btn-ghost btn-sm" onclick="changePage(${current+1})" ${current>=pages?'disabled':''}>Next →</button>`;
  box.innerHTML = html;
}
function changePage(n) { _page = n; renderEntriesPage(); window.scrollTo({top:0,behavior:'smooth'}); }

/* ═══════════════════════════════════════════════════════
   ARCHIVE (SOFT-DELETE) ENTRY
════════════════════════════════════════════════════════ */
async function archiveEntry(id, filmName, applicantName) {
  const confirmed = window.UI
    ? await UI.confirm(
        `Are you sure you want to delete this film entry?<br><br><strong>Film:</strong> ${filmName}<br><strong>Applicant:</strong> ${applicantName}<br><br>This action cannot be undone from this panel.`,
        { title: 'Delete Film Entry?', okText: 'Delete Entry', cancelText: 'Cancel', danger: true }
      )
    : confirm(`Delete "${filmName}" by ${applicantName}? This cannot be undone from this panel.`);
  if (!confirmed) return;

  const { error } = await sb.from('film_entries').update({ archived: true }).eq('id', id);
  if (error) return toast('Delete failed: ' + error.message, 'err');

  _allEntries = _allEntries.filter(r => r.id !== id);
  updatePaidCounters();
  applyFilters();
  toast('Entry archived: ' + filmName, 'ok');
}

/* ═══════════════════════════════════════════════════════
   ENTRY DETAIL MODAL
════════════════════════════════════════════════════════ */
async function openDrawer(idx) {
  const r = _filtered[idx];
  if (!r) return;
  _activeDrawerEntryId = r.id;

  const ps = (r.payment_status || '').toUpperCase();
  const filmLinkHtml = isUrl(r.film_link)
    ? `<a href="${esc(r.film_link)}" target="_blank" rel="noopener noreferrer" style="color:#ccc;text-decoration:underline;text-underline-offset:2px;">Open Film ↗</a>`
    : esc(r.film_link || '—');

  const row = (k, v) => v && v !== '—'
    ? `<div class="d-row"><span class="d-key">${k}</span><span class="d-val">${v}</span></div>` : '';

  const payStatusHtml = ps === 'PAID' ? '<span class="tag paid">Paid</span>'
    : ps === 'FAILED' ? '<span class="tag failed">Failed</span>'
    : '<span class="tag pending">Pending</span>';

  const trackTag = (r.category||'').toLowerCase().includes('campus')
    ? '<span class="tag campus">Campus</span>' : '<span class="tag general">General</span>';

  const evals = await loadEntryEvals(r.id);

  document.getElementById('entryModalTitle').textContent = r.film_name || 'Entry Details';

  const pdfBtn = document.getElementById('entryModalPdfBtn');
  pdfBtn.onclick = () => exportSinglePdf(idx);

  document.getElementById('entryModalBody').innerHTML = `
    <div class="em-overview">
      <div class="em-overview-item">
        <span class="em-overview-label">Entry ID</span>
        <span class="em-overview-value">#${r.id}</span>
      </div>
      <div class="em-overview-divider"></div>
      <div class="em-overview-item">
        <span class="em-overview-label">Track</span>
        <span class="em-overview-value">${trackTag}</span>
      </div>
      <div class="em-overview-divider"></div>
      <div class="em-overview-item">
        <span class="em-overview-label">Payment</span>
        <span class="em-overview-value">${payStatusHtml}</span>
      </div>
      <div class="em-overview-divider"></div>
      <div class="em-overview-item">
        <span class="em-overview-label">Applied</span>
        <span class="em-overview-value" style="font-size:13px;">${fmtDateTime(r.created_at)||'—'}</span>
      </div>
    </div>

    <div class="em-sections">
      <div class="em-section">
        <div class="em-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 12.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          APPLICANT DETAILS
        </div>
        ${row('Full Name', esc(r.applicant_name||'—'))}
        ${row('Email', r.email ? `<a href="mailto:${esc(r.email)}" style="color:#ccc;">${esc(r.email)}</a>` : '—')}
        ${row('Phone', esc(r.phone||'—'))}
        ${row('City', esc(r.city||'—'))}
      </div>

      <div class="em-section">
        <div class="em-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 5h12" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="8" r="1" fill="currentColor"/></svg>
          FILM DETAILS
        </div>
        ${row('Film Name', esc(r.film_name||'—'))}
        ${row('Film Link', filmLinkHtml)}
        ${row('Duration', esc(r.duration||'—'))}
        ${row('Source', esc(r.source||'—'))}
      </div>

      <div class="em-section em-full">
        <div class="em-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.1"/><circle cx="9.5" cy="4" r="2" stroke="currentColor" stroke-width="1.1"/><path d="M1 11c0-2 1.8-3.5 4-3.5.7 0 1.4.1 2 .4M7 11c0-2 1.5-3.5 3.5-3.5S14 9 14 11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          CAST &amp; CREW
        </div>
        <div class="em-sections" style="padding:0;border:none;">
          <div style="padding:0;">
            ${row('Director', esc(r.director||'—'))}
            ${row('Producer', esc(r.producer||'—'))}
            ${row('Writer / Screenplay', esc(r.writer||'—'))}
            ${row('Cinematographer / DP', esc(r.cinematographer||'—'))}
            ${row('Editor', esc(r.editor||'—'))}
          </div>
          <div style="padding:0;">
            ${row('Music Director', esc(r.music_director||'—'))}
            ${row('Lead Actor', esc(r.actor||'—'))}
            ${row('Lead Actress', esc(r.actress||'—'))}
            ${row('Child Artist', esc(r.child_artist||'—'))}
          </div>
        </div>
      </div>

      <div class="em-section">
        <div class="em-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/><path d="M4 9h2M8 9h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          PAYMENT INFO
        </div>
        ${row('Status', payStatusHtml)}
        ${row('Amount', '₹' + safe(r.amount||'1000'))}
        ${row('Currency', esc(r.currency||'INR'))}
        ${row('Order ID', esc(r.cashfree_order_id||'—'))}
        ${row('Payment ID', esc(r.cashfree_payment_id||'—'))}
        ${row('Method', esc(r.payment_method||'—'))}
        ${row('Paid At', fmtDateTime(r.paid_at))}
        ${row('Verified At', fmtDateTime(r.payment_verified_at))}
        ${row('Confirmation', r.confirmation_sent ? 'Sent ✓' : 'Not sent')}
      </div>

      <div class="em-section">
        <div class="em-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5a3 3 0 004.24 0l2-2a3 3 0 00-4.24-4.24l-1 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8.5 5.5a3 3 0 00-4.24 0l-2 2a3 3 0 004.24 4.24l1-1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          SUBMISSION INFO
        </div>
        ${row('Created At', fmtDateTime(r.created_at))}
        ${row('Source', esc(r.source||'—'))}
        ${row('Direct Link ID', esc(r.link_id ? String(r.link_id) : '—'))}
      </div>

      <div class="em-section em-full">
        <div class="em-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l1.4 2.8 3.1.45-2.25 2.2.53 3.1L7 8.5 4.22 10.05l.53-3.1L2.5 4.75l3.1-.45L7 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
          AWARD EVALUATION
        </div>
        ${renderEvalSection(r, evals)}
      </div>
    </div>
  `;

  document.getElementById('entryModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderEvalSection(r, evals) {
  const isCampus = (r.category||'').toLowerCase().includes('campus');
  let html = '';
  for (const cat of AWARD_CATS) {
    if (cat.campusOnly && !isCampus) continue;
    if (cat.field && !r[cat.field]) continue;

    const ev = evals[cat.key];
    const currentStatus = ev ? ev.status : 'not_reviewed';
    const candidateName = getCandidateName(r, cat);
    const subLabel = candidateName && candidateName !== r.film_name
      ? `<small>${esc(candidateName)}</small>` : '';

    const cNameEsc = esc(candidateName).replace(/'/g,"\\'");
    const isJury = cat.key === 'special_jury';

    let btns = '';
    if (currentStatus === 'not_reviewed') {
      if (isJury) {
        btns = `<div class="eval-btns">
          <button class="eval-btn shortlist" onclick="setEval(${r.id},'${cat.key}','selected','${cNameEsc}','${cat.type}',this)">+ Select</button>
        </div>`;
      } else {
        btns = `<div class="eval-btns">
          <button class="eval-btn shortlist" onclick="setEval(${r.id},'${cat.key}','shortlisted','${cNameEsc}','${cat.type}',this)">+ Shortlist</button>
        </div>`;
      }
    } else if (currentStatus === 'shortlisted') {
      btns = `<div class="eval-btns">
        <span class="eval-status-pill shortlisted">Shortlisted</span>
        <button class="eval-btn winner" onclick="setEval(${r.id},'${cat.key}','winner','${cNameEsc}','${cat.type}',this)">→ Winner</button>
        <button class="eval-btn remove" onclick="setEval(${r.id},'${cat.key}','not_reviewed','${cNameEsc}','${cat.type}',this)">× Remove</button>
      </div>`;
    } else if (currentStatus === 'winner') {
      btns = `<div class="eval-btns">
        <span class="eval-status-pill winner">★ Winner</span>
        <button class="eval-btn remove" onclick="setEval(${r.id},'${cat.key}','not_reviewed','${cNameEsc}','${cat.type}',this)">× Remove</button>
      </div>`;
    } else if (currentStatus === 'selected') {
      btns = `<div class="eval-btns">
        <span class="eval-status-pill selected">Selected</span>
        <button class="eval-btn remove" onclick="setEval(${r.id},'${cat.key}','not_reviewed','${cNameEsc}','${cat.type}',this)">× Remove</button>
      </div>`;
    } else {
      // under_review or other legacy — show shortlist option
      btns = `<div class="eval-btns">
        <button class="eval-btn shortlist" onclick="setEval(${r.id},'${cat.key}','shortlisted','${cNameEsc}','${cat.type}',this)">+ Shortlist</button>
        <button class="eval-btn remove" onclick="setEval(${r.id},'${cat.key}','not_reviewed','${cNameEsc}','${cat.type}',this)">× Remove</button>
      </div>`;
    }

    html += `<div class="eval-row">
      <div class="eval-label">${esc(cat.label)}${subLabel}</div>
      ${btns}
    </div>`;
  }
  return html || '<p class="muted-note">No applicable award categories for this entry.</p>';
}

function getCandidateName(r, cat) {
  if (cat.type === 'film' || !cat.field) return r.film_name || '';
  return r[cat.field] || '';
}

function buildStatusOpts(catKey, current) {
  const opts = catKey === 'special_jury'
    ? ['not_reviewed','under_review','selected']
    : ['not_reviewed','under_review','shortlisted','winner'];
  return opts.map(s => `<option value="${s}" ${current===s?'selected':''}>${STATUS_LABELS[s]||s}</option>`).join('');
}

async function loadEntryEvals(entryId) {
  if (_evaluations[entryId]) return _evaluations[entryId];
  const { data, error } = await sb.from('award_evaluations').select('*').eq('entry_id', entryId);
  if (error) { toast('Could not load evaluations: ' + error.message, 'err'); return {}; }
  const map = {};
  (data || []).forEach(ev => { map[ev.award_category] = ev; });
  _evaluations[entryId] = map;
  return map;
}

async function setEval(entryId, category, status, candidateName, candidateType, btn) {
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  const payload = {
    entry_id: entryId,
    award_category: category,
    candidate_name: candidateName || '',
    candidate_type: candidateType || 'film',
    status,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('award_evaluations')
    .upsert(payload, { onConflict: 'entry_id,award_category' })
    .select().single();
  if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  if (error) { toast('Eval save failed: ' + error.message, 'err'); return; }
  // Update local cache
  if (!_evaluations[entryId]) _evaluations[entryId] = {};
  if (status === 'not_reviewed') {
    delete _evaluations[entryId][category];
  } else {
    _evaluations[entryId][category] = data;
  }
  // Invalidate awards tab cache
  _evalsLoaded = false;
  const labelStatus = STATUS_LABELS[status] || status;
  toast(`${AWARD_CATS.find(c=>c.key===category)?.label} → ${labelStatus}`, 'ok');
  // Refresh eval section in open modal
  if (_activeDrawerEntryId === entryId) {
    const evals = _evaluations[entryId];
    const r = _allEntries.find(x => x.id === entryId);
    if (r) {
      const sections = document.querySelectorAll('#entryModalBody .em-section');
      const lastSection = sections[sections.length - 1];
      if (lastSection) {
        const titleEl = lastSection.querySelector('.em-section-title');
        if (titleEl && titleEl.textContent.includes('AWARD EVALUATION')) {
          lastSection.innerHTML = `<div class="em-section-title"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l1.4 2.8 3.1.45-2.25 2.2.53 3.1L7 8.5 4.22 10.05l.53-3.1L2.5 4.75l3.1-.45L7 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>AWARD EVALUATION</div>${renderEvalSection(r, evals)}`;
        }
      }
    }
  }
}

function closeEntryModal() {
  document.getElementById('entryModalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  _activeDrawerEntryId = null;
}
function closeDrawer(e) { closeEntryModal(); }
function closeDrawerDirect() { closeEntryModal(); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('entryModalOverlay')?.classList.contains('open')) closeEntryModal();
});

/* ═══════════════════════════════════════════════════════
   AWARDS TAB
════════════════════════════════════════════════════════ */
async function refreshAwardsTab() {
  _evalsLoaded = false;
  await Promise.all([loadAllEvals(), loadAwardCategories()]);
  renderAwardGrid();
}

async function loadAllEvals() {
  if (_evalsLoaded) return;
  const { data, error } = await sb.from('award_evaluations').select('*');
  if (error) { toast('Could not load evaluations: ' + error.message, 'err'); return; }
  _allEvals = data || [];
  _evalsLoaded = true;
  // Refresh local per-entry cache too
  _evaluations = {};
  _allEvals.forEach(ev => {
    if (!_evaluations[ev.entry_id]) _evaluations[ev.entry_id] = {};
    _evaluations[ev.entry_id][ev.award_category] = ev;
  });
}

function renderAwardGrid() {
  const grid = document.getElementById('awardGrid');
  grid.innerHTML = AWARD_CATS.map(cat => {
    const catEvals = _allEvals.filter(e => e.award_category === cat.key);
    const shortlisted = catEvals.filter(e => e.status === 'shortlisted').length;
    const winners     = catEvals.filter(e => e.status === 'winner' || e.status === 'selected').length;
    // Only count shortlisted + winner as "considered" (not under_review)
    const considered  = shortlisted + winners;
    const hasWinner   = winners > 0;
    return `<div class="award-card ${_activeCatKey===cat.key?'active-cat':''}" onclick="openAwardCat('${cat.key}')">
      <h3>${esc(cat.label)}</h3>
      <div class="ac-stats">
        <div class="ac-stat"><span class="n">${considered}</span><span class="l">Shortlisted</span></div>
        <div class="ac-stat"><span class="n" style="${hasWinner?'opacity:1':'opacity:0.4'}">${winners}</span><span class="l">${cat.key==='special_jury'?'Selected':'Winner'}</span></div>
      </div>
    </div>`;
  }).join('');
}

function openAwardCat(key) {
  _activeCatKey = key;
  const cat = AWARD_CATS.find(c => c.key === key);
  if (!cat) return;

  const catEvals = _allEvals.filter(e => e.award_category === key &&
    (e.status === 'shortlisted' || e.status === 'winner' || e.status === 'selected'));
  document.getElementById('awardCatTitle').textContent = cat.label;

  // Build columns
  const isFilm   = cat.type === 'film';
  const isFlexible = cat.type === 'flexible';
  const candidateLabel = isFilm ? 'Film' : cat.field ? cat.label.replace('Best ','') : 'Candidate';

  document.getElementById('awardCatThead').innerHTML = `
    <th>${candidateLabel}</th>
    <th>Film</th>
    <th>Entry ID</th>
    <th>Applicant</th>
    <th>Date</th>
    <th>Status</th>
    <th>View</th>
  `;

  if (!catEvals.length) {
    document.getElementById('awardCatBody').innerHTML =
      `<tr><td colspan="7" style="padding:20px 12px;color:var(--mut);font-size:0.83rem;">No entries evaluated for this category yet.</td></tr>`;
  } else {
    document.getElementById('awardCatBody').innerHTML = catEvals.map(ev => {
      const entry = _allEntries.find(r => r.id === ev.entry_id);
      const candidate = ev.candidate_name || (entry ? (isFilm ? entry.film_name : '') : '');
      const film = entry ? safe(entry.film_name) : '—';
      const applicant = entry ? safe(entry.applicant_name) : '—';
      const date = entry ? fmtDate(entry.created_at) : '—';
      // find idx in _allEntries for drawer open
      const eIdx = _filtered.indexOf(entry);
      const allIdx = _allEntries.indexOf(entry);
      // For opening from Awards tab, we need to open using allEntries idx in the filtered list
      // We'll open using a global entry lookup
      const openBtn = entry
        ? `<button class="btn-ghost btn-xs" onclick="openDrawerByEntryId(${ev.entry_id})">View</button>`
        : '—';
      return `<tr>
        <td style="font-weight:500;">${esc(candidate||'—')}</td>
        <td>${esc(film)}</td>
        <td style="color:var(--mut);font-size:0.76rem;">${ev.entry_id}</td>
        <td>${esc(applicant)}</td>
        <td style="color:var(--mut);font-size:0.76rem;">${date}</td>
        <td><span class="award-pill ${ev.status}">${STATUS_LABELS[ev.status]||ev.status}</span></td>
        <td>${openBtn}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('awardCatDetail').classList.remove('hidden');
  document.getElementById('awardCatDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderAwardGrid(); // re-render to update active state
}

function closeAwardCatDetail() {
  _activeCatKey = null;
  document.getElementById('awardCatDetail').classList.add('hidden');
  renderAwardGrid();
}

/* ─── AWARD CATEGORY CRUD ─────────────────────────── */
let _awardCats = [];

async function loadAwardCategories() {
  const { data, error } = await sb.from('award_categories').select('*').order('sort_order');
  if (error) { toast('Failed to load award categories: ' + error.message, 'err'); return; }
  _awardCats = data || [];
  renderAcList();
}

function renderAcList() {
  const tbody = document.getElementById('acListBody');
  if (!_awardCats.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:16px;color:var(--mut);">No categories yet.</td></tr>';
    return;
  }
  tbody.innerHTML = _awardCats.map((c, i) => {
    const iconPreview = c.icon_svg ? `<div style="width:28px;height:28px;color:#fff;">${c.icon_svg}</div>` : '—';
    const statusPill = c.active
      ? '<span class="pill open" style="font-size:0.7rem;">Active</span>'
      : '<span class="pill closed" style="font-size:0.7rem;">Inactive</span>';
    const upBtn = i > 0
      ? `<button class="btn-ghost btn-xs" onclick="acMove(${c.id},'up')" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>`
      : '';
    const downBtn = i < _awardCats.length - 1
      ? `<button class="btn-ghost btn-xs" onclick="acMove(${c.id},'down')" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg></button>`
      : '';
    return `<tr>
      <td style="color:var(--mut);font-size:0.78rem;">${c.sort_order}</td>
      <td style="font-weight:500;">${esc(c.name)}</td>
      <td>${iconPreview}</td>
      <td>${statusPill}</td>
      <td style="white-space:nowrap;">
        <button class="btn-ghost btn-xs" onclick="acEdit(${c.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg></button>
        ${upBtn}${downBtn}
        <button class="btn-ghost btn-xs" onclick="acToggleActive(${c.id})" title="${c.active?'Deactivate':'Activate'}">${c.active
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 19,12 5,21"/></svg>'
        }</button>
        <button class="btn-ghost btn-xs" onclick="acDelete(${c.id})" title="Delete" style="color:var(--err);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg></button>
      </td>
    </tr>`;
  }).join('');
}

function acToggleForm() {
  const form = document.getElementById('acForm');
  if (!form.classList.contains('hidden')) { acCancelForm(); return; }
  document.getElementById('acFormTitle').textContent = 'Add Award Category';
  document.getElementById('acEditId').value = '';
  document.getElementById('acNameInput').value = '';
  document.getElementById('acKeyInput').value = '';
  document.getElementById('acIconInput').value = '';
  document.getElementById('acSortInput').value = _awardCats.length;
  document.getElementById('acActiveInput').value = 'true';
  form.classList.remove('hidden');
  document.getElementById('acNameInput').focus();
}

function acCancelForm() {
  document.getElementById('acForm').classList.add('hidden');
  document.getElementById('acEditId').value = '';
}

function acEdit(id) {
  const cat = _awardCats.find(c => c.id === id);
  if (!cat) return;
  document.getElementById('acFormTitle').textContent = 'Edit Award Category';
  document.getElementById('acEditId').value = id;
  document.getElementById('acNameInput').value = cat.name;
  document.getElementById('acKeyInput').value = cat.key;
  document.getElementById('acIconInput').value = cat.icon_svg || '';
  document.getElementById('acSortInput').value = cat.sort_order;
  document.getElementById('acActiveInput').value = String(cat.active);
  document.getElementById('acForm').classList.remove('hidden');
  document.getElementById('acNameInput').focus();
}

async function acSave() {
  const name = document.getElementById('acNameInput').value.trim();
  if (!name) { toast('Category name required', 'err'); return; }
  const editId = document.getElementById('acEditId').value;
  const key = editId
    ? document.getElementById('acKeyInput').value
    : name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const icon_svg = document.getElementById('acIconInput').value.trim();
  const sort_order = parseInt(document.getElementById('acSortInput').value) || 0;
  const active = document.getElementById('acActiveInput').value === 'true';

  if (!editId) {
    const dup = _awardCats.find(c => c.key === key);
    if (dup) { toast('Category with key "' + key + '" already exists', 'err'); return; }
    const { error } = await sb.from('award_categories').insert({ key, name, icon_svg, sort_order, active });
    if (error) { toast('Failed to add: ' + error.message, 'err'); return; }
    toast('Category added');
  } else {
    const payload = { name, icon_svg, sort_order, active };
    const { error } = await sb.from('award_categories').update(payload).eq('id', parseInt(editId));
    if (error) { toast('Failed to update: ' + error.message, 'err'); return; }
    toast('Category updated');
  }
  acCancelForm();
  await loadAwardCategories();
}

async function acMove(id, dir) {
  const idx = _awardCats.findIndex(c => c.id === id);
  if (idx < 0) return;
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= _awardCats.length) return;
  const a = _awardCats[idx], b = _awardCats[swapIdx];
  const { error: e1 } = await sb.from('award_categories').update({ sort_order: b.sort_order }).eq('id', a.id);
  const { error: e2 } = await sb.from('award_categories').update({ sort_order: a.sort_order }).eq('id', b.id);
  if (e1 || e2) { toast('Reorder failed', 'err'); return; }
  await loadAwardCategories();
}

async function acToggleActive(id) {
  const cat = _awardCats.find(c => c.id === id);
  if (!cat) return;
  const { error } = await sb.from('award_categories').update({ active: !cat.active }).eq('id', id);
  if (error) { toast('Toggle failed: ' + error.message, 'err'); return; }
  toast(cat.name + (cat.active ? ' deactivated' : ' activated'));
  await loadAwardCategories();
}

async function acDelete(id) {
  const cat = _awardCats.find(c => c.id === id);
  if (!cat) return;
  const hasEvals = _allEvals.some(e => e.award_category === cat.key);
  let msg = `Delete "${cat.name}"?`;
  if (hasEvals) msg += '\n\nThis category has existing evaluations. Consider deactivating instead. Delete anyway?';
  if (!confirm(msg)) return;
  const { error } = await sb.from('award_categories').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message, 'err'); return; }
  toast(cat.name + ' deleted');
  await loadAwardCategories();
}

// Open drawer for entry found by entry_id (for Awards tab → View button)
function openDrawerByEntryId(entryId) {
  // Push entry to _filtered temporarily so openDrawer(idx) works
  const entry = _allEntries.find(r => r.id === entryId);
  if (!entry) return;
  // temporarily make _filtered include this entry
  const existing = _filtered.findIndex(r => r.id === entryId);
  if (existing >= 0) { openDrawer(existing); return; }
  // Not in current filter — bypass filter and open from _allEntries
  _filtered = [entry, ..._filtered];
  openDrawer(0);
}

/* ═══════════════════════════════════════════════════════
   CSV EXPORT
════════════════════════════════════════════════════════ */
function exportEntriesCsv() {
  const data = _filtered.length && _filtered.length < _allEntries.length ? _filtered : _allEntries;
  if (!data.length) return toast('No entries to export.', 'err');
  const cols = ['id','created_at','applicant_name','email','phone','city','film_name','category',
    'film_link','duration','director','producer','writer','cinematographer','editor',
    'music_director','actor','actress','child_artist',
    'payment_status','amount','currency','cashfree_order_id','cashfree_payment_id',
    'paid_at','payment_method','payment_verified_at','source','link_id'];
  const csv = [cols.join(',')].concat(data.map(r => cols.map(c => {
    const v = r[c] == null ? '' : String(r[c]).replace(/"/g,'""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }).join(','))).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'film_entries_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
}

/* ═══════════════════════════════════════════════════════
   PDF — ALL ENTRIES
════════════════════════════════════════════════════════ */
function buildPdf(entries, title) {
  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
    toast('PDF library not loaded yet — retry in a moment.', 'err'); return null;
  }
  const { jsPDF } = window.jspdf || jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const genDate = new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'long',year:'numeric'});

  doc.setFillColor(8,8,8);
  doc.rect(0,0,pageW,24,'F');
  doc.setTextColor(240,240,240);
  doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text('SHARANKRISHNA SHORT FILM AWARDS', margin, 10);
  doc.setTextColor(160,160,160);
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text(title + '  ·  Generated ' + genDate + '  ·  Total: ' + entries.length, margin, 17);

  const cols = [
    { header:'Date',       dataKey:'date'      },
    { header:'Applicant',  dataKey:'applicant'  },
    { header:'Film',       dataKey:'film'       },
    { header:'Track',      dataKey:'track'      },
    { header:'Director',   dataKey:'dir'        },
    { header:'Writer',     dataKey:'writer'     },
    { header:'Cinematographer', dataKey:'cin'   },
    { header:'Editor',     dataKey:'editor'     },
    { header:'Actor',      dataKey:'actor'      },
    { header:'Actress',    dataKey:'actress'    },
    { header:'Film Link',  dataKey:'link'       },
    { header:'Payment',    dataKey:'status'     },
    { header:'Amount',     dataKey:'amount'     },
  ];

  const rows = entries.map(r => ({
    date:      fmtDate(r.created_at),
    applicant: safe(r.applicant_name) + '\n' + safe(r.email),
    film:      safe(r.film_name),
    track:     safe(r.category),
    dir:       safe(r.director||'—'),
    writer:    safe(r.writer||'—'),
    cin:       safe(r.cinematographer||'—'),
    editor:    safe(r.editor||'—'),
    actor:     safe(r.actor||'—'),
    actress:   safe(r.actress||'—'),
    link:      isUrl(r.film_link) ? safe(r.film_link) : '—',
    status:    (r.payment_status||'').toUpperCase()||'PAID',
    amount:    '₹' + safe(r.amount||1000),
  }));
  const linkRows = entries.map(r => isUrl(r.film_link) ? r.film_link : null);

  doc.autoTable({
    startY: 28, margin: { left: margin, right: margin },
    head: [cols.map(c => c.header)],
    body: rows.map(r => cols.map(c => r[c.dataKey])),
    styles: { fontSize:6.5, cellPadding:2.5, overflow:'linebreak', valign:'middle',
      textColor:[220,220,230], lineColor:[35,35,45], lineWidth:0.15 },
    headStyles: { fillColor:[20,20,26], textColor:[200,200,210], fontStyle:'bold', fontSize:6.5 },
    alternateRowStyles: { fillColor:[15,15,22] },
    bodyStyles: { fillColor:[10,10,16] },
    columnStyles: {
      0: { cellWidth:18 }, 1: { cellWidth:34 }, 2: { cellWidth:30 },
      3: { cellWidth:16 }, 4: { cellWidth:22 }, 5: { cellWidth:22 },
      6: { cellWidth:22 }, 7: { cellWidth:18 }, 8: { cellWidth:20 },
      9: { cellWidth:20 }, 10:{ cellWidth:44, textColor:[150,150,170] },
      11:{ cellWidth:14 }, 12:{ cellWidth:14 },
    },
    didDrawCell(data) {
      if (data.section==='body' && data.column.index===10) {
        const url = linkRows[data.row.index];
        if (url) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
      }
      if (data.section==='body' && data.column.index===1) {
        const email = safe(entries[data.row.index].email);
        if (email && email.includes('@'))
          doc.link(data.cell.x, data.cell.y + data.cell.height/2, data.cell.width, data.cell.height/2, { url:'mailto:'+email });
      }
    },
    didDrawPage() {
      doc.setFontSize(6.5); doc.setTextColor(100,100,120);
      doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - margin, pageH - 5, { align:'right' });
    }
  });

  return doc;
}

function exportEntriesPdf() {
  const data = _filtered.length && _filtered.length < _allEntries.length ? _filtered : _allEntries;
  if (!data.length) return toast('No entries to export.', 'err');
  toast('Generating PDF…');
  setTimeout(() => {
    try { const doc = buildPdf(data,'All Film Entries'); if (doc) doc.save('film_entries_' + new Date().toISOString().slice(0,10) + '.pdf'); }
    catch(e) { toast('PDF error: ' + e.message, 'err'); }
  }, 100);
}

/* ═══════════════════════════════════════════════════════
   PDF — SINGLE ENTRY
════════════════════════════════════════════════════════ */
async function exportSinglePdf(idx) {
  const r = _filtered[idx];
  if (!r) return;
  toast('Generating PDF…');
  const evals = await loadEntryEvals(r.id);
  setTimeout(() => {
    try {
      const { jsPDF } = window.jspdf || jspdf;
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 18;
      const genDate = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});

      doc.setFillColor(8,8,8); doc.rect(0,0,pageW,32,'F');
      doc.setTextColor(230,230,230); doc.setFontSize(12); doc.setFont('helvetica','bold');
      doc.text('SHARANKRISHNA SHORT FILM AWARDS', margin, 12);
      doc.setTextColor(150,150,150); doc.setFontSize(8); doc.setFont('helvetica','normal');
      doc.text('Entry Details · Generated ' + genDate, margin, 19);
      doc.text('Film: ' + safe(r.film_name), margin, 26);

      const sectionPdf = (title, pairs, startY) => {
        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(200,200,210);
        doc.text(title, margin, startY);
        doc.setFont('helvetica','normal');
        let y = startY + 6;
        pairs.forEach(([k,v,linkUrl]) => {
          if (!v || v === '—') return;
          doc.setTextColor(130,130,150); doc.setFontSize(7.5); doc.text(k + ':', margin, y);
          doc.setTextColor(210,210,225); doc.setFontSize(7.5);
          const vStr = String(v||'—');
          doc.text(vStr, margin + 52, y, { maxWidth: pageW - margin - 52 - margin });
          if (linkUrl) doc.link(margin+52, y-4, pageW-margin-52-margin, 7, { url:linkUrl });
          y += 7;
        });
        return y + 5;
      };

      let y = 40;
      y = sectionPdf('APPLICANT DETAILS', [
        ['Full Name', r.applicant_name],
        ['Email', r.email, r.email?'mailto:'+r.email:null],
        ['Phone', r.phone],
        ['City', r.city],
        ['Entry ID', String(r.id)],
      ], y);
      y = sectionPdf('FILM DETAILS', [
        ['Film Name', r.film_name],
        ['Submission Track', r.category],
        ['Film Link', r.film_link, isUrl(r.film_link)?r.film_link:null],
        ['Duration', r.duration],
      ], y);
      y = sectionPdf('CAST & CREW', [
        ['Director', r.director],
        ['Producer', r.producer],
        ['Writer / Screenplay', r.writer],
        ['Cinematographer / DP', r.cinematographer],
        ['Editor', r.editor],
        ['Music Director', r.music_director],
        ['Lead Actor', r.actor],
        ['Lead Actress', r.actress],
        ['Child Artist', r.child_artist],
      ], y);
      y = sectionPdf('PAYMENT', [
        ['Status', r.payment_status||'—'],
        ['Amount', '₹' + (r.amount||1000)],
        ['Currency', r.currency||'INR'],
        ['Cashfree Order ID', r.cashfree_order_id],
        ['Payment ID', r.cashfree_payment_id],
        ['Payment Method', r.payment_method],
        ['Paid At', fmtDateTime(r.paid_at)],
        ['Verified At', fmtDateTime(r.payment_verified_at)],
        ['Confirmation', r.confirmation_sent?'Sent':'Not sent'],
      ], y);

      // Award evaluations
      const evalPairs = [];
      for (const cat of AWARD_CATS) {
        const ev = evals[cat.key];
        if (!ev || ev.status === 'not_reviewed') continue;
        evalPairs.push([cat.label, STATUS_LABELS[ev.status] + (ev.candidate_name?' — '+ev.candidate_name:'')]);
      }
      if (evalPairs.length) sectionPdf('AWARD EVALUATIONS', evalPairs, y);

      doc.setFontSize(7); doc.setTextColor(100,100,120);
      doc.text('Sharankrishna Short Film Awards · Page 1', pageW - margin, 290, { align:'right' });
      doc.save('entry_' + safe(r.cashfree_order_id||String(r.id)||'unknown').replace(/\W/g,'_') + '.pdf');
    } catch(e) { toast('PDF error: ' + e.message, 'err'); }
  }, 100);
}

/* ═══════════════════════════════════════════════════════
   PDF — AWARD SHORTLISTS
════════════════════════════════════════════════════════ */
async function exportAwardsPdf() {
  await loadAllEvals();
  if (!_allEvals.length) return toast('No evaluations to export.', 'err');
  toast('Generating shortlists PDF…');
  setTimeout(() => {
    try {
      const { jsPDF } = window.jspdf || jspdf;
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 18;
      const genDate = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});

      // Cover header
      doc.setFillColor(8,8,8); doc.rect(0,0,pageW,32,'F');
      doc.setTextColor(230,230,230); doc.setFontSize(12); doc.setFont('helvetica','bold');
      doc.text('SHARANKRISHNA SHORT FILM AWARDS', margin, 13);
      doc.setTextColor(150,150,150); doc.setFontSize(8.5); doc.setFont('helvetica','normal');
      doc.text('Award Shortlists · ' + genDate, margin, 21);
      doc.setTextColor(100,100,120); doc.setFontSize(7.5);
      doc.text('CONFIDENTIAL — JURY USE ONLY', margin, 27);

      let y = 40;
      const checkPage = (needed) => {
        if (y + needed > pageH - 16) { doc.addPage(); y = 20; }
      };

      for (const cat of AWARD_CATS) {
        const catEvals = _allEvals.filter(e => e.award_category === cat.key && e.status !== 'not_reviewed');
        if (!catEvals.length) continue;

        checkPage(20);
        doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(200,200,210);
        doc.text(cat.label.toUpperCase(), margin, y); y += 5;
        doc.setLineWidth(0.3); doc.setDrawColor(60,60,70);
        doc.line(margin, y, pageW - margin, y); y += 6;

        catEvals.forEach((ev, i) => {
          checkPage(14);
          const entry = _allEntries.find(r => r.id === ev.entry_id);
          doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(200,200,215);
          doc.text(`${i+1}.`, margin, y);
          doc.text(safe(ev.candidate_name||'—'), margin + 8, y);
          doc.setFont('helvetica','normal'); doc.setTextColor(140,140,160);
          const filmStr = entry ? ('Film: ' + safe(entry.film_name)) : '';
          const idStr = 'Entry #' + ev.entry_id;
          doc.text([filmStr, idStr].filter(Boolean).join('  ·  '), margin + 8, y + 5);
          const statusStr = (STATUS_LABELS[ev.status]||ev.status).toUpperCase();
          doc.setTextColor(190,190,210); doc.text(statusStr, pageW - margin, y, { align:'right' });
          y += 13;
        });
        y += 4;
      }

      // Page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(6.5); doc.setTextColor(100,100,120);
        doc.text('Page ' + i + ' of ' + pageCount, pageW - margin, pageH - 6, { align:'right' });
      }

      doc.save('award_shortlists_' + new Date().toISOString().slice(0,10) + '.pdf');
    } catch(e) { toast('PDF error: ' + e.message, 'err'); }
  }, 100);
}

/* ═══════════════════════════════════════════════════════
   GALLERY CATEGORIES
════════════════════════════════════════════════════════ */
async function loadGalleryCategories() {
  const { data } = await sb.from('site_config').select('gallery_categories').eq('id', 1).single();
  if (data && Array.isArray(data.gallery_categories) && data.gallery_categories.length) {
    _galCategories = data.gallery_categories;
  }
  rebuildGalCatSelect();
  renderCategoryManager();
}

function rebuildGalCatSelect() {
  const opts = _galCategories.map(c => ({ value: c, label: formatCatLabel(c) }));
  if (!opts.length) opts.push({ value: 'general', label: 'General' });
  if (_csel.galCat) { _csel.galCat.destroy(); delete _csel.galCat; }
  const wrap = document.getElementById('csGalCat');
  if (!wrap) return;
  _csel.galCat = new CSelect(wrap, opts, opts[0].value, null);
}

async function saveGalleryCategories() {
  const { error } = await sb.from('site_config').update({ gallery_categories: _galCategories }).eq('id', 1);
  if (error) toast('Categories save failed: ' + error.message, 'err');
}

async function addGalCategory() {
  const input = document.getElementById('newCatInput');
  const name = (input.value || '').trim();
  if (!name) return toast('Category name required.', 'err');
  const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');
  if (!slug) return toast('Invalid name — use letters/numbers only.', 'err');
  if (_galCategories.includes(slug)) return toast('Category already exists.', 'err');
  _galCategories.push(slug);
  input.value = '';
  await saveGalleryCategories();
  rebuildGalCatSelect();
  renderCategoryManager();
  toast('Category added', 'ok');
}

async function delGalCategory(slug) {
  if (window.UI) { if (!await UI.confirm(`Remove category "${formatCatLabel(slug)}"? Existing photos in this category will not be deleted.`, { title: 'Remove Category', danger: true })) return; }
  else { if (!confirm(`Remove category "${formatCatLabel(slug)}"? Existing photos in this category will not be deleted.`)) return; }
  _galCategories = _galCategories.filter(c => c !== slug);
  if (!_galCategories.length) _galCategories = ['general'];
  await saveGalleryCategories();
  rebuildGalCatSelect();
  renderCategoryManager();
  toast('Category removed', 'ok');
}

function renderCategoryManager() {
  const box = document.getElementById('catManagerList');
  if (!box) return;
  if (!_galCategories.length) {
    box.innerHTML = '<p class="muted-note">No categories yet.</p>';
    return;
  }
  box.innerHTML = _galCategories.map(c => `
    <div class="cat-row">
      <span class="cat-row-name">${esc(formatCatLabel(c))}</span>
      <span class="cat-row-slug">${esc(c)}</span>
      <button class="btn-del" onclick="delGalCategory('${esc(c)}')">Remove</button>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════
   GALLERY
════════════════════════════════════════════════════════ */
async function loadGallery() {
  const { data, error } = await sb.from('gallery').select('*').order('sort_order').order('created_at', { ascending: false });
  if (error) return toast(error.message, 'err');
  document.getElementById('statPhotos').textContent = (data||[]).length;
  const box = document.getElementById('galleryList');
  if (!data || !data.length) { box.innerHTML = '<div class="empty-state"><span class="em-icon">🖼️</span><h3>No photos yet</h3><p>Upload gallery images above.</p></div>'; return; }
  box.innerHTML = data.map(g => `
    <div class="gallery-item">
      ${g.src ? `<img src="${esc(g.src)}" alt="" loading="lazy">` : '<div class="gallery-item-thumb-placeholder"></div>'}
      <div class="gallery-item-meta">
        <div class="gallery-item-title">${esc(g.title)||'(untitled)'}</div>
        <div class="gallery-item-sub">${esc(formatCatLabel(g.category))} · ${esc(g.sub)||'—'}</div>
      </div>
      <button class="btn-del" onclick="delGallery(${g.id},'${esc(g.src)}')">Delete</button>
    </div>`).join('');
}
async function addGallery(ev) {
  const btn = ev?.target;
  const file = document.getElementById('gFile').files[0];
  if (!file) return toast('Pick an image first.', 'err');
  if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(file.type)) return toast('JPG, PNG, or WEBP only.', 'err');
  if (file.size > 8*1024*1024) return toast('Image too large (max 8 MB).', 'err');
  if (btn) { btn.disabled=true; btn.textContent='Uploading…'; }
  const path = Date.now() + '_' + file.name.replace(/[^\w.\-]/g,'_');
  const up = await sb.storage.from('gallery').upload(path, file, { upsert:false });
  if (up.error) { if (btn){btn.disabled=false;btn.textContent='Upload photo';} return toast('Upload failed: '+up.error.message,'err'); }
  const pub = sb.storage.from('gallery').getPublicUrl(path).data.publicUrl;
  const { error } = await sb.from('gallery').insert({
    category: (_csel.galCat ? _csel.galCat.value : 'events'), src:pub,
    title: document.getElementById('gTitle').value.trim(), sub: document.getElementById('gSub').value.trim()
  });
  if (btn) { btn.disabled=false; btn.textContent='Upload photo'; }
  if (error) return toast('Saved image but metadata failed: '+error.message,'err');
  document.getElementById('gFile').value=''; document.getElementById('gTitle').value=''; document.getElementById('gSub').value='';
  toast('Photo added', 'ok'); loadGallery();
}
async function delGallery(id, src) {
  if (window.UI) { if (!await UI.confirm('Delete this photo?', { title: 'Delete Photo', danger: true })) return; }
  else { if (!confirm('Delete this photo?')) return; }
  await sb.from('gallery').delete().eq('id', id);
  try { const p = src.split('/gallery/')[1]; if (p) await sb.storage.from('gallery').remove([p]); } catch(_){}
  toast('Deleted', 'ok'); loadGallery();
}

/* ═══════════════════════════════════════════════════════
   UPDATES
════════════════════════════════════════════════════════ */
async function loadUpdates() {
  const { data, error } = await sb.from('updates_feed').select('*').order('sort_order').order('created_at', { ascending:false });
  if (error) return toast(error.message, 'err');
  const box = document.getElementById('updatesList');
  if (!data || !data.length) { box.innerHTML = '<div class="empty-state"><span class="em-icon">📢</span><h3>No updates yet</h3><p>Add a festival update above.</p></div>'; return; }
  box.innerHTML = data.map(u => `
    <div class="update-card">
      <div class="update-card-body">
        <div class="update-card-date">${esc(u.date_label)||'—'}</div>
        <div class="update-card-title">${esc(u.title)}</div>
        <div class="update-card-text">${esc(u.body)}</div>
      </div>
      <button class="btn-del" onclick="delUpdate(${u.id})">Delete</button>
    </div>`).join('');
}
async function addUpdate(ev) {
  const btn = ev?.target;
  const title = document.getElementById('uTitle').value.trim();
  if (!title) return toast('Title required.', 'err');
  if (btn) { btn.disabled=true; btn.textContent='Adding…'; }
  const { error } = await sb.from('updates_feed').insert({
    date_label: document.getElementById('uDate').value.trim(), title,
    body: document.getElementById('uBody').value.trim()
  });
  if (btn) { btn.disabled=false; btn.textContent='Add update'; }
  if (error) return toast(error.message,'err');
  document.getElementById('uDate').value=''; document.getElementById('uTitle').value=''; document.getElementById('uBody').value='';
  toast('Update added', 'ok'); loadUpdates();
}
async function delUpdate(id) {
  if (window.UI) { if (!await UI.confirm('Delete this update?', { title: 'Delete Update', danger: true })) return; }
  else { if (!confirm('Delete this update?')) return; }
  await sb.from('updates_feed').delete().eq('id', id);
  toast('Deleted', 'ok'); loadUpdates();
}

/* ═══════════════════════════════════════════════════════
   LINKS
════════════════════════════════════════════════════════ */
async function loadLinks() {
  const box = document.getElementById('linksList');
  const { data, error } = await sb.from('submission_links').select('*').order('created_at', { ascending:false }).limit(50);
  if (error) { box.innerHTML = `<p class="muted-note" style="color:#ff7070;">Links table not found — run schema SQL first.</p>`; return; }
  if (!data||!data.length) { box.innerHTML = '<p class="muted-note">No links yet.</p>'; return; }
  const now = new Date();
  box.innerHTML = data.map(lk => {
    const fullUrl = 'https://sharankrishnashortfilmawards.com/submit.html?token=' + encodeURIComponent(lk.token);
    const expired  = lk.expires_at && new Date(lk.expires_at) < now;
    const exhausted = lk.max_uses > 0 && lk.use_count >= lk.max_uses;
    // 4-state status: revoked > used_up > expired > active
    const status = lk.revoked ? 'revoked' : exhausted ? 'used_up' : expired ? 'expired' : 'active';
    const statusLabel = status === 'used_up' ? 'USED UP' : status.toUpperCase();
    // Truncate URL for display: show domain + start of token
    const tokenShort = lk.token.slice(0, 8) + '…';
    const displayUrl = 'sharankrishnashortfilmawards.com/submit.html?token=' + tokenShort;
    return `<div class="link-card">
      <div class="link-card-header">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span class="link-card-label">${esc(lk.label||'(no label)')}</span>
          <span class="badge ${status}">${statusLabel}</span>
        </div>
        <div class="link-card-actions">
          <button class="btn-ghost btn-xs" onclick="copyLink('${esc(fullUrl)}')">Copy</button>
          <button class="btn-ghost btn-xs" onclick="window.open('${esc(fullUrl)}','_blank')">Open ↗</button>
          ${status==='active'?`<button class="btn-del" onclick="revokeLink(${lk.id})">Revoke</button>`:''}
        </div>
      </div>
      <code class="lc-url" title="${esc(fullUrl)}">${esc(displayUrl)}</code>
      <div class="lc-meta">Uses: ${lk.use_count||0}${lk.max_uses>0?' / '+lk.max_uses:' (unlimited)'}
        ${lk.expires_at?' · Expires: '+fmtDateTime(lk.expires_at):' · No expiry'}
        ${lk.note?' · '+esc(lk.note):''}
        · Created: ${fmtDate(lk.created_at)}
      </div>
    </div>`;
  }).join('');
}
async function createLink(ev) {
  const btn = ev?.target;
  const label = document.getElementById('lkLabel').value.trim();
  if (!label) return toast('Label required.', 'err');
  const maxUses = parseInt(document.getElementById('lkMaxUses').value)||0;
  const expiryVal = document.getElementById('lkExpiry').value;
  const note = document.getElementById('lkNote').value.trim();
  let expiry = null;
  if (expiryVal) {
    const expDate = new Date(expiryVal);
    if (isNaN(expDate)) return toast('Invalid expiry date.', 'err');
    if (expDate.getTime() < Date.now() + 5 * 60 * 1000) {
      return toast('Expiry must be at least 5 minutes in the future.', 'err');
    }
    expiry = expDate.toISOString();
  }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  if (btn) { btn.disabled=true; btn.textContent='Creating…'; }
  const { error } = await sb.from('submission_links').insert({ token, label, max_uses:maxUses, expires_at:expiry, note, use_count:0, revoked:false });
  if (btn) { btn.disabled=false; btn.textContent='Generate Link'; }
  if (error) { toast('Error: '+error.message,'err'); return; }
  document.getElementById('lkLabel').value=''; document.getElementById('lkMaxUses').value='0';
  document.getElementById('lkExpiry').value=''; document.getElementById('lkNote').value='';
  toast('Link created', 'ok'); loadLinks();
}
async function revokeLink(id) {
  if (window.UI) { if (!await UI.confirm('Revoke this link? It will stop working immediately.', { title: 'Revoke Link', danger: true })) return; }
  else { if (!confirm('Revoke this link? It will stop working immediately.')) return; }
  const { error } = await sb.from('submission_links').update({ revoked:true }).eq('id', id);
  if (error) return toast(error.message, 'err');
  toast('Link revoked', 'ok'); loadLinks();
}
function copyLink(url) {
  navigator.clipboard.writeText(url).then(() => toast('Link copied', 'ok')).catch(() => { prompt('Copy this link:', url); });
}

/* ═══════════════════════════════════════════════════════
   TESTIMONIALS
════════════════════════════════════════════════════════ */
let _tmtFetchTimer = null;
let _tmtFeaturedSel = null;
let _tmtCategorySel = null;
let _tmtActiveSel = null;
let _videoCatsCache = [];

/* ── VIDEO CATEGORIES ── */
async function loadVideoCategories() {
    const list = document.getElementById('vcList');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--mut);padding:8px 0;">Loading…</p>';
    const { data, error } = await sb.from('video_categories').select('*').order('sort_order');
    if (error) { list.innerHTML = `<p style="color:#e74c3c;">${esc(error.message)}</p>`; return; }
    _videoCatsCache = data || [];
    _tmtInitCategorySelect();
    if (!data || !data.length) { list.innerHTML = '<p style="color:var(--mut);padding:8px 0;">No categories yet.</p>'; return; }
    list.innerHTML = data.map((c, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line2);">
            <span style="font-size:1.2rem;width:28px;text-align:center;">${esc(c.icon || '📁')}</span>
            <span style="flex:1;font-weight:500;">${esc(c.name)}</span>
            <span style="color:var(--mut);font-size:0.78rem;">Order: ${c.sort_order}</span>
            <button class="btn-ghost btn-sm" onclick="vcRename(${c.id},'${esc(c.name).replace(/'/g,"\\'")}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M16.5 3.5l4 4L7 21H3v-4L16.5 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.5"/></svg></button>
            ${i > 0 ? `<button class="btn-ghost btn-sm" onclick="vcMove(${c.id},-1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M7 10l5-5 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
            ${i < data.length-1 ? `<button class="btn-ghost btn-sm" onclick="vcMove(${c.id},1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M7 14l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
            <button class="btn-ghost btn-sm" style="color:#e74c3c;" onclick="vcDelete(${c.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>`).join('');
}

async function vcAdd() {
    const name = document.getElementById('vcNewName').value.trim();
    const icon = document.getElementById('vcNewIcon').value.trim() || '📁';
    if (!name) return toast('Category name required', 'err');
    const { data: existing } = await sb.from('video_categories').select('sort_order').order('sort_order', { ascending: false }).limit(1).single();
    const nextOrder = (existing?.sort_order ?? -1) + 1;
    const { error } = await sb.from('video_categories').insert({ name, icon, sort_order: nextOrder });
    if (error) return toast(error.message, 'err');
    toast('Category added', 'ok');
    document.getElementById('vcNewName').value = '';
    document.getElementById('vcNewIcon').value = '';
    loadVideoCategories();
}

async function vcRename(id, currentName) {
    const newName = prompt('Rename category:', currentName);
    if (!newName || newName.trim() === currentName) return;
    const { error } = await sb.from('video_categories').update({ name: newName.trim() }).eq('id', id);
    if (error) return toast(error.message, 'err');
    toast('Category renamed', 'ok');
    loadVideoCategories();
}

async function vcDelete(id) {
    if (!confirm('Delete this category? Videos in it will become uncategorized.')) return;
    const { error } = await sb.from('video_categories').delete().eq('id', id);
    if (error) return toast(error.message, 'err');
    toast('Category deleted', 'ok');
    loadVideoCategories();
}

async function vcMove(id, direction) {
    const { data: all } = await sb.from('video_categories').select('id,sort_order').order('sort_order');
    if (!all) return;
    const idx = all.findIndex(c => c.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= all.length) return;
    const a = all[idx], b = all[swapIdx];
    await sb.from('video_categories').update({ sort_order: b.sort_order }).eq('id', a.id);
    await sb.from('video_categories').update({ sort_order: a.sort_order }).eq('id', b.id);
    loadVideoCategories();
}

function _extractYouTubeId(url) {
    if (!url) return null;
    const patterns = [
        /[?&]v=([A-Za-z0-9_-]{11})/,
        /youtu\.be\/([A-Za-z0-9_-]{11})/,
        /youtube\.com\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
    return null;
}

async function _fetchYtMeta(videoId) {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) throw new Error(`oEmbed ${res.status}`);
    return await res.json(); // {title, author_name, thumbnail_url, ...}
}

function tmtOnUrlInput(val) {
    clearTimeout(_tmtFetchTimer);
    const stateEl = document.getElementById('tmtFetchState');
    const preview = document.getElementById('tmtPreviewCard');
    const videoIdInput = document.getElementById('tmtEditVideoId');
    const thumbInput   = document.getElementById('tmtEditThumb');
    const channelInput = document.getElementById('tmtEditChannel');
    if (!val.trim()) {
        stateEl.textContent = '';
        preview.style.display = 'none';
        videoIdInput.value = ''; thumbInput.value = ''; channelInput.value = '';
        return;
    }
    const id = _extractYouTubeId(val.trim());
    if (!id) {
        stateEl.style.color = '#e74c3c';
        stateEl.textContent = 'Invalid YouTube URL';
        preview.style.display = 'none';
        videoIdInput.value = '';
        return;
    }
    stateEl.style.color = 'var(--mut)';
    stateEl.textContent = 'Fetching video info…';
    _tmtFetchTimer = setTimeout(async () => {
        try {
            const meta = await _fetchYtMeta(id);
            videoIdInput.value = id;
            thumbInput.value   = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
            channelInput.value = meta.author_name || '';
            document.getElementById('tmtPreviewThumb').src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
            document.getElementById('tmtPreviewTitle').textContent = meta.title || '';
            document.getElementById('tmtPreviewChannel').textContent = meta.author_name ? `Channel: ${meta.author_name}` : '';
            document.getElementById('tmtPreviewId').textContent = `Video ID: ${id}`;
            preview.style.display = '';
            stateEl.style.color = '#27ae60';
            stateEl.textContent = 'Video found ✓';
        } catch {
            stateEl.style.color = '#e74c3c';
            stateEl.textContent = 'Could not fetch video info. Check the URL.';
            preview.style.display = 'none';
            videoIdInput.value = '';
        }
    }, 600);
}

function _tmtInitFeaturedSelect() {
    const wrap = document.getElementById('tmtFeaturedSelect');
    if (wrap && !_tmtFeaturedSel) {
        _tmtFeaturedSel = new CSelect(wrap, [{value:'false',label:'No'},{value:'true',label:'Yes — Featured'}], 'false', () => {});
    }
    const activeWrap = document.getElementById('tmtActiveSelect');
    if (activeWrap && !_tmtActiveSel) {
        _tmtActiveSel = new CSelect(activeWrap, [{value:'true',label:'Active'},{value:'false',label:'Inactive'}], 'true', () => {});
    }
    _tmtInitCategorySelect();
}

function _tmtInitCategorySelect() {
    const wrap = document.getElementById('tmtCategorySelect');
    if (!wrap) return;
    const opts = [{value:'',label:'— No category —'}];
    _videoCatsCache.forEach(c => opts.push({value:String(c.id),label:c.name}));
    if (_tmtCategorySel) {
        const prev = _tmtCategorySel.value;
        wrap.innerHTML = '';
        _tmtCategorySel = new CSelect(wrap, opts, prev, () => {});
    } else {
        _tmtCategorySel = new CSelect(wrap, opts, '', () => {});
    }
}

function tmtCancelEdit() {
    document.getElementById('tmtEditId').value = '';
    document.getElementById('tmtFormTitle').textContent = 'Add Video';
    document.getElementById('tmtCancelEdit').style.display = 'none';
    document.getElementById('tmtUrl').value = '';
    document.getElementById('tmtUrl').disabled = false;
    document.getElementById('tmtFetchState').textContent = '';
    document.getElementById('tmtPreviewCard').style.display = 'none';
    document.getElementById('tmtName').value = '';
    document.getElementById('tmtRole').value = '';
    document.getElementById('tmtYear').value = '';
    document.getElementById('tmtShortText').value = '';
    document.getElementById('tmtEditVideoId').value = '';
    document.getElementById('tmtEditThumb').value = '';
    document.getElementById('tmtEditChannel').value = '';
    var durEl = document.getElementById('tmtDuration');
    if (durEl) durEl.value = '';
    if (_tmtFeaturedSel) { _tmtFeaturedSel.value = 'false'; _tmtFeaturedSel._render(); }
    if (_tmtCategorySel) { _tmtCategorySel.value = ''; _tmtCategorySel._render(); }
    if (_tmtActiveSel) { _tmtActiveSel.value = 'true'; _tmtActiveSel._render(); }
}

async function tmtSave() {
    const editId  = document.getElementById('tmtEditId').value;
    const videoId = document.getElementById('tmtEditVideoId').value;
    const url     = document.getElementById('tmtUrl').value.trim();
    if (!videoId) return toast('Paste a valid YouTube URL and wait for the preview.', 'err');

    const featured = _tmtFeaturedSel ? _tmtFeaturedSel.value === 'true' : false;
    const catVal = _tmtCategorySel ? _tmtCategorySel.value : '';
    const activeVal = _tmtActiveSel ? _tmtActiveSel.value !== 'false' : true;
    const payload = {
        youtube_url:      url,
        youtube_video_id: videoId,
        video_title:      document.getElementById('tmtPreviewTitle').textContent || '',
        thumbnail_url:    document.getElementById('tmtEditThumb').value,
        channel_name:     document.getElementById('tmtEditChannel').value,
        person_name:      document.getElementById('tmtName').value.trim(),
        role:             document.getElementById('tmtRole').value.trim(),
        year:             document.getElementById('tmtYear').value.trim(),
        short_text:       document.getElementById('tmtShortText').value.trim(),
        duration:         document.getElementById('tmtDuration').value.trim(),
        category_id:      catVal ? parseInt(catVal) : null,
        active:           activeVal,
        featured,
        updated_at:       new Date().toISOString(),
    };

    /* If featured, unset others first */
    if (featured) {
        await sb.from('testimonials').update({ featured: false }).neq('id', editId || 0);
    }

    let error;
    if (editId) {
        ({ error } = await sb.from('testimonials').update(payload).eq('id', editId));
    } else {
        const { data: existing } = await sb.from('testimonials').select('display_order').order('display_order', { ascending: false }).limit(1).single();
        payload.display_order = (existing?.display_order ?? -1) + 1;
        ({ error } = await sb.from('testimonials').insert(payload));
    }
    if (error) return toast(error.message, 'err');
    toast(editId ? 'Video updated' : 'Video saved', 'ok');
    tmtCancelEdit();
    loadTestimonials();
}

async function tmtEdit(id) {
    const { data, error } = await sb.from('testimonials').select('*').eq('id', id).single();
    if (error || !data) return toast('Could not load video', 'err');
    document.getElementById('tmtEditId').value   = data.id;
    document.getElementById('tmtFormTitle').textContent = 'Edit Video';
    document.getElementById('tmtCancelEdit').style.display = '';
    document.getElementById('tmtUrl').value   = data.youtube_url;
    document.getElementById('tmtUrl').disabled = false;
    document.getElementById('tmtEditVideoId').value = data.youtube_video_id;
    document.getElementById('tmtEditThumb').value   = data.thumbnail_url;
    document.getElementById('tmtEditChannel').value = data.channel_name;
    document.getElementById('tmtName').value      = data.person_name || '';
    document.getElementById('tmtRole').value      = data.role || '';
    document.getElementById('tmtYear').value      = data.year || '';
    document.getElementById('tmtShortText').value = data.short_text || '';
    var durEl = document.getElementById('tmtDuration');
    if (durEl) durEl.value = data.duration || '';
    const preview = document.getElementById('tmtPreviewCard');
    document.getElementById('tmtPreviewThumb').src     = data.thumbnail_url;
    document.getElementById('tmtPreviewTitle').textContent   = data.video_title;
    document.getElementById('tmtPreviewChannel').textContent = data.channel_name ? `Channel: ${data.channel_name}` : '';
    document.getElementById('tmtPreviewId').textContent      = `Video ID: ${data.youtube_video_id}`;
    preview.style.display = '';
    document.getElementById('tmtFetchState').style.color = '#27ae60';
    document.getElementById('tmtFetchState').textContent = 'Video found ✓';
    if (_tmtFeaturedSel) { _tmtFeaturedSel.value = data.featured ? 'true' : 'false'; _tmtFeaturedSel._render(); }
    if (_tmtCategorySel) { _tmtCategorySel.value = data.category_id ? String(data.category_id) : ''; _tmtCategorySel._render(); }
    if (_tmtActiveSel) { _tmtActiveSel.value = data.active === false ? 'false' : 'true'; _tmtActiveSel._render(); }
    document.getElementById('tmtFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let _tmtPendingDeleteId = null;
function tmtConfirmDelete(id) {
    _tmtPendingDeleteId = id;
    document.getElementById('tmtDelModal').classList.remove('hidden');
    document.getElementById('tmtDelConfirmBtn').onclick = tmtDoDelete;
}
function tmtDelModalClose() {
    _tmtPendingDeleteId = null;
    document.getElementById('tmtDelModal').classList.add('hidden');
}
async function tmtDoDelete() {
    if (!_tmtPendingDeleteId) return;
    const { error } = await sb.from('testimonials').delete().eq('id', _tmtPendingDeleteId);
    tmtDelModalClose();
    if (error) return toast(error.message, 'err');
    toast('Video deleted', 'ok');
    loadTestimonials();
}

async function tmtSetFeatured(id) {
    await sb.from('testimonials').update({ featured: false }).neq('id', id);
    const { error } = await sb.from('testimonials').update({ featured: true }).eq('id', id);
    if (error) return toast(error.message, 'err');
    toast('Featured video set', 'ok');
    loadTestimonials();
}

async function tmtMove(id, direction) {
    const { data: all } = await sb.from('testimonials').select('id,display_order').order('display_order');
    if (!all) return;
    const idx = all.findIndex(t => t.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= all.length) return;
    const a = all[idx], b = all[swapIdx];
    const aOrder = a.display_order, bOrder = b.display_order;
    await sb.from('testimonials').update({ display_order: bOrder }).eq('id', a.id);
    await sb.from('testimonials').update({ display_order: aOrder }).eq('id', b.id);
    loadTestimonials();
}

async function loadTestimonials() {
    _tmtInitFeaturedSelect();
    const list = document.getElementById('tmtList');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--mut);padding:12px 0;">Loading…</p>';
    const { data, error } = await sb.from('testimonials').select('*').order('display_order').order('created_at');
    if (error) { list.innerHTML = `<p style="color:#e74c3c;">${esc(error.message)}</p>`; return; }
    if (!data || !data.length) { list.innerHTML = '<p style="color:var(--mut);padding:12px 0;">No videos yet.</p>'; return; }
    const catMap = {};
    _videoCatsCache.forEach(c => { catMap[c.id] = c.name; });
    list.innerHTML = data.map((t, i) => {
        const catLabel = t.category_id && catMap[t.category_id] ? catMap[t.category_id] : '';
        const isActive = t.active !== false;
        return `
        <div class="tmt-admin-card" style="${!isActive ? 'opacity:0.5;' : ''}">
            <img class="tmt-admin-thumb" src="${esc(t.thumbnail_url)}" alt="${esc(t.video_title)}" onerror="this.style.opacity='0.3'">
            <div class="tmt-admin-info">
                <div class="tmt-admin-title" title="${esc(t.video_title)}">${esc(t.video_title)}</div>
                <div class="tmt-admin-meta">
                    ${t.person_name ? `${esc(t.person_name)}${t.role ? ' · ' + esc(t.role) : ''}` : '—'}
                    ${catLabel ? ` · <span style="color:rgba(255,255,255,0.55);">${esc(catLabel)}</span>` : ''}
                    ${t.duration ? ` · ${esc(t.duration)}` : ''}
                    ${t.featured ? '<span class="pill-featured" style="margin-left:8px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;margin-right:2px;"><path d="M12 2l2.4 4.8 5.3.8-3.85 3.7.9 5.3L12 14.1l-4.75 2.5.9-5.3L4.3 7.6l5.3-.8L12 2z"/></svg>Featured</span>' : ''}
                    ${!isActive ? '<span style="margin-left:8px;color:#e74c3c;font-size:0.75rem;">INACTIVE</span>' : ''}
                    &nbsp;·&nbsp; Order: ${t.display_order}
                </div>
                <div class="tmt-admin-actions">
                    <button class="btn-ghost btn-sm" onclick="tmtEdit(${t.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px;"><path d="M16.5 3.5l4 4L7 21H3v-4L16.5 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Edit</button>
                    ${!t.featured ? `<button class="btn-ghost btn-sm" onclick="tmtSetFeatured(${t.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px;"><path d="M12 2l2.4 4.8 5.3.8-3.85 3.7.9 5.3L12 14.1l-4.75 2.5.9-5.3L4.3 7.6l5.3-.8L12 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Featured</button>` : ''}
                    <button class="btn-ghost btn-sm" onclick="tmtToggleActive(${t.id},${isActive})">${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px;"><rect x="6" y="4" width="4" height="16" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="4" width="4" height="16" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>Deactivate' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px;"><path d="M6 4l14 8-14 8V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Activate'}</button>
                    ${i > 0 ? `<button class="btn-ghost btn-sm" onclick="tmtMove(${t.id},-1)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;"><path d="M12 5v14M7 10l5-5 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
                    ${i < data.length-1 ? `<button class="btn-ghost btn-sm" onclick="tmtMove(${t.id},1)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;"><path d="M12 19V5M7 14l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
                    <a class="btn-ghost btn-sm" href="https://www.youtube.com/watch?v=${esc(t.youtube_video_id)}" target="_blank" rel="noopener"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px;"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 8.5l6 3.5-6 3.5v-7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>YouTube</a>
                    <button class="btn-ghost btn-sm" style="color:#e74c3c;" onclick="tmtConfirmDelete(${t.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px;"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Delete</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

async function tmtToggleActive(id, currentlyActive) {
    const { error } = await sb.from('testimonials').update({ active: !currentlyActive }).eq('id', id);
    if (error) return toast(error.message, 'err');
    toast(currentlyActive ? 'Video deactivated' : 'Video activated', 'ok');
    loadTestimonials();
}

/* ═══════════════════════════════════════════════════════
   ADMIN REALTIME — live updates without refresh
════════════════════════════════════════════════════════ */
let _adminRtInit = false;
function _initAdminRealtime() {
  if (_adminRtInit) return;
  _adminRtInit = true;
  let _rtDebounce = {};
  function debounced(key, fn, delay) {
    clearTimeout(_rtDebounce[key]);
    _rtDebounce[key] = setTimeout(fn, delay || 400);
  }

  sb.channel('admin_live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'film_entries' }, (payload) => {
      const row = payload.new;
      const isPaid = row && (row.payment_status || '').toUpperCase() === 'PAID' && !row.archived;
      if (payload.eventType === 'INSERT' && isPaid) {
        _allEntries.unshift(row);
        debounced('entries', () => {
          updatePaidCounters();
          applyFilters();
          toast('New film entry: ' + (row.film_name || 'unknown'), 'ok');
        }, 300);
      } else if (payload.eventType === 'UPDATE') {
        const idx = _allEntries.findIndex(e => e.id === row.id);
        if (row.archived || (row.payment_status || '').toUpperCase() !== 'PAID') {
          if (idx >= 0) _allEntries.splice(idx, 1);
        } else if (idx >= 0) {
          _allEntries[idx] = { ..._allEntries[idx], ...row };
        } else if (isPaid) {
          _allEntries.unshift(row);
        }
        debounced('entries', () => { updatePaidCounters(); applyFilters(); }, 300);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submission_links' }, () => {
      debounced('links', loadLinks, 500);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'site_config', filter: 'id=eq.1' }, (payload) => {
      if (payload.new) applyConfig(payload.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gallery' }, () => {
      debounced('gallery', loadGallery, 500);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'updates_feed' }, () => {
      debounced('updates', loadUpdates, 400);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'testimonials' }, () => {
      debounced('videos', () => { if (document.getElementById('tab-videos')?.classList.contains('active')) loadTestimonials(); }, 500);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'video_categories' }, () => {
      debounced('videocats', () => { if (document.getElementById('tab-videos')?.classList.contains('active')) loadVideoCategories(); }, 500);
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Admin realtime issue:', status);
      }
    });

  // Re-sync on tab visibility
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      debounced('resync', () => {
        Promise.allSettled([loadConfig(), loadEntries(), loadLinks(), loadGallery(), loadUpdates(), loadVideoCategories()]);
      }, 1500);
    }
  });
}

/* ═══════════════════════════════════════════════════════
   BOOTSTRAP
════════════════════════════════════════════════════════ */
gate();