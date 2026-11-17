/* SKDate — Sharankrishna date / date-time picker that replaces the browser's native picker.
   Usage: SKDate.enhance(input)  · SKDate.auto(scope)  (enhances now + every input added later)
   Works on <input type="date"> and <input type="datetime-local">. The native input stays in the DOM
   (hidden) as the single source of truth: picking sets input.value in the native format and fires
   bubbling "input" + "change"; code that sets input.value directly keeps the label in sync.
   Keyboard: Enter/Space/↓ open · arrows move day · PageUp/PageDown month (+Shift year) · Home/End week
   · Enter pick · Esc close. Phones get a bottom sheet that sits above the on-screen keyboard.
   Add data-native to an input to opt out. */
window.SKDate = (function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var open = null, uid = 0;
  var SVG = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; };
  var IC = {
    cal: SVG('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
    x: SVG('<path d="M7 7l10 10M17 7L7 17"/>'),
    prev: SVG('<path d="M14.5 6l-6 6 6 6"/>'),
    next: SVG('<path d="M9.5 6l6 6-6 6"/>')
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v || '');
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
  }
  function ymd(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function human(p, withTime) {
    var dt = new Date(p.y, p.m, p.d, p.h || 0, p.mi || 0);
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
      (withTime ? ', ' + dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
  }
  function sheetMode() { return window.matchMedia('(max-width: 640px)').matches; }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

  function enhance(input, opts) {
    if (!input || input._skd) return input && input._skd;
    var type = (input.getAttribute('type') || '').toLowerCase();
    if (type !== 'date' && type !== 'datetime-local') return null;
    if (input.hasAttribute('data-native')) return null;
    opts = opts || {};
    var withTime = type === 'datetime-local';
    var id = 'skd' + (++uid);

    var wrap = document.createElement('div');
    wrap.className = 'skd';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skd-trigger';
    btn.id = id + '-btn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="skd-ic">' + IC.cal + '</span><span class="skd-val"></span>';
    var clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'skd-clear';
    clr.setAttribute('aria-label', 'Clear');
    clr.innerHTML = IC.x;

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(btn); wrap.appendChild(clr); wrap.appendChild(input);
    input.classList.add('skd-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    // the visible label now points at our button
    var labelText = '';
    var lab = input.id ? document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(input.id) : input.id) + '"]') : null;
    if (lab) { lab.htmlFor = btn.id; labelText = lab.textContent.trim(); }
    else {
      var host = input.closest('label') || (wrap.parentNode && wrap.parentNode.querySelector('label'));
      if (host) labelText = (host.querySelector('span') || host).textContent.trim();
    }
    labelText = labelText.replace(/\s+/g, ' ');
    var ph = opts.placeholder || input.getAttribute('placeholder') || (withTime ? 'Select date & time' : 'Select date');

    function sync() {
      var p = parse(desc.get.call(input));
      btn.querySelector('.skd-val').textContent = p ? human(p, withTime) : ph;
      btn.classList.toggle('is-empty', !p);
      clr.hidden = !p || input.required || input.disabled;
      btn.disabled = input.disabled;
      btn.setAttribute('aria-label', (labelText ? labelText + ': ' : '') + (p ? human(p, withTime) : 'not set'));
    }
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: function () { return desc.get.call(input); },
      set: function (v) { desc.set.call(input, v); sync(); }
    });
    new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled', 'required', 'min', 'max'] });

    function commit(v) {
      if (desc.get.call(input) === v) return;
      desc.set.call(input, v); sync();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    btn.addEventListener('click', function () { if (open && open.input === input) close(true); else show(); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } });
    clr.addEventListener('click', function () { commit(''); btn.focus(); });
    input.addEventListener('focus', function () { btn.focus(); });

    function show() {
      close(false);
      var cur = parse(desc.get.call(input)), now = new Date();
      var sel = cur ? { y: cur.y, m: cur.m, d: cur.d } : null;
      var view = { y: cur ? cur.y : now.getFullYear(), m: cur ? cur.m : now.getMonth() };
      var t = { h: cur && cur.h != null ? cur.h : (opts.defaultHour != null ? opts.defaultHour : 10), mi: cur && cur.mi != null ? cur.mi : 0 };
      var focusD = sel ? sel.d : (view.y === now.getFullYear() && view.m === now.getMonth() ? now.getDate() : 1);
      var minS = (input.min || '').slice(0, 10), maxS = (input.max || '').slice(0, 10);
      var sheet = sheetMode() || window.innerHeight < (withTime ? 520 : 440);   // too short for a dropdown → sheet

      var back = null;
      if (sheet) {
        back = document.createElement('div');
        back.className = 'skd-backdrop';
        document.body.appendChild(back);
        back.addEventListener('click', function () { close(true); });
      }
      var pan = document.createElement('div');
      pan.className = 'skd-panel' + (sheet ? ' is-sheet' : '');
      pan.setAttribute('role', 'dialog');
      pan.setAttribute('aria-label', (labelText || (withTime ? 'Date and time' : 'Date')) + ' picker');
      if (sheet) pan.setAttribute('aria-modal', 'true');
      pan.innerHTML =
        (sheet ? '<div class="skd-sheet-head"><strong>' + (labelText || (withTime ? 'Date & time' : 'Date')).replace(/[<>&]/g, '') + '</strong></div>' : '') +
        '<div class="skd-head"><button type="button" class="skd-nav" data-nav="-1" aria-label="Previous month">' + IC.prev + '</button>' +
        '<div class="skd-title" aria-live="polite"></div>' +
        '<button type="button" class="skd-nav" data-nav="1" aria-label="Next month">' + IC.next + '</button></div>' +
        '<div class="skd-wd" aria-hidden="true">' + WD.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
        '<div class="skd-grid" role="grid"></div>' +
        (withTime ? '<div class="skd-time"><span class="skd-time-l">Time</span>' +
          '<div class="skd-tbox"><input class="skd-h" inputmode="numeric" maxlength="2" aria-label="Hour" autocomplete="off"><span>:</span>' +
          '<input class="skd-m" inputmode="numeric" maxlength="2" aria-label="Minutes" autocomplete="off"></div>' +
          '<div class="skd-ampm" role="radiogroup" aria-label="AM or PM"><button type="button" role="radio" data-ap="am">AM</button><button type="button" role="radio" data-ap="pm">PM</button></div></div>' : '') +
        '<div class="skd-foot"><button type="button" class="skd-link" data-today>' + (withTime ? 'Now' : 'Today') + '</button>' +
        (input.required ? '' : '<button type="button" class="skd-link" data-clear>Clear</button>') +
        '<span class="skd-sp"></span><button type="button" class="skd-done" data-done>Done</button></div>';
      document.body.appendChild(pan);
      var grid = pan.querySelector('.skd-grid');

      function outOfRange(y, m, d) { var s = ymd(y, m, d); return (minS && s < minS) || (maxS && s > maxS); }
      function value() {
        if (!sel) return '';
        return ymd(sel.y, sel.m, sel.d) + (withTime ? 'T' + pad(t.h) + ':' + pad(t.mi) : '');
      }
      function draw(focus) {
        pan.querySelector('.skd-title').textContent = MONTHS[view.m] + ' ' + view.y;
        var first = (new Date(view.y, view.m, 1).getDay() + 6) % 7, n = daysIn(view.y, view.m);
        var todayS = ymd(now.getFullYear(), now.getMonth(), now.getDate());
        if (focusD > n) focusD = n;
        var cells = [], i;
        for (i = 0; i < first; i++) cells.push('<span class="skd-pad" role="gridcell"></span>');
        for (i = 1; i <= n; i++) {
          var s = ymd(view.y, view.m, i), isSel = sel && sel.y === view.y && sel.m === view.m && sel.d === i;
          cells.push('<button type="button" role="gridcell" class="skd-day' + (s === todayS ? ' is-today' : '') + (isSel ? ' is-sel' : '') + '"' +
            ' data-d="' + i + '" tabindex="' + (i === focusD ? 0 : -1) + '" aria-selected="' + (isSel ? 'true' : 'false') + '"' +
            ' aria-label="' + i + ' ' + MONTHS[view.m] + ' ' + view.y + (s === todayS ? ', today' : '') + '"' + (outOfRange(view.y, view.m, i) ? ' disabled' : '') + '>' + i + '</button>');
        }
        while (cells.length % 7) cells.push('<span class="skd-pad" role="gridcell"></span>');
        var rows = [];
        for (i = 0; i < cells.length; i += 7) rows.push('<div class="skd-row" role="row">' + cells.slice(i, i + 7).join('') + '</div>');
        grid.innerHTML = rows.join('');
        if (focus) { var f = grid.querySelector('[data-d="' + focusD + '"]'); if (f) f.focus({ preventScroll: true }); }
        if (withTime) drawTime();
      }
      function drawTime() {
        var h12 = t.h % 12 || 12, pm = t.h >= 12;
        var hi = pan.querySelector('.skd-h'), mi = pan.querySelector('.skd-m');
        if (document.activeElement !== hi) hi.value = pad(h12);
        if (document.activeElement !== mi) mi.value = pad(t.mi);
        pan.querySelectorAll('[data-ap]').forEach(function (b) {
          var on = (b.getAttribute('data-ap') === 'pm') === pm;
          b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      }
      function move(days) {
        var dt = new Date(view.y, view.m, focusD + days);
        view.y = dt.getFullYear(); view.m = dt.getMonth(); focusD = dt.getDate(); draw(true);
      }
      function shiftMonth(k) {
        var dt = new Date(view.y, view.m + k, 1);
        view.y = dt.getFullYear(); view.m = dt.getMonth(); focusD = Math.min(focusD, daysIn(view.y, view.m)); draw(true);
      }
      function pick(d) {
        if (outOfRange(view.y, view.m, d)) return;
        sel = { y: view.y, m: view.m, d: d }; focusD = d;
        commit(value());
        if (!withTime) { close(true); return; }
        draw(true);
      }
      function setTimeFromInputs() {
        var hv = parseInt(pan.querySelector('.skd-h').value, 10), mv = parseInt(pan.querySelector('.skd-m').value, 10);
        var pm = t.h >= 12;
        if (!isNaN(hv)) { hv = Math.min(12, Math.max(1, hv)); t.h = (hv % 12) + (pm ? 12 : 0); }
        if (!isNaN(mv)) t.mi = Math.min(59, Math.max(0, mv));
        drawTime();
        if (sel) commit(value());
      }

      pan.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-nav')) shiftMonth(+b.getAttribute('data-nav'));
        else if (b.hasAttribute('data-d')) pick(+b.getAttribute('data-d'));
        else if (b.hasAttribute('data-ap')) { var wantPm = b.getAttribute('data-ap') === 'pm'; if ((t.h >= 12) !== wantPm) t.h = (t.h + 12) % 24; drawTime(); if (sel) commit(value()); }
        else if (b.hasAttribute('data-today')) {
          var n2 = new Date(); view.y = n2.getFullYear(); view.m = n2.getMonth(); focusD = n2.getDate();
          if (withTime) { t.h = n2.getHours(); t.mi = n2.getMinutes(); }
          if (!outOfRange(view.y, view.m, focusD)) pick(focusD); else draw(true);
        }
        else if (b.hasAttribute('data-clear')) { commit(''); close(true); }
        else if (b.hasAttribute('data-done')) { if (withTime) setTimeFromInputs(); close(true); }
      });
      grid.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowLeft') move(-1); else if (k === 'ArrowRight') move(1);
        else if (k === 'ArrowUp') move(-7); else if (k === 'ArrowDown') move(7);
        else if (k === 'Home') move(-((new Date(view.y, view.m, focusD).getDay() + 6) % 7));
        else if (k === 'End') move(6 - ((new Date(view.y, view.m, focusD).getDay() + 6) % 7));
        else if (k === 'PageUp') shiftMonth(e.shiftKey ? -12 : -1);
        else if (k === 'PageDown') shiftMonth(e.shiftKey ? 12 : 1);
        else if (k === 'Enter' || k === ' ') { var f = e.target.closest('[data-d]'); if (f) pick(+f.getAttribute('data-d')); }
        else return;
        e.preventDefault();
      });
      if (withTime) {
        ['.skd-h', '.skd-m'].forEach(function (sel2) {
          var el = pan.querySelector(sel2);
          el.addEventListener('input', function () { el.value = el.value.replace(/\D/g, '').slice(0, 2); });
          el.addEventListener('change', setTimeFromInputs);
          el.addEventListener('blur', setTimeFromInputs);
          el.addEventListener('focus', function () { el.select(); });
          el.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') { if (e.key === 'Enter') { e.preventDefault(); setTimeFromInputs(); } return; }
            e.preventDefault();
            var up = e.key === 'ArrowUp' ? 1 : -1;
            if (sel2 === '.skd-h') t.h = (t.h + up + 24) % 24; else t.mi = (t.mi + up + 60) % 60;
            drawTime(); if (sel) commit(value());
          });
        });
      }
      pan.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        if (e.key === 'Tab') {   // keep focus inside the picker while it is open
          var f = Array.prototype.filter.call(pan.querySelectorAll('button:not([disabled]), input'), function (x) { return x.tabIndex !== -1 && x.offsetParent; });
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      });

      function place() {
        if (sheet) {
          var vv = window.visualViewport;
          pan.style.bottom = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px' : '0px';
          return;
        }
        var r = btn.getBoundingClientRect(), w = pan.offsetWidth, h = pan.offsetHeight;
        var left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
        var top = r.bottom + 6;
        if (top + h > window.innerHeight - 12) {
          top = r.top - h - 6 >= 12 ? r.top - h - 6 : Math.max(12, window.innerHeight - h - 12);   // never off-screen
        }
        pan.style.left = left + 'px'; pan.style.top = Math.max(12, top) + 'px';
      }
      function onDoc(e) { if (!pan.contains(e.target) && !wrap.contains(e.target) && (!back || e.target !== back)) close(false); }
      function onScroll(e) { if (!sheet && !pan.contains(e.target)) place(); }
      function onResize() { if (!sheet) close(false); else place(); }
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('touchstart', onDoc, { capture: true, passive: true });
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', place); window.visualViewport.addEventListener('scroll', place); }

      draw(!sheet);
      place();
      requestAnimationFrame(function () { pan.classList.add('in'); if (back) back.classList.add('in'); });
      if (sheet) { var f0 = grid.querySelector('[data-d="' + focusD + '"]'); if (f0) f0.focus({ preventScroll: true }); }
      btn.setAttribute('aria-expanded', 'true');

      open = {
        input: input,
        close: function (refocus) {
          document.removeEventListener('mousedown', onDoc, true);
          document.removeEventListener('touchstart', onDoc, true);
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onResize);
          if (window.visualViewport) { window.visualViewport.removeEventListener('resize', place); window.visualViewport.removeEventListener('scroll', place); }
          if (withTime && pan.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') setTimeFromInputs();
          pan.remove(); if (back) back.remove();
          btn.setAttribute('aria-expanded', 'false');
          if (refocus) btn.focus({ preventScroll: true });
        }
      };
    }

    sync();
    input._skd = { sync: sync, open: show, el: wrap, button: btn };
    return input._skd;
  }

  function close(refocus) { if (open) { var o = open; open = null; o.close(refocus); } }

  function enhanceAll(scope) {
    (scope || document).querySelectorAll('input[type="date"]:not([data-native]), input[type="datetime-local"]:not([data-native])').forEach(function (i) { enhance(i); });
  }
  function auto(scope) {
    scope = scope || document.body;
    enhanceAll(scope);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input[type="date"], input[type="datetime-local"]')) enhance(n);
          else if (n.querySelectorAll) enhanceAll(n);
        });
      });
    }).observe(scope, { childList: true, subtree: true });
  }

  return { enhance: enhance, enhanceAll: enhanceAll, auto: auto, close: close };
})();
