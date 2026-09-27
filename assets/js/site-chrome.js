/* Shared site chrome — one footer + mobile-menu implementation for every public page.
   Usage: <div id="siteFooter" data-page="home"></div><script src="/assets/js/site-chrome.js"></script>
   The script replaces #siteFooter synchronously, so the footer is in the DOM before later scripts run.
   data-page="home" keeps the homepage behaviour (in-page anchors + modals); any other page links back
   to the homepage sections and to the homepage modal deep links (/#faq, /#rules, …). */
(function () {
  'use strict';

  const slot = document.getElementById('siteFooter');
  const home = !!slot && slot.dataset.page === 'home';
  // [label, homepage (in-page anchor / modal), other pages (URL)]
  const link = (label, homeAttrs, awayHref) => home ? `<a ${homeAttrs}>${label}</a>` : `<a href="${awayHref}">${label}</a>`;
  const IMG = (typeof SITE_IMAGES !== 'undefined' && SITE_IMAGES) || {};
  const root = home ? '' : '/';

  const FOOTER = `
    <div class="support-footer">
        <div class="footer-columns">
            <div class="footer-col">
                <h4>Explore</h4>
                ${link('Home', 'href="#section-home"', '/')}
                ${link('About', 'href="#section-story"', '/#section-story')}
                ${link('Categories', 'href="#section-categories"', '/#section-categories')}
                <a href="/festival-gallery">Showcase</a>
                ${link('Contact', 'href="#section-contact"', '/#section-contact')}
            </div>

            <div class="footer-col">
                <h4>Resources</h4>
                ${link('How To Submit', `onclick="openInfoModal('submit')"`, '/#how-to-submit')}
                ${link('Festival Guidelines', `onclick="openInfoModal('guidelines')"`, '/#guidelines')}
                ${link('Rules &amp; Guidelines', 'onclick="toggleRulesModal(true)"', '/#rules')}
                ${link('Festival Updates', `onclick="openInfoModal('updates')"`, '/#updates')}
                ${link('Jury Panel', `onclick="openInfoModal('jury')"`, '/#jury-panel')}
                ${link('FAQ', `href="/#faq" onclick="openInfoModal('faq');return false;"`, '/#faq')}
                ${link('Privacy Policy', `href="privacy.html" onclick="openInfoModal('privacy');return false;"`, '/privacy.html')}
                ${link('Terms &amp; Conditions', `href="terms.html" onclick="openInfoModal('terms');return false;"`, '/terms.html')}
                ${link('Refunds &amp; Cancellations', `href="refund.html" onclick="openInfoModal('refunds');return false;"`, '/refund.html')}
            </div>

            <div class="footer-col">
                <h4>Get in Touch</h4>
                <a href="tel:+917902959564">+91 7902959564</a>
                <a href="tel:+919745640896">+91 9745640896</a>
                <a class="footer-email" href="mailto:sharankrishnashortfilmawards@gmail.com">sharankrishna<wbr>shortfilm<wbr>awards<wbr>@gmail.com</a>
            </div>

            <div class="footer-col">
                <h4>Headquarters</h4>
                <span class="footer-static-text">Angle Frames<br>12/399, Krishnalayam<br>Thenhippalam<br>Malappuram, Kerala – 673636</span>
            </div>
        </div>

        <!-- Location — one map, two places (Google Maps embed, no API key) -->
        <section class="footer-location" aria-labelledby="flHeading">
            <div class="fl-info">
                <h4 class="fl-eyebrow" id="flHeading">Location</h4>
                <div class="fl-tabs" role="tablist" aria-label="Choose a location">
                    <button type="button" role="tab" class="fl-tab is-active" id="flTab-venue" data-loc="venue" aria-selected="true" aria-controls="flMapWrap">Festival Venue</button>
                    <button type="button" role="tab" class="fl-tab" id="flTab-hq" data-loc="hq" aria-selected="false" aria-controls="flMapWrap" tabindex="-1">Headquarters</button>
                </div>
                <div class="fl-place" id="flPlace" aria-live="polite">
                    <span class="fl-kicker">Festival Venue</span>
                    <strong class="fl-name">JAIN (Deemed-to-be University)</strong>
                    <span class="fl-address">Knowledge Park, Nirmal Infopark<br>Kakkanad, Kochi – 682042<br>Kerala, India</span>
                </div>
                <a class="fl-directions" id="flDirections" href="https://www.google.com/maps/dir/?api=1&amp;destination=JAIN%20(Deemed-to-be%20University)%20Kochi%2C%20Knowledge%20Park%2C%20Nirmal%20Infopark%2C%20Kakkanad%2C%20Kochi%20682042" target="_blank" rel="noopener noreferrer">Get Directions <span aria-hidden="true">&rarr;</span></a>
            </div>
            <div class="fl-map" id="flMapWrap" role="tabpanel" aria-labelledby="flTab-venue">
                <iframe id="flMap" title="Map — JAIN (Deemed-to-be University), Kochi Campus" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen
                    src="https://maps.google.com/maps?q=JAIN%20(Deemed-to-be%20University)%20Kochi%2C%20Knowledge%20Park%2C%20Nirmal%20Infopark%2C%20Kakkanad%2C%20Kochi%20682042&amp;z=15&amp;output=embed"></iframe>
            </div>
        </section>

        <div class="footer-bottom-bar">
            <div class="footer-bottom-left">
                <span class="footer-brand-mark">Sharankrishna Short Film Awards</span>
                <p class="footer-presented">Presented by <strong>Angle Frames</strong><br>In Association With <strong>JAIN (Deemed-to-be University), Kochi Campus</strong></p>
                <p class="footer-tagline">Honouring Creativity.<br>Recognising Talent.<br>Inspiring Filmmakers.</p>
                <p>&copy; 2026 Angle Frames Presents Sharankrishna Short Film Awards. All Rights Reserved.</p>
            </div>
            <div class="social-links-grid footer-social-grid">
                <a href="https://www.instagram.com/sharankrishna_shortfilm_awards/" target="_blank" class="social-link-icon-anchor" aria-label="Instagram">
                    <span class="social-icon-bg"></span>
                    <img id="socialIconInstagram" src="${root}${IMG.socialInstagram || ''}" alt="Instagram" loading="lazy" decoding="async">
                    <span class="social-icon-underline"></span>
                    <span class="social-icon-tooltip">Instagram</span>
                </a>
                <a href="https://www.youtube.com/@ANGLEFRAMES" target="_blank" class="social-link-icon-anchor" aria-label="YouTube">
                    <span class="social-icon-bg"></span>
                    <img id="socialIconYoutube" src="${root}${IMG.socialYoutube || ''}" alt="YouTube" loading="lazy" decoding="async">
                    <span class="social-icon-underline"></span>
                    <span class="social-icon-tooltip">YouTube</span>
                </a>
                <a href="https://www.facebook.com/share/1BRDQLmtVp/" target="_blank" class="social-link-icon-anchor" aria-label="Facebook">
                    <span class="social-icon-bg"></span>
                    <img id="socialIconFacebook" src="${root}${IMG.socialFacebook || ''}" alt="Facebook" loading="lazy" decoding="async">
                    <span class="social-icon-underline"></span>
                    <span class="social-icon-tooltip">Facebook</span>
                </a>
            </div>
        </div>
    </div>`;

  if (slot) slot.outerHTML = FOOTER;

  /* ---------- Mobile menu (☰) — same behaviour on every page ---------- */
  window.toggleMobileMenu = function () {
    const nav = document.getElementById('mainNavbar');
    if (nav) nav.classList.toggle('active');
  };
  // close the mobile menu after choosing a link
  document.addEventListener('click', e => {
    if (!e.target.closest('#mainNavbar a')) return;
    const nav = document.getElementById('mainNavbar');
    if (nav) nav.classList.remove('active');
  });

  /* ---------- Footer location: one map, two places (Google Maps embed — no API key) ---------- */
  const q = t => encodeURIComponent(t);
  const PLACES = {
    venue: { kicker: 'Festival Venue', name: 'JAIN (Deemed-to-be University)', address: 'Knowledge Park, Nirmal Infopark<br>Kakkanad, Kochi – 682042<br>Kerala, India',
             query: 'JAIN (Deemed-to-be University) Kochi, Knowledge Park, Nirmal Infopark, Kakkanad, Kochi 682042', title: 'JAIN (Deemed-to-be University), Kochi Campus' },
    hq:    { kicker: 'Headquarters', name: 'Angle Frames', address: '12/399, Krishnalayam, Thenhippalam<br>Malappuram, Kerala – 673636<br>India',
             query: 'Angle Frames, Krishnalayam, Thenhippalam, Malappuram, Kerala 673636', title: 'Angle Frames, Thenhippalam, Malappuram' },
  };
  const start = () => {
    const tabs = [...document.querySelectorAll('.fl-tab')];
    const map = document.getElementById('flMap'), place = document.getElementById('flPlace'), dir = document.getElementById('flDirections'), wrap = document.getElementById('flMapWrap');
    if (!tabs.length || !map || !place || !dir) return;
    const select = (key, focus) => {
      const p = PLACES[key]; if (!p) return;
      tabs.forEach(t => { const on = t.dataset.loc === key; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      if (wrap) wrap.setAttribute('aria-labelledby', 'flTab-' + key);
      place.innerHTML = `<span class="fl-kicker">${p.kicker}</span><strong class="fl-name">${p.name}</strong><span class="fl-address">${p.address}</span>`;
      map.title = 'Map — ' + p.title;
      map.src = `https://maps.google.com/maps?q=${q(p.query)}&z=15&output=embed`;
      dir.href = `https://www.google.com/maps/dir/?api=1&destination=${q(p.query)}`;
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t.dataset.loc));
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        select(tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].dataset.loc, true);
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
