// CAT Engineering: fleet-wide mechanical cases with field evidence, root-cause analysis,
// and the two ways back out: a quick fix to the field, or a design change to the product.
(function () {
  const { api, esc, ago, dateShort, sevPill, md, toast, connectStream, store, topbar, modal, icon, emptyState, skeleton, ROLE, SOURCE_LABEL, metaLine, kv, keyRow, toneOf } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('/engineering');

  const STATUSES = ['new', 'investigating', 'quick_fix_issued', 'product_update', 'closed'];
  const STATUS_LABEL = { new: 'New', investigating: 'Investigating', quick_fix_issued: 'Quick fix sent', product_update: 'Design change', closed: 'Closed' };
  const PRIO_SEV = { P1: 'critical', P2: 'high', P3: 'medium' };
  const prio = (p) => `<span class="sev sev-${PRIO_SEV[p] || 'medium'}"><i></i>${esc(p)}</span>`;
  const state = { cases: [], selected: Number(new URLSearchParams(location.search).get('case')) || null, detail: null, engineers: [], filter: 'open' };

  $('cases').innerHTML = `<div style="padding:12px">${skeleton(4, 'block')}</div>`;
  $('detail').innerHTML = `<span class="sk line" style="width:30%"></span><span class="sk title" style="height:34px;margin-top:14px"></span>${skeleton(1, 'block')}${skeleton(5)}`;

  async function boot() {
    const people = await api('/api/people');
    state.engineers = people.filter((p) => p.role === 'cat_engineer');
    $('engineerSel').innerHTML = state.engineers.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}, ${esc(p.specialty.toLowerCase())}</option>`).join('');
    $('engineerSel').value = store.get('engineer', state.engineers[0]?.name);
    $('engineerSel').onchange = () => store.set('engineer', $('engineerSel').value);
    $('statusFilter').onchange = () => { state.filter = $('statusFilter').value; renderCases(); };
    await loadCases();
  }
  const me = () => $('engineerSel').value;

  async function loadCases() {
    try { state.cases = await api('/api/cases'); }
    catch (err) { $('cases').innerHTML = `<div style="padding:0 18px">${emptyState({ icon: 'wifiOff', error: true, title: 'Couldn’t load cases', body: esc(err.message) })}</div>`; return; }
    if (!state.selected && state.cases[0]) state.selected = state.cases[0].id;
    renderStats(); renderCases();
    if (state.selected) await loadDetail(state.selected);
    else $('detail').innerHTML = emptyState({ icon: 'file', title: 'No cases yet', body: 'A case opens the first time a machine reports a mechanical failure. Reports on the same model and part are added to it, so patterns show up on their own.' });
  }

  async function renderStats() {
    const open = state.cases.filter((c) => c.status !== 'closed');
    const p1 = open.filter((c) => c.priority === 'P1');
    let fixLine = '';
    try {
      const fixes = await api('/api/fixes');
      const tried = fixes.reduce((n, f) => n + f.success + f.fail, 0);
      const worked = fixes.reduce((n, f) => n + f.success, 0);
      fixLine = `<div class="stat"><div class="v">${fixes.filter((f) => f.source === 'field').length}</div><div class="k">fixes learned from technicians</div></div>
        <div class="stat"><div class="v">${tried ? Math.round((worked / tried) * 100) + '%' : '—'}</div><div class="k">of tried fixes worked (${worked} of ${tried})</div></div>`;
    } catch { /* optional */ }
    $('stats').innerHTML = `
      <div class="hero"><div class="v">${p1.length}</div><div class="k"><span class="mk ${p1.length ? 'critical' : 'good'}"></span>${p1.length === 1 ? 'pattern showing up on more than one machine' : 'patterns showing up on more than one machine'}</div></div>
      <div class="stat"><div class="v">${open.length}</div><div class="k">open cases</div></div>
      <div class="stat"><div class="v">${state.cases.reduce((n, c) => n + c.occurrences, 0)}</div><div class="k">field reports behind them</div></div>${fixLine}`;
  }

  function renderCases() {
    const f = state.filter;
    const list = state.cases.filter((c) => (f === 'all' ? true : f === 'open' ? c.status !== 'closed' : c.status === f));
    $('caseCount').textContent = `${list.length}`;
    $('cases').innerHTML = list.length ? list.map((c) => `<button class="case-item ${c.id === state.selected ? 'sel' : ''}" data-id="${c.id}">
      <div class="row spread">${prio(c.priority)}<span class="tag">${esc(STATUS_LABEL[c.status])}</span></div>
      <div class="tt">${esc(c.title)}</div>
      <div class="mm">#${c.id} · ${c.occurrences} report${c.occurrences === 1 ? '' : 's'} · ${c.machines} machine${c.machines === 1 ? '' : 's'} · ${c.sites} site${c.sites === 1 ? '' : 's'} · ${ago(c.last_seen)}</div></button>`).join('')
      : `<div style="padding:0 18px">${emptyState({ icon: 'search', title: `No cases marked “${esc(STATUS_LABEL[f] || f)}”`, body: 'Try “All cases” to see everything, including closed ones.' })}</div>`;
    $('cases').querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { state.selected = Number(b.dataset.id); renderCases(); loadDetail(state.selected); const u = new URL(location.href); u.searchParams.set('case', state.selected); history.replaceState(null, '', u); });
  }

  async function loadDetail(id) {
    try { state.detail = await api(`/api/cases/${id}`); renderDetail(); }
    catch (err) { $('detail').innerHTML = emptyState({ icon: 'file', error: true, title: `Case #${id} couldn’t be opened`, body: esc(err.message) }); }
  }

  const bars = (rows, total, none) => rows.length
    ? rows.slice(0, 6).map((r) => `<div class="bar-row" title="${esc(r.name)}: ${r.n} of ${total} reports"><span class="lab">${esc(r.name)}</span><span class="bar"><i style="width:${Math.round((r.n / total) * 100)}%"></i></span><span class="val">${r.n} of ${total}</span></div>`).join('')
    : `<div class="muted" style="font-size:13px;margin-top:6px">${none}</div>`;

  function renderDetail() {
    const d = state.detail; const c = d.case;
    const idx = STATUSES.indexOf(c.status);
    const total = d.reports.length;
    const sym = d.symptoms.filter((s) => s.name !== 'Warning / fault code');
    $('detail').innerHTML = `
      <div class="detail-head">
        <div class="row spread wrap"><span class="row" style="gap:8px">${prio(c.priority)}<span class="mono muted" style="font-size:12px">case #${c.id}</span>${c.engineer ? `<span class="muted" style="font-size:13px">· ${esc(c.engineer)}</span>` : '<span class="muted" style="font-size:13px">· unassigned</span>'}</span>
          <span class="mono faint" style="font-size:12px">first ${dateShort(c.first_seen)} · latest ${ago(c.last_seen)}</span></div>
        <h2>${esc(c.title)}</h2>
        <div class="status-track">${STATUSES.map((s, i) => `<span class="${i === idx ? 'on' : i < idx ? 'past' : ''}">${STATUS_LABEL[s]}</span>`).join('')}</div>
      </div>
      <div class="evidence">
        <div><div class="sec-title">Machines affected</div>${d.machines.map((m) => `<div class="mrow"><a class="id" href="/asset?id=${encodeURIComponent(m.id)}">${esc(m.id)}</a><span class="muted">${esc(m.site)}</span><span class="mono muted" style="font-size:12px">${m.hours.toLocaleString()} h</span></div>`).join('')}</div>
        <div><div class="sec-title">Conditions when reported</div>${bars(d.conditions, total, 'Nobody mentioned heat, dust, grade or load.')}</div>
        <div><div class="sec-title">Codes and symptoms</div>${bars([...d.codes, ...sym], total, 'No fault codes reported.')}</div>
      </div>

      <div class="analysis">
        <div class="row spread wrap"><span><b>Root cause, from the evidence</b><span class="muted" style="font-size:13px"> · ${c.ai_analysis ? (c.ai_analysis_by && c.ai_analysis_by !== 'rules' ? 'written by ' + esc(c.ai_analysis_by) : 'counted by the rule engine') : 'not analysed yet'}</span></span><button class="btn sm" id="analyzeBtn">${icon('search')} ${c.ai_analysis ? 'Read it again' : 'Read the evidence'}</button></div>
        <details class="dd" id="aiBox" style="margin-top:10px" ${analysisPendingFor === c.id || analysisOpen === c.id ? 'open' : ''}><summary><span>${c.ai_analysis ? 'Show the write-up' : 'What this does'}</span>${icon('chevron', 'chev')}</summary>
        <div class="md dd-body" id="aiText">${analysisPendingFor === c.id ? `<div class="muted" style="font-size:13px;margin-bottom:10px" id="aiPending">${esc(analysisModel)} is reading all ${total} reports; its write-up will replace this when it arrives.</div>` : ''}${c.ai_analysis ? md(c.ai_analysis) : `<span class="muted">Reads all ${total} reports, their conditions and fault codes, and every repair on these machines, then proposes a cause, a field fix and a design change.</span>`}</div></details>
      </div>

      <div class="two">
        <div>
          <div class="sec-title">From the field · ${total} report${total === 1 ? '' : 's'}</div>
          ${d.reports.map((r) => keyRow({
            tone: toneOf(r),
            title: `<a class="id" href="/asset?id=${encodeURIComponent(r.asset_id)}">${esc(r.asset_id)}</a> <span style="font-weight:500">${esc(r.site_name || '')}</span>`,
            meta: metaLine([dateShort(r.created_at), `${Math.round(r.smu_hours).toLocaleString()} h`, esc((r.extraction.conditions || []).join(', ').toLowerCase()), esc((r.extraction.fault_codes || []).join(', '))]),
            right: sevPill(r.severity),
            body: kv([
              ['Said', `<q>${esc(r.raw_text)}</q>`],
              ['Reported by', esc(`${r.person_name || SOURCE_LABEL[r.source]}${r.person_role ? ', ' + ROLE[r.person_role].toLowerCase() : ''}`)],
              ['Photo', r.photo_path ? `<img src="${esc(r.photo_path)}" alt="Photo from the field" style="max-width:160px;border-radius:3px;border:1px solid var(--line)">` : ''],
            ]),
          })).join('')}
        </div>
        <div>
          <div class="sec-title">Fixes tried, ranked by field results</div>
          ${d.fixes.length ? d.fixes.map((f) => `<div class="fix-row"><div class="row spread" style="align-items:flex-start;gap:12px"><b style="font-weight:600">${esc(f.title)}</b><span class="tag ${f.source === 'engineering' ? 'cat' : ''}">${f.source === 'engineering' ? 'CAT' : 'field'}</span></div>
            <div class="conf" title="${f.confidence}% estimated success"><i style="width:${f.confidence}%"></i></div><div class="muted" style="font-size:12px;margin-top:5px">Worked ${f.success} of ${f.success + f.fail} times · ${esc(f.author || 'unknown')}</div></div>`).join('')
            : emptyState({ icon: 'wrench', title: 'No fix on record yet', body: 'The first technician to log a repair for this will create one, and every later result will re-rank it.' })}
          ${d.repairs.length ? `<div class="sec-title" style="margin-top:22px">Recent repairs on these machines</div>${d.repairs.slice(0, 4).map((r) => keyRow({ tone: 'repair', title: esc(r.asset_id), meta: dateShort(r.created_at), body: `<div style="font-size:14px;color:var(--ink-2)">${esc(r.raw_text)}</div>` })).join('')}` : ''}
          ${c.quick_fix ? `<div class="card" style="margin-top:18px;box-shadow:inset 4px 0 0 var(--cat)"><div class="sec-title" style="margin:0 0 4px">In the field now</div>${esc(c.quick_fix)}</div>` : ''}
          ${c.product_action ? `<div class="card" style="margin-top:10px"><div class="sec-title" style="margin:0 0 4px">Design change planned</div>${esc(c.product_action)}${c.root_cause ? `<div class="muted" style="font-size:13px;margin-top:6px">Cause: ${esc(c.root_cause)}</div>` : ''}</div>` : ''}
          <div class="sec-title" style="margin-top:22px">Next step</div>
          <div class="actions-bar">
            <button class="btn primary" id="qfBtn">${icon('send')} Send a quick fix to the field</button>
            <button class="btn" id="puBtn">${icon('file')} Log a design change</button>
            ${c.status === 'new' ? `<button class="btn" data-st="investigating">Take this case</button>` : ''}
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
    const btn = $('analyzeBtn'); btn.disabled = true; btn.textContent = 'Reading…';
    $('aiBox').open = true;
    $('aiText').innerHTML = `${skeleton(4)}`;
    try {
      const out = await api(`/api/cases/${state.selected}/analyze`, { body: {} });
      analysisOpen = state.selected;
      $('aiBox').open = true;
      $('aiText').innerHTML = md(out.analysis) + (out.pending ? `<div class="muted" style="font-size:13px;margin-top:10px;border-top:1px dashed var(--line-strong);padding-top:8px" id="aiPending">That’s the rule engine’s count. ${esc(out.model)} is reading all ${state.detail.reports.length} reports for a root cause; its write-up will replace this, usually within a minute.</div>` : '');
      analysisPendingFor = out.pending ? state.selected : null;
      analysisModel = out.model;
      btn.innerHTML = `${icon('search')} Read it again`;
    } catch (err) { $('aiText').innerHTML = emptyState({ icon: 'wifiOff', error: true, title: 'Analysis failed', body: esc(err.message) }); btn.innerHTML = `${icon('search')} Try again`; }
    btn.disabled = false;
  }

  function quickFixDialog() {
    const c = state.detail.case; const best = state.detail.fixes[0];
    const m = modal(`<h2>Send a quick fix to the field</h2>
      <p class="muted">Every job site running a ${esc(c.model)} gets an alert, and each of those machines gets a task for its technician. Their results feed back into this fix’s record.</p>
      <label class="lbl" style="margin-top:14px">The fix, in one line</label><input class="input" id="qfTitle" value="${esc(best ? best.title : '')}" placeholder="What the technician should do">
      <label class="lbl" style="margin-top:14px">Steps</label><textarea class="textarea" id="qfSteps" placeholder="Step by step, as you'd say it to a technician">${esc(best?.steps || '')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="qfCancel">Cancel</button><button class="btn primary" id="qfGo">${icon('send')} Send to every ${esc(c.model)} site</button></div>`);
    m.el.querySelector('#qfCancel').onclick = m.close;
    m.el.querySelector('#qfGo').onclick = async () => {
      const title = m.el.querySelector('#qfTitle').value.trim();
      if (!title) { toast('Write the fix in one line first.', 'high'); return; }
      try {
        const out = await api(`/api/cases/${c.id}/quick-fix`, { body: { title, steps: m.el.querySelector('#qfSteps').value.trim(), engineer: me() } });
        m.close(); toast(`Sent to ${out.sitesNotified} job site${out.sitesNotified === 1 ? '' : 's'}. Crews will see it on their phones now.`, 'good'); loadCases();
      } catch (err) { toast(esc(err.message), 'high'); }
    };
  }

  function productDialog() {
    const c = state.detail.case;
    const m = modal(`<h2>Log a design change</h2>
      <p class="muted">For the permanent fix. Fleet managers at affected sites are told it’s coming.</p>
      <label class="lbl" style="margin-top:14px">Cause</label><input class="input" id="puRoot" value="${esc(c.root_cause || '')}" placeholder="Hose rubs on the boom-foot bracket as the boom articulates">
      <label class="lbl" style="margin-top:14px">Change</label><textarea class="textarea" id="puAct" placeholder="Revise bracket geometry and hose routing on new builds; retrofit kit for machines in the field">${esc(c.product_action || '')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="puCancel">Cancel</button><button class="btn primary" id="puGo">Save</button></div>`);
    m.el.querySelector('#puCancel').onclick = m.close;
    m.el.querySelector('#puGo').onclick = async () => {
      const product_action = m.el.querySelector('#puAct').value.trim();
      if (!product_action) { toast('Describe the change first.', 'high'); return; }
      try {
        await api(`/api/cases/${c.id}/status`, { body: { status: 'product_update', engineer: me(), product_action, root_cause: m.el.querySelector('#puRoot').value.trim() } });
        m.close(); toast('Saved. Fleet managers on affected sites have been told.', 'good'); loadCases();
      } catch (err) { toast(esc(err.message), 'high'); }
    };
  }

  let analysisPendingFor = null; let analysisModel = ''; let analysisOpen = null;

  async function setStatus(status) {
    try { await api(`/api/cases/${state.selected}/status`, { body: { status, engineer: me() } }); loadCases(); } catch (err) { toast(esc(err.message), 'high'); }
  }

  let t = null;
  connectStream({
    case: ({ case: c, reportId, analysis, error }) => {
      if (analysis && c.id === analysisPendingFor) {
        analysisPendingFor = null;
        toast(analysis === 'llm' ? `${esc(c.ai_analysis_by)} finished its root-cause write-up for case #${c.id}.` : `The AI write-up for case #${c.id} didn’t come back (${esc(error || 'no response')}). The rule engine’s count stays.`, analysis === 'llm' ? 'good' : 'high');
      }
      if (analysis === 'failed' && c.id === state.selected) { const p = document.getElementById('aiPending'); if (p) p.textContent = `The AI write-up didn’t come back (${error || 'no response'}). Showing the rule engine’s count.`; return; }
      clearTimeout(t); t = setTimeout(loadCases, 300);
      if (reportId) toast(`New report on <b>case #${c.id}</b>, ${esc(c.title)}. That’s ${c.occurrences} now.`, c.priority === 'P1' ? 'high' : '');
    },
    fix: () => { clearTimeout(t); t = setTimeout(loadCases, 300); },
    'case-removed': ({ id }) => {
      if (state.selected === id) { state.selected = null; toast(`Case #${id} was removed: the only report behind it was deleted.`); }
      clearTimeout(t); t = setTimeout(loadCases, 300);
    },
  }, $('live'));

  boot().catch((err) => { $('detail').innerHTML = emptyState({ icon: 'wifiOff', error: true, title: 'Couldn’t load the engineering view', body: esc(err.message) }); });
})();
