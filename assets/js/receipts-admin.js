/* Admin → Payment Receipts: every Paid submission with its own receipt (same PDF the filmmaker downloads).
   Reads film_entries (admin-only RLS). Pending / failed rows never get a receipt. */
window.ReceiptsAdmin = (function () {
  'use strict';

  let sb = null;
  let rows = [];
  let q = '';
  let track = 'all';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const fmtDate = v => { const d = new Date(v); return v && !isNaN(d) ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'; };
  const inr = n => isFinite(Number(n)) ? '₹' + Number(n).toLocaleString('en-IN') : '—';
  const FIELDS = 'id,applicant_name,email,film_name,category,amount,currency,cashfree_order_id,cashfree_payment_id,payment_method,paid_at,payment_status,archived';

  async function load() {
    const root = document.getElementById('receiptsAdmin');
    if (!root || !sb) return;
    root.innerHTML = '<p class="muted-note">Loading…</p>';
    const { data, error } = await sb.from('film_entries').select(FIELDS).eq('payment_status', 'Paid').order('paid_at', { ascending: false });
    if (error) { root.innerHTML = `<p class="muted-note">Could not load payments (${esc(error.message)}).</p>`; return; }
    rows = (data || []).filter(r => window.SKReceipt && SKReceipt.fromEntry(r));
    render();
  }

  function filtered() {
    const s = q.trim().toLowerCase();
    return rows.filter(r => {
      if (track !== 'all' && String(r.category || '').toLowerCase() !== track) return false;
      if (!s) return true;
      const rn = window.SKReceipt ? SKReceipt.receiptNumber(r.cashfree_order_id) : '';
      return [r.applicant_name, r.film_name, r.email, r.cashfree_order_id, r.cashfree_payment_id, rn]
        .some(v => String(v || '').toLowerCase().includes(s));
    });
  }

  function rowHtml(r, i) {
    const rn = SKReceipt.receiptNumber(r.cashfree_order_id);
    return `<div class="mg-row rc-row" data-id="${r.id}">
      <span class="mg-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="mg-info">
        <b>${esc(r.applicant_name || '—')} · ${esc(r.film_name || '—')}</b>
        <small><span class="rc-mono">${esc(rn)}</span> · ${inr(r.amount)} · ${esc(fmtDate(r.paid_at))} · ${esc(SKReceipt.categoryLabel(r.category))}${r.archived ? ' · Archived' : ''}</small>
        <small>${esc(r.email || '')} · Order <span class="rc-mono">${esc(r.cashfree_order_id || '')}</span></small>
      </span>
      <span class="mg-actions">
        <span class="tag paid">Paid</span>
        <button type="button" class="btn-ghost btn-xs" data-act="receipt">Download receipt</button>
      </span>
    </div>`;
  }

  function renderList() {
    const list = filtered();
    const box = document.getElementById('rcList');
    const count = document.getElementById('rcCount');
    if (count) count.textContent = `${list.length} of ${rows.length} paid submission${rows.length === 1 ? '' : 's'}`;
    if (!box) return;
    box.innerHTML = list.length ? list.map(rowHtml).join('') : '<p class="muted-note">No paid submissions match.</p>';
  }

  function render() {
    const root = document.getElementById('receiptsAdmin');
    root.innerHTML = `
      <div class="mg-toolbar rc-toolbar">
        <input type="search" id="rcSearch" class="rc-search" placeholder="Search name, film, email, order ID or receipt no." value="${esc(q)}" aria-label="Search receipts">
        <div class="rc-filter" role="group" aria-label="Filter by track">
          ${[['all', 'All'], ['general', 'General'], ['campus', 'Campus']].map(([k, l]) => `<button type="button" class="btn-ghost btn-xs${track === k ? ' is-active' : ''}" data-track="${k}" aria-pressed="${track === k}">${l}</button>`).join('')}
        </div>
        <span class="mg-spacer"></span>
        <span class="muted-note rc-count" id="rcCount"></span>
      </div>
      <p class="muted-note">Each paid submission has its own receipt. The receipt number comes from that payment's Cashfree order, so it never changes and matches the copy the filmmaker downloads after paying. Pending or failed payments are not listed and cannot produce a receipt.</p>
      <div class="mg-list" id="rcList"></div>`;
    renderList();
    document.getElementById('rcSearch').addEventListener('input', e => { q = e.target.value; renderList(); });
    root.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => { track = b.dataset.track; render(); }));
    document.getElementById('rcList').addEventListener('click', e => {
      const b = e.target.closest('[data-act="receipt"]'); if (!b) return;
      const r = rows.find(x => x.id === +b.closest('.rc-row').dataset.id);
      download(r, b);
    });
  }

  // Shared by this tab and the entry popup. Re-reads the row so the PDF reflects the stored payment.
  async function download(row, btn) {
    if (!row || !window.SKReceipt) return;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const { data, error } = await sb.from('film_entries').select(FIELDS).eq('id', row.id).single();
      if (error) throw error;
      const rec = SKReceipt.fromEntry(data);
      if (!rec) throw new Error('This submission is not marked Paid, so no receipt is available.');
      await SKReceipt.download(rec);
    } catch (e) {
      notify('Receipt failed: ' + (e.message || e), 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function init(client) { sb = client; }
  return { init, load, download };
})();
