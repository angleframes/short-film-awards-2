/* ═══════════════════════════════════════════════════════════════════
   SKSFA UI COMPONENT LIBRARY — JavaScript
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── Toast System ──────────────────────────────────────────────────
  let _toastContainer;
  function _ensureContainer() {
    if (_toastContainer) return _toastContainer;
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
    return _toastContainer;
  }

  const TOAST_ICONS = {
    error:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    success: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11.5 14.5 16 9.5"/></svg>',
    warn:    '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function showToast(msg, type, opts) {
    type = type || 'info';
    opts = opts || {};
    var duration = opts.duration || (type === 'error' ? 6000 : 4000);
    var title = opts.title || '';

    var container = _ensureContainer();
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;

    el.innerHTML =
      '<span class="toast-icon">' + (TOAST_ICONS[type] || TOAST_ICONS.info) + '</span>' +
      '<div class="toast-body">' +
        (title ? '<div class="toast-title">' + title + '</div>' : '') +
        '<div class="toast-msg">' + msg + '</div>' +
      '</div>' +
      '<button class="toast-close" aria-label="Close"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';

    el.querySelector('.toast-close').onclick = function() { dismiss(el); };
    container.appendChild(el);

    var timer = setTimeout(function() { dismiss(el); }, duration);
    function dismiss(t) {
      clearTimeout(timer);
      t.classList.add('toast-out');
      setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }
    return el;
  }

  // ── Confirm Dialog ────────────────────────────────────────────────
  function showConfirm(msg, opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';

      var title = opts.title || 'Confirm';
      var okText = opts.okText || 'OK';
      var cancelText = opts.cancelText || 'Cancel';
      var danger = opts.danger || false;

      overlay.innerHTML =
        '<div class="confirm-box">' +
          '<h3>' + title + '</h3>' +
          '<p>' + msg + '</p>' +
          '<div class="confirm-actions">' +
            '<button class="confirm-btn confirm-btn-cancel">' + cancelText + '</button>' +
            '<button class="confirm-btn ' + (danger ? 'confirm-btn-danger' : 'confirm-btn-ok') + '">' + okText + '</button>' +
          '</div>' +
        '</div>';

      var btns = overlay.querySelectorAll('.confirm-btn');
      btns[0].onclick = function() { close(false); };
      btns[1].onclick = function() { close(true); };

      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) close(false);
      });

      document.addEventListener('keydown', onKey);
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      }

      function close(result) {
        document.removeEventListener('keydown', onKey);
        overlay.style.opacity = '0';
        setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
        resolve(result);
      }

      document.body.appendChild(overlay);
      btns[1].focus();
    });
  }

  // ── Alert replacement ─────────────────────────────────────────────
  function showAlert(msg, type) {
    return showToast(msg, type || 'warn', { duration: 5000 });
  }

  // ── CSelect ───────────────────────────────────────────────────────
  function CSelect(el, opts) {
    opts = opts || {};
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el || el._cselect) return el._cselect;

    var nativeSelect = el;
    var options = [];
    var selectedValue = '';
    var placeholder = opts.placeholder || nativeSelect.getAttribute('data-placeholder') || 'Select…';
    var onChange = opts.onChange || null;

    // Read options from native select
    Array.prototype.forEach.call(nativeSelect.options, function(opt) {
      if (opt.value) {
        options.push({ value: opt.value, label: opt.textContent });
      }
    });
    selectedValue = nativeSelect.value;

    // Hide native
    nativeSelect.style.display = 'none';

    // Build custom
    var wrap = document.createElement('div');
    wrap.className = 'cselect';
    wrap.setAttribute('tabindex', '0');

    var trigger = document.createElement('div');
    trigger.className = 'cselect-trigger';
    trigger.innerHTML =
      '<span class="cselect-label"></span>' +
      '<span class="cselect-arrow"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>';

    var dropdown = document.createElement('div');
    dropdown.className = 'cselect-dropdown';

    options.forEach(function(opt) {
      var item = document.createElement('div');
      item.className = 'cselect-option';
      item.setAttribute('data-value', opt.value);
      item.textContent = opt.label;
      item.onclick = function(e) {
        e.stopPropagation();
        select(opt.value);
        closeDropdown();
      };
      dropdown.appendChild(item);
    });

    wrap.appendChild(trigger);
    wrap.appendChild(dropdown);
    nativeSelect.parentNode.insertBefore(wrap, nativeSelect.nextSibling);

    function updateLabel() {
      var label = trigger.querySelector('.cselect-label');
      var found = options.find(function(o) { return o.value === selectedValue; });
      if (found) {
        label.textContent = found.label;
        label.classList.remove('cselect-placeholder');
      } else {
        label.textContent = placeholder;
        label.classList.add('cselect-placeholder');
      }
      dropdown.querySelectorAll('.cselect-option').forEach(function(o) {
        o.classList.toggle('selected', o.getAttribute('data-value') === selectedValue);
      });
    }

    function select(val) {
      selectedValue = val;
      nativeSelect.value = val;
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      updateLabel();
      if (onChange) onChange(val);
    }

    function openDropdown() { wrap.classList.add('open'); }
    function closeDropdown() { wrap.classList.remove('open'); }
    function toggle() { wrap.classList.contains('open') ? closeDropdown() : openDropdown(); }

    trigger.onclick = function(e) { e.stopPropagation(); toggle(); };
    wrap.onkeydown = function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'Escape') closeDropdown();
    };

    document.addEventListener('click', function() { closeDropdown(); });

    updateLabel();

    var api = { select: select, getValue: function() { return selectedValue; }, el: wrap };
    el._cselect = api;
    return api;
  }

  // ── File Upload Enhancer ──────────────────────────────────────────
  function CFileUpload(container, opts) {
    opts = opts || {};
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return;

    var input = container.querySelector('input[type="file"]');
    if (!input) return;

    // Drag events
    ['dragenter', 'dragover'].forEach(function(ev) {
      container.addEventListener(ev, function(e) {
        e.preventDefault();
        container.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function(ev) {
      container.addEventListener(ev, function(e) {
        e.preventDefault();
        container.classList.remove('dragover');
      });
    });

    container.addEventListener('drop', function(e) {
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // Preview
    input.addEventListener('change', function() {
      var file = input.files[0];
      var nameEl = container.querySelector('.cfile-upload-name');
      var previewEl = container.querySelector('.cfile-upload-preview');

      if (file) {
        container.classList.add('has-file');
        if (nameEl) nameEl.textContent = file.name;
        if (previewEl && file.type.startsWith('image/')) {
          var reader = new FileReader();
          reader.onload = function(e) { previewEl.src = e.target.result; };
          reader.readAsDataURL(file);
        }
      } else {
        container.classList.remove('has-file');
        if (nameEl) nameEl.textContent = '';
        if (previewEl) previewEl.src = '';
      }

      if (opts.onChange) opts.onChange(file);
    });
  }

  // ── Button ripple effect ──────────────────────────────────────────
  document.addEventListener('mousedown', function(e) {
    var btn = e.target.closest('.cbtn, .btn-wizard-action, .btn-primary, .btn');
    if (btn) {
      var rect = btn.getBoundingClientRect();
      btn.style.setProperty('--ripple-x', ((e.clientX - rect.left) / rect.width * 100) + '%');
      btn.style.setProperty('--ripple-y', ((e.clientY - rect.top) / rect.height * 100) + '%');
    }
  });

  // ── Export ─────────────────────────────────────────────────────────
  window.UI = {
    toast:   showToast,
    confirm: showConfirm,
    alert:   showAlert,
    CSelect: CSelect,
    CFileUpload: CFileUpload
  };
})();
