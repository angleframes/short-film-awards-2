/* Touch screens: black-and-white photos turn to full colour the instant a finger touches them.
   Desktop keeps its CSS :hover (mouse input is ignored here). One photo is in colour at a time.
   - finger down on any part of a photo → colour fades in immediately
   - finger lifts (a tap)               → the photo stays in colour
   - the touch turns into a scroll       → the photo goes back to how it was
   - tap the same photo again / tap elsewhere / tap another photo → back to black and white
   On photos that also open something (lightbox, video, jury profile) the first tap only reveals
   the colour; tapping the coloured photo again opens it. Text links and buttons are untouched. */
(function () {
    'use strict';

    // card (holds the colour state) → photo surface (where a touch counts)
    var GROUPS = [
        ['.pe-card', '.pe-media'],
        ['.jury-member', '.jury-member-photo'],
        ['.story-block', '.story-block-img'],
        ['.fg-card', '.fg-thumb'],
        ['.ab-video-poster', '.ab-video-poster']
    ];
    var SURFACE = GROUPS.map(function (g) { return g[1]; }).join(',');
    var MOVE_PX = 10;

    var active = null;      // card currently in colour
    var press = null;       // { card, prev, x, y, id }
    var swallow = null;     // { card, until } — eat the click that follows a colour-only tap

    var style = document.createElement('style');
    style.id = 'tap-color-style';
    style.textContent =
        '.pe-card.is-tap-color .pe-media img,' +
        '.jury-member.is-tap-color .jury-member-photo img,' +
        '.story-block.is-tap-color .story-block-img img,' +
        '.fg-card.is-tap-color .fg-thumb img,' +
        '.ab-video-poster.is-tap-color img { filter: grayscale(0) !important; }' +
        '.pe-card.is-tap-color .pe-media::after, .pe-card.is-tap-color .pe-grain { opacity: 0; }' +
        '.jury-member-photo img, .story-block-img img { transition: filter 0.45s ease; }' +
        '@media (hover: none) { ' + SURFACE + ' { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; } }';
    document.head.appendChild(style);

    function cardOf(target) {
        if (!target || !target.closest) return null;
        var surf = target.closest(SURFACE);
        if (!surf) return null;
        for (var i = 0; i < GROUPS.length; i++) {
            var card = surf.closest(GROUPS[i][0]);
            if (card && (card === surf || card.contains(surf)) && card.querySelector('img')) return card;
        }
        return null;
    }

    function show(card) {
        if (active && active !== card) active.classList.remove('is-tap-color');
        active = card;
        if (card) card.classList.add('is-tap-color');
    }

    // something happens on click (lightbox, video, profile) — those need a second tap to open
    function navigates(card, target) {
        return !!(target.closest('button, a[href], [role="button"], [data-jury-id]') || card.matches('button, [role="button"], [data-jury-id]'));
    }

    document.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' || !e.isPrimary) return;
        var card = cardOf(e.target);
        press = null;
        if (!card) return;
        press = { card: card, prev: active, x: e.clientX, y: e.clientY, id: e.pointerId };
        show(card);                                   // colour starts at finger contact
    }, { passive: true });

    function revert() {
        if (!press) return;
        var p = press;
        press = null;
        if (p.prev && p.prev !== p.card) show(p.prev);  // a scroll that began on a photo
        else if (!p.prev) show(null);
    }

    document.addEventListener('pointermove', function (e) {
        if (press && e.pointerId === press.id &&
            (Math.abs(e.clientX - press.x) > MOVE_PX || Math.abs(e.clientY - press.y) > MOVE_PX)) revert();
    }, { passive: true });
    document.addEventListener('pointercancel', revert, { passive: true });

    document.addEventListener('pointerup', function (e) {
        if (e.pointerType === 'mouse' || !e.isPrimary) return;
        if (!press) {                                 // tap outside any photo
            if (!cardOf(e.target)) show(null);
            return;
        }
        var p = press;
        press = null;
        if (p.prev === p.card) {
            // second tap on a coloured photo: open it if it opens something, otherwise toggle off
            if (!navigates(p.card, e.target)) show(null);
        } else if (navigates(p.card, e.target)) {
            swallow = { card: p.card, until: Date.now() + 800 };
        }
    }, { passive: true });

    // runs before the page's own handlers, so a colour-only tap never opens a lightbox/profile
    window.addEventListener('click', function (e) {
        if (!swallow) return;
        var s = swallow;
        swallow = null;
        if (Date.now() < s.until && s.card.contains(e.target)) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    // keyboard focus keeps working as before; a tap elsewhere (non-photo) clears colour via pointerup
})();
