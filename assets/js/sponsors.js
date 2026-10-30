/* Homepage "Co-Powered By" sponsors (public.sponsors, managed in Admin → Sponsors).
   Logos sit still when they fit the row; when the row is wider than the space, a seamless marquee runs.
   The decision is measured from real logo widths and re-checked on resize — never a fixed count. */
(function () {
    'use strict';

    var SPEED_PX_PER_SEC = 38;
    var section, viewport, track, sponsors = [], ro = null, lastWidth = 0;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function itemsHtml(clone) {
        return sponsors.map(function (s) {
            return '<li class="sponsor-item' + (s.on_light ? ' is-plate' : '') + '"' + (clone ? ' aria-hidden="true"' : '') + '>' +
                '<img src="' + esc(s.logo_url) + '" alt="' + (clone ? '' : esc(s.name)) + '" decoding="async" draggable="false">' +
                '</li>';
        }).join('');
    }

    function render() {
        section.hidden = false;
        track.innerHTML = '<ul class="sponsors-set" role="list">' + itemsHtml(false) + '</ul>';
        track.querySelectorAll('img').forEach(function (img) {
            img.addEventListener('error', function () {
                var li = img.closest('.sponsor-item');
                if (li) li.remove();
                layout();
            }, { once: true });
        });
        whenImagesReady(track).then(layout);
    }

    function whenImagesReady(root) {
        var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
        return Promise.all(imgs.map(function (img) {
            if (img.complete) return Promise.resolve();
            return new Promise(function (r) { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
        }));
    }

    // Static when one set fits the viewport; otherwise duplicate the set and scroll it by exactly one set width.
    function layout() {
        var set = track.querySelector('.sponsors-set');
        if (!set || !set.children.length) { section.hidden = true; return; }
        section.hidden = false;

        var clones = track.querySelectorAll('.sponsors-set.is-clone');
        clones.forEach(function (c) { c.remove(); });
        section.classList.remove('is-marquee', 'is-scrollable');
        track.style.removeProperty('--sp-duration');
        track.style.removeProperty('--sp-shift');

        var available = viewport.clientWidth;
        var needed = set.getBoundingClientRect().width;
        lastWidth = available;
        if (needed <= available + 1) return;

        // Reduced motion: no animation — let people swipe/scroll the row instead.
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            section.classList.add('is-scrollable');
            return;
        }

        section.classList.add('is-marquee');
        var setWidth = set.getBoundingClientRect().width;   // includes the trailing gap, so the loop has no seam
        var copies = Math.max(1, Math.ceil(available / setWidth));
        for (var i = 0; i < copies; i++) {
            var c = set.cloneNode(true);
            c.classList.add('is-clone');
            c.setAttribute('aria-hidden', 'true');
            c.querySelectorAll('img').forEach(function (img) { img.alt = ''; });
            c.querySelectorAll('.sponsor-item').forEach(function (li) { li.setAttribute('aria-hidden', 'true'); });
            track.appendChild(c);
        }
        track.style.setProperty('--sp-shift', (-setWidth) + 'px');
        track.style.setProperty('--sp-duration', Math.max(12, setWidth / SPEED_PX_PER_SEC).toFixed(2) + 's');
    }

    function watchResize() {
        if (!('ResizeObserver' in window)) { window.addEventListener('resize', debounce(layout, 150)); return; }
        ro = new ResizeObserver(debounce(function () {
            if (Math.abs(viewport.clientWidth - lastWidth) > 2) layout();
        }, 120));
        ro.observe(viewport);
    }

    function debounce(fn, ms) {
        var t;
        return function () { clearTimeout(t); t = setTimeout(fn, ms); };
    }

    async function load() {
        section = document.getElementById('section-sponsors');
        viewport = document.getElementById('sponsorsViewport');
        track = document.getElementById('sponsorsTrack');
        if (!section || !viewport || !track || !window.supabase || typeof SUPA_URL === 'undefined') return;
        try {
            var sb = window.supabase.createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
            var res = await sb.from('sponsors').select('id,name,logo_url,on_light')
                .eq('is_active', true).order('display_order').order('id');
            if (res.error || !Array.isArray(res.data)) return;
            sponsors = res.data.filter(function (s) { return /^https:\/\//i.test(s.logo_url || ''); });
            if (!sponsors.length) { section.hidden = true; return; }
            render();
            watchResize();
        } catch (e) {
            console.warn('Sponsors could not load:', e);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();

    window.SKSponsors = { relayout: function () { if (track) layout(); } };
})();
