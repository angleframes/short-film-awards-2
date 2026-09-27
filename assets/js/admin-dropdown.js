/* AdminDropdown — Sharankrishna-styled replacement for native <select> in the admin panel.
   Usage: AdminDropdown.enhance(selectEl [, { search: true|false, placeholder }])
   The native <select> stays in the DOM (hidden) and remains the source of truth:
   picking an option sets select.value and dispatches a bubbling "change" event,
   so existing code that reads select.value keeps working.
   Keyboard: Enter / Space / ↓ open · ↑ ↓ move · Home / End · Enter select · Esc close · type to search. */
window.AdminDropdown = (function () {
  'use strict';

  let open = null; // currently open instance

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uid = 0;

  document.addEventListener('click', e => { if (open && !open.root.contains(e.target)) open.close(); });
  window.addEventListener('resize', () => { if (open) open.close(); });

  function enhance(select, opts) {
    if (!select || select.tagName !== 'SELECT' || select._adEnhanced) return select && select._adEnhanced;
    opts = opts || {};
    const id = 'ad' + (++uid);
    const options = () => Array.from(select.options).filter(o => !o.hidden).map(o => ({ value: o.value, label: o.textContent, disabled: o.disabled }));
    const searchable = opts.search != null ? opts.search : select.options.length > 7;

    const root = document.createElement('div');
    root.className = 'ad-select';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ad-trigger';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id + '-list');
    const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
    if (label) { label.id = label.id || id + '-label'; btn.setAttribute('aria-labelledby', label.id + ' ' + id + '-value'); label.htmlFor = id + '-btn'; }
    else if (select.getAttribute('aria-label')) btn.setAttribute('aria-label', select.getAttribute('aria-label'));
    btn.id = id + '-btn';
    btn.innerHTML = `<span class="ad-value" id="${id}-value"></span><svg class="ad-chevron" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

    const pop = document.createElement('div');
    pop.className = 'ad-pop';
    pop.hidden = true;
    pop.innerHTML = (searchable ? `<input type="text" class="ad-search" placeholder="Search…" aria-label="Search options" autocomplete="off">` : '') +
      `<ul class="ad-list" role="listbox" id="${id}-list" tabindex="-1"></ul>`;

    root.append(btn, pop);
    select.after(root);
    select.classList.add('ad-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const list = pop.querySelector('.ad-list');
    const search = pop.querySelector('.ad-search');
    let active = -1, shown = [];

    function syncLabel() {
      const cur = options().find(o => o.value === select.value);
      btn.querySelector('.ad-value').textContent = cur ? cur.label : (opts.placeholder || 'Select…');
      btn.classList.toggle('is-placeholder', !cur || !cur.value);
      btn.disabled = select.disabled;
    }

    function renderList() {
      const q = search ? search.value.trim().toLowerCase() : '';
      shown = options().filter(o => !q || o.label.toLowerCase().includes(q));
      list.innerHTML = shown.length ? shown.map((o, i) => `<li role="option" id="${id}-o${i}" class="ad-opt${o.value === select.value ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}" aria-selected="${o.value === select.value}" data-i="${i}">${esc(o.label)}</li>`).join('')
        : '<li class="ad-empty" role="presentation">No matches</li>';
      setActive(Math.max(0, shown.findIndex(o => o.value === select.value)));
    }

    function setActive(i) {
      if (!shown.length) { active = -1; return; }
      active = Math.max(0, Math.min(shown.length - 1, i));
      list.querySelectorAll('.ad-opt').forEach((li, k) => li.classList.toggle('is-active', k === active));
      const li = list.querySelector(`#${id}-o${active}`);
      if (li) { li.scrollIntoView({ block: 'nearest' }); (search || list).setAttribute('aria-activedescendant', li.id); }
    }

    function place() {
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      pop.classList.toggle('is-up', below < 280 && r.top > below);
    }

    function openPop() {
      if (open && open !== api) open.close();
      if (btn.disabled) return;
      open = api;
      pop.hidden = false; root.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
      if (search) search.value = '';
      renderList(); place();
      (search || list).focus({ preventScroll: true });
    }
    function close(focusBtn) {
      pop.hidden = true; root.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
      if (open === api) open = null;
      if (focusBtn) btn.focus({ preventScroll: true });
    }
    function choose(i) {
      const o = shown[i];
      if (!o || o.disabled) return;
      const changed = select.value !== o.value;
      select.value = o.value;
      syncLabel(); close(true);
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    btn.addEventListener('click', () => (pop.hidden ? openPop() : close(true)));
    btn.addEventListener('keydown', e => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openPop(); }
    });
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => { const li = e.target.closest('.ad-opt'); if (li) choose(+li.dataset.i); });
    list.addEventListener('mousemove', e => { const li = e.target.closest('.ad-opt'); if (li && +li.dataset.i !== active) setActive(+li.dataset.i); });
    pop.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    if (search) search.addEventListener('input', renderList);
    // external value changes (e.g. code sets select.value then dispatches change)
    select.addEventListener('change', syncLabel);

    const api = { root, close, refresh: syncLabel };
    select._adEnhanced = api;
    syncLabel();
    return api;
  }

  function enhanceAll(scope, opts) {
    (scope || document).querySelectorAll('select:not(.ad-native)').forEach(s => enhance(s, opts));
  }

  return { enhance, enhanceAll };
})();
