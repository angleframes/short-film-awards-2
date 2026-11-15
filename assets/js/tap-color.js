/* Touch screens: tap a black-and-white photo to reveal its colour (desktop keeps its CSS :hover).
   One photo is in colour at a time; tapping it again or tapping elsewhere returns it to black and white.
   Listens to touch/pen pointer taps only — mouse hover is untouched, scrolling never toggles, and the
   tap still does whatever it did before (open lightbox, play video, open jury profile). */
(function () {
    'use strict';

    var TARGETS = '.pe-card, .jury-member, .story-block, .fg-card, .ab-video-poster';
    var MOVE_PX = 10, MAX_MS = 700;
    var active = null, start = null;

    var css =
        '.pe-card.is-tap-color .pe-media img,' +
        '.jury-member.is-tap-color .jury-member-photo img,' +
        '.story-block.is-tap-color .story-block-img img,' +
        '.fg-card.is-tap-color .fg-thumb img,' +
        '.ab-video-poster.is-tap-color img { filter: grayscale(0) !important; }' +
        '.pe-card.is-tap-color .pe-media::after, .pe-card.is-tap-color .pe-grain { opacity: 0; }' +
        '.jury-member-photo img, .story-block-img img { transition: filter 0.45s ease; }';
    var style = document.createElement('style');
    style.id = 'tap-color-style';
    style.textContent = css;
    document.head.appendChild(style);

    function set(el) {
        if (active && active !== el) active.classList.remove('is-tap-color');
        active = el;
        if (el) el.classList.add('is-tap-color');
    }

    document.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' || !e.isPrimary) { start = null; return; }
        start = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, { passive: true });

    document.addEventListener('pointercancel', function () { start = null; }, { passive: true });

    document.addEventListener('pointerup', function (e) {
        if (!start || e.pointerType === 'mouse' || !e.isPrimary) return;
        var moved = Math.abs(e.clientX - start.x) > MOVE_PX || Math.abs(e.clientY - start.y) > MOVE_PX;
        var slow = Date.now() - start.t > MAX_MS;
        start = null;
        if (moved || slow) return;                       // a scroll or long-press, not a tap
        var card = e.target.closest ? e.target.closest(TARGETS) : null;
        if (card && card.querySelector('img')) set(card === active ? null : card);
        else set(null);                                  // tapped outside any photo
    }, { passive: true });
})();
