/* Sharankrishna Short Film Awards — payment receipt PDF (shared by the public success screen and Admin).
   One renderer for both, so a filmmaker's copy and the admin's copy are identical.
   The page is drawn on a canvas (so any script, e.g. Malayalam titles, renders with the browser's own text shaping)
   and placed on an A4 PDF with jsPDF. Callers must pass server-verified PAID data only. */
window.SKReceipt = (function () {
    'use strict';

    var JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    var LOGO_SRC = '/assets/img/logo-566.webp';
    var W = 595.28, H = 841.89;          // A4 in points
    var K = 2.8;                         // canvas pixels per point (~200 dpi)
    var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Malayalam", "Nirmala UI", "Malayalam Sangam MN", Arial, sans-serif';
    var C = { ink: '#0b0b0c', text: '#1a1a1a', mute: '#6b6b6b', soft: '#8c8c8c', silver: '#a7a7a7', line: '#e3e3e3', panel: '#f3f3f3' };

    // Stable receipt number derived from the Cashfree order id (unique per payment in film_entries).
    // SKSFA_<year>_<epochMs>_<5 digits>  →  SKSFA-RCT-<year>-<base36>. Same order → same number, every download.
    function receiptNumber(orderId) {
        var m = /^SKSFA_(\d{4})_(\d+)_(\d{1,5})$/.exec(String(orderId || '').trim());
        if (m && typeof BigInt === 'function') {
            var n = BigInt(m[2]) * 100000n + BigInt(m[3]);
            return 'SKSFA-RCT-' + m[1] + '-' + n.toString(36).toUpperCase();
        }
        return 'SKSFA-RCT-' + String(orderId || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
    }

    function categoryLabel(c) {
        var v = String(c || '').trim();
        return ({ general: 'General Track', campus: 'Campus Track' })[v.toLowerCase()] || v || '—';
    }

    function methodLabel(m) {
        var v = String(m || '').trim().toLowerCase();
        var map = { upi: 'UPI', upi_credit_card: 'UPI (credit card)', credit_card: 'Credit card', debit_card: 'Debit card',
            card: 'Card', net_banking: 'Net banking', netbanking: 'Net banking', wallet: 'Wallet', app: 'Wallet / app', pay_later: 'Pay later' };
        if (!v) return '—';
        return map[v] || v.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function money(amount, currency) {
        var n = Number(amount);
        if (!isFinite(n)) return '—';
        return (currency || 'INR') + ' ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function istDate(v, withTime) {
        if (!v) return '—';
        var d = new Date(v);
        if (isNaN(d)) return '—';
        var opts = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' };
        if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; opts.hour12 = true; }
        return d.toLocaleString('en-IN', opts).replace(/\s?(am|pm)$/i, function (s) { return ' ' + s.trim().toUpperCase(); }) + (withTime ? ' IST' : '');
    }

    // Normalises a receipt from either the public success screen or an Admin film_entries row.
    function normalise(r) {
        var orderId = String(r.orderId || '').trim();
        return {
            receiptNo: receiptNumber(orderId),
            orderId: orderId,
            paymentRef: String(r.paymentRef || '').trim(),
            name: String(r.name || '').trim(),
            email: String(r.email || '').trim(),
            film: String(r.film || '').trim(),
            category: categoryLabel(r.category),
            amount: Number(r.amount),
            currency: String(r.currency || 'INR').toUpperCase(),
            method: methodLabel(r.method),
            paidAt: r.paidAt || null
        };
    }

    function loadScript(src) {
        return new Promise(function (res, rej) {
            var s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = res; s.onerror = function () { rej(new Error('Could not load the PDF tool. Check your connection and try again.')); };
            document.head.appendChild(s);
        });
    }
    async function ensureJsPdf() {
        if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
        await loadScript(JSPDF_SRC);
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF tool unavailable.');
        return window.jspdf.jsPDF;
    }
    var logoPromise = null;
    function loadLogo() {
        if (!logoPromise) {
            logoPromise = new Promise(function (res) {
                var img = new Image();
                img.onload = function () { res(img); };
                img.onerror = function () { res(null); };
                img.src = LOGO_SRC;
            });
        }
        return logoPromise;
    }

    /* ---------------- drawing ---------------- */
    function font(ctx, size, weight) { ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT; }

    function spaced(ctx, text, x, y, spacing, align) {
        var chars = String(text).split(''), w = 0, i;
        for (i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? spacing : 0);
        var start = align === 'right' ? x - w : x;
        var save = ctx.textAlign; ctx.textAlign = 'left';
        for (i = 0; i < chars.length; i++) { ctx.fillText(chars[i], start, y); start += ctx.measureText(chars[i]).width + spacing; }
        ctx.textAlign = save;
    }

    function wrap(ctx, text, maxW) {
        var words = String(text).split(/(\s+)/), lines = [], line = '';
        words.forEach(function (w) {
            var test = line + w;
            if (ctx.measureText(test).width > maxW && line.trim()) { lines.push(line.trim()); line = w.trimStart(); }
            else line = test;
        });
        if (line.trim()) lines.push(line.trim());
        // break any single over-long token (e.g. long emails / ids)
        var out = [];
        lines.forEach(function (l) {
            while (ctx.measureText(l).width > maxW && l.length > 1) {
                var cut = l.length;
                while (cut > 1 && ctx.measureText(l.slice(0, cut)).width > maxW) cut--;
                out.push(l.slice(0, cut)); l = l.slice(cut);
            }
            out.push(l);
        });
        return out.length ? out : ['—'];
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function draw(rec, logo) {
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(W * K); canvas.height = Math.round(H * K);
        var ctx = canvas.getContext('2d');
        ctx.scale(K, K);
        ctx.textBaseline = 'alphabetic';
        var L = 44, R = W - 44, CW = R - L;

        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

        // Header band
        ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, 128);
        if (logo) {
            var lh = 62, lw = lh * (logo.naturalWidth / logo.naturalHeight);
            if (lw > 230) { lw = 230; lh = lw * (logo.naturalHeight / logo.naturalWidth); }
            ctx.drawImage(logo, L, (128 - lh) / 2, lw, lh);
        } else {
            ctx.fillStyle = '#ffffff'; font(ctx, 15, 700); ctx.fillText('SHARANKRISHNA SHORT FILM AWARDS', L, 70);
        }
        ctx.fillStyle = '#ffffff'; font(ctx, 21, 700); spaced(ctx, 'PAYMENT RECEIPT', R, 62, 2.2, 'right');
        ctx.fillStyle = C.silver; font(ctx, 9.5, 500); ctx.textAlign = 'right';
        ctx.fillText('Sharankrishna Short Film Awards 2026', R, 82);
        ctx.fillText('Festival entry fee', R, 96);
        ctx.textAlign = 'left';

        // Meta row
        var y = 168;
        function meta(label, value, x) {
            ctx.fillStyle = C.soft; font(ctx, 7.5, 700); spaced(ctx, label.toUpperCase(), x, y, 1.4);
            ctx.fillStyle = C.ink; font(ctx, 12.5, 700); ctx.fillText(value, x, y + 19);
        }
        meta('Receipt no.', rec.receiptNo, L);
        meta('Date of payment', istDate(rec.paidAt, false), L + 268);
        // PAID pill
        font(ctx, 9.5, 800);
        var pw = ctx.measureText('PAID').width + 3 * 1.5 + 26;
        roundRect(ctx, R - pw, y - 9, pw, 26, 13); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = C.ink; spaced(ctx, 'PAID', R - pw / 2 - (ctx.measureText('PAID').width + 4.5) / 2, y + 8, 1.5);

        y += 44;
        ctx.strokeStyle = C.line; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();

        // Sections
        var VX = L + 168, VW = R - VX;
        function section(title, rows) {
            y += 30;
            ctx.fillStyle = C.mute; font(ctx, 8, 700); spaced(ctx, title.toUpperCase(), L, y, 1.6);
            y += 10;
            rows.forEach(function (row, i) {
                font(ctx, 10.5, 600);
                var lines = wrap(ctx, row[1] || '—', VW);
                var rh = Math.max(28, 14 + lines.length * 15);
                var ty = y + 18;
                ctx.fillStyle = C.mute; font(ctx, 9.5, 400); ctx.fillText(row[0], L, ty);
                ctx.fillStyle = C.text; font(ctx, 10.5, row[2] ? 700 : 600);
                lines.forEach(function (ln, j) { ctx.fillText(ln, VX, ty + j * 15); });
                y += rh;
                if (i < rows.length - 1) { ctx.strokeStyle = '#efefef'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
            });
        }
        section('Filmmaker', [['Name', rec.name], ['Registered email', rec.email]]);
        section('Film submission', [['Film title', rec.film], ['Category', rec.category]]);
        section('Payment details', [
            ['Amount paid', money(rec.amount, rec.currency), true],
            ['Currency', rec.currency],
            ['Payment status', 'Paid — verified with Cashfree Payments'],
            ['Payment method', rec.method],
            ['Cashfree payment reference', rec.paymentRef || 'Not provided by Cashfree'],
            ['Cashfree order ID', rec.orderId],
            ['Payment date and time', istDate(rec.paidAt, true)]
        ]);

        // Total
        y += 22;
        roundRect(ctx, L, y, CW, 58, 10); ctx.fillStyle = C.panel; ctx.fill();
        ctx.fillStyle = C.mute; font(ctx, 8.5, 700); spaced(ctx, 'TOTAL PAID', L + 18, y + 34, 1.6);
        ctx.fillStyle = C.ink; font(ctx, 19, 800); ctx.textAlign = 'right'; ctx.fillText(money(rec.amount, rec.currency), R - 18, y + 37); ctx.textAlign = 'left';

        // Footer
        var fy = H - 98;
        ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(L, fy); ctx.lineTo(R, fy); ctx.stroke();
        ctx.fillStyle = C.soft; font(ctx, 8, 400);
        var note = 'This receipt is issued by Sharankrishna Short Film Awards (presented by Angle Frames) for the festival entry fee. ' +
            'The payment was processed by Cashfree Payments; this is the festival’s own receipt, not an official Cashfree document. ' +
            'The entry fee is non-refundable as per the festival terms.';
        wrap(ctx, note, CW).forEach(function (ln, i) { ctx.fillText(ln, L, fy + 18 + i * 12); });
        ctx.fillStyle = C.mute; font(ctx, 8, 600);
        ctx.fillText('sharankrishnashortfilmawards.com  ·  sharankrishnashortfilmawards@gmail.com', L, H - 34);
        ctx.fillStyle = C.soft; font(ctx, 7.5, 400); ctx.textAlign = 'right';
        ctx.fillText('Generated ' + istDate(new Date().toISOString(), true), R, H - 34);
        ctx.textAlign = 'left';
        return canvas;
    }

    async function build(raw) {
        var rec = normalise(raw);
        if (!rec.orderId) throw new Error('Missing order reference.');
        var JsPDF = await ensureJsPdf();
        var logo = await loadLogo();
        if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) {} }
        var canvas = draw(rec, logo);
        var pdf = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
        pdf.setProperties({ title: 'Payment Receipt ' + rec.receiptNo, subject: 'Sharankrishna Short Film Awards — entry fee receipt', author: 'Sharankrishna Short Film Awards', creator: 'sharankrishnashortfilmawards.com' });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, W, H, undefined, 'FAST');
        return { pdf: pdf, rec: rec, fileName: 'SKSFA-Payment-Receipt-' + rec.receiptNo + '.pdf' };
    }

    // Saves the PDF; on iOS (no download attribute in some in-app browsers) opens it in a new tab instead.
    async function download(raw) {
        var out = await build(raw);
        var ua = navigator.userAgent || '';
        var iosInApp = /iPhone|iPad|iPod/i.test(ua) && !/Safari/i.test(ua);
        if (iosInApp) {
            var url = URL.createObjectURL(out.pdf.output('blob'));
            window.open(url, '_blank');
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        } else {
            out.pdf.save(out.fileName);
        }
        return out.rec;
    }

    // From an Admin film_entries row. Only Paid rows have a receipt.
    function fromEntry(row) {
        if (!row || String(row.payment_status || '').toLowerCase() !== 'paid') return null;
        return { orderId: row.cashfree_order_id, paymentRef: row.cashfree_payment_id, name: row.applicant_name, email: row.email,
            film: row.film_name, category: row.category, amount: row.amount, currency: row.currency, method: row.payment_method, paidAt: row.paid_at };
    }

    // Page image only (used to preview the receipt on screen).
    async function render(raw) { return draw(normalise(raw), await loadLogo()); }

    return { receiptNumber: receiptNumber, download: download, build: build, render: render, fromEntry: fromEntry, categoryLabel: categoryLabel };
})();
