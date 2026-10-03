// Job-site view: open alerts, crew tasks, machine status, the field log, and the record agent.
(function () {
  const { api, esc, ago, sevPill, statusPill, healthBar, md, toast, connectStream, store, topbar, modal, icon, machineIcon, emptyState, skeleton, ROLE, SOURCE_ICON, SOURCE_LABEL } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('/site');

  const state = { site: new URLSearchParams(location.search).get('site') ?? store.get('site', 'S1'), data: null, sites: [], people: [], tele: {} };
  const ROLE_ORDER = ['operator', 'technician', 'site_manager', 'safety_officer', 'fleet_manager'];
  const METRIC = { coolant_temp: 'coolant', hyd_oil_temp: 'hyd oil', trans_oil_temp: 'trans oil', engine_load: 'load', payload: 'payload', speed: 'speed' };
  const KIND = { mechanical: 'Mechanical', safety: 'Safety', operational: 'Site ops', bulletin: 'CAT bulletin', agent: 'Notice' };

  // Loading state before the first response
  $('alerts').innerHTML = skeleton(3, 'block');
  $('actions').innerHTML = skeleton(5);
  $('fleet').innerHTML = skeleton(4, 'block');
  $('feed').innerHTML = skeleton(4);

  async function boot() {
    [state.sites, state.people] = await Promise.all([api('/api/sites'), api('/api/people')]);
    $('siteSel').innerHTML = `<option value="">All three job sites</option>${state.sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}`;
    $('siteSel').value = state.site;
    $('siteSel').onchange = () => { state.site = $('siteSel').value; store.set('site', state.site); const u = new URL(location.href); u.searchParams.set('site', state.site); history.replaceState(null, '', u); load(); };
    api('/api/health').then((h) => { $('aiMode').textContent = h.ai === 'claude' ? 'Claude' : 'offline'; }).catch(() => {});
    await load();
  }

  async function load() {
    try {
      state.data = await api(`/api/dashboard${state.site ? `?site=${state.site}` : ''}`);
    } catch (err) {
      $('alerts').innerHTML = emptyState({ icon: 'wifiOff', error: true, title: 'Couldn’t reach the server', body: `${esc(err.message)} The page will refresh itself when the connection comes back.` });
      return;
    }
    for (const t of state.data.latestTelemetry) (state.tele[t.asset_id] ||= {})[t.metric] = t;
    $('teleToggle').checked = state.data.telemetry;
    renderAll();
  }
  const inScope = (siteId) => !state.site || siteId === state.site;
  const mgr = () => state.people.find((p) => p.role === 'site_manager' && p.site_id === (state.site || 'S1'));

  function renderAll() { renderHead(); renderStats(); renderAlerts(); renderActions(); renderFleet(); renderFeed(); }

  function renderHead() {
    const site = state.sites.find((s) => s.id === state.site);
    $('siteLabel').textContent = site ? `Job site ${site.id}` : 'Every job site';
    $('siteTitle').textContent = site ? site.name : 'The whole fleet';
    const m = mgr();
    $('siteSub').textContent = site ? `${site.location} · ${site.climate}${m ? ` · site manager ${m.name}` : ''}` : state.sites.map((s) => s.name).join(' · ');
    document.title = `${site ? site.name : 'All sites'} · Cat Track`;
  }

  function renderStats() {
    const k = state.data.kpis;
    const need = k.down + k.attention;
    $('stats').innerHTML = `
      <div class="hero"><div class="v">${need}</div><div class="k"><span class="mk ${k.down ? 'critical' : need ? 'high' : 'good'}"></span>${need === 0 ? 'machines need attention — all running' : need === 1 ? 'machine needs attention' : 'machines need attention'}</div></div>
      <div class="stat"><div class="v">${k.down}</div><div class="k">${k.down ? '<span class="mk critical"></span>' : ''}down</div></div>
      <div class="stat"><div class="v">${k.openAlerts}</div><div class="k">open alerts</div></div>
      <div class="stat"><div class="v">${k.openActions}</div><div class="k">open tasks</div></div>
      <div class="stat"><div class="v">${k.reportsToday}</div><div class="k">reports today</div></div>
      <div class="stat"><div class="v">${k.avgHealth}</div><div class="k">average health of ${k.assets}</div></div>`;
  }

  function alertCard(a, flash) {
    const cls = a.kind === 'bulletin' || a.kind === 'agent' ? a.kind : a.severity;
    return `<div class="alert-card ${esc(cls)} ${a.status === 'resolved' ? 'resolved' : ''} ${flash ? 'flash' : ''}" data-id="${a.id}">
      <div class="row spread" style="align-items:flex-start"><div class="row wrap" style="gap:6px">${a.kind === 'bulletin' ? '<span class="tag cat">CAT bulletin</span>' : sevPill(a.severity)}${a.kind !== 'bulletin' ? `<span class="tag">${esc(KIND[a.kind] || a.kind)}</span>` : ''}${a.status === 'ack' ? '<span class="tag">seen</span>' : ''}${a.status === 'resolved' ? '<span class="tag">resolved</span>' : ''}</div><span class="faint mono" style="font-size:11px;white-space:nowrap">${ago(a.created_at)}</span></div>
      <div class="t" style="margin-top:7px">${a.asset_id ? `<a href="/asset?id=${encodeURIComponent(a.asset_id)}">${esc(a.title)}</a>` : esc(a.title)}</div>
      ${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}
      ${a.resolution ? `<div class="b" style="color:var(--ink)">${icon('check')} Fixed: ${esc(a.resolution)}</div>` : ''}
      <div class="aud">Sent to ${(a.audience || []).map((r) => esc((ROLE[r] || r).toLowerCase())).join(', ')}${!state.site && a.site_name ? ` · ${esc(a.site_name)}` : ''}</div>
      ${a.status !== 'resolved' ? `<div class="alert-actions">${a.status === 'open' ? `<button class="btn sm" data-ack="${a.id}">Mark as seen</button>` : ''}<button class="btn sm ${a.kind === 'mechanical' ? 'primary' : ''}" data-resolve="${a.id}">${a.kind === 'mechanical' ? 'Log the repair' : 'Close'}</button></div>` : ''}
    </div>`;
  }
  function renderAlerts(flashId) {
    const alerts = state.data.alerts;
    const open = alerts.filter((a) => a.status !== 'resolved');
    $('alertCount').textContent = open.length ? `${open.length} open` : '';
    if (!alerts.length) {
      $('alerts').innerHTML = emptyState({ icon: 'shield', title: 'Nothing open, nothing closed today', body: 'No alerts in the last 24 hours. The next voice note or sensor alarm from this site will land here and flash.' });
    } else {
      const lastResolved = alerts.find((a) => a.status === 'resolved');
      const quiet = !open.length && lastResolved ? emptyState({ icon: 'check', title: 'Everything here has been dealt with', body: `Last one closed ${ago(lastResolved.updated_at)}: ${esc(lastResolved.title)}.` }) : '';
      $('alerts').innerHTML = quiet + alerts.map((a) => alertCard(a, a.id === flashId)).join('');
    }
    $('alerts').querySelectorAll('[data-ack]').forEach((b) => b.onclick = () => ack(Number(b.dataset.ack)));
    $('alerts').querySelectorAll('[data-resolve]').forEach((b) => b.onclick = () => resolveDialog(Number(b.dataset.resolve)));
  }

  async function ack(id) {
    try { await api(`/api/alerts/${id}/ack`, { body: { personId: mgr()?.id } }); } catch (err) { toast(esc(err.message), 'high'); }
  }

  async function resolveDialog(id) {
    const a = state.data.alerts.find((x) => x.id === id);
    if (!a) return;
    let fixes = [];
    if (a.asset_id && a.kind === 'mechanical') {
      try { fixes = (await api(`/api/assets/${encodeURIComponent(a.asset_id)}`)).fixes; } catch { fixes = []; }
    }
    const crew = state.people.filter((p) => ['technician', 'site_manager', 'operator'].includes(p.role) && (!p.site_id || p.site_id === a.site_id));
    const m = modal(`<h2>${a.kind === 'mechanical' ? 'What fixed it?' : 'Close this alert'}</h2>
      <p class="muted">${esc(a.title)}</p>
      <label class="lbl" style="margin-top:14px">Closed by</label>
      <select class="select" id="rsBy">${crew.map((p) => `<option value="${p.id}" ${p.role === 'technician' ? 'selected' : ''}>${esc(p.name)} — ${ROLE[p.role]}</option>`).join('')}</select>
      ${fixes.length ? `<label class="lbl" style="margin-top:14px">Was it one of these?</label>
        <select class="select" id="rsFix"><option value="">No, something else</option>${fixes.map((f) => `<option value="${f.id}">${esc(f.title)} (worked ${f.success} of ${f.success + f.fail})</option>`).join('')}</select>` : ''}
      ${a.asset_id ? `<label class="lbl" style="margin-top:14px">In your words</label>
        <textarea class="textarea" id="rsText" placeholder="Replaced the boom hose, routed it clear of the bracket, added a P-clamp."></textarea>
        <div class="muted" style="font-size:13px;margin-top:6px">${a.kind === 'mechanical' ? 'This goes on the machine’s record. If it’s a new fix, the next crew with this problem will be offered it.' : 'This goes on the machine’s record.'}</div>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="rsCancel">Cancel</button><button class="btn primary" id="rsGo">${a.kind === 'mechanical' ? 'Save repair' : 'Close alert'}</button></div>`);
    m.el.querySelector('#rsCancel').onclick = m.close;
    m.el.querySelector('#rsGo').onclick = async () => {
      const fixId = m.el.querySelector('#rsFix')?.value || null;
      const text = m.el.querySelector('#rsText')?.value.trim() || '';
      const resolution = text || (fixId ? fixes.find((f) => String(f.id) === fixId)?.title : '');
      m.el.querySelector('#rsGo').disabled = true;
      try {
        const out = await api(`/api/alerts/${id}/resolve`, { body: { personId: m.el.querySelector('#rsBy').value, resolution, fixId, worked: Boolean(fixId) } });
        m.close();
        toast(out.learnedFixId ? 'Repair saved. It’s now a known fix for this problem.' : fixId ? 'Repair saved. That fix’s track record just went up by one.' : 'Alert closed.', 'good');
        load();
      } catch (err) { toast(esc(err.message), 'high'); m.el.querySelector('#rsGo').disabled = false; }
    };
  }

  function renderActions() {
    const items = state.data.actions;
    const open = items.filter((i) => i.status === 'open');
    $('actCount').textContent = open.length ? `${open.length} to do` : '';
    if (!items.length) { $('actions').innerHTML = emptyState({ icon: 'check', title: 'No tasks for this crew', body: 'Tasks are written automatically when someone reports a problem, and split by who should do them.' }); return; }
    const groups = {};
    for (const it of items) (groups[it.assignee_role] ||= []).push(it);
    $('actions').innerHTML = ROLE_ORDER.filter((r) => groups[r]).map((r) => `<div class="act-group"><h4>${ROLE[r]} · ${groups[r].filter((i) => i.status === 'open').length}</h4>${groups[r].map((it) => `
      <div class="act-item ${it.status === 'done' ? 'done' : ''}" data-act="${it.id}" role="checkbox" aria-checked="${it.status === 'done'}" tabindex="0"><span class="box">${it.status === 'done' ? icon('check') : ''}</span>
      <div><div class="txt">${esc(it.text)}</div><div class="meta">${it.asset_id ? esc(it.asset_id) + ' · ' : ''}${ago(it.created_at)}${!state.site && it.site_name ? ' · ' + esc(it.site_name) : ''}</div></div></div>`).join('')}</div>`).join('');
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
    $('fleetCount').textContent = `${assets.length} on site`;
    if (!assets.length) { $('fleet').innerHTML = emptyState({ icon: 'pin', title: 'No machines assigned here', body: 'Machines show up once they’re assigned to this job site.' }); return; }
    $('fleet').innerHTML = assets.map((a) => `<a class="unit ${a.status}" href="/asset?id=${encodeURIComponent(a.id)}">
      <span class="ic">${machineIcon(a.family)}</span>
      <span><span class="id">${esc(a.id)}</span> <span class="m">${esc(a.model)}</span><div class="m">${a.open_alerts ? `${a.open_alerts} open alert${a.open_alerts === 1 ? '' : 's'}` : esc(a.family)}</div><div class="tele" data-tele="${esc(a.id)}">${teleLine(a.id)}</div></span>
      <span class="r">${statusPill(a.status)}<div class="health ${a.health < 60 ? 'bad' : a.health < 80 ? 'mid' : ''}" title="Health ${a.health}/100"><i style="width:${a.health}%"></i></div></span></a>`).join('');
  }

  function feedItem(r, flash) {
    return `<div class="feed-item ${flash ? 'flash' : ''}"><div class="src" title="${esc(SOURCE_LABEL[r.source] || r.source)}">${icon(SOURCE_ICON[r.source] || 'chat')}</div>
      <div><div class="row spread" style="align-items:flex-start"><span><span class="id">${esc(r.asset_id)}</span> · <b style="font-weight:600">${esc(r.summary)}</b></span><span class="faint mono" style="font-size:11px;white-space:nowrap">${ago(r.created_at)}</span></div>
      <div class="q">“${esc(r.raw_text.length > 160 ? r.raw_text.slice(0, 159) + '…' : r.raw_text)}”</div>
      <div class="row wrap" style="gap:8px;margin-top:6px">${sevPill(r.severity)}<span class="faint" style="font-size:12px">${esc(r.person_name || SOURCE_LABEL[r.source])}${r.person_role ? ', ' + esc(ROLE[r.person_role].toLowerCase()) : ''}</span></div></div></div>`;
  }
  function renderFeed(flashId) {
    $('graphStat').textContent = `${state.data.graph.nodes} facts on record`;
    $('feed').innerHTML = state.data.reports.length
      ? state.data.reports.map((r) => feedItem(r, r.id === flashId)).join('')
      : emptyState({ icon: 'mic', title: 'Nobody has reported anything here yet', body: 'The first voice note from a phone on this site appears here about a second after it’s sent.', action: '<a href="/operator">Open the operator screen</a>' });
  }

  // ---------- agent ----------
  const SUGGEST = ['Which machines need attention?', 'Any overheating on the 777s?', 'What do we know about boom hose leaks?', 'Show engineering cases'];
  $('askChips').innerHTML = SUGGEST.map((s) => `<button class="chip" type="button">${esc(s)}</button>`).join('');
  $('askChips').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('askInput').value = c.textContent; $('askForm').requestSubmit(); });
  $('askForm').onsubmit = async (e) => {
    e.preventDefault();
    const qText = $('askInput').value.trim();
    if (!qText) return;
    $('askInput').value = '';
    const log = $('askLog');
    log.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(qText)}</div><div class="bubble bot" id="pending"><span class="sk line" style="width:220px"></span><span class="sk line" style="width:160px"></span></div>`);
    log.scrollTop = log.scrollHeight;
    try {
      const out = await api('/api/ask', { body: { question: qText, role: 'site_manager', personId: mgr()?.id } });
      document.getElementById('pending').outerHTML = `<div class="bubble bot md">${md(out.answer)}${out.trace?.length ? `<div class="trace">looked at: ${out.trace.map((t) => esc(t.tool.replace(/_/g, ' '))).join(', ')}</div>` : ''}</div>`;
    } catch (err) {
      document.getElementById('pending').outerHTML = `<div class="bubble bot">${emptyState({ icon: 'wifiOff', error: true, title: 'No answer', body: esc(err.message) })}</div>`;
    }
    log.scrollTop = log.scrollHeight;
  };

  // ---------- telemetry ----------
  $('teleToggle').onchange = async () => {
    try { const r = await api('/api/telemetry', { body: { on: $('teleToggle').checked } }); toast(r.on ? 'Simulated sensors on. Readings over a limit become reports, same as a voice note.' : 'Simulated sensors off.'); }
    catch (err) { toast(esc(err.message), 'high'); }
  };

  // ---------- live ----------
  let reloadTimer = null;
  const softReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 400); };
  connectStream({
    report: ({ report }) => {
      if (!inScope(report.site_id) || !state.data) return;
      state.data.reports = [report, ...state.data.reports.filter((r) => r.id !== report.id)].slice(0, 25);
      renderFeed(report.id);
    },
    alert: ({ alert }) => {
      if (!inScope(alert.site_id) || !state.data) return;
      state.data.alerts = [alert, ...state.data.alerts.filter((a) => a.id !== alert.id)];
      renderAlerts(alert.id);
      toast(`<b>${esc(alert.title)}</b>`, alert.severity);
      softReload();
    },
    'alert-updated': ({ alert }) => { if (inScope(alert.site_id)) softReload(); },
    action: ({ item }) => { if (inScope(item.site_id)) softReload(); },
    asset: (a) => { if (inScope(a.site_id)) softReload(); },
    graph: () => { api('/api/graph/stats').then((g) => { if (state.data) { state.data.graph = g; $('graphStat').textContent = `${g.nodes} facts on record`; } }).catch(() => {}); },
    telemetry: ({ readings }) => {
      for (const r of readings) (state.tele[r.asset_id] ||= {})[r.metric] = r;
      document.querySelectorAll('[data-tele]').forEach((el) => { el.textContent = teleLine(el.dataset.tele); });
    },
    'telemetry-status': ({ on }) => { $('teleToggle').checked = on; if (state.data) { state.data.telemetry = on; renderFleet(); } },
    hello: () => { if (state.data) softReload(); },
  }, $('live'));

  boot().catch((err) => { $('alerts').innerHTML = emptyState({ icon: 'wifiOff', error: true, title: 'Couldn’t load this job site', body: esc(err.message) }); });
})();
