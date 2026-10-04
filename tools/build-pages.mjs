#!/usr/bin/env node
/* Sharankrishna Short Film Awards — static page builder (GitHub Pages has no server rendering).

   Run from the repository root:   node tools/build-pages.mjs
   (Node 18+, no dependencies. Reads public data only — the same anon key the website already uses.)

   Writes crawlable HTML for:
   • Festival Resources pages — /how-to-submit, /guidelines, /festival-updates, /jury, /faq,
     /privacy.html, /terms.html, /refund.html — one shared layout, content from tools/content/*.html
     (Guidelines from config.js + the homepage Rules, Updates + Jury from Supabase)
   • Category pages — /general-category, /campus-category
   • /resources — compatibility redirect for old /resources?section=… links
   • /festival-gallery — pre-renders the first batch of cards between <!--prerender:start/end--> markers
   The browser scripts still load live data on top, so visitors always see the current content.
   Re-run after editing tools/content/*, config.js guidelines, festival updates, jury or gallery media. */
import fs from 'node:fs';
import vm from 'node:vm';

const SITE = 'https://sharankrishnashortfilmawards.com';
const read = f => fs.readFileSync(f, 'utf8');
const write = (f, s) => { fs.writeFileSync(f, s); console.log('wrote', f, (s.length / 1024).toFixed(1) + ' KB'); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tidy = t => String(t || '').replace(/\s+/g, ' ').trim();

/* ---------- inputs ---------- */
const cfg = {};
vm.runInNewContext(read('assets/js/config.js') + ';__out.v={SUPA_URL,SUPA_ANON,GUIDELINES_ITEMS,UPDATES_FEED,JURY_PANEL,PORTAL_TIMELINES};', { __out: cfg });
const { SUPA_URL, SUPA_ANON, GUIDELINES_ITEMS, UPDATES_FEED, JURY_PANEL, PORTAL_TIMELINES } = cfg.v;
const EDITION = new Date(PORTAL_TIMELINES.submissionDeadline).getFullYear();   // current festival edition
const R = {}; vm.runInNewContext(read('assets/js/resources-render.js'), { window: R });
const { guidelinesHtml, updatesHtml, juryHtml } = R.SKResources;

async function db(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON } });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return res.json();
}
const [updatesDb, juryDb, awards, mediaCats, gallery] = await Promise.all([
  db('updates_feed?select=date_label,title,body,sort_order,created_at&order=sort_order.asc,created_at.desc'),
  db('jury_members?select=name,designation,bio,photo_url,edition_year,jury_type,current_edition,display_order&order=edition_year.desc.nullslast,display_order.asc'),
  db('award_categories?select=id,key,name,active,sort_order&order=sort_order.asc'),
  db('media_categories?select=key,label&order=sort_order.asc'),
  db('gallery_media?select=id,title,media_type,category,image_url,medium_url,thumbnail_url,video_url,edition_year,is_featured,award_id,award_name,competition_track,winner_name,film_name,recipient_type&order=is_featured.desc,display_order.asc,created_at.asc,id.asc&limit=12'),
]);
const updates = updatesDb.length ? updatesDb.map(u => ({ date: u.date_label || '', title: u.title || '', text: u.body || '' })) : UPDATES_FEED;

// the homepage Rules & Guidelines (single source: index.html #rulesModal)
const home = read('index.html');
const rulesBlock = home.slice(home.indexOf('id="rulesModal"'), home.indexOf('<!-- Festival Resources'));
const RULES = [...rulesBlock.matchAll(/<h4>\s*\d+\.\s*(.*?)<\/h4>\s*<p>(.*?)<\/p>/gs)].map(m => ({ title: m[1], text: m[2] }));
if (RULES.length < 3) throw new Error('could not read the homepage rules');
const JURY_NOTE = 'Our jury panel for this edition is being finalized and will be announced soon. Follow our social channels for the official reveal.';

// shared header markup (identical to the homepage header) — taken from the Showcase page
const fg = read('festival-gallery.html');
const HEADER = fg.slice(fg.indexOf('    <!-- Same header as the homepage'), fg.indexOf('    <main')).replace(' class="active" aria-current="page"', '');
const content = f => read(`tools/content/${f}.html`).replace(/<!--include:([\w-]+)-->/g, (_, n) => read(`tools/content/${n}.html`));

