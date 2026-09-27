/* SKYouTube — one shared YouTube helper for the whole site (homepage, Festival Gallery, admin).
   • id(url)      → 11-char video ID from any common YouTube URL (or null)
   • thumb(id)    → best thumbnail URL (maxresdefault); lower qualities are tried automatically
   • thumbFor(customUrl, videoUrlOrId) → custom thumbnail first, else the generated YouTube one, else FALLBACK
   Every <img> whose src is an i.ytimg.com thumbnail falls back maxres → sd → hq → branded placeholder,
   including YouTube's 120px grey "missing" image (which arrives as a normal image, not an error).
   No player/iframe is ever created here — videos load only when a visitor opens them. */
window.SKYouTube = (function () {
  'use strict';

  const QUALITIES = ['maxresdefault', 'sddefault', 'hqdefault'];
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

  // Sharankrishna-styled placeholder (charcoal, quiet play mark, wordmark) — shown instead of a broken image
  const FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">' +
    '<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1c1c20"/><stop offset="1" stop-color="#08080a"/></radialGradient></defs>' +
    '<rect width="1280" height="720" fill="url(#g)"/>' +
    '<circle cx="640" cy="330" r="62" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="3"/>' +
    '<polygon points="620,298 620,362 672,330" fill="#ffffff" fill-opacity=".7"/>' +
    '<text x="640" y="470" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="9" fill="#ffffff" fill-opacity=".55">SHARANKRISHNA</text>' +
    '<text x="640" y="510" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="16" font-weight="600" letter-spacing="6" fill="#ffffff" fill-opacity=".35">SHORT FILM AWARDS</text>' +
    '</svg>');

  function id(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    if (ID_RE.test(raw)) return raw;
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw.replace(/^\/\//, '')); } catch (e) { return null; }
    if (!HOSTS.test(u.hostname)) return null;
    let cand = null;
    if (/youtu\.be$/i.test(u.hostname)) cand = u.pathname.split('/')[1];                       // youtu.be/ID
    else if (u.searchParams.get('v')) cand = u.searchParams.get('v');                            // watch?v=ID (+ any params)
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/i);                   // /shorts|embed|live|v/ID
      if (m) cand = m[1];
    }
    return cand && ID_RE.test(cand) ? cand : null;
  }

  const thumb = (vid, q) => (vid && ID_RE.test(vid) ? `https://i.ytimg.com/vi/${vid}/${q || QUALITIES[0]}.jpg` : FALLBACK);

  // custom (non-YouTube) thumbnail wins; stored YouTube thumbnails are upgraded to the best quality
  function thumbFor(custom, videoRef) {
    const c = String(custom || '').trim();
    if (c && !/i\.ytimg\.com|img\.youtube\.com/i.test(c)) return c;
    const vid = id(videoRef) || (c.match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//) || [])[1];
    return vid ? thumb(vid) : FALLBACK;
  }

  // step an <img> to the next thumbnail quality, then to the branded placeholder
  function next(img) {
    const m = String(img.currentSrc || img.src).match(/i\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\/(\w+)\.jpg/);
    if (!m) { if (img.src !== FALLBACK) img.src = FALLBACK; return; }
    const i = QUALITIES.indexOf(m[2]);
    img.removeAttribute('srcset');
    img.src = i >= 0 && i < QUALITIES.length - 1 ? thumb(m[1], QUALITIES[i + 1]) : FALLBACK;
  }
  const isYt = img => img && img.tagName === 'IMG' && /i\.ytimg\.com\/vi/.test(img.currentSrc || img.src || '');

  // one global listener covers every thumbnail on the page, present or added later
  document.addEventListener('error', e => { const t = e.target; if (isYt(t)) next(t); else if (t && t.tagName === 'IMG' && t.dataset.ytFallback != null && t.src !== FALLBACK) t.src = FALLBACK; }, true);
  document.addEventListener('load', e => { const t = e.target; if (isYt(t) && t.naturalWidth > 0 && t.naturalWidth <= 120) next(t); }, true);
  // images that finished before this script ran
  function sweep(root) {
    (root || document).querySelectorAll('img').forEach(img => { if (isYt(img) && img.complete && (img.naturalWidth === 0 || img.naturalWidth <= 120)) next(img); });
  }
  if (document.readyState !== 'loading') sweep(); else document.addEventListener('DOMContentLoaded', () => sweep());

  return { id, thumb, thumbFor, next, sweep, FALLBACK, QUALITIES };
})();
