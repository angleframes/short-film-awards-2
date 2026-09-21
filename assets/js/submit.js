const SUPA_URL    = "https://flwlbraeyyrofkhxnvwt.supabase.co";
const SUPA_ANON   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2xicmFleXlyb2ZraHhudnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDQzNDEsImV4cCI6MjEwNDM4MDM0MX0.0apM1gnHcYzTSLs0wTfi1fgaNCf0RKbeginWPXg5EbY";
const BACKEND_URL = "https://flwlbraeyyrofkhxnvwt.supabase.co/functions/v1/payment";
const CASHFREE_MODE = "production";

const sb = supabase.createClient(SUPA_URL, SUPA_ANON);

let _token = '';
let _linkId = null;
let _linkLabel = '';
let _currentStep = 1;
let _payState = { orderId:null, verified:false, cfPaymentId:null, amount:null, paidAt:null, paymentMethod:null };

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  _token = (params.get('token') || '').trim();

  if (!_token) { showState('invalid'); return; }

  const { data, error } = await sb
    .rpc('validate_submission_token', { token_input: _token })
    .single();

  if (error || !data) { showState('invalid'); return; }

  const now = new Date();
  const expired   = data.expires_at && new Date(data.expires_at) < now;
  const exhausted = data.max_uses > 0 && data.use_count >= data.max_uses;

  if (data.revoked)  { showState('revoked');  return; }
  if (exhausted)     { showState('usedUp');   return; }
  if (expired)       { showState('expired');  return; }

  _linkId    = data.id;
  _linkLabel = data.label || 'Direct Link';
  document.getElementById('linkLabelDisplay').textContent = _linkLabel;
  showState('form');
  goStep(1);
}

function showState(s) {
  const map = { validating:'sValidating', expired:'sExpired', revoked:'sRevoked',
                usedUp:'sUsedUp', invalid:'sInvalid', form:'sForm', success:'sSuccess' };
  Object.values(map).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (map[s] === id) ? '' : 'none';
  });
}

