/* Event Budget — one app for two doors:
     /admin/budget/          data-mode="admin"  → Supabase admin session + public.is_admin()
     /budget/share/#<token>  data-mode="share"  → share-link token (viewer | editor), no account
   Every read/write goes through SECURITY DEFINER RPCs (budget_load / budget_save_item / budget_admin_*)
   that re-check access on each call. Live updates: a content-free broadcast on topic "budget-<id>"
   tells every open screen to re-fetch. Nothing here is a source of truth — the database is. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://flwlbraeyyrofkhxnvwt.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2xicmFleXlyb2ZraHhudnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDQzNDEsImV4cCI6MjEwNDM4MDM0MX0.0apM1gnHcYzTSLs0wTfi1fgaNCf0RKbeginWPXg5EbY';
  var RECEIPT_FN = SUPABASE_URL + '/functions/v1/budget-receipt';
  var MODE = document.body.getAttribute('data-mode') === 'share' ? 'share' : 'admin';
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, MODE === 'share'
    ? { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    : {});

  var STATUS = [['planned', 'Planned'], ['pending', 'Pending'], ['partially_paid', 'Partially Paid'], ['paid', 'Paid']];
  var STATUS_LABEL = {}; STATUS.forEach(function (s) { STATUS_LABEL[s[0]] = s[1]; });
  var RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

  var S = {
    token: null, passcode: '', name: '', role: null, budget: null, items: [], categories: [], link: null,
    q: '', cat: '', status: '', lastSync: 0, live: false, offline: false, saving: 0, savedAt: 0, saveError: '',
    channel: null, loading: false, again: false, timer: null, shell: false, versions: null, linkTokens: {}
  };
  var app = document.getElementById('budApp');

  /* ───────── helpers ───────── */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cents(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; }
  function inr(v) {
    var n = Number(v) || 0, frac = Math.abs(Math.round(n * 100)) % 100 !== 0;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  }
  function num(v) { return (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function qtyText(v) { var n = Number(v) || 0; return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, ''); }
  function lineTotal(q, p) { return Math.round(cents(q) * cents(p) / 100) / 100; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function rel(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 10) return 'just now'; if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago'; return Math.round(s / 3600) + ' h ago';
  }
  function fmtDate(d, withTime) {
    if (!d) return '';
    var x = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
    return x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
      (withTime ? ', ' + x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
  }
  function initials(s) {
    var w = String(s || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '').slice(1, 2))).toUpperCase();
  }
  function canWrite() { return S.role === 'admin' || S.role === 'editor'; }
  function isAdmin() { return S.role === 'admin'; }
  function toast(msg, type) { if (window.UI && UI.toast) UI.toast(esc(msg), type || 'success'); }   // UI.toast renders HTML
  function access() {
    return MODE === 'share' ? { p_token: S.token, p_passcode: S.passcode || null }
      : { p_budget: S.budget ? S.budget.id : null };
  }
  async function rpc(name, args) {
    var res = await sb.rpc(name, args || {});
    if (res.error) throw res.error;
    return res.data;
  }
  var ERR = {
    read_only: 'This link is view only.', not_authorized: 'You are not signed in as an admin.',
    conflict: 'Someone else changed this expense.', not_found: 'This expense no longer exists.',
    link_revoked: 'This link was turned off.', link_expired: 'This link has expired.', link_invalid: 'This link is not valid.'
  };
  function errText(r) { return (r && (r.message || ERR[r.error])) || 'Something went wrong. Please try again.'; }
  function isAccessError(code) {
    return ['link_revoked', 'link_expired', 'link_invalid', 'passcode_required', 'passcode_wrong', 'locked', 'not_authorized'].indexOf(code) !== -1;
  }

  var I = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    history: '<path d="M4 12a8 8 0 102.3-5.6"/><path d="M4 4.5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
    receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    link: '<path d="M10 14a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1.5-1.5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    pencil: '<path d="M4 20l1-4.2L15.8 5a2 2 0 012.8 0l.4.4a2 2 0 010 2.8L8.2 19z"/><path d="M14 7l3 3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    chev: '<path d="M7 10l5 5 5-5"/>',
    wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 9.5h17M15.5 14h2"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    clip: '<path d="M19 11.5l-7.4 7.4a4.6 4.6 0 01-6.5-6.5l8-8a3 3 0 014.3 4.3l-7.9 7.9a1.5 1.5 0 01-2.1-2.1l7-7"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>'
  };
  function icon(n, cls) {
    return '<svg class="bud-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + '</svg>';
  }
  var LOGO = '<img class="bud-logo" src="/assets/img/logo-377.webp" srcset="/assets/img/logo-189.webp 189w, /assets/img/logo-377.webp 377w, /assets/img/logo-566.webp 566w" sizes="150px" width="377" height="112" alt="Sharankrishna Short Film Awards">';

  /* ───────── totals ───────── */
  function totals(list) {
    var t = 0, p = 0;
    (list || S.items).forEach(function (i) { t += cents(i.line_total); p += cents(i.amount_paid); });
    return { total: t / 100, paid: p / 100, outstanding: (t - p) / 100 };
  }
  function byCategory() {
    var m = {};
    S.items.forEach(function (i) {
      var k = i.category; m[k] = m[k] || { name: k, total: 0, paid: 0, count: 0 };
      m[k].total += cents(i.line_total); m[k].paid += cents(i.amount_paid); m[k].count++;
    });
    return Object.keys(m).map(function (k) { var c = m[k]; c.total /= 100; c.paid /= 100; return c; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  function filtered() {
    var q = S.q.trim().toLowerCase();
    return S.items.filter(function (i) {
      if (S.cat && i.category !== S.cat) return false;
      if (S.status && i.status !== S.status) return false;
      if (q && (i.title + ' ' + i.category + ' ' + (i.vendor || '') + ' ' + (i.notes || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }

  /* ───────── data loading + live sync ───────── */
  async function load() {
    if (S.loading) { S.again = true; return; }
    S.loading = true;
    try {
      var d = await rpc('budget_load', access());
      if (!d || !d.ok) { handleAccessError(d ? d.error : 'unknown'); return; }
      var prev = S.versions;
      S.role = d.role; S.budget = d.budget; S.items = d.items || []; S.categories = d.categories || []; S.link = d.link;
      S.lastSync = Date.now(); S.offline = false;
      S.versions = {}; S.items.forEach(function (i) { S.versions[i.id] = i.version; });
      if (!S.shell) renderShell();
      renderAll(prev);
      subscribe();
      if (MODE === 'share' && S.role === 'editor' && !S.nameAsked) askName();
    } catch (e) {
      S.offline = true;
      if (!S.shell) errorPage('network'); else renderSync();
    } finally {
      S.loading = false;
      if (S.again) { S.again = false; reload(200); }
    }
  }
  function reload(ms) { clearTimeout(S.timer); S.timer = setTimeout(load, ms == null ? 300 : ms); }
  function subscribe() {
    if (S.channel || !S.budget) return;
    S.channel = sb.channel('budget-' + S.budget.id)
      .on('broadcast', { event: 'changed' }, function () { reload(150); })
      .subscribe(function (st) { S.live = st === 'SUBSCRIBED'; renderSync(); if (st === 'SUBSCRIBED') reload(0); });
  }
  function teardown() {
    if (S.channel) { try { sb.removeChannel(S.channel); } catch (e) {} S.channel = null; }
    S.shell = false;
    document.querySelectorAll('.bud-ov').forEach(function (o) { o.remove(); });
    document.body.classList.remove('bud-lock');
  }
  setInterval(function () { if (S.shell && !document.hidden) load(); }, 30000);
  setInterval(function () { if (S.shell) renderSync(); }, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.shell) reload(0); });
  window.addEventListener('online', function () { if (S.shell) reload(0); });

  function handleAccessError(code) {
    if (MODE === 'admin') {
      teardown();
      if (code === 'not_authorized') return loginView('Sign in with an admin account to open the budget.');
      return errorPage(code === 'no_budget' ? 'no_budget' : 'network');
    }
    teardown();
    if (code === 'passcode_required' || code === 'passcode_wrong') return passcodeView(code === 'passcode_wrong');
    return errorPage(code);
  }

  /* ───────── sync indicator ───────── */
  function renderSync() {
    var el = document.getElementById('budSync'); if (!el) return;
    var cls = 'ok', txt;
    if (S.saving > 0) { cls = 'busy'; txt = 'Saving…'; }
    else if (S.saveError) { cls = 'bad'; txt = S.saveError; }
    else if (S.offline) { cls = 'bad'; txt = 'Offline · retrying'; }
    else if (S.savedAt && Date.now() - S.savedAt < 4000) { txt = 'Changes saved'; }
    else txt = (S.live ? 'Live · ' : '') + 'Updated ' + rel(S.lastSync);
    el.className = 'bud-sync is-' + cls + (S.live ? ' is-live' : '');
    el.innerHTML = '<i></i><span>' + esc(txt) + '</span>';
  }
  function saving(on, err) {
    S.saving = Math.max(0, S.saving + (on ? 1 : -1));
    if (!on) { S.saveError = err || ''; if (!err) S.savedAt = Date.now(); setTimeout(renderSync, 4100); }
    renderSync();
  }

  /* ───────── shell ───────── */
  function renderShell() {
    S.shell = true;
    var admin = isAdmin();
    app.innerHTML =
      '<div class="bud-wrap">' +
      '<header class="bud-head">' +
        (admin ? '<a class="bud-logo-link" href="/admin.html" aria-label="Back to Admin Panel">' + LOGO + '</a>' : '<a class="bud-logo-link" href="/" aria-label="Sharankrishna Short Film Awards">' + LOGO + '</a>') +
        '<div class="bud-head-actions">' +
          '<span id="budSync" class="bud-sync"></span>' +
          (MODE === 'share' && S.role === 'editor' ? '<button type="button" class="bud-btn ghost sm" data-act="name" id="budNameBtn"></button>' : '') +
          (admin ? '<button type="button" class="bud-btn ghost" data-act="activity">' + icon('history') + '<span>History</span></button>' : '') +
          '<button type="button" class="bud-btn ghost" data-act="export">' + icon('download') + '<span>Export</span></button>' +
          (admin ? '<button type="button" class="bud-btn primary" data-act="share">' + icon('share') + '<span>Share</span></button>' : '') +
          (admin ? '<a class="bud-btn ghost" href="/admin.html">' + icon('back') + '<span>Admin</span></a>' : '') +
        '</div>' +
      '</header>' +
      '<section class="bud-hero">' +
        '<div class="bud-eyebrow">Sharankrishna Awards</div>' +
        '<h1>Event Budget</h1>' +
        '<div class="bud-sub" id="budSub"></div>' +
      '</section>' +
      '<section class="bud-cards" id="budCards" aria-label="Budget summary"></section>' +
      '<div class="bud-grid">' +
        '<section class="bud-items" aria-label="Expense items">' +
          '<div class="bud-sec-head"><h2>Expense items</h2><span id="budCount" class="bud-muted"></span></div>' +
          '<div class="bud-toolbar">' +
            '<label class="bud-search">' + icon('search') + '<input id="budQ" type="search" placeholder="Search expenses, categories, vendors" autocomplete="off" enterkeyhint="search"></label>' +
            '<div class="bud-dd" id="budCatDd"></div>' +
            '<div class="bud-dd" id="budStatusDd"></div>' +
            (canWrite() ? '<button type="button" class="bud-btn primary bud-add" data-act="add">' + icon('plus') + '<span>Add Expense</span></button>' : '') +
          '</div>' +
          '<div id="budFilterNote" class="bud-filter-note"></div>' +
          '<div class="bud-list" id="budList"></div>' +
        '</section>' +
        '<aside class="bud-side">' +
          '<div class="bud-panel"><div class="bud-panel-head"><h3>Category breakdown</h3>' +
            (admin ? '<button type="button" class="bud-link" data-act="cats">Manage</button>' : '') + '</div>' +
          '<div id="budBreak"></div></div>' +
          (MODE === 'share' ? '<div class="bud-panel bud-access" id="budAccess"></div>' : '') +
        '</aside>' +
      '</div>' +
      '<footer class="bud-foot">Sharankrishna Short Film Awards · Internal event budget' + (MODE === 'share' ? ' · Shared link' : '') + '</footer>' +
      '</div>' +
      '<div class="bud-totalbar" id="budTotalbar" role="status" aria-live="polite"></div>';

    var q = document.getElementById('budQ');
    q.value = S.q;
    q.addEventListener('input', function () { S.q = q.value; renderList(); });
    app.addEventListener('click', onAppClick);
  }

  function renderAll(prev) {
    renderSub(); renderCards(); renderFilters(); renderList(prev); renderBreakdown(); renderTotalbar(); renderSync(); renderAccess();
    var nb = document.getElementById('budNameBtn');
    if (nb) nb.innerHTML = icon('user') + '<span>' + esc(S.name || 'Add your name') + '</span>';
  }
  function renderSub() {
    var badge = S.role === 'admin' ? 'Administrator' : S.role === 'editor' ? 'Can edit' : 'View only';
    document.getElementById('budSub').innerHTML =
      '<span>' + esc(S.budget.title) + '</span>' +
      '<span class="bud-role is-' + esc(S.role) + '">' + icon(S.role === 'viewer' ? 'eye' : S.role === 'editor' ? 'pencil' : 'lock') + esc(badge) + '</span>';
  }
  function renderCards() {
    var t = totals(), alloc = S.budget.allocated_budget == null ? null : Number(S.budget.allocated_budget);
    var paidPct = t.total > 0 ? Math.min(100, t.paid / t.total * 100) : 0;
    var html =
      '<article class="bud-card is-hero"><div class="bud-card-label">' + icon('wallet') + 'Grand Total</div>' +
        '<div class="bud-card-val" data-val>' + inr(t.total) + '</div>' +
        '<div class="bud-card-sub">' + S.items.length + (S.items.length === 1 ? ' expense item' : ' expense items') + '</div></article>' +
      '<article class="bud-card"><div class="bud-card-label">' + icon('check') + 'Paid</div>' +
        '<div class="bud-card-val">' + inr(t.paid) + '</div>' +
        '<div class="bud-meter"><i style="width:' + paidPct.toFixed(1) + '%"></i></div>' +
        '<div class="bud-card-sub">' + Math.round(paidPct) + '% of total paid</div></article>' +
      '<article class="bud-card"><div class="bud-card-label">' + icon('clock') + 'Outstanding</div>' +
        '<div class="bud-card-val">' + inr(t.outstanding) + '</div>' +
        '<div class="bud-card-sub">' + S.items.filter(function (i) { return i.status !== 'paid'; }).length + ' still to pay</div></article>';
    if (alloc != null) {
      var bal = alloc - t.total, used = alloc > 0 ? t.total / alloc * 100 : (t.total > 0 ? 100 : 0), over = bal < 0;
      html += '<article class="bud-card' + (over ? ' is-over' : '') + (isAdmin() ? ' is-click' : '') + '"' + (isAdmin() ? ' data-act="budget" tabindex="0" role="button"' : '') + '>' +
        '<div class="bud-card-label">' + icon('filter') + 'Budget balance</div>' +
        '<div class="bud-card-val">' + (over ? '−' : '') + inr(Math.abs(bal)) + '</div>' +
        '<div class="bud-meter' + (over ? ' is-over' : '') + '"><i style="width:' + Math.min(100, used).toFixed(1) + '%"></i></div>' +
        '<div class="bud-card-sub">' + (over ? 'Over' : 'Under') + ' budget · ' + inr(alloc) + ' allocated</div></article>';
    } else if (isAdmin()) {
      html += '<button type="button" class="bud-card is-empty" data-act="budget">' + icon('plus') +
        '<span><strong>Set an overall budget</strong><small>See if the event is under or over budget</small></span></button>';
    }
    var cards = document.getElementById('budCards');
    cards.className = 'bud-cards n' + (alloc != null || isAdmin() ? 4 : 3) + (S.cardsShown ? '' : ' first');
    S.cardsShown = true;
    cards.innerHTML = html;
  }
  function renderTotalbar() {
    var t = totals();
    document.getElementById('budTotalbar').innerHTML =
      '<div class="bud-totalbar-in"><span class="bud-tb-label">Grand Total</span><strong class="bud-tb-val">' + inr(t.total) + '</strong>' +
      '<span class="bud-tb-meta"><span>Paid <b>' + inr(t.paid) + '</b></span><span>Outstanding <b>' + inr(t.outstanding) + '</b></span></span></div>';
  }
  function renderFilters() {
    var cats = S.categories.map(function (c) { return c.name; });
    S.items.forEach(function (i) { if (cats.indexOf(i.category) === -1) cats.push(i.category); });
    if (S.cat && cats.indexOf(S.cat) === -1) S.cat = '';
    dropdown(document.getElementById('budCatDd'), {
      value: S.cat, placeholder: 'All categories', icon: 'filter', searchable: cats.length > 8,
      options: [{ value: '', label: 'All categories' }].concat(cats.map(function (c) { return { value: c, label: c }; })),
      onChange: function (v) { S.cat = v; renderList(); renderBreakdown(); }
    });
    dropdown(document.getElementById('budStatusDd'), {
      value: S.status, placeholder: 'All statuses',
      options: [{ value: '', label: 'All statuses' }].concat(STATUS.map(function (s) { return { value: s[0], label: s[1] }; })),
      onChange: function (v) { S.status = v; renderList(); }
    });
  }
  function renderList(prev) {
    var list = filtered(), box = document.getElementById('budList');
    document.getElementById('budCount').textContent = S.items.length ? S.items.length + ' total' : '';
    var note = document.getElementById('budFilterNote');
    var filtering = S.q.trim() || S.cat || S.status;
    note.innerHTML = filtering && S.items.length
      ? '<span>Showing ' + list.length + ' of ' + S.items.length + ' · <b>' + inr(totals(list).total) + '</b></span><button type="button" class="bud-link" data-act="clear">Clear filters</button>' : '';
    if (!S.items.length) {
      box.innerHTML = '<div class="bud-empty">' + icon('receipt', 'lg') + '<h3>No expenses yet</h3><p>' +
        (canWrite() ? 'Add the first expense — LED wall, stage, refreshments, trophies…' : 'Expenses will appear here as soon as the team adds them.') + '</p>' +
        (canWrite() ? '<button type="button" class="bud-btn primary" data-act="add">' + icon('plus') + '<span>Add Expense</span></button>' : '') + '</div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="bud-empty sm"><h3>No matching expenses</h3><p>Try another search or filter.</p><button type="button" class="bud-btn ghost" data-act="clear">Clear filters</button></div>';
      return;
    }
    box.classList.toggle('first', !S.listShown); S.listShown = true;
    box.innerHTML = list.map(function (i) {
      var changed = prev && (prev[i.id] == null || prev[i.id] !== i.version);
      var meta = ['<span>' + esc(i.category) + '</span>'];
      if (i.vendor) meta.push('<span>' + esc(i.vendor) + '</span>');
      meta.push('<span>' + qtyText(i.quantity) + ' × ' + inr(i.unit_price) + '</span>');
      if (i.has_receipt) meta.push('<span class="bud-has-rc" title="Receipt attached">' + icon('clip') + '</span>');
      var paidLine = i.status === 'paid' ? 'Paid in full' : cents(i.amount_paid) > 0 ? inr(i.amount_paid) + ' paid' : (i.status === 'pending' ? 'Payment due' : 'Not paid yet');
      return '<article class="bud-row' + (changed ? ' is-flash' : '') + '" data-id="' + esc(i.id) + '" tabindex="0">' +
        '<div class="bud-mono" aria-hidden="true">' + esc(initials(i.category)) + '</div>' +
        '<div class="bud-row-main"><div class="bud-row-title">' + esc(i.title) + '</div><div class="bud-row-meta">' + meta.join('') + '</div></div>' +
        (canWrite()
          ? '<button type="button" class="bud-chip s-' + esc(i.status) + '" data-act="status" aria-label="Change payment status">' + esc(STATUS_LABEL[i.status]) + icon('chev') + '</button>'
          : '<span class="bud-chip s-' + esc(i.status) + '">' + esc(STATUS_LABEL[i.status]) + '</span>') +
        '<div class="bud-row-amt"><strong>' + inr(i.line_total) + '</strong><small>' + esc(paidLine) + '</small></div>' +
      '</article>';
    }).join('');
  }
  function renderBreakdown() {
    var cats = byCategory(), box = document.getElementById('budBreak'), total = totals().total;
    if (!cats.length) { box.innerHTML = '<p class="bud-muted sm">Totals per category show up here once expenses are added.</p>'; return; }
    var max = cats[0].total || 1;
    box.innerHTML = '<ul class="bud-break">' + cats.map(function (c) {
      var pct = total > 0 ? c.total / total * 100 : 0;
      return '<li><button type="button" class="bud-break-row' + (S.cat === c.name ? ' is-on' : '') + '" data-act="catfilter" data-cat="' + esc(c.name) + '">' +
        '<span class="bud-break-top"><span class="bud-break-name">' + esc(c.name) + '</span><span class="bud-break-amt">' + inr(c.total) + '</span></span>' +
        '<span class="bud-meter thin"><i style="width:' + (c.total / max * 100).toFixed(1) + '%"></i></span>' +
        '<span class="bud-break-meta">' + c.count + (c.count === 1 ? ' item' : ' items') + ' · ' + pct.toFixed(pct < 10 ? 1 : 0) + '% · ' + inr(c.paid) + ' paid</span>' +
        '</button></li>';
    }).join('') + '</ul>';
  }
  function renderAccess() {
    var box = document.getElementById('budAccess'); if (!box) return;
    var exp = S.link && S.link.expires_at ? 'Access until ' + fmtDate(S.link.expires_at, true) : 'No expiry set';
    box.innerHTML = '<div class="bud-panel-head"><h3>Your access</h3></div>' +
      '<p class="bud-access-role">' + icon(S.role === 'editor' ? 'pencil' : 'eye') +
      (S.role === 'editor' ? 'You can add expenses and update payments.' : 'You can view this budget. Editing is turned off for this link.') + '</p>' +
      '<p class="bud-muted sm">' + icon('clock') + esc(exp) + '</p>' +
      '<p class="bud-muted sm">Changes from the team appear here automatically.</p>';
  }

  /* ───────── clicks ───────── */
  function onAppClick(e) {
    var a = e.target.closest('[data-act]');
    var row = e.target.closest('.bud-row');
    if (a) {
      var act = a.getAttribute('data-act');
      if (act === 'add') return openExpense(null);
      if (act === 'share') return openShare();
      if (act === 'activity') return openActivity();
      if (act === 'export') return exportMenu(a);
      if (act === 'budget') return openBudgetSettings();
      if (act === 'cats') return openCategories();
      if (act === 'name') return askName(true);
      if (act === 'clear') { S.q = ''; S.cat = ''; S.status = ''; document.getElementById('budQ').value = ''; renderFilters(); renderList(); renderBreakdown(); return; }
      if (act === 'catfilter') { var c = a.getAttribute('data-cat'); S.cat = S.cat === c ? '' : c; renderFilters(); renderList(); renderBreakdown(); return; }
      if (act === 'status' && row) { e.stopPropagation(); return statusMenu(a, itemById(row.getAttribute('data-id'))); }
    }
    if (row) openExpense(itemById(row.getAttribute('data-id')));
  }
  app.addEventListener('keydown', function (e) {
    var row = e.target.closest && e.target.closest('.bud-row');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openExpense(itemById(row.getAttribute('data-id'))); }
    var card = e.target.closest && e.target.closest('.bud-card.is-click');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openBudgetSettings(); }
  });
  function itemById(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
  function upsertLocal(item) {
    var found = false;
    S.items = S.items.map(function (i) { if (i.id === item.id) { found = true; return item; } return i; });
    if (!found) S.items.push(item);
    if (S.categories.every(function (c) { return c.name !== item.category; })) S.categories.push({ id: null, name: item.category });
    S.versions = S.versions || {}; S.versions[item.id] = item.version;
    renderAll();
  }

  /* ───────── small UI kit: popover, dropdown, modal ───────── */
  var openPop = null;
  function closePop() { if (openPop) { openPop.el.remove(); openPop.anchor.setAttribute('aria-expanded', 'false'); openPop = null; } }
  document.addEventListener('mousedown', function (e) { if (openPop && !openPop.el.contains(e.target) && !openPop.anchor.contains(e.target)) closePop(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openPop) { var a = openPop.anchor; closePop(); a.focus(); } });
  window.addEventListener('resize', closePop);
  function popover(anchor, html, opts) {
    if (openPop && openPop.anchor === anchor) { closePop(); return null; }
    closePop();
    var el = document.createElement('div');
    el.className = 'bud-pop ' + ((opts && opts.cls) || '');
    el.innerHTML = html;
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect(), w = Math.max(r.width, (opts && opts.minWidth) || 200);
    el.style.minWidth = w + 'px';
    var left = Math.min(Math.max(12, r.left), window.innerWidth - el.offsetWidth - 12);
    var top = r.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight - 12 && r.top - el.offsetHeight - 6 > 12) top = r.top - el.offsetHeight - 6;
    el.style.left = left + 'px'; el.style.top = Math.max(12, top) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    openPop = { el: el, anchor: anchor };
    requestAnimationFrame(function () { el.classList.add('in'); });
    return el;
  }
  function dropdown(host, o) {
    var cur = o.options.filter(function (x) { return x.value === o.value; })[0];
    host.innerHTML = '<button type="button" class="bud-dd-btn' + (o.value ? ' is-set' : '') + '" aria-haspopup="listbox" aria-expanded="false">' +
      (o.icon ? icon(o.icon) : '') + '<span>' + esc(cur ? cur.label : (o.value || o.placeholder)) + '</span>' + icon('chev', 'dd-chev') + '</button>';
    var btn = host.firstChild;
    btn.onclick = function () {
      var pop = popover(btn,
        (o.searchable || o.onCreate ? '<div class="bud-pop-search">' + icon('search') + '<input type="text" placeholder="' + (o.onCreate ? 'Search or add new' : 'Search') + '" maxlength="60"></div>' : '') +
        '<div class="bud-pop-list" role="listbox"></div>', { minWidth: 220, cls: 'is-dd' });
      if (!pop) return;
      var list = pop.querySelector('.bud-pop-list'), inp = pop.querySelector('input');
      function draw() {
        var q = inp ? inp.value.trim().toLowerCase() : '';
        var opts = o.options.filter(function (x) { return !q || x.label.toLowerCase().indexOf(q) !== -1; });
        var exact = o.options.some(function (x) { return x.label.toLowerCase() === q; });
        list.innerHTML = opts.map(function (x) {
          return '<button type="button" role="option" class="bud-pop-item' + (x.value === o.value ? ' is-on' : '') + '" data-v="' + esc(x.value) + '">' +
            '<span>' + esc(x.label) + '</span>' + (x.value === o.value ? icon('check') : '') + '</button>';
        }).join('') +
          (o.onCreate && q && !exact ? '<button type="button" class="bud-pop-item is-new" data-new="1">' + icon('plus') + '<span>Add “' + esc(inp.value.trim()) + '”</span></button>' : '') +
          (!opts.length && !(o.onCreate && q) ? '<div class="bud-pop-empty">No matches</div>' : '');
      }
      draw();
      if (inp) { inp.addEventListener('input', draw); setTimeout(function () { inp.focus(); }, 30);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var f = list.querySelector('.bud-pop-item'); if (f) f.click(); } }); }
      list.addEventListener('click', function (e) {
        var it = e.target.closest('.bud-pop-item'); if (!it) return;
        if (it.getAttribute('data-new')) { var nv = inp.value.trim(); closePop(); o.onCreate(nv); return; }
        var v = it.getAttribute('data-v'); closePop(); btn.focus();
        if (v !== o.value) { o.value = v; o.onChange(v); dropdown(host, o); }
      });
    };
    return { set: function (v) { o.value = v; dropdown(host, o); } };
  }
  function modal(opts) {
    closePop();
    var ov = document.createElement('div');
    ov.className = 'bud-ov';
    ov.innerHTML = '<div class="bud-modal ' + (opts.cls || '') + '" role="dialog" aria-modal="true" aria-labelledby="budMt">' +
      '<div class="bud-modal-head"><div><h2 id="budMt">' + esc(opts.title) + '</h2>' + (opts.sub ? '<p>' + opts.sub + '</p>' : '') + '</div>' +
      '<button type="button" class="bud-x" aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="bud-modal-body">' + opts.body + '</div>' + (opts.foot ? '<div class="bud-modal-foot">' + opts.foot + '</div>' : '') + '</div>';
    document.body.appendChild(ov);
    document.body.classList.add('bud-lock');
    var last = document.activeElement;
    requestAnimationFrame(function () { ov.classList.add('in'); });
    var m = { root: ov.querySelector('.bud-modal'), close: close, el: ov };
    function close(force) {
      if (!force && opts.beforeClose && opts.beforeClose() === false) return;
      ov.classList.remove('in');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { ov.remove(); if (!document.querySelector('.bud-ov')) document.body.classList.remove('bud-lock'); }, 180);
      if (last && last.focus) try { last.focus(); } catch (e) {}
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape' && !openPop && document.querySelector('.bud-ov:last-of-type') === ov) close();
      if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(m.root.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    ov.querySelector('.bud-x').onclick = function () { close(); };
    if (opts.backdropClose) ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    if (opts.mount) opts.mount(m);
    setTimeout(function () { var f = m.root.querySelector('[autofocus]') || m.root.querySelector('.bud-x'); if (f) f.focus(); }, 60);
    return m;
  }
  async function confirmBox(msg, o) {
    if (window.UI && UI.confirm) return UI.confirm(esc(msg), o);   // UI.confirm renders HTML
    return false;
  }

  /* ───────── status quick change (inline) ───────── */
  function statusMenu(anchor, item) {
    if (!item) return;
    var pop = popover(anchor, '<div class="bud-pop-list">' + STATUS.map(function (s) {
      return '<button type="button" class="bud-pop-item' + (s[0] === item.status ? ' is-on' : '') + '" data-v="' + s[0] + '"><span class="bud-dot s-' + s[0] + '"></span><span>' + s[1] + '</span>' + (s[0] === item.status ? icon('check') : '') + '</button>';
    }).join('') + '</div>', { minWidth: 190 });
    if (!pop) return;
    pop.addEventListener('click', async function (e) {
      var it = e.target.closest('.bud-pop-item'); if (!it) return;
      var v = it.getAttribute('data-v'); closePop();
      if (v === item.status) return;
      if (v === 'partially_paid') return openExpense(item, { status: 'partially_paid' });
      var payload = toPayload(item); payload.status = v; payload.receipt_path = 'keep';
      saving(true);
      try {
        var r = await rpc('budget_save_item', Object.assign(access(), { p_item: payload, p_expected_version: item.version, p_actor_name: S.name || null }));
        if (!r.ok) {
          saving(false, r.error === 'conflict' ? '' : 'Couldn’t save');
          if (isAccessError(r.error)) return handleAccessError(r.error);
          if (r.error === 'conflict') { upsertLocal(r.item); toast('Someone else just changed this expense — showing the latest.', 'warning'); return; }
          return toast(errText(r), 'error');
        }
        saving(false); upsertLocal(r.item); toast(STATUS_LABEL[v] + ' · ' + r.item.title);
      } catch (err) { saving(false, 'Couldn’t save'); toast('Could not save — check your connection and try again.', 'error'); }
    });
  }
  function toPayload(i) {
    return { id: i.id, title: i.title, category: i.category, quantity: i.quantity, unit_price: i.unit_price, status: i.status,
      amount_paid: i.amount_paid, vendor: i.vendor || '', payment_date: i.payment_date || '', notes: i.notes || '' };
  }

  /* ───────── add / edit expense ───────── */
  function openExpense(item, preset) {
    if (!item && !canWrite()) return;
    var editable = canWrite();
    if (!editable) return viewExpense(item);
    var isNew = !item;
    var d = item ? Object.assign({}, item) : { title: '', category: S.cat || '', quantity: 1, unit_price: '', status: 'planned', amount_paid: 0, vendor: '', payment_date: '', notes: '' };
    if (preset) Object.assign(d, preset);
    var reqId = isNew ? uuid() : null, version = item ? item.version : null, busy = false, file = null, dropReceipt = false, dirty = false;
    var catOpts = function () {
      return S.categories.map(function (c) { return { value: c.name, label: c.name }; });
    };
    var body =
      '<div class="bud-form">' +
        '<div class="bud-conflict" hidden></div>' +
        '<label class="bud-field full"><span>Expense name</span><input name="title" maxlength="160" placeholder="e.g. LED wall for main stage" autofocus></label>' +
        '<div class="bud-field full"><span>Category</span><div class="bud-dd wide" data-cat></div></div>' +
        '<label class="bud-field"><span>Quantity</span><input name="quantity" inputmode="decimal" autocomplete="off"></label>' +
        '<label class="bud-field"><span>Unit price (₹)</span><input name="unit_price" inputmode="decimal" autocomplete="off" placeholder="0"></label>' +
        '<div class="bud-calc full"><span>Line total</span><strong data-total>₹0</strong><small data-calc></small></div>' +
        '<div class="bud-field full"><span>Payment status</span><div class="bud-seg" role="radiogroup">' +
          STATUS.map(function (s) { return '<button type="button" role="radio" data-status="' + s[0] + '"><span class="bud-dot s-' + s[0] + '"></span>' + s[1] + '</button>'; }).join('') +
        '</div></div>' +
        '<label class="bud-field full" data-paidrow><span>Amount paid (₹)</span><input name="amount_paid" inputmode="decimal" autocomplete="off"></label>' +
        '<details class="bud-more full"' + (d.vendor || d.payment_date || d.notes || d.has_receipt ? ' open' : '') + '><summary>Vendor, date, notes &amp; receipt</summary><div class="bud-more-in">' +
          '<label class="bud-field"><span>Vendor / supplier</span><input name="vendor" maxlength="120" placeholder="Optional"></label>' +
          '<label class="bud-field"><span>Payment date</span><input name="payment_date" type="date"></label>' +
          '<label class="bud-field full"><span>Notes</span><textarea name="notes" rows="3" maxlength="2000" placeholder="Optional"></textarea></label>' +
          '<div class="bud-field full"><span>Receipt or invoice</span><div class="bud-receipt" data-receipt></div>' +
            '<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden data-file></div>' +
        '</div></details>' +
        '<p class="bud-err" role="alert" hidden></p>' +
        (!isNew ? '<p class="bud-muted sm bud-stamp">' + esc('Last updated ' + fmtDate(item.updated_at, true) + (item.updated_by_label ? ' by ' + item.updated_by_label : '')) + '</p>' : '') +
      '</div>';
    var foot = (!isNew && isAdmin() ? '<button type="button" class="bud-btn danger ghost" data-del>' + icon('trash') + '<span>Delete</span></button>' : '') +
      '<span class="bud-spacer"></span><button type="button" class="bud-btn ghost" data-cancel>Cancel</button>' +
      '<button type="button" class="bud-btn primary" data-save>' + (isNew ? 'Add Expense' : 'Save changes') + '</button>';

    modal({
      title: isNew ? 'Add Expense' : 'Edit Expense', body: body, foot: foot, cls: 'is-form',
      beforeClose: function () { return !busy; },
      mount: function (m) {
        var R = m.root, f = function (n) { return R.querySelector('[name="' + n + '"]'); };
        var err = R.querySelector('.bud-err'), saveBtn = R.querySelector('[data-save]');
        var catDd;
        function fill() {
          f('title').value = d.title || ''; f('quantity').value = d.quantity == null ? '' : qtyText(d.quantity);
          f('unit_price').value = d.unit_price === '' || d.unit_price == null ? '' : String(Number(d.unit_price));
          f('amount_paid').value = cents(d.amount_paid) ? String(Number(d.amount_paid)) : '';
          f('vendor').value = d.vendor || ''; f('payment_date').value = d.payment_date || ''; f('notes').value = d.notes || '';
          catDd = dropdown(R.querySelector('[data-cat]'), {
            value: d.category, placeholder: 'Choose a category', searchable: true, options: catOpts(),
            onChange: function (v) { d.category = v; dirty = true; },
            onCreate: isAdmin() ? async function (name) {
              try {
                var r = await rpc('budget_admin_add_category', { p_budget: S.budget.id, p_name: name });
                if (!r.ok) return showErr(errText(r));
                if (S.categories.every(function (c) { return c.name !== r.category.name; })) S.categories.push(r.category);
                d.category = r.category.name; dirty = true; fill(); renderFilters();
              } catch (e) { showErr('Could not add the category.'); }
            } : null
          });
          setStatus(d.status, true); calc(); drawReceipt();
        }
        function showErr(t) { err.textContent = t; err.hidden = !t; }
        function calc() {
          var q = f('quantity').value.trim(), p = f('unit_price').value.trim();
          var tot = lineTotal(q || 0, p || 0);
          R.querySelector('[data-total]').textContent = inr(tot);
          R.querySelector('[data-calc]').textContent = q && p ? qtyText(Number(q)) + ' × ' + inr(Number(p)) : '';
          if (d.status === 'paid') f('amount_paid').value = tot ? String(tot) : '';
          return tot;
        }
        function setStatus(s, silent) {
          d.status = s;
          R.querySelectorAll('[data-status]').forEach(function (b) { var on = b.getAttribute('data-status') === s; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on); });
          var row = R.querySelector('[data-paidrow]'), inp = f('amount_paid');
          row.hidden = s === 'planned' || s === 'pending';
          inp.readOnly = s === 'paid';
          if (s === 'paid') inp.value = String(lineTotal(f('quantity').value || 0, f('unit_price').value || 0));
          if (s === 'partially_paid' && !silent) setTimeout(function () { inp.focus(); inp.select(); }, 30);
        }
        function drawReceipt() {
          var box = R.querySelector('[data-receipt]');
          if (file) {
            box.innerHTML = '<span class="bud-rc-name">' + icon('clip') + esc(file.name) + '</span><span class="bud-muted sm">Uploads when you save</span><button type="button" class="bud-link" data-rc-clear>Remove</button>';
          } else if (d.has_receipt && !dropReceipt) {
            box.innerHTML = '<span class="bud-rc-name">' + icon('receipt') + esc(d.receipt_name || 'Receipt') + '</span><button type="button" class="bud-link" data-rc-view>View</button>' +
              '<button type="button" class="bud-link" data-rc-pick>Replace</button><button type="button" class="bud-link danger" data-rc-drop>Remove</button>';
          } else {
            box.innerHTML = '<button type="button" class="bud-btn ghost sm" data-rc-pick>' + icon('clip') + '<span>Attach PDF or image</span></button><span class="bud-muted sm">Up to 10 MB · private</span>' +
              (dropReceipt ? '<button type="button" class="bud-link" data-rc-undo>Undo remove</button>' : '');
          }
        }
        R.addEventListener('input', function (e) {
          dirty = true; showErr('');
          if (e.target.name === 'quantity' || e.target.name === 'unit_price') calc();
        });
        R.addEventListener('click', function (e) {
          var t = e.target.closest('button'); if (!t) return;
          if (t.hasAttribute('data-status')) { dirty = true; setStatus(t.getAttribute('data-status')); }
          else if (t.hasAttribute('data-rc-pick')) R.querySelector('[data-file]').click();
          else if (t.hasAttribute('data-rc-clear')) { file = null; drawReceipt(); }
          else if (t.hasAttribute('data-rc-drop')) { dropReceipt = true; dirty = true; drawReceipt(); }
          else if (t.hasAttribute('data-rc-undo')) { dropReceipt = false; drawReceipt(); }
          else if (t.hasAttribute('data-rc-view')) viewReceipt(item);
          else if (t.hasAttribute('data-cancel')) tryClose();
          else if (t.hasAttribute('data-del')) del();
          else if (t.hasAttribute('data-save')) save();
          else if (t.hasAttribute('data-reload')) { Object.assign(d, t._latest); version = t._latest.version; R.querySelector('.bud-conflict').hidden = true; fill(); }
        });
        R.querySelector('[data-file]').addEventListener('change', function (e) {
          var fl = e.target.files && e.target.files[0]; e.target.value = '';
          if (!fl) return;
          if (RECEIPT_TYPES.indexOf(fl.type) === -1) return showErr('Receipts must be PDF, JPG, PNG or WebP.');
          if (fl.size > 10 * 1024 * 1024) return showErr('Receipt must be under 10 MB.');
          file = fl; dirty = true; showErr(''); drawReceipt();
        });
        R.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
        async function tryClose() {
          if (dirty && !(await confirmBox('Discard the changes to this expense?', { title: 'Discard changes', okText: 'Discard', danger: true }))) return;
          m.close(true);
        }
        m.root.parentNode.addEventListener('mousedown', function (e) { if (e.target === m.root.parentNode && !dirty) m.close(); });

        function readForm() {
          var q = f('quantity').value.trim(), p = f('unit_price').value.trim(), paid = f('amount_paid').value.trim();
          var NUM = /^\d+(\.\d{1,2})?$/;
          var title = f('title').value.trim();
          if (!title) return { e: 'Enter an expense name.', at: 'title' };
          if (!d.category) return { e: 'Choose a category.' };
          if (!NUM.test(q) || Number(q) <= 0) return { e: 'Quantity must be a number above 0 (up to 2 decimals).', at: 'quantity' };
          if (!NUM.test(p)) return { e: 'Unit price must be a positive amount (up to 2 decimals).', at: 'unit_price' };
          var tot = lineTotal(q, p);
          if (d.status === 'partially_paid') {
            if (!NUM.test(paid) || Number(paid) <= 0) return { e: 'Enter how much has been paid.', at: 'amount_paid' };
            if (cents(paid) >= cents(tot)) return { e: 'For a full payment choose “Paid”. Partly paid must be less than ' + inr(tot) + '.', at: 'amount_paid' };
          }
          return { v: {
            title: title, category: d.category, quantity: q, unit_price: p, status: d.status,
            amount_paid: d.status === 'partially_paid' ? paid : d.status === 'paid' ? String(tot) : '0',
            vendor: f('vendor').value.trim(), payment_date: f('payment_date').value, notes: f('notes').value.trim()
          } };
        }
        async function save() {
          if (busy) return;
          var r0 = readForm();
          if (r0.e) { showErr(r0.e); if (r0.at) f(r0.at).focus(); return; }
          var payload = r0.v;
          payload.receipt_path = dropReceipt ? null : 'keep';
          if (!isNew) payload.id = item.id;
          busy = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; saving(true);
          try {
            var r = await rpc('budget_save_item', Object.assign(access(), {
              p_item: payload, p_client_request_id: reqId, p_expected_version: version, p_actor_name: S.name || null }));
            if (!r.ok) {
              saving(false, r.error === 'conflict' ? '' : 'Couldn’t save');
              if (isAccessError(r.error)) { m.close(true); return handleAccessError(r.error); }
              if (r.error === 'conflict') {
                var c = R.querySelector('.bud-conflict');
                c.innerHTML = '<span>' + icon('history') + 'Someone else saved this expense while you were editing.</span><button type="button" class="bud-link" data-reload>Load their version</button>';
                c.querySelector('[data-reload]')._latest = r.item; c.hidden = false;
                version = r.item.version; upsertLocal(r.item);
                return;
              }
              return showErr(errText(r));
            }
            var saved = r.item;
            if (isNew) { isNew = false; item = saved; version = saved.version; reqId = null; }
            if (file) {
              saveBtn.textContent = 'Uploading receipt…';
              try { saved = await uploadReceipt(saved, file); file = null; }
              catch (ue) {
                saving(false, 'Receipt not uploaded'); upsertLocal(saved); item = saved; version = saved.version; d = Object.assign({}, saved);
                R.querySelector('#budMt').textContent = 'Edit Expense';
                return showErr('Expense saved, but the receipt did not upload: ' + (ue.message || 'try again') + '.');
              }
            }
            saving(false); upsertLocal(saved); dirty = false; m.close(true);
            toast(r.duplicate ? 'Already saved' : (payload.id ? 'Changes saved' : 'Expense added'));
          } catch (e) {
            saving(false, 'Couldn’t save');
            showErr('Could not save — check your connection and try again. Nothing was lost; press Save again.');
          } finally {
            busy = false; saveBtn.disabled = false; saveBtn.textContent = isNew ? 'Add Expense' : 'Save changes';
          }
        }
        async function del() {
          if (busy) return;
          if (!(await confirmBox('Delete “' + item.title + '” (' + inr(item.line_total) + ')? It is removed for everyone. The change is kept in the budget history.', { title: 'Delete expense', okText: 'Delete', danger: true }))) return;
          busy = true; saving(true);
          try {
            var r = await rpc('budget_admin_delete_item', { p_item: item.id, p_expected_version: null });
            if (!r.ok) { saving(false, 'Couldn’t delete'); return showErr(errText(r)); }
            saving(false);
            S.items = S.items.filter(function (i) { return i.id !== item.id; });
            renderAll(); m.close(true); toast('Expense deleted');
          } catch (e) { saving(false, 'Couldn’t delete'); showErr('Could not delete — check your connection.'); }
          finally { busy = false; }
        }
        fill();
      }
    });
  }
  function viewExpense(item) {
    if (!item) return;
    var rows = [
      ['Category', esc(item.category)], ['Quantity', qtyText(item.quantity)], ['Unit price', inr(item.unit_price)],
      ['Status', '<span class="bud-chip s-' + esc(item.status) + '">' + esc(STATUS_LABEL[item.status]) + '</span>'],
      ['Amount paid', inr(item.amount_paid)], ['Outstanding', inr((cents(item.line_total) - cents(item.amount_paid)) / 100)]
    ];
    if (item.vendor) rows.push(['Vendor', esc(item.vendor)]);
    if (item.payment_date) rows.push(['Payment date', esc(fmtDate(item.payment_date))]);
    modal({
      title: item.title, cls: 'is-view', backdropClose: true,
      body: '<div class="bud-calc"><span>Line total</span><strong>' + inr(item.line_total) + '</strong></div>' +
        '<dl class="bud-dl">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>' +
        (item.notes ? '<div class="bud-notes"><span>Notes</span><p>' + esc(item.notes) + '</p></div>' : '') +
        (item.has_receipt ? '<button type="button" class="bud-btn ghost" data-rc>' + icon('receipt') + '<span>View receipt</span></button>' : '') +
        '<p class="bud-muted sm bud-stamp">' + esc('Last updated ' + fmtDate(item.updated_at, true)) + '</p>',
      mount: function (m) { var b = m.root.querySelector('[data-rc]'); if (b) b.onclick = function () { viewReceipt(item); }; }
    });
  }

  /* ───────── receipts (private bucket, signed URLs via edge function) ───────── */
  async function fnCall(body) {
    var auth = SUPABASE_ANON;
    if (MODE === 'admin') { var s = await sb.auth.getSession(); if (s.data.session) auth = s.data.session.access_token; }
    var extra = MODE === 'share' ? { token: S.token, passcode: S.passcode || null } : { budget_id: S.budget.id };
    var res = await fetch(RECEIPT_FN, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth, apikey: SUPABASE_ANON },
      body: JSON.stringify(Object.assign(extra, body))
    });
    var j = {}; try { j = await res.json(); } catch (e) {}
    return j;
  }
  async function uploadReceipt(item, fl) {
    var r = await fnCall({ action: 'upload', item_id: item.id, type: fl.type, size: fl.size });
    if (!r.ok) throw new Error(r.message || ERR[r.error] || 'upload refused');
    var up = await sb.storage.from('budget-receipts').uploadToSignedUrl(r.path, r.token, fl, { contentType: fl.type });
    if (up.error) throw new Error('upload failed');
    var p = toPayload(item); p.receipt_path = r.path; p.receipt_name = fl.name.slice(0, 160);
    var s = await rpc('budget_save_item', Object.assign(access(), { p_item: p, p_expected_version: item.version, p_actor_name: S.name || null }));
    if (!s.ok) throw new Error(errText(s));
    return s.item;
  }
  async function viewReceipt(item) {
    var w = window.open('', '_blank');
    try {
      var r = await fnCall({ action: 'view', item_id: item.id });
      if (!r.ok) throw new Error();
      if (w) { w.opener = null; w.location.href = r.url; } else location.href = r.url;
    } catch (e) { if (w) w.close(); toast('Could not open the receipt.', 'error'); }
  }

  /* ───────── budget settings (admin) ───────── */
  function openBudgetSettings() {
    if (!isAdmin()) return;
    var b = S.budget;
    modal({
      title: 'Budget settings', cls: 'is-form sm', backdropClose: true,
      body: '<div class="bud-form">' +
        '<label class="bud-field full"><span>Budget name</span><input name="title" maxlength="120"></label>' +
        '<label class="bud-field full"><span>Overall allocated budget (₹)</span><input name="alloc" inputmode="decimal" placeholder="e.g. 500000" autofocus></label>' +
        '<p class="bud-muted sm full">Leave empty to hide the budget balance.</p><p class="bud-err" role="alert" hidden></p></div>',
      foot: '<span class="bud-spacer"></span><button type="button" class="bud-btn ghost" data-cancel>Cancel</button><button type="button" class="bud-btn primary" data-save>Save</button>',
      mount: function (m) {
        var R = m.root, t = R.querySelector('[name=title]'), a = R.querySelector('[name=alloc]'), err = R.querySelector('.bud-err'), busy = false;
        t.value = b.title; a.value = b.allocated_budget == null ? '' : String(Number(b.allocated_budget));
        R.querySelector('[data-cancel]').onclick = function () { m.close(); };
        R.querySelector('[data-save]').onclick = async function () {
          if (busy) return;
          var v = a.value.trim().replace(/,/g, '');
          if (v && !/^\d+(\.\d{1,2})?$/.test(v)) { err.textContent = 'Enter a positive amount.'; err.hidden = false; return; }
          if (!t.value.trim()) { err.textContent = 'Enter a name.'; err.hidden = false; return; }
          busy = true; saving(true);
          try {
            var r = await rpc('budget_admin_update_budget', { p_budget: b.id, p_title: t.value.trim(), p_allocated: v ? Number(v) : null, p_clear_allocated: !v });
            if (!r.ok) { saving(false, 'Couldn’t save'); err.textContent = errText(r); err.hidden = false; return; }
            saving(false); S.budget.title = t.value.trim(); S.budget.allocated_budget = v ? Number(v) : null; renderAll(); m.close(); toast('Budget updated');
          } catch (e) { saving(false, 'Couldn’t save'); err.textContent = 'Could not save — check your connection.'; err.hidden = false; }
          finally { busy = false; }
        };
      }
    });
  }

  /* ───────── categories (admin) ───────── */
  function openCategories() {
    modal({
      title: 'Categories', sub: 'Suggestions everyone can pick from. Add your own — remove ones nobody uses.', cls: 'is-form sm', backdropClose: true,
      body: '<div class="bud-catadd"><input type="text" maxlength="60" placeholder="New category name" data-new><button type="button" class="bud-btn primary sm" data-add>' + icon('plus') + '<span>Add</span></button></div>' +
        '<p class="bud-err" role="alert" hidden></p><ul class="bud-catlist" data-list></ul>',
      mount: function (m) {
        var R = m.root, err = R.querySelector('.bud-err');
        function used(n) { return S.items.filter(function (i) { return i.category === n; }).length; }
        function draw() {
          R.querySelector('[data-list]').innerHTML = S.categories.map(function (c) {
            var u = used(c.name);
            return '<li><span>' + esc(c.name) + '</span><span class="bud-muted sm">' + (u ? u + (u === 1 ? ' item' : ' items') : 'unused') + '</span>' +
              (!u && c.id ? '<button type="button" class="bud-icon-btn" data-rm="' + esc(c.id) + '" aria-label="Remove ' + esc(c.name) + '">' + icon('trash') + '</button>' : '<span class="bud-icon-btn ph"></span>') + '</li>';
          }).join('');
        }
        async function add() {
          var inp = R.querySelector('[data-new]'), v = inp.value.trim(); if (!v) return;
          try {
            var r = await rpc('budget_admin_add_category', { p_budget: S.budget.id, p_name: v });
            if (!r.ok) { err.textContent = errText(r); err.hidden = false; return; }
            if (S.categories.every(function (c) { return c.name !== r.category.name; })) S.categories.push(r.category);
            inp.value = ''; err.hidden = true; draw(); renderFilters();
          } catch (e) { err.textContent = 'Could not add — check your connection.'; err.hidden = false; }
        }
        R.querySelector('[data-add]').onclick = add;
        R.querySelector('[data-new]').addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
        R.querySelector('[data-list]').addEventListener('click', async function (e) {
          var b = e.target.closest('[data-rm]'); if (!b) return;
          var id = b.getAttribute('data-rm');
          try {
            var r = await rpc('budget_admin_delete_category', { p_category: id });
            if (!r.ok) { err.textContent = errText(r); err.hidden = false; return; }
            S.categories = S.categories.filter(function (c) { return c.id !== id; }); draw(); renderFilters();
          } catch (x) { err.textContent = 'Could not remove — check your connection.'; err.hidden = false; }
        });
        draw();
      }
    });
  }

  /* ───────── sharing (admin) ───────── */
  function shareUrl(tok) { return location.origin + '/budget/share/#' + tok; }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (x) {} ta.remove(); return ok;
    }
  }
  function openShare() {
    modal({
      title: 'Share budget', cls: 'is-share', backdropClose: true,
      sub: 'Links open this budget only — never the Admin Panel or any other data. No account needed.',
      body:
        '<section class="bud-share-new">' +
          '<div class="bud-seg two" data-role><button type="button" data-r="editor" class="is-on">' + icon('pencil') + 'Can edit</button><button type="button" data-r="viewer">' + icon('eye') + 'View only</button></div>' +
          '<div class="bud-form">' +
            '<label class="bud-field full"><span>Who is it for?</span><input data-label maxlength="80" placeholder="e.g. Hospitality team, Stage vendor"></label>' +
            '<div class="bud-field full"><span>Expires</span><div class="bud-seg wrap" data-exp>' +
              [['', 'Never'], ['1', '24 hours'], ['7', '7 days'], ['30', '30 days'], ['date', 'Pick date']].map(function (x, i) {
                return '<button type="button" data-e="' + x[0] + '"' + (i === 2 ? ' class="is-on"' : '') + '>' + x[1] + '</button>'; }).join('') +
            '</div><input type="date" data-date hidden></div>' +
            '<label class="bud-field full"><span>Passcode <em>(optional)</em></span><input data-pass type="text" maxlength="40" autocomplete="off" placeholder="People must type this to open the link"></label>' +
          '</div>' +
          '<p class="bud-err" role="alert" hidden></p>' +
          '<button type="button" class="bud-btn primary full" data-create>' + icon('link') + '<span>Create link</span></button>' +
          '<div class="bud-newlink" data-out hidden></div>' +
        '</section>' +
        '<section class="bud-share-list"><div class="bud-panel-head"><h3>Active &amp; past links</h3><button type="button" class="bud-link danger" data-revoke-all hidden>Turn off all links</button></div><div data-links><p class="bud-muted sm">Loading…</p></div></section>',
      mount: function (m) {
        var R = m.root, role = 'editor', exp = '7', err = R.querySelector('.bud-err'), busy = false;
        R.querySelector('[data-role]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-r]'); if (!b) return; role = b.getAttribute('data-r');
          R.querySelectorAll('[data-r]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        });
        R.querySelector('[data-exp]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-e]'); if (!b) return; exp = b.getAttribute('data-e');
          R.querySelectorAll('[data-e]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
          var di = R.querySelector('[data-date]'); di.hidden = exp !== 'date'; if (exp === 'date') di.focus();
        });
        R.querySelector('[data-create]').onclick = async function () {
          if (busy) return;
          var expires = null;
          if (exp === 'date') {
            var dv = R.querySelector('[data-date]').value;
            if (!dv) { err.textContent = 'Pick an expiry date.'; err.hidden = false; return; }
            expires = new Date(dv + 'T23:59:59').toISOString();
          } else if (exp) expires = new Date(Date.now() + Number(exp) * 86400000).toISOString();
          var pass = R.querySelector('[data-pass]').value;
          if (pass && pass.length < 4) { err.textContent = 'Passcode needs at least 4 characters.'; err.hidden = false; return; }
          busy = true; err.hidden = true;
          try {
            var r = await rpc('budget_admin_create_link', { p_budget: S.budget.id, p_role: role, p_label: R.querySelector('[data-label]').value.trim() || null, p_passcode: pass || null, p_expires_at: expires });
            if (!r.ok) { err.textContent = errText(r); err.hidden = false; return; }
            S.linkTokens[r.link_id] = r.token;
            var url = shareUrl(r.token), out = R.querySelector('[data-out]');
            out.innerHTML = '<div class="bud-newlink-top">' + icon('check') + '<strong>' + (role === 'editor' ? 'Edit' : 'View-only') + ' link ready</strong></div>' +
              '<div class="bud-urlbox"><input readonly value="' + esc(url) + '" aria-label="Share link"><button type="button" class="bud-btn primary sm" data-copy>' + icon('copy') + '<span>Copy</span></button></div>' +
              '<p class="bud-muted sm">For security the full link is shown only now (we store a fingerprint, not the link). If it gets lost, create a new one and turn this off.' +
              (pass ? ' Send the passcode separately.' : '') + '</p>';
            out.hidden = false;
            out.querySelector('[data-copy]').onclick = async function () { if (await copyText(url)) toast('Link copied'); };
            out.querySelector('input').onclick = function () { this.select(); };
            R.querySelector('[data-pass]').value = ''; R.querySelector('[data-label]').value = '';
            drawLinks();
          } catch (e) { err.textContent = 'Could not create the link — check your connection.'; err.hidden = false; }
          finally { busy = false; }
        };
        async function drawLinks() {
          var box = R.querySelector('[data-links]');
          try {
            var r = await rpc('budget_admin_list_links', { p_budget: S.budget.id });
            if (!r.ok) { box.innerHTML = '<p class="bud-err">' + esc(errText(r)) + '</p>'; return; }
            var links = r.links || [], now = Date.now();
            var active = links.filter(function (l) { return !l.revoked_at && !(l.expires_at && new Date(l.expires_at) <= now); });
            R.querySelector('[data-revoke-all]').hidden = !active.length;
            if (!links.length) { box.innerHTML = '<p class="bud-muted sm">No links yet. Create one above.</p>'; return; }
            box.innerHTML = links.map(function (l) {
              var state = l.revoked_at ? 'Turned off' : (l.expires_at && new Date(l.expires_at) <= now) ? 'Expired' : 'Active';
              var on = state === 'Active', tok = S.linkTokens[l.id];
              return '<div class="bud-linkrow' + (on ? '' : ' is-off') + '" data-id="' + esc(l.id) + '">' +
                '<div class="bud-linkrow-main"><div class="bud-linkrow-title">' + icon(l.role === 'editor' ? 'pencil' : 'eye') +
                  '<strong>' + esc(l.label || (l.role === 'editor' ? 'Edit link' : 'View link')) + '</strong><span class="bud-mini">…' + esc(l.token_hint || '') + '</span></div>' +
                  '<div class="bud-linkrow-meta"><span class="bud-state is-' + state.toLowerCase().replace(/\s/g, '') + '">' + state + '</span>' +
                  '<span>' + (l.role === 'editor' ? 'Can edit' : 'View only') + '</span>' +
                  (l.has_passcode ? '<span>' + icon('lock') + 'Passcode</span>' : '') +
                  '<span>' + (l.expires_at ? (on ? 'Until ' : 'Ended ') + esc(fmtDate(l.expires_at, true)) : 'No expiry') + '</span>' +
                  '<span>' + (l.last_used_at ? 'Opened ' + esc(rel(new Date(l.last_used_at).getTime())) : 'Not opened yet') + '</span>' +
                  (l.locked ? '<span class="bud-state is-expired">Locked: wrong passcodes</span>' : '') + '</div></div>' +
                (on ? '<div class="bud-linkrow-act">' +
                  (tok ? '<button type="button" class="bud-icon-btn" data-copy-l aria-label="Copy link">' + icon('copy') + '</button>' : '') +
                  '<button type="button" class="bud-btn ghost sm" data-swap>' + (l.role === 'editor' ? 'Make view only' : 'Allow editing') + '</button>' +
                  '<button type="button" class="bud-btn ghost sm danger" data-revoke>Turn off</button></div>' : '') +
                '</div>';
            }).join('');
            box._links = links;
          } catch (e) { box.innerHTML = '<p class="bud-err">Could not load links — check your connection.</p>'; }
        }
        R.querySelector('[data-links]').addEventListener('click', async function (e) {
          var row = e.target.closest('.bud-linkrow'); if (!row) return;
          var id = row.getAttribute('data-id'), l = (this._links || []).filter(function (x) { return x.id === id; })[0]; if (!l) return;
          if (e.target.closest('[data-copy-l]')) { if (await copyText(shareUrl(S.linkTokens[id]))) toast('Link copied'); return; }
          if (e.target.closest('[data-swap]')) {
            var to = l.role === 'editor' ? 'viewer' : 'editor';
            if (to === 'editor' && !(await confirmBox('Anyone with this link will be able to add and change expenses.', { title: 'Allow editing', okText: 'Allow editing' }))) return;
            var r1 = await rpc('budget_admin_update_link', { p_link: id, p_role: to }).catch(function () { return { ok: false }; });
            if (!r1.ok) return toast(errText(r1), 'error');
            toast(to === 'editor' ? 'Link can now edit' : 'Link is now view only'); drawLinks(); return;
          }
          if (e.target.closest('[data-revoke]')) {
            if (!(await confirmBox('“' + (l.label || 'This link') + '” will stop working immediately, including for anyone who has it open. This can’t be undone — create a new link if needed.', { title: 'Turn off link', okText: 'Turn off', danger: true }))) return;
            var r2 = await rpc('budget_admin_update_link', { p_link: id, p_revoke: true }).catch(function () { return { ok: false }; });
            if (!r2.ok) return toast(errText(r2), 'error');
            delete S.linkTokens[id]; toast('Link turned off'); drawLinks();
          }
        });
        R.querySelector('[data-revoke-all]').onclick = async function () {
          var links = (R.querySelector('[data-links]')._links || []).filter(function (l) { return !l.revoked_at && !(l.expires_at && new Date(l.expires_at) <= Date.now()); });
          if (!links.length) return;
          if (!(await confirmBox('Turn off all ' + links.length + ' active link' + (links.length === 1 ? '' : 's') + '? Everyone using them loses access immediately.', { title: 'Turn off sharing', okText: 'Turn off all', danger: true }))) return;
          var bad = 0;
          for (var i = 0; i < links.length; i++) {
            var r = await rpc('budget_admin_update_link', { p_link: links[i].id, p_revoke: true }).catch(function () { return { ok: false }; });
            if (!r.ok) bad++; else delete S.linkTokens[links[i].id];
          }
          toast(bad ? bad + ' link(s) could not be turned off — try again' : 'Sharing turned off', bad ? 'error' : 'success'); drawLinks();
        };
        drawLinks();
      }
    });
  }

  /* ───────── activity history (admin) ───────── */
  var FIELD = { title: 'Name', category: 'Category', quantity: 'Quantity', unit_price: 'Unit price', line_total: 'Total', status: 'Status',
    amount_paid: 'Paid', vendor: 'Vendor', payment_date: 'Payment date', notes: 'Notes', receipt_name: 'Receipt', allocated_budget: 'Allocated budget' };
  var MONEY = { unit_price: 1, line_total: 1, amount_paid: 1, allocated_budget: 1 };
  function fv(k, v) {
    if (v == null || v === '') return '—';
    if (MONEY[k]) return inr(v);
    if (k === 'status') return STATUS_LABEL[v] || v;
    if (k === 'quantity') return qtyText(v);
    if (k === 'payment_date') return fmtDate(v);
    var s = String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }
  function openActivity() {
    modal({
      title: 'Budget history', sub: 'Every change, who made it and when. Only admins see this.', cls: 'is-history', backdropClose: true,
      body: '<div data-h><p class="bud-muted sm">Loading…</p></div>',
      mount: async function (m) {
        var box = m.root.querySelector('[data-h]');
        try {
          var res = await sb.from('budget_activity').select('*').eq('budget_id', S.budget.id).order('created_at', { ascending: false }).limit(300);
          if (res.error) throw res.error;
          if (!res.data.length) { box.innerHTML = '<p class="bud-muted sm">No changes yet.</p>'; return; }
          box.innerHTML = '<ol class="bud-hist">' + res.data.map(function (a) {
            var who = a.actor_type === 'admin' ? esc(a.actor_email || 'Admin') + ' <span class="bud-mini">admin</span>'
              : (a.display_name ? esc(a.display_name) + ' <span class="bud-mini" title="Name typed by the person — not verified">unverified name</span> ' : '') +
                'via <b>' + esc(a.link_label || 'share link') + '</b> <span class="bud-mini">' + esc(a.link_role || '') + ' link</span>';
            var what = {
              created: 'added', updated: 'edited', deleted: 'deleted', budget_updated: 'changed budget settings', category_added: 'added category',
              category_removed: 'removed category', link_created: 'created a share link', link_updated: 'changed a share link', link_revoked: 'turned off a share link'
            }[a.action] || a.action;
            var detail = '', c = a.changes || {};
            if (a.action === 'updated' || a.action === 'budget_updated') {
              detail = Object.keys(c).filter(function (k) { return FIELD[k]; }).map(function (k) {
                return '<li><span>' + FIELD[k] + '</span>' + esc(fv(k, c[k].from)) + ' → <b>' + esc(fv(k, c[k].to)) + '</b></li>';
              }).join('');
            } else if (a.action === 'created' && c.after) {
              detail = '<li><span>Total</span><b>' + esc(inr(c.after.line_total)) + '</b> · ' + esc(c.after.category) + ' · ' + esc(STATUS_LABEL[c.after.status] || '') + '</li>';
            } else if (a.action === 'deleted' && c.before) {
              detail = '<li><span>Was</span>' + esc(inr(c.before.line_total)) + ' · ' + esc(c.before.category) + '</li>';
            } else if (/^category_/.test(a.action)) {
              detail = '<li>' + esc(c.name || '') + '</li>';
            } else if (/^link_/.test(a.action)) {
              detail = '<li>' + esc(c.label || 'Untitled link') + ' · ' + esc(c.role && c.role.to ? c.role.to : c.role || '') + '</li>';
            }
            return '<li class="bud-hist-item"><div class="bud-hist-top"><span class="bud-hist-who">' + who + '</span><time>' + esc(fmtDate(a.created_at, true)) + '</time></div>' +
              '<div class="bud-hist-what">' + esc(what) + (a.item_title ? ' <b>' + esc(a.item_title) + '</b>' : '') + '</div>' +
              (detail ? '<ul class="bud-hist-diff">' + detail + '</ul>' : '') + '</li>';
          }).join('') + '</ol>';
        } catch (e) { box.innerHTML = '<p class="bud-err">Could not load history.</p>'; }
      }
    });
  }

  /* ───────── exports ───────── */
  function exportMenu(anchor) {
    var pop = popover(anchor, '<div class="bud-pop-list">' +
      '<button type="button" class="bud-pop-item" data-x="pdf">' + icon('receipt') + '<span>PDF report</span></button>' +
      '<button type="button" class="bud-pop-item" data-x="csv">' + icon('download') + '<span>CSV · all items</span></button></div>', { minWidth: 200 });
    if (!pop) return;
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-x]'); if (!b) return; closePop();
      if (b.getAttribute('data-x') === 'pdf') exportPdf(); else exportCsv();
    });
  }
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var head = ['Expense', 'Category', 'Quantity', 'Unit Price (INR)', 'Line Total (INR)', 'Status', 'Amount Paid (INR)', 'Outstanding (INR)', 'Vendor', 'Payment Date', 'Notes', 'Receipt', 'Last Updated By', 'Last Updated'];
    var rows = S.items.slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }).map(function (i) {
      return [i.title, i.category, i.quantity, Number(i.unit_price).toFixed(2), Number(i.line_total).toFixed(2), STATUS_LABEL[i.status], Number(i.amount_paid).toFixed(2),
        ((cents(i.line_total) - cents(i.amount_paid)) / 100).toFixed(2), i.vendor || '', i.payment_date || '', i.notes || '', i.has_receipt ? 'Yes' : 'No',
        i.updated_by_label || '', i.updated_at ? new Date(i.updated_at).toISOString() : ''];
    });
    var t = totals();
    rows.push([]); rows.push(['Grand Total', '', '', '', t.total.toFixed(2), '', t.paid.toFixed(2), t.outstanding.toFixed(2)]);
    var csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'sharankrishna-event-budget-' + stamp() + '.csv');
  }
  // jsPDF's built-in Helvetica only covers Latin-1: map common symbols, mark anything else with '?'
  function pt(v) {
    return String(v == null ? '' : v).replace(/[×✕]/g, 'x').replace(/[–—−]/g, '-').replace(/[·•]/g, '-')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/₹/g, 'INR ')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  }
  function exportPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) return toast('PDF tools are still loading — try again in a moment.', 'error');
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), M = 40;
    var t = totals(), alloc = S.budget.allocated_budget == null ? null : Number(S.budget.allocated_budget);
    doc.setFillColor(10, 10, 12); doc.rect(0, 0, W, 104, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setCharSpace(2.2);
    doc.text('SHARANKRISHNA SHORT FILM AWARDS', M, 38); doc.setCharSpace(0);
    doc.setFontSize(22); doc.text('Event Budget', M, 68);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(190);
    doc.text(pt(S.budget.title), M, 88);
    doc.text('Generated ' + fmtDate(new Date().toISOString(), true), W - M, 88, { align: 'right' });
    var cards = [['GRAND TOTAL', t.total], ['PAID', t.paid], ['OUTSTANDING', t.outstanding]];
    if (alloc != null) cards.push([alloc - t.total < 0 ? 'OVER BUDGET BY' : 'BUDGET BALANCE', Math.abs(alloc - t.total)]);
    var cw = (W - M * 2 - (cards.length - 1) * 10) / cards.length, y = 126;
    cards.forEach(function (c, i) {
      var x = M + i * (cw + 10);
      doc.setDrawColor(210); doc.setFillColor(i === 0 ? 10 : 255, i === 0 ? 10 : 255, i === 0 ? 12 : 255);
      doc.roundedRect(x, y, cw, 58, 6, 6, i === 0 ? 'F' : 'S');
      doc.setTextColor(i === 0 ? 200 : 110); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text(c[0], x + 12, y + 20);
      doc.setTextColor(i === 0 ? 255 : 15); doc.setFontSize(14); doc.text('INR ' + num(c[1]), x + 12, y + 42);
    });
    y += 82;
    if (alloc != null) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text('Allocated budget: INR ' + num(alloc), M, y - 8); y += 6; }
    var tableStyle = { font: 'helvetica', fontSize: 8.5, cellPadding: 5, lineColor: [225, 225, 225], lineWidth: 0.5, textColor: [25, 25, 25] };
    var headStyle = { fillColor: [18, 18, 20], textColor: 255, fontStyle: 'bold', fontSize: 8 };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15); doc.text('Category breakdown', M, y); y += 8;
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, styles: tableStyle, headStyles: headStyle, theme: 'grid',
      head: [['Category', 'Items', 'Total (INR)', 'Paid (INR)', 'Share']],
      body: byCategory().map(function (c) { return [pt(c.name), c.count, num(c.total), num(c.paid), (t.total ? (c.total / t.total * 100).toFixed(1) : '0.0') + '%']; }),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
    });
    y = doc.lastAutoTable.finalY + 26;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15); doc.text('Expense items', M, y); y += 8;
    var items = S.items.slice().sort(function (a, b) { return a.category.localeCompare(b.category) || String(a.created_at).localeCompare(String(b.created_at)); });
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 50 }, styles: tableStyle, headStyles: headStyle, theme: 'grid',
      head: [['#', 'Expense', 'Category', 'Qty', 'Unit (INR)', 'Total (INR)', 'Status', 'Paid (INR)', 'Vendor']],
      body: items.map(function (i, n) { return [n + 1, pt(i.title), pt(i.category), qtyText(i.quantity), num(i.unit_price), num(i.line_total), STATUS_LABEL[i.status], num(i.amount_paid), pt(i.vendor || '')]; }),
      foot: [['', 'Grand Total', '', '', '', num(t.total), '', num(t.paid), '']],
      footStyles: { fillColor: [240, 240, 240], textColor: 15, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 20, halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 7: { halign: 'right' } }
    });
    var pages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140);
      doc.text('Sharankrishna Short Film Awards - Event Budget - Internal', M, doc.internal.pageSize.getHeight() - 22);
      doc.text('Page ' + p + ' of ' + pages, W - M, doc.internal.pageSize.getHeight() - 22, { align: 'right' });
    }
    doc.save('sharankrishna-event-budget-' + stamp() + '.pdf');
  }

  /* ───────── share-link entry screens ───────── */
  function gate(html) { app.innerHTML = '<div class="bud-gate"><div class="bud-gate-card">' + LOGO + html + '</div></div>'; }
  function errorPage(code) {
    var C = {
      link_revoked: ['This link was turned off', 'The organisers stopped sharing the budget through this link. Ask them for a new one.'],
      link_expired: ['This link has expired', 'Budget links can be set to stop working after a while. Ask the organisers for a new link.'],
      link_invalid: ['This link isn’t valid', 'Check that you copied the whole link, or ask the organisers to send it again.'],
      no_token: ['Link incomplete', 'This page needs the full budget link that was shared with you.'],
      locked: ['Too many wrong passcodes', 'For safety this link is paused for 15 minutes. Try again later.'],
      no_budget: ['No budget found', 'The event budget has not been set up yet.'],
      network: ['Can’t reach the budget', 'Check your internet connection and try again.']
    }[code] || ['Something went wrong', 'Please try again in a moment.'];
    document.title = C[0] + ' | Event Budget';
    gate('<div class="bud-gate-icon">' + icon(code === 'network' ? 'clock' : 'lock') + '</div><h1>' + esc(C[0]) + '</h1><p>' + esc(C[1]) + '</p>' +
      (code === 'network' ? '<button type="button" class="bud-btn primary" id="budRetry">Try again</button>' : '<a class="bud-btn ghost" href="/">Go to sharankrishnashortfilmawards.com</a>'));
    var rb = document.getElementById('budRetry'); if (rb) rb.onclick = function () { gate('<p class="bud-muted">Loading…</p>'); load(); };
  }
  function passcodeView(wrong) {
    gate('<div class="bud-gate-icon">' + icon('lock') + '</div><h1>Enter passcode</h1><p>This budget link is protected. Type the passcode the organisers gave you.</p>' +
      '<form class="bud-gate-form" id="budPc"><input type="password" id="budPcIn" autocomplete="off" maxlength="72" placeholder="Passcode" aria-label="Passcode" autofocus>' +
      (wrong ? '<p class="bud-err">That passcode isn’t right.</p>' : '') +
      '<button type="submit" class="bud-btn primary full">Open budget</button></form>');
    var inp = document.getElementById('budPcIn'); setTimeout(function () { inp.focus(); }, 50);
    document.getElementById('budPc').onsubmit = function (e) {
      e.preventDefault(); if (!inp.value) return;
      S.passcode = inp.value;
      try { sessionStorage.setItem('bud-pc:' + S.token.slice(0, 10), S.passcode); } catch (x) {}
      gate('<p class="bud-muted">Checking…</p>'); load();
    };
  }
  function askName(force) {
    S.nameAsked = true;
    if (S.name && !force) return;
    modal({
      title: 'Who’s editing?', cls: 'is-form sm', backdropClose: true,
      sub: 'Optional. Your name is shown in the budget history next to changes you make. It isn’t verified.',
      body: '<div class="bud-form"><label class="bud-field full"><span>Your name</span><input data-n maxlength="60" placeholder="e.g. Anjali — Hospitality" autofocus></label></div>',
      foot: '<span class="bud-spacer"></span><button type="button" class="bud-btn ghost" data-skip>Skip</button><button type="button" class="bud-btn primary" data-ok>Continue</button>',
      mount: function (m) {
        var inp = m.root.querySelector('[data-n]'); inp.value = S.name || '';
        function done() {
          S.name = inp.value.trim().slice(0, 60);
          try { localStorage.setItem('bud-name', S.name); } catch (x) {}
          renderAll(); m.close();
        }
        m.root.querySelector('[data-ok]').onclick = done;
        m.root.querySelector('[data-skip]').onclick = function () { m.close(); };
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
      }
    });
  }

  /* ───────── admin entry ───────── */
  function loginView(msg) {
    document.title = 'Event Budget | Sharankrishna Short Film Awards';
    gate('<h1>Event Budget</h1><p>' + esc(msg || 'Admin sign-in') + '</p>' +
      '<form class="bud-gate-form" id="budLogin"><input type="email" id="budEm" autocomplete="username" placeholder="admin@email.com" aria-label="Email" required>' +
      '<input type="password" id="budPw" autocomplete="current-password" placeholder="Password" aria-label="Password" required>' +
      '<p class="bud-err" id="budLe" hidden></p><button type="submit" class="bud-btn primary full">Sign in</button></form>' +
      '<a class="bud-link" href="/admin.html">Open the Admin Panel</a>');
    document.getElementById('budLogin').onsubmit = async function (e) {
      e.preventDefault();
      var le = document.getElementById('budLe'), btn = this.querySelector('button'); btn.disabled = true; le.hidden = true;
      var r = await sb.auth.signInWithPassword({ email: document.getElementById('budEm').value.trim(), password: document.getElementById('budPw').value });
      btn.disabled = false;
      if (r.error) { le.textContent = 'Email or password is incorrect.'; le.hidden = false; return; }
      startAdmin();
    };
  }
  async function startAdmin() {
    gate('<p class="bud-muted">Loading budget…</p>');
    try {
      var s = await sb.auth.getSession();
      if (!s.data.session) return loginView();
      var a = await sb.rpc('is_admin');
      if (a.error) throw a.error;
      if (a.data !== true) { await sb.auth.signOut(); return loginView('This account doesn’t have admin access.'); }
      load();
    } catch (e) { errorPage('network'); }
  }

  /* ───────── boot ───────── */
  if (MODE === 'share') {
    var raw = '';
    try { raw = decodeURIComponent((location.hash || '').replace(/^#/, '').replace(/^t=/, '')); } catch (e) {}
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) { errorPage(raw ? 'link_invalid' : 'no_token'); return; }
    S.token = raw;
    try { S.passcode = sessionStorage.getItem('bud-pc:' + raw.slice(0, 10)) || ''; } catch (e) {}
    try { S.name = localStorage.getItem('bud-name') || ''; } catch (e) {}
    window.addEventListener('hashchange', function () { location.reload(); });
    gate('<p class="bud-muted">Opening budget…</p>');
    load();
  } else {
    sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') { teardown(); loginView(); } });
    startAdmin();
  }
})();
