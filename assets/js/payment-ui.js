/* Sharankrishna Short Film Awards — payment step UI (shared by index.html and submit.html).
   Uses the existing backend actions only: createOrder → saveFormData → Cashfree checkout → verifyOrder → handleSubmission.
   PAID is only ever shown after the server confirms it; the browser never sets payment status. */
window.SKPayment = (function () {
    var STORE_TTL_MS = 24 * 60 * 60 * 1000;
    var POLL_TRIES = 4, POLL_GAP_MS = 4000;

    var o = null;          // options from the page
    var els = {};
    var s = {              // payment state
        orderId: null, sessionId: null, formKey: null, snapshot: null,
        busy: false, paid: false, server: null, finalized: false
    };

    var ICON = {
        lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
        check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.8 2.8 6.2-6.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        upi: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 9.5l2 2 2-2M12 6.5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 9.5h19" stroke="currentColor" stroke-width="1.4"/><path d="M6 14.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        bank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5L12 4l9 5.5M4.5 20h15M6 10.5v7M10 10.5v7M14 10.5v7M18 10.5v7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function rupees(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function store(rec) {
        try {
            if (rec) sessionStorage.setItem(o.storageKey, JSON.stringify(rec));
            else sessionStorage.removeItem(o.storageKey);
        } catch (_) {}
    }
    function stored() {
        try {
            var rec = JSON.parse(sessionStorage.getItem(o.storageKey) || 'null');
            if (rec && rec.orderId && Date.now() - (rec.ts || 0) < STORE_TTL_MS) return rec;
        } catch (_) {}
        return null;
    }

    /* ---------------- rendering ---------------- */
    function render() {
        var d = o.getDetails();
        o.root.innerHTML =
            '<div class="skp">' +
            '  <p class="skp-sub">Complete the secure payment to confirm your film submission.</p>' +
            '  <div class="skp-grid">' +
            '    <div class="skp-main">' +
            '      <section class="skp-card" aria-label="Submission details">' +
            '        <p class="skp-label">Sharankrishna Short Film Awards 2026</p>' +
            '        <dl class="skp-dl" data-skp="details">' + detailsHtml(d) + '</dl>' +
            '      </section>' +
            '      <section class="skp-methods" aria-label="Payment methods">' +
            '        <p class="skp-label">Pay securely with</p>' +
            '        <ul class="skp-method-list">' +
            '          <li>' + ICON.upi + '<span><strong>UPI</strong><small>Google Pay, PhonePe, Paytm or any UPI app</small></span></li>' +
            '          <li>' + ICON.card + '<span><strong>Cards</strong><small>Debit and credit cards</small></span></li>' +
            '          <li>' + ICON.bank + '<span><strong>Net Banking</strong><small>Pay from your bank account</small></span></li>' +
            '        </ul>' +
            '        <p class="skp-fine">Options available for your payment are shown in the secure Cashfree checkout.</p>' +
            '      </section>' +
            '    </div>' +
            '    <aside class="skp-summary" aria-label="Payment summary">' +
            '      <p class="skp-label">Payment summary</p>' +
            '      <div class="skp-line"><span>Entry fee</span><span>' + rupees(o.fee) + '</span></div>' +
            '      <div class="skp-line skp-total"><span>Total payable</span><span>' + rupees(o.fee) + '</span></div>' +
            '      <div class="skp-state" data-skp="state" role="status" aria-live="polite" hidden></div>' +
            '      <button type="button" class="skp-cta" data-skp="cta"></button>' +
            '      <button type="button" class="skp-secondary" data-skp="secondary" hidden></button>' +
            '      <ul class="skp-notes" data-skp="notes">' +
            '        <li>Your submission will be confirmed after successful payment verification.</li>' +
            '        <li>Do not close or refresh the page while your payment is being processed.</li>' +
            '      </ul>' +
            '      <ul class="skp-trust">' +
            '        <li>' + ICON.lock + 'Secure payment</li>' +
            '        <li>' + ICON.check + 'Encrypted checkout</li>' +
            '        <li>' + ICON.check + 'Server-verified payment</li>' +
            '        <li>' + ICON.check + 'Instant confirmation</li>' +
            '      </ul>' +
            '      <p class="skp-powered">Powered by Cashfree Payments</p>' +
            '    </aside>' +
            '  </div>' +
            '</div>';
        els.state = o.root.querySelector('[data-skp=state]');
        els.cta = o.root.querySelector('[data-skp=cta]');
        els.secondary = o.root.querySelector('[data-skp=secondary]');
        els.details = o.root.querySelector('[data-skp=details]');
        els.notes = o.root.querySelector('[data-skp=notes]');
        els.cta.addEventListener('click', function () { if (els.cta._run) els.cta._run(); });
        els.secondary.addEventListener('click', function () { if (els.secondary._run) els.secondary._run(); });
    }

    function detailsHtml(d) {
        var rows = [['Film', d.film], ['Category', d.category], ['Applicant', d.applicant], ['Email', d.email]];
        return rows.filter(function (r) { return r[1]; }).map(function (r) {
            return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
        }).join('');
    }

    function setView(v) {
        // v: { state:{kind,title,text}|null, cta:{label,run,disabled}|null, secondary:{label,run}|null, notes:bool }
        if (v.state) {
            els.state.hidden = false;
            els.state.className = 'skp-state is-' + v.state.kind;
            els.state.innerHTML = (v.state.kind === 'busy' ? '<span class="skp-spinner" aria-hidden="true"></span>' : '') +
                '<div><strong>' + esc(v.state.title) + '</strong>' + (v.state.text ? '<p>' + esc(v.state.text) + '</p>' : '') + '</div>';
        } else {
            els.state.hidden = true;
            els.state.innerHTML = '';
        }
        if (v.cta) {
            els.cta.hidden = false;
            els.cta.textContent = v.cta.label;
            els.cta.disabled = !!v.cta.disabled;
            els.cta.setAttribute('aria-busy', v.cta.disabled ? 'true' : 'false');
            els.cta._run = v.cta.disabled ? null : v.cta.run;
        } else {
            els.cta.hidden = true;
            els.cta._run = null;
        }
        if (v.secondary) {
            els.secondary.hidden = false;
            els.secondary.textContent = v.secondary.label;
            els.secondary._run = v.secondary.run;
        } else {
            els.secondary.hidden = true;
            els.secondary._run = null;
        }
        els.notes.hidden = v.notes === false;
    }

    var payLabel = function () { return 'Pay ' + rupees(o.fee) + ' securely'; };

    function viewIdle() {
        setView({ state: null, cta: { label: payLabel(), run: pay } });
    }
    function viewBusy(title, text, ctaLabel) {
        setView({ state: { kind: 'busy', title: title, text: text }, cta: { label: ctaLabel, disabled: true } });
    }
    function viewVerifying() {
        setView({
            state: { kind: 'pending', title: 'Payment verification in progress', text: 'We are checking the payment status. Please wait a moment.' },
            cta: { label: 'Check payment status', run: function () { checkStatus(false); } }
        });
    }
    function viewNotCompleted(message) {
        setView({
            state: { kind: 'error', title: 'Payment not completed', text: message || 'Your submission has been saved, but payment has not been completed.' },
            cta: { label: 'Try payment again', run: pay },
            secondary: { label: 'Back to submission', run: function () { o.onBack(); } }
        });
    }
    function viewFinalizeError() {
        setView({
            state: { kind: 'pending', title: 'Payment received', text: 'We could not confirm your submission yet. Your payment is safe — please try again.' },
            cta: { label: 'Confirm my submission', run: finalize },
            notes: false
        });
    }

    /* ---------------- flow ---------------- */
    function api(payload) {
        return Promise.resolve(o.backendCall(payload)).then(function (r) {
            if (!r) throw new Error('No response from server.');
            return r;
        });
    }

    async function pay() {
        if (s.busy || s.paid) return;
        var problem = o.validate();
        if (problem) { setView({ state: { kind: 'error', title: 'Check your details', text: problem }, cta: { label: payLabel(), run: pay } }); return; }
        if (typeof Cashfree !== 'function') {
            setView({ state: { kind: 'error', title: 'Payment could not start', text: 'The secure payment library did not load. Check your connection and try again.' }, cta: { label: payLabel(), run: pay } });
            return;
        }

        s.busy = true;
        try {
            var c = o.collect();
            var formKey = JSON.stringify([c.form, c.orderExtra || {}]);

            // Reuse the existing order (and its saved submission) unless the details changed.
            if (s.orderId && s.formKey === formKey) {
                viewBusy('Checking your earlier attempt…', null, 'Preparing secure payment…');
                var prev = await api({ action: 'verifyOrder', orderId: s.orderId });
                if (prev.status === 'success') {
                    var ps = String(prev.order_status || '').toUpperCase();
                    if (ps === 'PAID') { s.server = prev; s.paid = true; s.busy = false; await finalize(); return; }
                    if (ps !== 'ACTIVE') { s.orderId = null; s.sessionId = null; }
                }
            } else {
                s.orderId = null; s.sessionId = null;
            }

            if (!s.orderId) {
                viewBusy('Preparing secure payment…', null, 'Preparing secure payment…');
                var order = await api(Object.assign({
                    action: 'createOrder',
                    customerName: c.form.applicantName,
                    customerEmail: c.form.email,
                    customerPhone: c.form.phone,
                    category: c.form.category
                }, c.orderExtra || {}));
                if (order.status !== 'success' || !order.payment_session_id || !order.order_id) {
                    throw new Error(order.message || 'Could not create your payment order.');
                }
                s.orderId = order.order_id;
                s.sessionId = order.payment_session_id;
                s.formKey = formKey;
                s.snapshot = Object.assign({}, c.form, c.submitExtra || {});
                store({ orderId: s.orderId, sessionId: s.sessionId, formKey: formKey, snapshot: s.snapshot, ts: Date.now() });

                // Pre-payment save lets the webhook finalise the entry even if the browser closes.
                try {
                    await api(Object.assign({ action: 'saveFormData' }, c.form, c.saveExtra || {}, { cashfreeOrderId: s.orderId }));
                } catch (e) { console.warn('Pre-payment save failed (non-blocking):', e); }
            }

            await openCheckout(true);
        } catch (err) {
            s.busy = false;
            setView({
                state: { kind: 'error', title: 'Payment could not start', text: (err && err.message) || 'Please try again.' },
                cta: { label: payLabel(), run: pay }
            });
        }
    }

    async function openCheckout(allowNewOrder) {
        viewBusy('Secure checkout is open', 'Complete the payment in the Cashfree window.', 'Waiting for payment…');
        var result;
        try {
            result = await Cashfree({ mode: o.cashfreeMode }).checkout({ paymentSessionId: s.sessionId, redirectTarget: '_modal' });
        } catch (e) {
            result = { error: { message: (e && e.message) || 'Checkout error' } };
        }
        s.busy = false;

        var err = result && result.error;
        if (err && allowNewOrder && /session/i.test(String(err.code || '') + ' ' + String(err.message || ''))) {
            // Stale payment session: start one fresh order instead of failing.
            s.orderId = null; s.sessionId = null; s.formKey = null;
            return pay();
        }
        // Never trust the checkout result — always ask the server.
        await checkStatus(!!err);
    }

    async function checkStatus(userClosed) {
        if (!s.orderId) { viewIdle(); return; }
        viewBusy('Verifying your payment…', 'Confirming the payment status with our server.', 'Verifying payment…');
        var tries = userClosed ? 1 : POLL_TRIES;
        for (var i = 0; i < tries; i++) {
            var r;
            try { r = await api({ action: 'verifyOrder', orderId: s.orderId }); }
            catch (e) { r = { status: 'error', message: e.message }; }
            if (r.status === 'success') {
                var ps = String(r.order_status || '').toUpperCase();
                if (ps === 'PAID') { s.server = r; s.paid = true; await finalize(); return; }
                if (ps !== 'ACTIVE') {
                    s.orderId = null; s.sessionId = null;
                    store(null);
                    viewNotCompleted('This payment attempt has expired. No charge was confirmed — please try again.');
                    return;
                }
            } else if (i === tries - 1) {
                setView({
                    state: { kind: 'error', title: 'Could not verify payment', text: r.message || 'Network error. Please check the status again.' },
                    cta: { label: 'Check payment status', run: function () { checkStatus(false); } }
                });
                return;
            }
            if (i < tries - 1) await wait(POLL_GAP_MS);
        }
        if (userClosed) viewNotCompleted();
        else viewVerifying();
    }

    async function finalize() {
        if (s.finalized) return;
        viewBusy('Payment received', 'Confirming your submission…', 'Confirming submission…');
        var r = s.server || {};
        var payload = Object.assign({}, s.snapshot || o.collect().form, {
            action: 'handleSubmission',
            paymentStatus: 'Paid',
            cashfreeOrderId: s.orderId,
            cashfreePaymentId: r.cf_payment_id || null,
            amount: r.order_amount || o.fee,
            currency: r.order_currency || 'INR',
            paidAt: r.paid_at || new Date().toISOString(),
            paymentMethod: r.payment_method || null
        });
        try {
            var resp = await api(payload);
            if (resp.status === 'success' || resp.status === 'already_registered' || resp.already_registered) {
                s.finalized = true;
                store(null);
                showSuccess(payload);
            } else {
                viewFinalizeError();
            }
        } catch (e) {
            viewFinalizeError();
        }
    }

    function showSuccess(p) {
        var d = o.getDetails(p);
        o.successRoot.innerHTML =
            '<div class="skp-success" role="status">' +
            '  <div class="skp-success-icon">' + ICON.check + '</div>' +
            '  <h2>Payment successful</h2>' +
            '  <p class="skp-success-lead">Your submission has been confirmed.</p>' +
            '  <dl class="skp-dl skp-success-dl">' +
            (d.film ? '<div><dt>Film</dt><dd>' + esc(d.film) + '</dd></div>' : '') +
            '    <div><dt>Amount paid</dt><dd>' + rupees(p.amount) + '</dd></div>' +
            '    <div><dt>Payment status</dt><dd><span class="skp-paid">PAID</span></dd></div>' +
            '    <div><dt>Order ID</dt><dd class="skp-mono">' + esc(p.cashfreeOrderId) + '</dd></div>' +
            '  </dl>' +
            (d.email ? '<p class="skp-success-note">A confirmation email will be sent to ' + esc(d.email) + '. Keep your Order ID for reference.</p>' : '') +
            '  <button type="button" class="skp-cta skp-success-cta" data-skp="again">Submit another film</button>' +
            '</div>';
        o.successRoot.querySelector('[data-skp=again]').addEventListener('click', function () { reset(); o.onReset(); });
        o.onSuccess();
    }

    function reset() {
        store(null);
        s = { orderId: null, sessionId: null, formKey: null, snapshot: null, busy: false, paid: false, server: null, finalized: false };
    }

    return {
        mount: function (opts) {
            o = opts;
            render();
            viewIdle();
            var rec = stored();
            var urlOrder = new URLSearchParams(location.search).get('order_id');
            if (rec && (!urlOrder || urlOrder === rec.orderId)) {
                s.orderId = rec.orderId; s.sessionId = rec.sessionId; s.formKey = rec.formKey; s.snapshot = rec.snapshot;
                if (o.restore) o.restore(rec.snapshot);
                o.showStep();
                els.details.innerHTML = detailsHtml(o.getDetails(rec.snapshot));
                checkStatus(true);
            }
        },
        // Called when the payment step becomes visible so the summary shows the latest form values.
        refresh: function () {
            if (!o || s.busy || s.paid) return;
            els.details.innerHTML = detailsHtml(o.getDetails());
            if (!s.orderId) viewIdle();
        },
        pay: pay,
        reset: reset
    };
})();