// ── Step navigation ────────────────────────────────────────────────────────────
function goStep(n) {
  _currentStep = n;
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('step' + n).classList.add('active');
  // Update step dots
  for (let i = 1; i <= 5; i++) {
    const dot = document.getElementById('sd' + i);
    dot.classList.remove('active','done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function nextStep(from) {
  if (from === 1) {
    const fields = ['applicantName','phone','email','city'];
    const missing = fields.find(id => !req(id));
    if (missing) { return alert('Please fill in all required fields.'); }
    goStep(2);
  } else if (from === 2) {
    const fields = ['filmName','category','filmLink','duration'];
    if (fields.find(id => !req(id))) return alert('Please fill in all required fields.');
    goStep(3);
  } else if (from === 3) {
    const fields = ['director','producer','writer','cinematographer','editor','musicDirector','actor','actress'];
    if (fields.find(id => !req(id))) return alert('Please fill in all required crew fields.');
    goStep(4);
  }
}

// ── Validation ─────────────────────────────────────────────────────────────────
const req = id => (document.getElementById(id)?.value || '').trim();

function showPayStatus(cls, msg) {
  const el = document.getElementById('payStatus');
  el.style.display = msg ? '' : 'none';
  el.className = 'pay-status ' + (cls || 'pending');
  el.textContent = msg;
}

// ── Payment ─────────────────────────────────────────────────────────────────────
async function doPayment() {
  if (_payState.verified) { goStep(5); buildReview(); return; }

  if (typeof Cashfree !== 'function') {
    showPayStatus('err', 'Payment library not loaded. Check your connection and reload.'); return;
  }

  document.getElementById('payBtn').disabled = true;
  document.getElementById('retryBtn').style.display = 'none';
  showPayStatus('pending', 'Creating your secure payment order…');

  try {
    const orderResp = await backendCall({
      action: 'createOrder',
      customerName:  req('applicantName'),
      customerEmail: req('email'),
      customerPhone: req('phone')
    });
    if (!orderResp || orderResp.status !== 'success' || !orderResp.payment_session_id) {
      throw new Error(orderResp?.message || 'Could not create order.');
    }
    _payState.orderId = orderResp.order_id;

    const cashfree = Cashfree({ mode: CASHFREE_MODE });
    showPayStatus('pending', 'Opening Cashfree checkout…');
    const result = await cashfree.checkout({ paymentSessionId: orderResp.payment_session_id, redirectTarget: '_modal' });
    if (result?.error) showPayStatus('pending', 'Checkout closed. Verifying payment…');

    await verifyPayment();
  } catch(err) {
    showPayStatus('err', 'Payment error: ' + (err.message || 'Unknown error') + '. Please try again.');
    document.getElementById('payBtn').disabled = false;
    document.getElementById('retryBtn').style.display = '';
  }
}

async function verifyPayment() {
  if (!_payState.orderId) return;
  showPayStatus('pending', 'Verifying with server…');
  try {
    const resp = await backendCall({ action: 'verifyOrder', orderId: _payState.orderId });
    if (!resp || resp.status !== 'success') throw new Error(resp?.message || 'Verification failed.');
    const ps = (resp.order_status || '').toUpperCase();
    if (ps === 'PAID') {
      _payState.verified     = true;
      _payState.cfPaymentId  = resp.cf_payment_id || null;
      _payState.amount       = resp.order_amount   || 1000;
      _payState.paidAt       = resp.paid_at        || new Date().toISOString();
      _payState.paymentMethod= resp.payment_method || null;
      showPayStatus('ok', '✓ Payment of ₹' + (_payState.amount||1000) + ' confirmed. Please continue to review your entry.');
      document.getElementById('payBtn').style.display = 'none';
      // Auto-advance to review step
      setTimeout(() => { buildReview(); goStep(5); }, 800);
    } else if (ps === 'ACTIVE' || ps === 'PENDING') {
      showPayStatus('pending', 'Payment still processing — wait a moment then retry.');
      document.getElementById('payBtn').disabled = false;
      document.getElementById('retryBtn').style.display = '';
    } else {
      showPayStatus('err', 'Payment not completed (' + ps + '). No charge made — please try again.');
      document.getElementById('payBtn').disabled = false;
      document.getElementById('retryBtn').style.display = '';
    }
  } catch(err) {
    showPayStatus('err', 'Verification error: ' + (err.message||'network error') + '. Press Retry.');
    document.getElementById('payBtn').disabled = false;
    document.getElementById('retryBtn').style.display = '';
  }
}

// ── Review ────────────────────────────────────────────────────────────────────
function buildReview() {
  const section = (title, rows) => {
    const html = rows.map(([k,v]) => v
      ? `<div class="review-row"><span class="review-key">${k}</span><span class="review-val">${v}</span></div>`
      : '').join('');
    return `<div class="review-section"><h4>${title}</h4>${html}</div>`;
  };
  document.getElementById('reviewContent').innerHTML = `
    <div class="card">
      <div class="card-title">Step 5 of 5 · Review &amp; Submit</div>
      ${section('Applicant',[
        ['Full Name',  req('applicantName')],
        ['Email',      req('email')],
        ['Phone',      req('phone')],
        ['City',       req('city')],
      ])}
      ${section('Film',[
        ['Film Name',  req('filmName')],
        ['Category',   req('category')],
        ['Film Link',  req('filmLink')],
        ['Duration',   req('duration')],
      ])}
      ${section('Cast & Crew',[
        ['Director',        req('director')],
        ['Producer',        req('producer')],
        ['Writer',          req('writer')],
        ['Cinematographer', req('cinematographer')],
        ['Editor',          req('editor')],
        ['Music Director',  req('musicDirector')],
        ['Lead Actor',      req('actor')],
        ['Lead Actress',    req('actress')],
        ['Child Artist',    req('childArtist') || 'None'],
      ])}
      ${section('Payment',[
        ['Status',   '✓ Paid'],
        ['Amount',   '₹' + (_payState.amount||1000) + ' INR'],
        ['Order ID', _payState.orderId || '—'],
      ])}
    </div>`;
}

// ── Final submit ────────────────────────────────────────────────────────────────
async function doSubmit() {
  if (!_payState.verified) { alert('Payment not yet verified. Please complete payment first.'); return; }
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  const payload = {
    applicantName:   req('applicantName'),
    phone:           req('phone'),
    email:           req('email'),
    city:            req('city'),
    filmName:        req('filmName'),
    category:        req('category'),
    filmLink:        req('filmLink'),
    duration:        req('duration'),
    director:        req('director'),
    producer:        req('producer'),
    writer:          req('writer'),
    cinematographer: req('cinematographer'),
    editor:          req('editor'),
    musicDirector:   req('musicDirector'),
    actor:           req('actor'),
    actress:         req('actress'),
    childArtist:     req('childArtist') || 'None',
    paymentStatus:   'Paid',
    cashfreeOrderId: _payState.orderId,
    cashfreePaymentId: _payState.cfPaymentId,
    amount:          _payState.amount,
    currency:        'INR',
    paidAt:          _payState.paidAt,
    paymentMethod:   _payState.paymentMethod,
    // Direct link tracking
    source:          'direct_link',
    linkToken:       _token,
    linkId:          _linkId
  };

  try {
    const resp = await backendCall(payload);
    if (resp.status === 'success') {
      document.getElementById('successOrderId').textContent = _payState.orderId || '—';
      showState('success');
    } else {
      alert('Submission error: ' + (resp.message || 'Unknown error'));
      btn.disabled = false; btn.textContent = 'Submit Film Entry →';
    }
  } catch(err) {
    alert('Network error. Please try again: ' + (err.message||''));
    btn.disabled = false; btn.textContent = 'Submit Film Entry →';
  }
}

function backendCall(payload) {
  return fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

init();