/* ---------- page shell ---------- */
const RESOURCE_TABS = [
  ['/how-to-submit', 'How To Submit'], ['/guidelines', 'Guidelines'], ['/festival-updates', 'Updates'], ['/jury', 'Jury Panel'],
  ['/faq', 'FAQ'], ['/privacy.html', 'Privacy'], ['/terms.html', 'Terms'], ['/refund.html', 'Refunds'],
];
const CATEGORY_TABS = [['/general-category', 'General Category'], ['/campus-category', 'Campus Category'], ['/how-to-submit', 'How To Submit']];

function page(p) {
  const url = SITE + p.path;
  const tabs = p.tabs ? `
        <nav class="rs-nav" aria-label="${esc(p.tabsLabel)}">
            <div class="rs-tabs">${p.tabs.map(([href, label]) => `
                <a class="rs-tab${href === p.path ? ' is-active' : ''}" href="${href}"${href === p.path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
            </div>
        </nav>` : '';
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': url + '#page', url, name: p.title, description: p.desc, inLanguage: 'en-IN',
      isPartOf: { '@id': SITE + '/#website' }, about: { '@id': SITE + '/#organization' } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Sharankrishna Short Film Awards', item: SITE + '/' },
      ...(p.crumb ? [{ '@type': 'ListItem', position: 2, name: p.crumb[0], item: SITE + p.crumb[1] }] : []),
      { '@type': 'ListItem', position: p.crumb ? 3 : 2, name: p.h1, item: url } ] },
    ...(p.extraLd || []) ] };
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(p.title)}</title>
    <meta name="description" content="${esc(p.desc)}">
    <link rel="canonical" href="${url}">
    <meta name="robots" content="index, follow, max-image-preview:large">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Sharankrishna Short Film Awards">
    <meta property="og:title" content="${esc(p.title)}">
    <meta property="og:description" content="${esc(p.desc)}">
    <meta property="og:url" content="${url}">
    <meta property="og:locale" content="en_IN">
    <meta property="og:image" content="${SITE}/og-image.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Sharankrishna Short Film Awards logo">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(p.title)}">
    <meta name="twitter:description" content="${esc(p.desc)}">
    <meta name="twitter:image" content="${SITE}/og-image.jpg">
    <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
    </script>
    <link rel="icon" type="image/png" href="/Favicon.png">
    <link rel="preconnect" href="https://flwlbraeyyrofkhxnvwt.supabase.co">
    <script src="/assets/js/config.js?v=10"></script>
    <link rel="stylesheet" href="/assets/css/site.css?v=37">
    <link rel="stylesheet" href="/assets/css/resources.css?v=3">
</head>
<body class="rs-page" data-page="${p.key}">
<!-- Generated by tools/build-pages.mjs — edit tools/content/${p.source || p.key}.html (or the data) and re-run the script. -->
${HEADER}    <main class="rs-main">
        <div class="rs-intro">
            <span class="section-eyebrow">${esc(p.eyebrow)}</span>
            <h1 class="section-heading"><span class="shiny-text">${esc(p.h1)}</span></h1>
            <p class="rs-lead">${esc(p.lead)}</p>
        </div>
${tabs}
        <div class="rs-pane" id="rsPane-${p.key}">
${p.body}
        </div>
    </main>

    <!-- Same footer as the homepage — shared component -->
    <div id="siteFooter"></div>
    <script src="/assets/js/site-chrome.js?v=3"></script>${p.live ? `
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" defer></script>
    <script src="/assets/js/resources-render.js?v=2" defer></script>` : ''}
    <script src="/assets/js/resources.js?v=3" defer></script>
</body>
</html>
`;
}

const lead = { // section intros — unchanged wording from the former Resources popup
  submit: 'Follow these five simple steps to register your film for Sharankrishna Short Film Awards.',
  guidelines: 'Read the official guidelines carefully before submitting your film entry.',
  updates: 'Stay informed with the latest announcements, deadlines and important information about Sharankrishna Short Film Awards.',
  jury: 'Our distinguished jury panel evaluates each submission with care and expertise.',
  faq: 'Answers to common questions about eligibility, submission, fees, subtitles, multiple entries and awards.',
  privacy: 'How we collect, use and protect your personal information.',
  terms: 'The terms governing your participation in the festival.',
  refunds: 'Understand our refund policy and the circumstances under which refunds may apply.',
};
const RES = { eyebrow: 'Festival Resources', tabs: RESOURCE_TABS, tabsLabel: 'Festival resources', crumb: null };

// FAQPage data straight from the FAQ markup
const faqHtml = content('faq');
const faqLd = { '@type': 'FAQPage', '@id': SITE + '/faq#faq', mainEntity: [...faqHtml.matchAll(/class="faq-q"[^>]*>(.*?)<span[\s\S]*?class="faq-a-inner">([\s\S]*?)<\/div><\/div>/g)]
  .map(m => ({ '@type': 'Question', name: tidy(m[1].replace(/<[^>]+>/g, '')), acceptedAnswer: { '@type': 'Answer', text: tidy(m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')) } })) };

const activeAwards = awards.filter(a => a.active !== false);
const awardsList = `<ul class="rs-award-list">${activeAwards.map(a => `<li>${esc(a.name)}</li>`).join('')}</ul>`;

const PAGES = [
  { ...RES, key: 'how-to-submit', path: '/how-to-submit', file: 'how-to-submit.html', h1: 'How To Submit', lead: lead.submit,
    title: 'How to Submit | Sharankrishna International Short Film Awards 2026',
    desc: 'Learn how to submit your short film to Sharankrishna International Short Film Awards 2026, including film details, credits, payment and confirmation.',
    body: content('how-to-submit') },
  { ...RES, key: 'guidelines', path: '/guidelines', file: 'guidelines.html', h1: 'Festival Guidelines', lead: lead.guidelines, live: true,
    title: 'Submission Guidelines | Sharankrishna International Short Film Awards 2026',
    desc: 'Read the official submission guidelines, eligibility, runtime requirements and competition rules for Sharankrishna International Short Film Awards 2026.',
    body: `<section class="rs-group" id="submission-rules" aria-labelledby="rsRules"><h2 class="rs-group-title" id="rsRules">Submission Rules</h2>
            <ol class="rs-grid rs-guides">${guidelinesHtml(RULES)}</ol></section>
            <section class="rs-group" aria-labelledby="rsGuides"><h2 class="rs-group-title" id="rsGuides">Festival Guidelines</h2>
            <ol class="rs-grid rs-guides" id="guidelinesListContainer">${guidelinesHtml(GUIDELINES_ITEMS)}</ol></section>
            <div class="rs-cta-row"><a href="/#section-registration" class="rs-cta">Start Your Submission <span aria-hidden="true">&rarr;</span></a></div>` },
  { ...RES, key: 'festival-updates', path: '/festival-updates', file: 'festival-updates.html', h1: 'Festival Updates', lead: lead.updates, live: true,
    title: 'Festival Updates | Sharankrishna Short Film Awards',
    desc: 'Latest announcements, deadlines and news from Sharankrishna Short Film Awards, the Kerala-based short film competition welcoming eligible filmmakers worldwide.',
    body: `<div class="rs-updates" id="updatesListContainer">${updatesHtml(updates)}</div>` },
  { ...RES, key: 'jury', path: '/jury', file: 'jury.html', h1: 'Jury Panel', lead: lead.jury, live: true,
    title: 'Jury | Sharankrishna International Short Film Awards 2026',
    desc: 'Meet the jury of Sharankrishna International Short Film Awards and discover the filmmakers and industry professionals evaluating the official entries.',
    body: `<div id="juryPanelGrid" data-note="${esc(JURY_NOTE)}" data-edition="${EDITION}">${juryHtml(juryDb.length ? juryDb : JURY_PANEL, JURY_NOTE, EDITION)}</div>` },
  { ...RES, key: 'faq', path: '/faq', file: 'faq.html', h1: 'Frequently Asked Questions', lead: lead.faq, extraLd: [faqLd],
    title: 'FAQ | Sharankrishna International Short Film Awards 2026',
    desc: 'Find answers about eligibility, categories, runtime, entry fee, submissions, judging and the awards ceremony for Sharankrishna International Short Film Awards 2026.',
    body: faqHtml },
  { ...RES, key: 'privacy', path: '/privacy.html', file: 'privacy.html', h1: 'Privacy Policy', lead: lead.privacy,
    title: 'Privacy Policy | Sharankrishna Short Film Awards',
    desc: 'Privacy Policy for the Sharankrishna Short Film Awards. Learn how we collect, use, and protect your personal information.',
    body: content('privacy') },
  { ...RES, key: 'terms', path: '/terms.html', file: 'terms.html', h1: 'Terms & Conditions', lead: lead.terms,
    title: 'Terms & Conditions | Sharankrishna Short Film Awards',
    desc: 'Terms and Conditions for the Sharankrishna Short Film Awards. Eligibility, entry fee, ownership rights, and governing law.',
    body: content('terms') },
  { ...RES, key: 'refund', path: '/refund.html', file: 'refund.html', h1: 'Refunds & Cancellations', lead: lead.refunds,
    title: 'Refunds & Cancellations | Sharankrishna Short Film Awards',
    desc: 'Refund and cancellation policy for the Sharankrishna Short Film Awards. Entry fee refund conditions, failed payments, and how to request a refund.',
    body: content('refund') },
  { key: 'general-category', path: '/general-category', file: 'general-category.html', source: 'general-category', eyebrow: 'Choose Your Category',
    tabs: CATEGORY_TABS, tabsLabel: 'Categories', crumb: null, h1: 'General Category',
    lead: 'A short film competition for independent filmmakers, production teams and creators — open to eligible filmmakers worldwide.',
    title: 'General Category | Sharankrishna International Short Film Awards 2026',
    desc: 'Explore the General Category of Sharankrishna International Short Film Awards 2026 for independent and professional filmmakers worldwide.',
    body: content('general-category').replace('<!--awards-->', awardsList) },
  { key: 'campus-category', path: '/campus-category', file: 'campus-category.html', source: 'campus-category', eyebrow: 'Choose Your Category',
    tabs: CATEGORY_TABS, tabsLabel: 'Categories', crumb: null, h1: 'Campus Category',
    lead: 'A student short film competition for filmmakers currently studying at a recognised college or university.',
    title: 'Campus Category | Sharankrishna International Short Film Awards 2026',
    desc: 'Explore the Campus Category of Sharankrishna International Short Film Awards 2026 for eligible student filmmakers and campus creators.',
    body: content('campus-category').replace('<!--awards-->', awardsList) },
];

for (const p of PAGES) write(p.file, page(p));

/* ---------- /resources → compatibility redirect (old ?section= links) ---------- */
write('resources.html', `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Festival Resources | Sharankrishna Short Film Awards</title>
    <meta name="robots" content="noindex, follow">
    <link rel="canonical" href="${SITE}/how-to-submit">
    <script>
      // Resources now has one page per topic — send old /resources?section=… links to the matching page
      (function () {
        var map = { submit: '/how-to-submit', 'how-to-submit': '/how-to-submit', guidelines: '/guidelines', rules: '/guidelines#submission-rules',
          updates: '/festival-updates', jury: '/jury', 'jury-panel': '/jury', faq: '/faq',
          privacy: '/privacy.html', terms: '/terms.html', refunds: '/refund.html', refund: '/refund.html' };
        var s = (new URLSearchParams(location.search).get('section') || '').toLowerCase();
        location.replace(map[s] || '/how-to-submit');
      })();
    </script>
    <meta http-equiv="refresh" content="0; url=/how-to-submit">
</head>
<body style="background:#060608;color:#ccc;font-family:system-ui,sans-serif;text-align:center;padding:80px 16px">
    <p><a href="/how-to-submit" style="color:#fff">Festival Resources &rarr;</a></p>
</body>
</html>
`);

/* ---------- Showcase: first batch of cards in the HTML ---------- */
const catLabel = k => (mediaCats.find(c => c.key === k) || {}).label || '';
const award = id => awards.find(a => String(a.id) === String(id)) || {};
const TRACKS = { general: 'General', campus: 'Campus' };
function winner(m) {
  const a = award(m.award_id);
  let name = a.name || m.award_name || 'Award';
  const special = /special/i.test(a.key || name);
  if (special && /^Special Jury — ./.test(m.award_name || '')) name = m.award_name;
  const film = tidy(m.film_name), person = tidy(m.winner_name);
  const filmFirst = /short_film|campus_film|best short film|best campus film|best film/i.test(a.key || name) || (special && m.recipient_type !== 'person');
  return { name, film, person, filmFirst, primary: filmFirst ? (film || person) : (person || film),
    secondary: filmFirst ? (person && film ? person : '') : (person && film ? 'Film: ' + film : '') };
}
const ytId = u => (String(u || '').match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/) || [])[1] || '';
const cards = gallery.map((m, i) => {
  const w = m.category === 'award-winners' && (m.award_id || m.award_name) ? winner(m) : null;
  const meta = w ? [w.name, TRACKS[m.competition_track], m.edition_year].filter(Boolean).join(' · ') : [catLabel(m.category), m.edition_year].filter(Boolean).join(' · ');
  const title = w ? w.primary : tidy(m.title);
  const alt = w ? `${w.name}${TRACKS[m.competition_track] ? ' (' + TRACKS[m.competition_track] + ')' : ''}: ${w.primary}${!w.filmFirst && w.film ? ', film ' + w.film : ''} — Sharankrishna Short Film Awards${m.edition_year ? ' ' + m.edition_year : ''}`
    : `${title || catLabel(m.category)} — ${catLabel(m.category) || 'Festival'}, Sharankrishna Short Film Awards${m.edition_year ? ' ' + m.edition_year : ''}`;
  const vid = m.media_type === 'video' ? ytId(m.video_url) : '';
  const thumb = m.media_type === 'video' ? (m.thumbnail_url && !/i\.ytimg\.com/.test(m.thumbnail_url) ? m.thumbnail_url : (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '')) : (m.thumbnail_url || m.image_url || '');
  const src = thumb && !/^https?:/.test(thumb) ? '/' + thumb.replace(/^\/+/, '') : thumb;
  const feat = m.is_featured ? ' is-featured' : '';
  return `<button type="button" class="fg-card${m.media_type === 'video' ? ' is-video' : ''}${feat}${w ? ' is-winner' : ''}" data-i="${i}" aria-label="${m.media_type === 'video' ? 'Play' : 'Open'}: ${esc(w ? meta + ' — ' + title : (title || meta))}">
        <span class="fg-thumb">${src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="${i < 4 ? 'eager' : 'lazy'}" decoding="async">` : ''}${m.media_type === 'video' ? '<span class="fg-play"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7,4.5 19.5,12 7,19.5" fill="currentColor"/></svg></span>' : ''}</span>
        <span class="fg-card-text">${meta ? `<span class="fg-card-meta">${esc(meta)}</span>` : ''}${title ? `<span class="fg-card-title">${esc(title)}</span>` : ''}${w && w.secondary ? `<span class="fg-card-sub">${esc(w.secondary)}</span>` : ''}</span>
      </button>`;
}).join('\n      ');
const START = '<!--prerender:start-->', END = '<!--prerender:end-->';
let fgOut = read('festival-gallery.html');
if (!fgOut.includes(START)) throw new Error('festival-gallery.html has no prerender markers');
fgOut = fgOut.slice(0, fgOut.indexOf(START) + START.length) +
  `<!-- first ${gallery.length} items, pre-rendered by tools/build-pages.mjs; festival-gallery.js replaces them with the live, filterable gallery -->
      <div class="fg-grid" id="fgGrid">
      ${cards}
      </div>
      ` + fgOut.slice(fgOut.indexOf(END));
write('festival-gallery.html', fgOut);
console.log('done:', PAGES.length, 'pages,', gallery.length, 'gallery cards,', updates.length, 'updates,', juryDb.length, 'jury members');
