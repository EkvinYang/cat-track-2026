// Operator panel: identify the unit (type / QR), dictate what's happening, and get the
// machine's memory + crew alerts back in seconds.
(function () {
  const { api, esc, ago, dateShort, sevPill, statusPill, healthBar, toast, connectStream, store, icon, machineIcon, emptyState, skeleton, ROLE, modal } = CT;
  const $ = (id) => document.getElementById(id);

  const state = { unit: null, people: [], me: null, photo: null, listening: false, tts: store.get('tts', true), lastResult: null };

  // ---------- static chrome ----------
  $('scanBtn').innerHTML = `${icon('qr')}<span>Scan</span>`;
  $('photoBtn').innerHTML = `${icon('camera')} Add photo`;
  $('submitBtn').innerHTML = `${icon('send')} Send to Cat Track`;
  const renderTts = () => { $('ttsBtn').innerHTML = icon(state.tts ? 'speaker' : 'mute'); $('ttsBtn').style.color = state.tts ? 'var(--yellow)' : 'var(--muted)'; };
  renderTts();
  $('ttsBtn').onclick = () => { state.tts = !state.tts; store.set('tts', state.tts); renderTts(); if (!state.tts) window.speechSynthesis?.cancel(); toast(state.tts ? 'Spoken responses on' : 'Spoken responses off'); };

  // ---------- who is reporting (personalization) ----------
  function renderMe() {
    const p = state.me;
    $('meChip').innerHTML = `${icon('user')}<span>${p ? esc(p.name.split(' ')[0]) : 'Who?'}</span>`;
  }
  async function loadPeople() {
    state.people = await api('/api/people');
    const saved = store.get('me');
    const unitOp = state.unit?.asset.operator_id;
    state.me = state.people.find((p) => p.id === saved) || state.people.find((p) => p.id === unitOp) || state.people.find((p) => p.role === 'operator') || null;
    renderMe();
  }
  $('meChip').onclick = () => {
    const field = state.people.filter((p) => ['operator', 'technician', 'site_manager', 'safety_officer'].includes(p.role));
    const m = modal(`<h2>Who's reporting?</h2><p class="muted" style="margin-top:-4px">Your name goes on the record so the technician knows who to ask, and the advice you hear back matches your job.</p>
      <div class="people-list">${field.map((p) => `<button data-id="${p.id}" class="${state.me?.id === p.id ? 'sel' : ''}"><span><b>${esc(p.name)}</b><br><span class="muted" style="font-size:13px">${ROLE[p.role]}${p.site_name ? ' · ' + esc(p.site_name) : ''}</span></span>${state.me?.id === p.id ? icon('check') : ''}</button>`).join('')}</div>`);
    m.el.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => {
      state.me = state.people.find((p) => p.id === b.dataset.id); store.set('me', state.me.id); renderMe(); m.close();
      toast(`Reporting as ${esc(state.me.name)}`, 'good');
    });
  };

  // ---------- unit lookup ----------
  const recent = () => store.get('recentUnits', []);
  function renderRecent() {
    const list = recent();
    const defaults = ['EX-0412', 'HT-0761', 'DZ-0107', 'WL-0241'];
    const units = [...new Set([...list, ...defaults])].slice(0, 6);
    $('recentUnits').innerHTML = units.map((u) => `<button class="chip" data-u="${esc(u)}">${esc(u)}</button>`).join('');
    $('recentUnits').querySelectorAll('[data-u]').forEach((b) => b.onclick = () => { $('unitInput').value = b.dataset.u; loadUnit(b.dataset.u); });
  }

  let loadSeq = 0;
  async function loadUnit(raw, { quiet = false } = {}) {
    const id = String(raw || '').trim();
    if (!id) return;
    const seq = ++loadSeq;
    $('unitError').classList.add('hidden');
    if (!state.unit || state.unit.asset.id !== id.toUpperCase()) {
      $('unitCard').innerHTML = `<div class="unit-head"><span class="sk" style="width:60px;height:60px"></span><div><span class="sk title"></span><span class="sk line" style="width:70%"></span></div></div><div style="margin-top:16px">${skeleton(3)}</div>`;
    }
    try {
      const data = await api(`/api/assets/${encodeURIComponent(id)}`);
      if (seq !== loadSeq) return;
      const firstLoad = !state.unit || state.unit.asset.id !== data.asset.id;
      state.unit = data;
      $('unitInput').value = data.asset.id;
      store.set('recentUnits', [data.asset.id, ...recent().filter((u) => u !== data.asset.id)].slice(0, 6));
      renderRecent();
      renderUnit();
      updateSubmit();
      if (firstLoad) {
        // Until someone explicitly picks who they are, assume the machine's assigned operator.
        if (!store.get('me') && data.asset.operator_id && state.people.length) {
          state.me = state.people.find((p) => p.id === data.asset.operator_id) || state.me; renderMe();
        }
        loadFeed();
        if (!quiet) navigator.vibrate?.(30);
        const url = new URL(location.href); url.searchParams.set('unit', data.asset.id); history.replaceState(null, '', url);
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      state.unit = null;
      renderNotFound(id, err.message);
      updateSubmit();
    }
  }

  function renderUnit() {
    const { asset, memory, alerts } = state.unit;
    const since = asset.last_service_hours != null ? Math.round(asset.smu_hours - asset.last_service_hours) : null;
    const top = memory.filter((m) => m.kind !== 'service').slice(0, 3);
    $('unitCard').innerHTML = `
      <div class="unit-head">
        <div class="unit-ico">${machineIcon(asset.family)}</div>
        <div class="grow">
          <div class="row spread" style="align-items:flex-start"><div class="unit-model">${esc(asset.model)}</div>${statusPill(asset.status)}</div>
          <div class="unit-sub"><span class="id" style="color:var(--ink)">${esc(asset.id)}</span> · ${esc(asset.family)} · S/N <span class="mono">${esc(asset.serial)}</span></div>
          <div class="unit-sub">${esc(asset.site_name)}</div>
        </div>
      </div>
      <div style="margin-top:14px">
        <div class="row spread" style="font-size:13px;margin-bottom:6px"><span class="muted">Health, from open issues and age</span><span class="mono">${asset.health}/100</span></div>
        ${healthBar(asset.health)}
      </div>
      <div class="meta-grid">
        <div class="meta"><div class="k">Hours</div><div class="v">${Math.round(asset.smu_hours).toLocaleString()}</div></div>
        <div class="meta"><div class="k">Fuel</div><div class="v">${Math.round(asset.fuel_pct)}%</div></div>
        <div class="meta"><div class="k">Open issues</div><div class="v">${alerts.length}</div></div>
        <div class="meta"><div class="k">Last service</div><div class="v">${dateShort(asset.last_service_at)}</div></div>
        <div class="meta"><div class="k">Since PM</div><div class="v">${since != null ? since + ' h' : '—'}</div></div>
        <div class="meta"><div class="k">On record</div><div class="v">${state.unit.stats.total} entries</div></div>
      </div>
      ${top.length ? `<ul class="mem-list">${top.map((m) => `<li class="${m.level}">${icon(m.kind === 'fleet' ? 'graph' : m.kind === 'bulletin' ? 'wrench' : m.kind === 'pattern' ? 'alert' : 'history')}<span>${esc(m.text)}</span></li>`).join('')}</ul>` : '<ul class="mem-list"><li><span></span><span class="muted">Nothing unusual on record for this machine.</span></li></ul>'}
      ${alerts.length ? `<div style="margin-top:12px">${alerts.slice(0, 2).map((a) => `<div class="alert-card ${esc(a.severity)}"><div class="t">${esc(a.title)}</div><div class="b">${ago(a.created_at)}</div></div>`).join('')}</div>` : ''}
      <div class="row spread wrap" style="margin-top:14px;font-size:14px"><span class="muted">Assigned to ${esc(asset.operator_name || 'nobody yet')}</span><a href="/asset?id=${encodeURIComponent(asset.id)}">Full history for ${esc(asset.id)}</a></div>`;
    $('whereTxt').textContent = asset.site_name.split(' ').slice(0, 2).join(' ');
  }

  function renderNoUnit() {
    $('unitCard').innerHTML = `<div class="nounit" style="padding:0"><div class="tag-art">${icon('qr')}</div><div>
      <div style="font-weight:600">Which machine are you on?</div>
      <div class="muted" style="font-size:14px;margin-top:4px">There’s a Cat Track tag inside the cab door. Tap <b style="color:var(--ink)">Scan</b> and point your camera at it, or type the unit number printed under the code. It looks like <span class="id" style="color:var(--ink)">EX-0412</span>.</div></div></div>`;
    $('feed').innerHTML = emptyState({ icon: 'pin', title: 'No job site yet', body: 'Alerts for the machine’s site appear here once you pick a machine.' });
  }
  let allAssets = null;
  async function renderNotFound(raw, message) {
    const typed = String(raw).toUpperCase();
    $('unitCard').innerHTML = emptyState({ icon: 'search', error: true, title: `No machine called “${esc(typed)}”`, body: `${esc(message.startsWith('Unknown') ? 'It isn’t in the fleet record. Check the tag — unit numbers are two letters and four digits.' : message)}` });
    try {
      allAssets ||= await api('/api/assets');
      const digits = typed.replace(/\D/g, '');
      const near = allAssets.filter((a) => (digits && a.id.includes(digits.slice(-3))) || a.id.startsWith(typed.slice(0, 2))).slice(0, 4);
      if (near.length) {
        $('unitCard').insertAdjacentHTML('beforeend', `<div class="row wrap" style="padding:0 2px 6px 48px"><span class="muted" style="font-size:13px">Did you mean</span>${near.map((a) => `<button class="chip" data-near="${esc(a.id)}"><span class="k">${esc(a.model)}</span><span class="id">${esc(a.id)}</span></button>`).join('')}</div>`);
        $('unitCard').querySelectorAll('[data-near]').forEach((b) => b.onclick = () => { unitInput.value = b.dataset.near; loadUnit(b.dataset.near); });
      }
    } catch { /* suggestions are optional */ }
  }

  const unitInput = $('unitInput');
  let typeTimer = null;
  unitInput.addEventListener('input', () => {
    clearTimeout(typeTimer);
    const v = unitInput.value.trim();
    if (/^(CAT[-\s]?)?[A-Za-z]{2}[-\s]?\d{3,4}$/i.test(v)) typeTimer = setTimeout(() => loadUnit(v), 350);
  });
  unitInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadUnit(unitInput.value); unitInput.blur(); } });
  unitInput.addEventListener('change', () => loadUnit(unitInput.value));

  // ---------- QR scanner ----------
  let scanStream = null; let scanRaf = 0; let scanEl = null;
  function stopScan() {
    cancelAnimationFrame(scanRaf);
    scanStream?.getTracks().forEach((t) => t.stop());
    scanStream = null;
    scanEl?.remove(); scanEl = null;
  }
  function handleQr(text) {
    stopScan();
    navigator.vibrate?.([40, 30, 40]);
    const m = String(text).match(/[?&]unit=([A-Za-z0-9-]+)/i);
    const id = m ? m[1] : String(text).trim();
    unitInput.value = id.toUpperCase();
    toast(`Scanned ${esc(id.toUpperCase())}`, 'good');
    loadUnit(id);
  }
  async function decodeImageFile(file) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const code = window.jsQR && window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) handleQr(code.data); else toast('No QR code found in that photo — try again closer.', 'high');
  }
  async function startScan() {
    scanEl = document.createElement('div');
    scanEl.className = 'scanner';
    scanEl.innerHTML = `<video playsinline muted autoplay></video><div class="frame"></div>
      <div class="bar"><b style="font-family:var(--font-cond);font-size:20px;letter-spacing:.06em">SCAN MACHINE TAG</b><button class="btn" id="scanClose">${icon('x')} Close</button></div>
      <div class="msg" id="scanMsg">Point at the QR tag on the machine</div>`;
    document.body.appendChild(scanEl);
    scanEl.querySelector('#scanClose').onclick = stopScan;
    const msg = scanEl.querySelector('#scanMsg');
    const photoFallback = () => {
      msg.innerHTML = `<label class="btn primary" style="margin-top:8px">${icon('camera')} Take a photo of the tag<input type="file" accept="image/*" capture="environment" class="hidden" id="qrFile"></label>`;
      scanEl.querySelector('#qrFile').onchange = (e) => { const f = e.target.files[0]; if (f) decodeImageFile(f).catch(() => toast('Could not read that photo', 'high')); };
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      msg.innerHTML = 'Live camera needs HTTPS. ';
      photoFallback();
      return;
    }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (err) {
      msg.textContent = err.name === 'NotAllowedError' ? 'Camera permission denied. ' : 'Camera unavailable. ';
      photoFallback();
      return;
    }
    if (!scanEl) { scanStream.getTracks().forEach((t) => t.stop()); return; }
    const video = scanEl.querySelector('video');
    video.srcObject = scanStream;
    try { await video.play(); } catch { /* autoplay with muted+playsinline normally succeeds */ }
    let detector = null;
    if ('BarcodeDetector' in window) {
      try { const fmts = await window.BarcodeDetector.getSupportedFormats(); if (fmts.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
    }
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let last = 0; let busy = false;
    const loop = async (t) => {
      if (!scanStream) return;
      scanRaf = requestAnimationFrame(loop);
      if (busy || t - last < 140 || video.readyState < 2) return;
      last = t; busy = true;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) return handleQr(codes[0].rawValue);
        } else if (window.jsQR) {
          const w = Math.min(640, video.videoWidth); const h = Math.round(video.videoHeight * (w / video.videoWidth));
          if (w && h) {
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code?.data) return handleQr(code.data);
          }
        }
      } catch { /* keep scanning */ } finally { busy = false; }
    };
    scanRaf = requestAnimationFrame(loop);
  }
  $('scanBtn').onclick = startScan;

  // ---------- voice dictation ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const dictateBtn = $('dictateBtn');
  const reportText = $('reportText');
  let rec = null; let baseText = ''; let autoStop = null; let usedVoice = false;

  function renderDictate() {
    dictateBtn.classList.toggle('listening', state.listening);
    dictateBtn.innerHTML = `${icon(state.listening ? 'stop' : 'mic')}<span class="lab">${state.listening ? 'Tap to stop' : SR ? 'Tap to talk' : 'Type below'}</span>`;
    dictateBtn.setAttribute('aria-label', state.listening ? 'Stop dictation' : 'Start dictation');
  }
  const joinText = (...parts) => parts.map((p) => (p || '').trim()).filter(Boolean).join(' ');

  function startDictation() {
    if (!SR) {
      reportText.focus();
      $('dictateHint').textContent = 'This browser can’t listen directly. Tap the box below and use the microphone key on your keyboard instead.';
      return;
    }
    window.speechSynthesis?.cancel();
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = !isAndroid; // Android Chrome duplicates results in continuous mode; we restart instead.
    rec.maxAlternatives = 1;
    baseText = reportText.value;
    rec.onresult = (e) => {
      let finalT = ''; let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalT += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      reportText.value = joinText(baseText, finalT, interim);
      usedVoice = true;
      $('dictateHint').innerHTML = interim ? `<span class="interim">${esc(interim)}</span>` : 'Listening…';
      updateSubmit();
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      state.listening = false;
      const msgs = { 'not-allowed': 'Microphone permission was blocked. Allow mic access for this site and try again.', 'service-not-allowed': 'Speech recognition is disabled on this device (on iPhone enable Siri & Dictation). You can use the keyboard mic instead.', network: 'Speech service needs a network connection.', 'audio-capture': 'No microphone found.' };
      $('dictateHint').textContent = msgs[e.error] || `Voice error: ${e.error}`;
      renderDictate();
    };
    rec.onend = () => {
      baseText = reportText.value;
      if (state.listening) {
        try { rec.start(); return; } catch { state.listening = false; }
      }
      clearTimeout(autoStop);
      renderDictate();
      if (!/error|blocked|disabled|found|network/i.test($('dictateHint').textContent)) {
        $('dictateHint').textContent = reportText.value.trim() ? 'Got it. Fix anything it misheard, then send.' : 'Didn’t catch anything. Move away from the engine noise and try again.';
      }
      updateSubmit();
    };
    try {
      rec.start();
      state.listening = true;
      $('dictateHint').textContent = 'Listening…';
      navigator.vibrate?.(25);
      clearTimeout(autoStop);
      autoStop = setTimeout(() => stopDictation(), 90_000);
    } catch (err) {
      $('dictateHint').textContent = `Couldn't start the microphone: ${err.message}`;
    }
    renderDictate();
  }
  function stopDictation() {
    state.listening = false;
    clearTimeout(autoStop);
    try { rec?.stop(); } catch { /* already stopped */ }
    renderDictate();
  }
  dictateBtn.onclick = () => (state.listening ? stopDictation() : startDictation());
  renderDictate();
  if (!SR) $('dictateHint').textContent = 'This browser can’t listen directly. Use the microphone key on your keyboard in the box below.';

  reportText.addEventListener('input', updateSubmit);
  $('clearBtn').onclick = () => { reportText.value = ''; baseText = ''; usedVoice = false; clearPhoto(); updateSubmit(); };
  document.querySelectorAll('.examples .ex').forEach((b) => b.onclick = () => {
    reportText.value = b.textContent.trim();
    if (!state.unit) { const pick = /track idler/i.test(b.textContent) ? 'DZ-0107' : /coolant|haul road/i.test(b.textContent) ? 'HT-0761' : /trench/i.test(b.textContent) ? 'EX-0519' : /fuel filter/i.test(b.textContent) ? 'WL-0233' : 'EX-0412'; unitInput.value = pick; loadUnit(pick); }
    updateSubmit();
    b.closest('details').open = false;
    reportText.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- photo ----------
  function clearPhoto() { state.photo = null; $('photoPrev').classList.add('hidden'); $('photoInput').value = ''; }
  $('photoRemove').onclick = clearPhoto;
  $('photoInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      state.photo = c.toDataURL('image/jpeg', 0.82);
      $('photoPrev').querySelector('img').src = state.photo;
      $('photoPrev').classList.remove('hidden');
    } catch { toast('Could not read that image', 'high'); }
  };

  // ---------- submit ----------
  function updateSubmit() {
    const ok = Boolean(state.unit) && reportText.value.trim().length > 2;
    $('submitBtn').disabled = !ok;
    $('submitBtn').innerHTML = state.unit ? `${icon('send')} Send report on ${esc(state.unit.asset.id)}` : 'Pick a machine first';
  }

  const STEPS = ['Reading what you said', 'Filing it under this machine', 'Checking if this has happened before', 'Telling the people on site', 'Deciding whether CAT Engineering needs it'];
  function runSteps() {
    $('progressBox').classList.remove('hidden');
    $('steps').innerHTML = STEPS.map((s) => `<li><span class="b"></span>${s}</li>`).join('');
    const lis = [...$('steps').children];
    let i = 0;
    lis[0].classList.add('active');
    const timer = setInterval(() => {
      if (i < lis.length - 1) { lis[i].classList.remove('active'); lis[i].classList.add('done'); lis[i].querySelector('.b').innerHTML = icon('check'); i++; lis[i].classList.add('active'); }
    }, 650);
    return () => { clearInterval(timer); lis.forEach((li) => { li.classList.remove('active'); li.classList.add('done'); li.querySelector('.b').innerHTML = icon('check'); }); };
  }

  $('submitBtn').onclick = async () => {
    if (state.listening) stopDictation();
    const text = reportText.value.trim();
    if (!state.unit || !text) return;
    $('submitBtn').disabled = true;
    state.submitting = true;
    $('resultBox').classList.add('hidden');
    const finish = runSteps();
    $('progressBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const out = await api('/api/reports', { body: { assetId: state.unit.asset.id, personId: state.me?.id, text, source: usedVoice ? 'voice' : 'text', photo: state.photo } });
      finish();
      state.lastResult = out;
      setTimeout(() => { $('progressBox').classList.add('hidden'); renderResult(out); }, 350);
      reportText.value = ''; baseText = ''; usedVoice = false; clearPhoto();
      loadUnit(state.unit.asset.id, { quiet: true });
      navigator.vibrate?.(out.extraction.severity === 'critical' ? [80, 50, 80, 50, 80] : 40);
    } catch (err) {
      finish();
      $('progressBox').classList.add('hidden');
      toast(`Couldn’t send: ${esc(err.message)} Your words are still in the box.`, 'high');
    } finally {
      state.submitting = false;
      updateSubmit();
    }
  };

  function speak(text) {
    if (!state.tts || !window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch { /* TTS unavailable */ }
  }

  function renderResult(out) {
    const ex = out.extraction;
    const chip = (label, items, cls = '') => items.map((x) => `<span class="chip ${cls}"><span class="k">${label}</span>${esc(x)}</span>`).join('');
    const fix = out.fixes[0];
    const box = $('resultBox');
    box.innerHTML = `
      <div class="result-banner ${esc(ex.severity)}">
        <div class="row wrap" style="gap:6px">${sevPill(ex.severity)}<span class="tag">${esc(ex.category)}</span><span class="tag">${ex.ai_mode === 'claude' ? 'read by Claude' : 'read offline'}</span></div>
        <div class="h">${esc(ex.summary)}</div>
        <div class="guidance">${esc(ex.operator_guidance)}</div>
      </div>
      ${out.report.photo_path ? `<img src="${esc(out.report.photo_path)}" alt="Photo attached to this report" style="margin-top:12px;max-width:100%;border-radius:4px;border:1px solid var(--line)">` : ''}
      <div class="res-sec"><h4>What it picked out</h4><div class="chips">
        ${chip('part', ex.components)}${chip('symptom', ex.symptoms)}${chip('code', ex.fault_codes)}${chip('condition', ex.conditions)}${chip('hazard', ex.safety_hazards, 'hazard')}
        ${!ex.components.length && !ex.symptoms.length && !ex.safety_hazards.length ? '<span class="muted">No parts or symptoms named. Saved as a general note on this machine.</span>' : ''}
      </div></div>
      <div class="res-sec"><h4>Who's been told</h4>
        ${out.routed.length ? out.routed.map((r) => `<div class="route">${icon(r.to === 'CAT Engineering' ? 'wrench' : 'alert')}<div><b>${esc(r.to)}</b><div class="muted" style="font-size:13px">${esc(r.detail || '')}</div></div></div>`).join('') : '<div class="route"><span></span><div class="muted">Nobody. It’s low priority, so it went on the machine’s record without paging anyone.</div></div>'}
      </div>
      ${out.actions.length ? `<div class="res-sec"><h4>Tasks created</h4>${out.actions.map((a) => `<div class="act"><span class="who">${esc(ROLE[a.assignee_role] || a.assignee_role)}</span><span>${esc(a.text)}</span></div>`).join('')}</div>` : ''}
      ${fix ? `<div class="res-sec"><h4>What fixed this before</h4><div class="fix-card">
        <b>${esc(fix.title)}</b>
        ${fix.steps ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(fix.steps)}</div>` : ''}
        <div class="conf"><i style="width:${fix.confidence}%"></i></div>
        <div class="muted" style="font-size:13px;margin-top:6px" id="fixStat">Worked ${fix.success} of ${fix.success + fix.fail} times on ${esc(out.asset.model)} machines.</div>
        <div class="row wrap" style="margin-top:10px"><span class="muted" style="font-size:13px">Tried it?</span><button class="btn sm" data-fb="1">${icon('thumbUp')} It worked</button><button class="btn sm" data-fb="0">${icon('thumbDown')} It didn’t</button></div>
      </div></div>` : ''}
      ${out.similar.length ? `<div class="res-sec"><h4>Seen before</h4>${out.similar.slice(0, 3).map((s) => `<div class="sim"><div class="row spread"><span class="id">${esc(s.asset_id)}</span><span class="faint mono" style="font-size:12px">${dateShort(s.created_at)}</span></div><div>${esc(s.summary)}</div><div class="faint" style="font-size:12px;margin-top:2px">matched on ${esc(s.reasons.slice(0, 4).join(', '))}</div></div>`).join('')}</div>` : ''}
      <div class="graph-note">${icon('graph')}<span>Added to the record: ${out.graph.newNodes} new ${out.graph.newNodes === 1 ? 'fact' : 'facts'}, ${out.graph.newEdges} new links, ${out.graph.reinforced} existing ones confirmed.</span></div>
      <button class="btn block lg" style="margin-top:14px" id="newReport">${icon('mic')} Report something else</button>`;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.querySelectorAll('[data-fb]').forEach((b) => b.onclick = async () => {
      try {
        const r = await api(`/api/fixes/${fix.id}/feedback`, { body: { worked: b.dataset.fb === '1', assetId: out.asset.id, reportId: out.report.id, personId: state.me?.id } });
        box.querySelector('#fixStat').textContent = `Now worked ${r.fix.success} of ${r.fix.success + r.fix.fail} times. Thanks — the next crew will see your result.`;
        box.querySelectorAll('[data-fb]').forEach((x) => { x.disabled = true; });
        toast('Saved. This changes how the fix is ranked for everyone.', 'good');
      } catch (err) { toast(esc(err.message), 'high'); }
    });
    box.querySelector('#newReport').onclick = () => { box.classList.add('hidden'); $('reportBox').scrollIntoView({ behavior: 'smooth' }); };
    speak(`${ex.severity === 'critical' ? 'Critical. ' : ''}${ex.operator_guidance}${out.routed.length ? ` I've alerted ${out.routed.map((r) => r.to).join(' and ')}.` : ''}`);
  }

  // ---------- live site alerts ----------
  let feedAlerts = [];
  async function loadFeed() {
    if (!state.unit) return;
    $('feedTitle').textContent = `Alerts at ${state.unit.asset.site_name}`;
    $('feed').innerHTML = skeleton(2, 'block');
    try { feedAlerts = await api(`/api/alerts?site=${encodeURIComponent(state.unit.asset.site_id)}`); renderFeed(); } catch { /* keep old */ }
  }
  function renderFeed(flashId) {
    $('feedCount').textContent = feedAlerts.length ? `${feedAlerts.length} open` : '';
    $('feed').innerHTML = feedAlerts.length
      ? feedAlerts.slice(0, 8).map((a) => `<div class="alert-card ${esc(a.kind === 'bulletin' || a.kind === 'agent' ? a.kind : a.severity)} ${a.id === flashId ? 'flash' : ''}"><div class="row spread" style="align-items:flex-start"><span class="t">${esc(a.title)}</span><span class="faint mono" style="font-size:11px;white-space:nowrap">${ago(a.created_at)}</span></div>${a.body ? `<div class="b">${esc(a.body.length > 180 ? a.body.slice(0, 179) + '…' : a.body)}</div>` : ''}</div>`).join('')
      : emptyState({ icon: 'shield', title: `Nothing open at ${esc(state.unit.asset.site_name)}`, body: 'When anyone on this site reports a problem, it shows up here within a second, and your phone buzzes.' });
  }

  connectStream({
    alert: ({ alert }) => {
      if (!state.unit || alert.site_id !== state.unit.asset.site_id) return;
      feedAlerts = [alert, ...feedAlerts.filter((a) => a.id !== alert.id)];
      renderFeed(alert.id);
      const ownReport = state.submitting && alert.asset_id === state.unit.asset.id;
      if (!ownReport && state.lastResult?.alert?.id !== alert.id) {
        toast(`${icon('alert')} <b>${esc(alert.title)}</b>`, alert.severity);
        navigator.vibrate?.([60, 40, 60]);
      }
    },
    'alert-updated': ({ alert }) => {
      if (!state.unit || alert.site_id !== state.unit.asset.site_id) return;
      feedAlerts = alert.status === 'resolved' ? feedAlerts.filter((a) => a.id !== alert.id) : feedAlerts.map((a) => (a.id === alert.id ? alert : a));
      renderFeed();
    },
    asset: (asset) => { if (state.unit && asset.id === state.unit.asset.id) loadUnit(asset.id, { quiet: true }); },
  }, $('live'));

  // ---------- boot ----------
  renderRecent();
  updateSubmit();
  loadPeople().catch(() => toast('Could not load crew list', 'high'));
  const qs = new URLSearchParams(location.search).get('unit');
  if (qs) { unitInput.value = qs.toUpperCase(); loadUnit(qs, { quiet: true }); } else renderNoUnit();
})();
