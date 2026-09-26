/* Admin editor for the public "Prizes & Recognition" section.
   Saves to site_config.recognition; the website falls back to the same defaults when empty. */
window.RecAdmin = (function () {
  'use strict';

  const DEFAULTS = {
    show_amounts: false,
    intro: 'The Sharankrishna Short Film Awards celebrates outstanding filmmaking across both the Campus and General categories, recognising exceptional films, performances, storytelling and technical excellence.',
    main: [
      { key: 'best_campus_film', label: 'Campus Category',
        description: 'The Campus Category is dedicated to recognising outstanding filmmaking talent from student and campus filmmakers.',
        tiers: [
          { label: 'First Prize', benefits: ['cash', 'memento', 'certificate'], amount: '' },
          { label: 'Special Jury Mention', benefits: ['cash', 'memento', 'certificate'], amount: '' },
        ] },
      { key: 'best_short_film', label: 'General Category',
        description: 'The General Category recognises outstanding independent and professional short films participating in the festival.',
        tiers: [
          { label: 'First Prize', benefits: ['cash', 'memento', 'certificate'], amount: '' },
          { label: 'Special Jury Mention', benefits: ['cash', 'memento', 'certificate'], amount: '' },
        ] },
    ],
    others: {
      title: 'Individual & Technical Awards',
      description: 'Honouring the artists and craftspeople whose work brings each film to life.',
      benefits: ['memento', 'certificate'],
      byKey: {},
    },
    nominee: {
      enabled: true,
      title: 'Angle Frames Special Award',
      subtitle: 'For every officially nominated entry',
      description: 'Every officially nominated entry will receive special recognition from Angle Frames, celebrating the films that earn a place in the festival’s official selection.',
      benefits: ['memento', 'certificate'],
      extra: [],
    },
  };
  const BENEFITS = [['cash', 'Cash Prize'], ['memento', 'Memento'], ['certificate', 'Certificate']];

  let sb = null;
  let state = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const notify = (m, k) => (typeof window.toast === 'function' ? window.toast(m, k) : console.log(m));
  const cats = () => { try { return (_awardCats || []).map(c => ({ key: c.key, name: c.name })); } catch (e) { return []; } };

  function merge(saved) {
    const b = clone(DEFAULTS);
    if (!saved || typeof saved !== 'object') return b;
    if (typeof saved.show_amounts === 'boolean') b.show_amounts = saved.show_amounts;
    if (saved.intro) b.intro = saved.intro;
    if (Array.isArray(saved.main) && saved.main.length) b.main = saved.main.map((m, i) => Object.assign({}, DEFAULTS.main[i] || {}, m));
    if (saved.others) Object.assign(b.others, saved.others);
    if (saved.nominee) Object.assign(b.nominee, saved.nominee);
    return b;
  }

  const checks = (name, selected) => BENEFITS.map(([v, l]) =>
    `<label class="rec-chk"><input type="checkbox" data-b="${name}" value="${v}" ${selected.includes(v) ? 'checked' : ''}> ${l}</label>`).join('');

  function render() {
    const root = document.getElementById('recAdmin');
    if (!root || !state) return;
    const s = state;
    const catOpts = sel => cats().map(c => `<option value="${esc(c.key)}" ${c.key === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const mainKeys = s.main.map(m => m.key);
    const otherCats = cats().filter(c => !mainKeys.includes(c.key));

    root.innerHTML = `
      <label class="rec-switch-row"><input type="checkbox" id="recShowAmounts" ${s.show_amounts ? 'checked' : ''}>
        <span><b>Show cash prize amounts on the website</b><br><small>Off: visitors only see “Cash Prize”. Amounts you type below stay hidden until you switch this on.</small></span></label>

      <label for="recIntro">Introduction</label>
      <textarea id="recIntro" rows="3">${esc(s.intro || '')}</textarea>

      <div class="rec-admin-grid">
        ${s.main.map((m, mi) => `
          <div class="rec-admin-box">
            <div class="grid2">
              <div><label>Section name</label><input type="text" data-main="${mi}" data-f="label" value="${esc(m.label)}"></div>
              <div><label>Linked award category</label><select data-main="${mi}" data-f="key">${catOpts(m.key)}</select></div>
            </div>
            <label>Description</label>
            <textarea rows="3" data-main="${mi}" data-f="description">${esc(m.description || '')}</textarea>
            ${(m.tiers || []).map((t, ti) => `
              <div class="rec-admin-tier">
                <input type="text" class="rec-tier-name" data-main="${mi}" data-tier="${ti}" data-f="label" value="${esc(t.label)}" aria-label="Prize name">
                <div class="rec-chks">${checks('m' + mi + 't' + ti, t.benefits || [])}</div>
                <input type="text" class="rec-amount" data-main="${mi}" data-tier="${ti}" data-f="amount" value="${esc(t.amount || '')}" placeholder="Amount e.g. ₹25,000 (hidden)">
              </div>`).join('')}
          </div>`).join('')}
      </div>

      <div class="rec-admin-box">
        <div class="rec-admin-sub">Individual &amp; technical awards</div>
        <div class="grid2">
          <div><label for="recOthTitle">Heading</label><input type="text" id="recOthTitle" value="${esc(s.others.title || '')}"></div>
          <div><label for="recOthDesc">Description</label><input type="text" id="recOthDesc" value="${esc(s.others.description || '')}"></div>
        </div>
        <div class="rec-admin-row"><span>Default (new categories)</span><div class="rec-chks">${checks('odef', s.others.benefits)}</div></div>
        ${otherCats.map(c => `<div class="rec-admin-row"><span>${esc(c.name)}</span><div class="rec-chks">${checks('ok_' + c.key, Array.isArray(s.others.byKey[c.key]) ? s.others.byKey[c.key] : s.others.benefits)}</div></div>`).join('')}
      </div>

      <div class="rec-admin-box rec-admin-nominee">
        <label class="rec-switch-row"><input type="checkbox" id="recNomEnabled" ${s.nominee.enabled ? 'checked' : ''}>
          <span><b>Show the Official Nominees award</b><br><small>Special recognition for officially nominated entries.</small></span></label>
        <div class="grid2">
          <div><label>Award name</label><input type="text" id="recNomTitle" value="${esc(s.nominee.title)}"></div>
          <div><label>Small heading</label><input type="text" id="recNomSub" value="${esc(s.nominee.subtitle || '')}"></div>
        </div>
        <label for="recNomDesc">Description</label>
        <textarea id="recNomDesc" rows="3">${esc(s.nominee.description || '')}</textarea>
        <div class="rec-chks">${checks('nom', s.nominee.benefits || [])}</div>
        <label for="recNomExtra" style="margin-top:12px;">Extra benefits (comma-separated, optional)</label>
        <input type="text" id="recNomExtra" value="${esc((s.nominee.extra || []).join(', '))}" placeholder="e.g. Festival Screening">
      </div>

      <div class="rec-admin-actions">
        <button type="button" class="btn" onclick="RecAdmin.save(this)">Save prizes</button>
        <button type="button" class="btn-ghost btn-sm" onclick="RecAdmin.resetDefaults()">Reset to defaults</button>
        <span class="muted-note" id="recSaved"></span>
      </div>`;
  }

  const picked = name => Array.from(document.querySelectorAll(`#recAdmin input[data-b="${name}"]:checked`)).map(i => i.value);

  function collect() {
    const s = clone(state);
    s.show_amounts = document.getElementById('recShowAmounts').checked;
    s.intro = document.getElementById('recIntro').value.trim();
    s.others.title = document.getElementById('recOthTitle').value.trim() || DEFAULTS.others.title;
    s.others.description = document.getElementById('recOthDesc').value.trim();
    s.nominee.description = document.getElementById('recNomDesc').value.trim();
    s.main.forEach((m, mi) => {
      m.label = (document.querySelector(`input[data-main="${mi}"][data-f="label"]:not([data-tier])`).value || '').trim() || m.label;
      m.key = document.querySelector(`select[data-main="${mi}"]`).value || m.key;
      m.description = document.querySelector(`textarea[data-main="${mi}"][data-f="description"]`).value.trim();
      m.tiers.forEach((t, ti) => {
        t.label = (document.querySelector(`[data-main="${mi}"][data-tier="${ti}"][data-f="label"]`).value || '').trim() || t.label;
        t.amount = (document.querySelector(`[data-main="${mi}"][data-tier="${ti}"][data-f="amount"]`).value || '').trim();
        t.benefits = picked('m' + mi + 't' + ti);
      });
    });
    s.others.benefits = picked('odef');
    const byKey = {};
    const mainKeys = s.main.map(m => m.key);
    cats().filter(c => !mainKeys.includes(c.key)).forEach(c => { byKey[c.key] = picked('ok_' + c.key); });
    s.others.byKey = byKey;
    s.nominee.enabled = document.getElementById('recNomEnabled').checked;
    s.nominee.title = document.getElementById('recNomTitle').value.trim() || DEFAULTS.nominee.title;
    s.nominee.subtitle = document.getElementById('recNomSub').value.trim();
    s.nominee.benefits = picked('nom');
    s.nominee.extra = document.getElementById('recNomExtra').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 6);
    return s;
  }

  async function load() {
    const root = document.getElementById('recAdmin');
    if (!root || !sb) return;
    const { data, error } = await sb.from('site_config').select('recognition').eq('id', 1).single();
    if (error) {
      root.innerHTML = `<p class="muted-note">Prize settings are unavailable (${esc(error.message)}). The website is showing the default prizes.</p>`;
      return;
    }
    state = merge(data && data.recognition);
    render();
  }

  async function save(btn) {
    if (!state) return;
    const next = collect();
    const mainKeys = next.main.map(m => m.key);
    if (new Set(mainKeys).size !== mainKeys.length) return notify('Campus and General must link to different award categories.', 'err');
    if (btn) btn.disabled = true;
    const { error } = await sb.from('site_config').update({ recognition: next, updated_at: new Date().toISOString() }).eq('id', 1);
    if (btn) btn.disabled = false;
    if (error) return notify('Save failed: ' + error.message, 'err');
    state = next;
    render();
    const el = document.getElementById('recSaved');
    if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString('en-IN') + ' — live on the website';
    notify('Prizes & recognition saved', 'ok');
  }

  function resetDefaults() { state = clone(DEFAULTS); render(); notify('Defaults restored — click Save prizes to publish.'); }

  function init(client) { sb = client; }

  return { init, load, save, resetDefaults, DEFAULTS };
})();
