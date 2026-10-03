// Site Command Center: live alerts, crew action items, fleet status, memory feed and agent.
(function () {
  const { api, esc, ago, sevPill, statusPill, healthBar, md, toast, connectStream, store, topbar, modal, icon, ROLE, SOURCE_ICON } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('/site');

  const state = { site: new URLSearchParams(location.search).get('site') || store.get('site', 'S1'), data: null, sites: [], people: [], tele: {} };
  const ROLE_ORDER = ['operator', 'technician', 'site_manager', 'safety_officer', 'fleet_manager'];
  const METRIC = { coolant_temp: 'Coolant', hyd_oil_temp: 'Hyd oil', trans_oil_temp: 'Trans oil', engine_load: 'Load', payload: 'Payload', speed: 'Speed' };

  async function boot() {
    [state.sites, state.people] = await Promise.all([api('/api/sites'), api('/api/people')]);
    $('siteSel').innerHTML = `<option value="">All job sites</option>${state.sites.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.location)}</option>`).join('')}`;
    $('siteSel').value = state.site;
    $('siteSel').onchange = () => { state.site = $('siteSel').value; store.set('site', state.site); load(); };
    api('/api/health').then((h) => { $('aiMode').textContent = h.ai === 'claude' ? 'Claude agent' : 'Offline agent'; });
    await load();
  }

  async function load() {
    state.data = await api(`/api/dashboard${state.site ? `?site=${state.site}` : ''}`);
    for (const t of state.data.latestTelemetry) (state.tele[t.asset_id] ||= {})[t.metric] = t;
    $('teleToggle').checked = state.data.telemetry;
    renderAll();
  }
  const inScope = (siteId) => !state.site || siteId === state.site;

  function renderAll() { renderKpis(); renderAlerts(); renderActions(); renderFleet(); renderFeed(); }

  function renderKpis() {
    const k = state.data.kpis;
    $('kpis').innerHTML = [
      ['Machines', k.assets, ''], ['Down', k.down, k.down ? 'bad' : 'good'], ['Need attention', k.attention, k.attention ? 'alert' : 'good'],
      ['Open alerts', k.openAlerts, k.openAlerts ? 'alert' : 'good'], ['Open actions', k.openActions, ''], ['Reports today', k.reportsToday, ''],
      ['Avg health', k.avgHealth, k.avgHealth < 70 ? 'alert' : 'good'], ['Graph memory', `${state.data.graph.nodes}<span class="muted" style="font-size:16px"> nodes</span>`, ''],
    ].map(([key, v, cls]) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="k">${key}</div></div>`).join('');
  }

  function alertCard(a, flash) {
    const cls = a.kind === 'bulletin' || a.kind === 'agent' ? a.kind : a.severity;
    const kindLabel = { mechanical: 'Mechanical', safety: 'Safety', operational: 'Operations', bulletin: 'CAT bulletin', agent: 'Agent notice' }[a.kind] || a.kind;
    return `<div class="alert-card ${esc(cls)} ${a.status === 'resolved' ? 'resolved' : ''} ${flash ? 'flash' : ''}" data-id="${a.id}">
      <div class="row spread" style="align-items:flex-start"><div class="row wrap" style="gap:6px">${sevPill(a.severity)}<span class="pill sev-info">${esc(kindLabel)}</span>${a.status !== 'open' ? `<span class="pill" style="color:var(--muted);border-color:var(--line)">${esc(a.status)}</span>` : ''}</div><span class="faint" style="font-size:12px;white-space:nowrap">${ago(a.created_at)}</span></div>
      <div class="t" style="margin-top:6px">${a.asset_id ? `<a href="/asset?id=${encodeURIComponent(a.asset_id)}">${esc(a.title)}</a>` : esc(a.title)}</div>
      ${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}
      ${a.resolution ? `<div class="b" style="color:#6ee2ad">${icon('check')} Resolved: ${esc(a.resolution)}</div>` : ''}
      ${!state.site && a.site_name ? `<div class="faint" style="font-size:12px;margin-top:4px">${icon('pin')} ${esc(a.site_name)}</div>` : ''}
      <div class="aud">${(a.audience || []).map((r) => `<span>${esc(ROLE[r] || r)}</span>`).join('')}</div>
      ${a.status !== 'resolved' ? `<div class="alert-actions">${a.status === 'open' ? `<button class="btn sm" data-ack="${a.id}">${icon('check')} Acknowledge</button>` : ''}<button class="btn sm ${a.kind === 'mechanical' ? 'primary' : ''}" data-resolve="${a.id}">${icon('wrench')} ${a.kind === 'mechanical' ? 'Resolve & log repair' : 'Resolve'}</button></div>` : ''}
    </div>`;
  }
  function renderAlerts(flashId) {
    const alerts = state.data.alerts;
    const open = alerts.filter((a) => a.status !== 'resolved');
    $('alertCount').textContent = `${open.length} open`;
    $('alerts').innerHTML = alerts.length ? alerts.map((a) => alertCard(a, a.id === flashId)).join('') : '<div class="empty">No alerts. All quiet on site.</div>';
    $('alerts').querySelectorAll('[data-ack]').forEach((b) => b.onclick = () => ack(Number(b.dataset.ack)));
    $('alerts').querySelectorAll('[data-resolve]').forEach((b) => b.onclick = () => resolveDialog(Number(b.dataset.resolve)));
  }

  async function ack(id) {
    const mgr = state.people.find((p) => p.role === 'site_manager' && p.site_id === (state.site || 'S1'));
    try { await api(`/api/alerts/${id}/ack`, { body: { personId: mgr?.id } }); } catch (err) { toast(esc(err.message), 'high'); }
  }

  async function resolveDialog(id) {
    const a = state.data.alerts.find((x) => x.id === id);
    if (!a) return;
    let fixes = [];
    if (a.asset_id && a.kind === 'mechanical') {
      try { fixes = (await api(`/api/assets/${encodeURIComponent(a.asset_id)}`)).fixes; } catch { fixes = []; }
    }
    const techs = state.people.filter((p) => ['technician', 'site_manager', 'operator'].includes(p.role) && (!p.site_id || p.site_id === a.site_id));
    const m = modal(`<h2>${a.kind === 'mechanical' ? 'Resolve & teach Cat Track' : 'Resolve alert'}</h2>
      <p class="muted" style="margin-top:-6px">${esc(a.title)}</p>
      <label class="lbl" style="margin-top:12px">Resolved by</label>
      <select class="select" id="rsBy">${techs.map((p) => `<option value="${p.id}" ${p.role === 'technician' ? 'selected' : ''}>${esc(p.name)} — ${ROLE[p.role]}</option>`).join('')}</select>
      ${fixes.length ? `<label class="lbl" style="margin-top:12px">Did a known fix work?</label>
        <select class="select" id="rsFix"><option value="">— No / something else —</option>${fixes.map((f) => `<option value="${f.id}">${esc(f.title)} (${f.confidence}%)</option>`).join('')}</select>` : ''}
      ${a.asset_id ? `<label class="lbl" style="margin-top:12px">What fixed it? <span class="faint" style="text-transform:none;letter-spacing:0">(becomes machine memory${a.kind === 'mechanical' ? ' + a learned fix' : ''})</span></label>
        <textarea class="textarea" id="rsText" placeholder="e.g. Replaced boom hose, re-routed clear of bracket, added P-clamp"></textarea>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="rsCancel">Cancel</button><button class="btn primary" id="rsGo">${icon('check')} Resolve</button></div>`);
    m.el.querySelector('#rsCancel').onclick = m.close;
    m.el.querySelector('#rsGo').onclick = async () => {
      const fixId = m.el.querySelector('#rsFix')?.value || null;
      const text = m.el.querySelector('#rsText')?.value.trim() || '';
      const resolution = text || (fixId ? fixes.find((f) => String(f.id) === fixId)?.title : '');
      m.el.querySelector('#rsGo').disabled = true;
      try {
        const out = await api(`/api/alerts/${id}/resolve`, { body: { personId: m.el.querySelector('#rsBy').value, resolution, fixId, worked: Boolean(fixId) } });
        m.close();
        toast(out.learnedFixId ? `${icon('brain')} Resolved — Cat Track learned a new fix from this repair.` : fixId ? `${icon('brain')} Resolved — fix success rate updated.` : 'Alert resolved.', 'good');
        load();
      } catch (err) { toast(esc(err.message), 'high'); m.el.querySelector('#rsGo').disabled = false; }
    };
  }

  function renderActions() {
    const items = state.data.actions;
    const open = items.filter((i) => i.status === 'open');
    $('actCount').textContent = `${open.length} open`;
    if (!items.length) { $('actions').innerHTML = '<div class="empty">No action items.</div>'; return; }
    const groups = {};
    for (const it of items) (groups[it.assignee_role] ||= []).push(it);
    $('actions').innerHTML = ROLE_ORDER.filter((r) => groups[r]).map((r) => `<div class="act-group"><h4>${ROLE[r]}</h4>${groups[r].map((it) => `
      <div class="act-item ${it.status === 'done' ? 'done' : ''}" data-act="${it.id}"><span class="box">${it.status === 'done' ? icon('check') : ''}</span>
      <div class="grow"><div class="txt">${esc(it.text)}</div><div class="meta">${it.asset_id ? esc(it.asset_id) + ' · ' : ''}${ago(it.created_at)}${!state.site && it.site_name ? ' · ' + esc(it.site_name) : ''}</div></div></div>`).join('')}</div>`).join('');
    $('actions').querySelectorAll('[data-act]').forEach((el) => el.onclick = async () => {
      try { await api(`/api/actions/${el.dataset.act}/toggle`, { body: {} }); } catch (err) { toast(esc(err.message), 'high'); }
    });
  }

  function teleLine(assetId) {
    const t = state.tele[assetId];
    if (!t || !state.data.telemetry) return '';
    return Object.values(t).slice(0, 2).map((r) => `${METRIC[r.metric] || r.metric} ${Math.round(r.value)}${r.unit}`).join(' · ');
  }
  function renderFleet() {
    const assets = state.data.assets;
    $('fleetCount').textContent = `${assets.length} machines`;
    $('fleet').innerHTML = assets.map((a) => `<a class="tile ${a.status}" href="/asset?id=${encodeURIComponent(a.id)}">
      <div class="row spread"><span class="id">${esc(a.id)}</span>${statusPill(a.status)}</div>
      <div class="m">${esc(a.model)} ${esc(a.family.split(' ').slice(-1)[0])}</div>
      <div style="margin:7px 0 4px">${healthBar(a.health)}</div>
      <div class="row spread" style="font-size:12px"><span class="muted">Health ${a.health}</span><span style="color:${a.open_alerts ? 'var(--high)' : 'var(--faint)'}">${a.open_alerts} alert${a.open_alerts === 1 ? '' : 's'}</span></div>
      <div class="tele" data-tele="${esc(a.id)}">${teleLine(a.id)}</div></a>`).join('');
  }

  function feedItem(r, flash) {
    return `<div class="feed-item ${flash ? 'flash' : ''}"><div class="src ${esc(r.source)}">${icon(SOURCE_ICON[r.source] || 'chat')}</div>
      <div class="grow"><div class="row spread"><b>${esc(r.asset_id)} · ${esc(r.summary)}</b><span class="faint" style="font-size:12px;white-space:nowrap">${ago(r.created_at)}</span></div>
      <div class="q">"${esc(r.raw_text.length > 150 ? r.raw_text.slice(0, 149) + '…' : r.raw_text)}"</div>
      <div class="row wrap" style="gap:6px;margin-top:4px">${sevPill(r.severity)}<span class="faint" style="font-size:12px">${esc(r.person_name || (r.source === 'telemetry' ? 'Telemetry' : 'Unknown'))}${r.person_role ? ' · ' + esc(ROLE[r.person_role]) : ''}${r.ai_mode === 'claude' ? ' · Claude' : ''}</span></div></div></div>`;
  }
  function renderFeed(flashId) {
    $('graphStat').textContent = `${state.data.graph.nodes} nodes · ${state.data.graph.edges} links`;
    $('feed').innerHTML = state.data.reports.map((r) => feedItem(r, r.id === flashId)).join('') || '<div class="empty">No reports yet.</div>';
  }

  // ---------- agent ----------
  const SUGGEST = ['Which machines need attention?', 'Any overheating on the 777s?', 'What do we know about hydraulic hose leaks?', 'Show engineering cases'];
  $('askChips').innerHTML = SUGGEST.map((s) => `<button class="chip" type="button">${esc(s)}</button>`).join('');
  $('askChips').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('askInput').value = c.textContent; $('askForm').requestSubmit(); });
  $('askForm').onsubmit = async (e) => {
    e.preventDefault();
    const qText = $('askInput').value.trim();
    if (!qText) return;
    $('askInput').value = '';
    const log = $('askLog');
    log.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(qText)}</div><div class="bubble bot" id="pending"><span class="muted">Searching machine memory…</span></div>`);
    log.scrollTop = log.scrollHeight;
    const mgr = state.people.find((p) => p.role === 'site_manager' && p.site_id === (state.site || 'S1'));
    try {
      const out = await api('/api/ask', { body: { question: qText, role: 'site_manager', personId: mgr?.id } });
      document.getElementById('pending').outerHTML = `<div class="bubble bot md">${md(out.answer)}${out.trace?.length ? `<div class="trace">${out.trace.map((t) => `<span>${esc(t.tool)}</span>`).join('')}</div>` : ''}</div>`;
    } catch (err) {
      document.getElementById('pending').outerHTML = `<div class="bubble bot" style="color:#ff9a9b">${esc(err.message)}</div>`;
    }
    log.scrollTop = log.scrollHeight;
  };

  // ---------- telemetry ----------
  $('teleToggle').onchange = async () => {
    try { const r = await api('/api/telemetry', { body: { on: $('teleToggle').checked } }); toast(r.on ? `${icon('radio')} Telemetry stream started — anomalies flow into memory.` : 'Telemetry stream stopped.'); }
    catch (err) { toast(esc(err.message), 'high'); }
  };

  // ---------- live ----------
  let reloadTimer = null;
  const softReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 400); };
  connectStream({
    report: ({ report }) => {
      if (!inScope(report.site_id)) return;
      state.data.reports = [report, ...state.data.reports.filter((r) => r.id !== report.id)].slice(0, 25);
      renderFeed(report.id);
    },
    alert: ({ alert }) => {
      if (!inScope(alert.site_id)) return;
      state.data.alerts = [alert, ...state.data.alerts.filter((a) => a.id !== alert.id)];
      renderAlerts(alert.id);
      toast(`${icon('alert')} <b>${esc(alert.title)}</b>`, alert.severity);
      softReload();
    },
    'alert-updated': ({ alert }) => { if (inScope(alert.site_id)) softReload(); },
    action: ({ item }) => { if (inScope(item.site_id)) softReload(); },
    asset: (a) => { if (inScope(a.site_id)) softReload(); },
    graph: () => { api('/api/graph/stats').then((g) => { state.data.graph = g; $('graphStat').textContent = `${g.nodes} nodes · ${g.edges} links`; renderKpis(); }).catch(() => {}); },
    telemetry: ({ readings }) => {
      for (const r of readings) (state.tele[r.asset_id] ||= {})[r.metric] = r;
      document.querySelectorAll('[data-tele]').forEach((el) => { el.textContent = teleLine(el.dataset.tele); });
    },
    'telemetry-status': ({ on }) => { $('teleToggle').checked = on; state.data.telemetry = on; renderFleet(); },
  }, $('live'));

  boot().catch((err) => toast(esc(err.message), 'high'));
})();
