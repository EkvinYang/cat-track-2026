// CAT Engineering portal: fleet-wide mechanical cases with field evidence, AI root-cause
// analysis, and the loop back to the field (quick fixes) and to the product (design updates).
(function () {
  const { api, esc, ago, dateShort, sevPill, md, toast, connectStream, store, topbar, modal, icon, ROLE } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('/engineering');

  const STATUSES = ['new', 'investigating', 'quick_fix_issued', 'product_update', 'closed'];
  const STATUS_LABEL = { new: 'New', investigating: 'Investigating', quick_fix_issued: 'Quick fix issued', product_update: 'Product update', closed: 'Closed' };
  const state = { cases: [], selected: Number(new URLSearchParams(location.search).get('case')) || null, detail: null, engineers: [], filter: 'open' };

  async function boot() {
    const people = await api('/api/people');
    state.engineers = people.filter((p) => p.role === 'cat_engineer');
    $('engineerSel').innerHTML = state.engineers.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} — ${esc(p.specialty)}</option>`).join('');
    $('engineerSel').value = store.get('engineer', state.engineers[0]?.name);
    $('engineerSel').onchange = () => store.set('engineer', $('engineerSel').value);
    $('statusFilter').onchange = () => { state.filter = $('statusFilter').value; renderCases(); };
    await loadCases();
  }
  const me = () => $('engineerSel').value;

  async function loadCases() {
    state.cases = await api('/api/cases');
    if (!state.selected && state.cases[0]) state.selected = state.cases[0].id;
    renderKpis(); renderCases();
    if (state.selected) await loadDetail(state.selected);
  }

  async function renderKpis() {
    const open = state.cases.filter((c) => c.status !== 'closed');
    const fixes = await api('/api/fixes');
    const eng = fixes.filter((f) => f.source === 'engineering');
    const tried = fixes.reduce((n, f) => n + f.success + f.fail, 0);
    const worked = fixes.reduce((n, f) => n + f.success, 0);
    $('kpis').innerHTML = [
      ['Open cases', open.length, ''], ['P1 fleet patterns', open.filter((c) => c.priority === 'P1').length, open.some((c) => c.priority === 'P1') ? 'bad' : 'good'],
      ['Field reports linked', state.cases.reduce((n, c) => n + c.occurrences, 0), ''], ['Quick fixes issued', eng.length, ''],
      ['Learned field fixes', fixes.filter((f) => f.source === 'field').length, ''], ['Field fix success', tried ? `${Math.round((worked / tried) * 100)}%` : '—', 'good'],
    ].map(([k, v, cls]) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  }

  function renderCases() {
    const f = state.filter;
    const list = state.cases.filter((c) => (f === 'all' ? true : f === 'open' ? c.status !== 'closed' : c.status === f));
    $('caseCount').textContent = `${list.length} shown`;
    $('cases').innerHTML = list.map((c) => `<button class="case-item ${c.id === state.selected ? 'sel' : ''}" data-id="${c.id}">
      <div class="row spread"><span class="row" style="gap:6px"><span class="prio ${c.priority}">${c.priority}</span><span class="faint mono">#${c.id}</span></span><span class="pill sev-info">${esc(STATUS_LABEL[c.status])}</span></div>
      <div class="tt">${esc(c.title)}</div>
      <div class="mm">${c.occurrences} report${c.occurrences === 1 ? '' : 's'} · ${c.machines} machine${c.machines === 1 ? '' : 's'} · ${c.sites} site${c.sites === 1 ? '' : 's'} · last ${ago(c.last_seen)}</div></button>`).join('') || '<div class="empty">No cases match.</div>';
    $('cases').querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { state.selected = Number(b.dataset.id); renderCases(); loadDetail(state.selected); const u = new URL(location.href); u.searchParams.set('case', state.selected); history.replaceState(null, '', u); });
  }

  async function loadDetail(id) {
    try { state.detail = await api(`/api/cases/${id}`); renderDetail(); } catch (err) { $('detail').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  const bars = (rows, total, color) => rows.length ? rows.slice(0, 6).map((r) => `<div class="bar-row"><span class="lab" title="${esc(r.name)}">${esc(r.name)}</span><span class="bar"><i style="width:${Math.round((r.n / total) * 100)}%;${color ? `background:${color}` : ''}"></i></span><b>${r.n}/${total}</b></div>`).join('') : '<div class="faint" style="font-size:13px;margin-top:6px">None recorded</div>';

  function renderDetail() {
    const d = state.detail; const c = d.case;
    const idx = STATUSES.indexOf(c.status);
    const total = d.reports.length;
    $('detail').innerHTML = `
      <div class="detail-head">
        <div class="row spread wrap"><span class="row" style="gap:8px"><span class="prio ${c.priority}">${c.priority}</span><span class="faint mono">Case #${c.id}</span>${c.engineer ? `<span class="muted" style="font-size:13px">${icon('user')} ${esc(c.engineer)}</span>` : ''}</span>
          <span class="faint" style="font-size:13px">first seen ${dateShort(c.first_seen)} · last ${ago(c.last_seen)}</span></div>
        <h2 style="margin-top:8px">${esc(c.title)}</h2>
        <div class="timeline-status">${STATUSES.map((s, i) => `<span class="${i === idx ? 'on' : i < idx ? 'past' : ''}">${STATUS_LABEL[s]}</span>`).join('')}</div>
      </div>
      <div class="ev-grid">
        <div class="card"><h3 style="font-size:13px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase">Affected machines</h3>
          ${d.machines.map((m) => `<div class="row spread" style="margin-top:7px;font-size:14px"><a href="/asset?id=${encodeURIComponent(m.id)}"><b>${esc(m.id)}</b></a><span class="muted">${m.hours.toLocaleString()} h · ${esc(m.site.split(' ')[0])}</span></div>`).join('')}</div>
        <div class="card"><h3 style="font-size:13px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase">Operating conditions</h3>${bars(d.conditions, total)}</div>
        <div class="card"><h3 style="font-size:13px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase">Fault codes & symptoms</h3>${bars([...d.codes, ...d.symptoms.filter((s) => s.name !== 'Warning / fault code')], total, 'var(--purple)')}</div>
      </div>

      <div class="ai-box" style="margin-top:16px">
        <div class="row spread"><b>${icon('brain')} Root-cause analysis</b><button class="btn sm" id="analyzeBtn">${icon('zap')} ${c.ai_analysis ? 'Re-analyze' : 'Analyze field evidence'}</button></div>
        <div class="md" id="aiText" style="margin-top:8px">${c.ai_analysis ? md(c.ai_analysis) : '<span class="muted">Run an analysis across every linked field report, condition and repair.</span>'}</div>
      </div>

      <div class="two">
        <div>
          <h3 style="font-size:14px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Field evidence (${total})</h3>
          ${d.reports.map((r) => `<div class="ev"><div class="row spread wrap"><span class="row" style="gap:6px">${sevPill(r.severity)}<b>${esc(r.asset_id)}</b><span class="faint" style="font-size:13px">${esc(r.site_name)}</span></span><span class="faint" style="font-size:12px">${ago(r.created_at)}</span></div>
            <div class="q">"${esc(r.raw_text)}"</div>
            <div class="faint" style="font-size:12px;margin-top:4px">${esc(r.person_name || (r.source === 'telemetry' ? 'Telemetry stream' : ''))}${r.person_role ? ' · ' + ROLE[r.person_role] : ''} · ${Math.round(r.smu_hours).toLocaleString()} h${(r.extraction.conditions || []).length ? ' · ' + esc(r.extraction.conditions.join(', ')) : ''}</div>
            ${r.photo_path ? `<img src="${esc(r.photo_path)}" alt="Field photo">` : ''}</div>`).join('')}
        </div>
        <div>
          <h3 style="font-size:14px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Known fixes · learned from the field</h3>
          ${d.fixes.length ? d.fixes.map((f) => `<div class="fix-row"><div class="row spread" style="align-items:flex-start"><b>${esc(f.title)}</b><span class="pill ${f.source === 'engineering' ? 'sev-info' : 'sev-low'}">${esc(f.source)}</span></div>
            <div class="conf"><i style="width:${f.confidence}%"></i></div><div class="faint" style="font-size:12px;margin-top:4px">${f.confidence}% success · worked ${f.success}× · failed ${f.fail}× · by ${esc(f.author || '—')}</div></div>`).join('') : '<div class="empty">No fixes recorded yet.</div>'}
          ${d.repairs.length ? `<h3 style="font-size:14px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px">Repairs on affected machines</h3>${d.repairs.slice(0, 5).map((r) => `<div class="ev"><div class="row spread"><b>${esc(r.asset_id)}</b><span class="faint" style="font-size:12px">${ago(r.created_at)}</span></div><div style="font-size:14px;margin-top:3px">${esc(r.raw_text)}</div></div>`).join('')}` : ''}
          ${c.quick_fix ? `<div class="card" style="margin-top:16px;border-color:rgba(90,169,255,.45)"><b>${icon('wrench')} Quick fix in the field</b><div style="margin-top:4px">${esc(c.quick_fix)}</div></div>` : ''}
          ${c.product_action ? `<div class="card" style="margin-top:10px;border-color:rgba(255,205,17,.45)"><b>${icon('zap')} Planned product update</b><div style="margin-top:4px">${esc(c.product_action)}</div></div>` : ''}
          <h3 style="font-size:14px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px">Engineering actions</h3>
          <div class="row wrap">
            <button class="btn primary" id="qfBtn">${icon('send')} Issue quick fix to field</button>
            <button class="btn" id="puBtn">${icon('zap')} Plan product update</button>
            ${c.status === 'new' ? `<button class="btn" data-st="investigating">Start investigating</button>` : ''}
            ${c.status !== 'closed' ? `<button class="btn ghost" data-st="closed">Close case</button>` : `<button class="btn ghost" data-st="investigating">Reopen</button>`}
          </div>
        </div>
      </div>`;
    $('analyzeBtn').onclick = analyze;
    $('qfBtn').onclick = quickFixDialog;
    $('puBtn').onclick = productDialog;
    $('detail').querySelectorAll('[data-st]').forEach((b) => b.onclick = () => setStatus(b.dataset.st));
  }

  async function analyze() {
    const btn = $('analyzeBtn'); btn.disabled = true; btn.innerHTML = `${icon('refresh')} Analyzing…`;
    $('aiText').innerHTML = '<span class="muted">Reading every linked report, condition, fault code and repair…</span>';
    try {
      const out = await api(`/api/cases/${state.selected}/analyze`, { body: {} });
      $('aiText').innerHTML = md(out.analysis);
      btn.innerHTML = `${icon('zap')} Re-analyze`;
    } catch (err) { $('aiText').textContent = err.message; btn.innerHTML = `${icon('zap')} Analyze field evidence`; }
    btn.disabled = false;
  }

  function quickFixDialog() {
    const c = state.detail.case; const best = state.detail.fixes[0];
    const m = modal(`<h2>Issue quick fix to the field</h2>
      <p class="muted" style="margin-top:-6px">Every site running a ${esc(c.model)} gets an alert and a technician task per machine. Field results will feed back into this fix's success rate.</p>
      <label class="lbl" style="margin-top:12px">Quick fix</label><input class="input" id="qfTitle" value="${esc(best ? best.title : '')}" placeholder="Short instruction">
      <label class="lbl" style="margin-top:12px">Steps</label><textarea class="textarea" id="qfSteps" placeholder="Step-by-step for technicians">${esc(best?.steps || '')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="qfCancel">Cancel</button><button class="btn primary" id="qfGo">${icon('send')} Send to field</button></div>`);
    m.el.querySelector('#qfCancel').onclick = m.close;
    m.el.querySelector('#qfGo').onclick = async () => {
      const title = m.el.querySelector('#qfTitle').value.trim();
      if (!title) return toast('Give the quick fix a title', 'high');
      try {
        const out = await api(`/api/cases/${c.id}/quick-fix`, { body: { title, steps: m.el.querySelector('#qfSteps').value.trim(), engineer: me() } });
        m.close(); toast(`${icon('send')} Quick fix sent to ${out.sitesNotified} job site${out.sitesNotified === 1 ? '' : 's'}.`, 'good'); loadCases();
      } catch (err) { toast(esc(err.message), 'high'); }
    };
  }

  function productDialog() {
    const c = state.detail.case;
    const m = modal(`<h2>Plan a product update</h2>
      <p class="muted" style="margin-top:-6px">Record the long-term design change. Fleet managers on affected sites are notified.</p>
      <label class="lbl" style="margin-top:12px">Root cause</label><input class="input" id="puRoot" value="${esc(c.root_cause || '')}" placeholder="e.g. Hose chafes on boom-foot bracket under articulation">
      <label class="lbl" style="margin-top:12px">Product action</label><textarea class="textarea" id="puAct" placeholder="e.g. Revise bracket geometry and hose routing for new builds; retrofit kit for fielded units">${esc(c.product_action || '')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="puCancel">Cancel</button><button class="btn primary" id="puGo">Save product update</button></div>`);
    m.el.querySelector('#puCancel').onclick = m.close;
    m.el.querySelector('#puGo').onclick = async () => {
      const product_action = m.el.querySelector('#puAct').value.trim();
      if (!product_action) return toast('Describe the product action', 'high');
      try {
        await api(`/api/cases/${c.id}/status`, { body: { status: 'product_update', engineer: me(), product_action, root_cause: m.el.querySelector('#puRoot').value.trim() } });
        m.close(); toast('Product update recorded and fleet notified.', 'good'); loadCases();
      } catch (err) { toast(esc(err.message), 'high'); }
    };
  }

  async function setStatus(status) {
    try { await api(`/api/cases/${state.selected}/status`, { body: { status, engineer: me() } }); loadCases(); } catch (err) { toast(esc(err.message), 'high'); }
  }

  let t = null;
  connectStream({
    case: ({ case: c, reportId }) => {
      clearTimeout(t); t = setTimeout(loadCases, 300);
      if (reportId) toast(`${icon('alert')} New field report on <b>case #${c.id}</b> — ${esc(c.title)} (${c.occurrences} total)`, c.priority === 'P1' ? 'high' : '');
    },
    fix: () => { clearTimeout(t); t = setTimeout(loadCases, 300); },
  }, $('live'));

  boot().catch((err) => toast(esc(err.message), 'high'));
})();
