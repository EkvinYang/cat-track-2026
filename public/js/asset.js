// Machine memory page: one asset's whole life — profile, distilled memory, role insights,
// lifecycle timeline, its slice of the knowledge graph, and a chat with the machine.
(function () {
  const { api, esc, ago, dateShort, dateTime, sevPill, statusPill, md, toast, connectStream, store, topbar, icon, machineIcon, emptyState, skeleton, ROLE, SOURCE_ICON, SOURCE_LABEL } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('');
  const id = (new URLSearchParams(location.search).get('id') || '').toUpperCase();
  const state = { data: null, role: store.get('assetRole', 'operator'), filter: 'all', timeline: [] };
  if (!id) { $('hero').innerHTML = emptyState({ icon: 'search', title: 'No machine picked', body: 'Open a machine from a job site, or add ?id=EX-0412 to the address.', action: '<a href="/site">Go to job sites</a>' }); return; }

  function ring(h) {
    const c = 2 * Math.PI * 44; const off = c * (1 - h / 100);
    const col = h < 60 ? 'var(--critical)' : h < 80 ? 'var(--warn)' : 'var(--good)';
    return `<div class="ring" role="meter" aria-label="Health ${h} of 100"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="var(--s3)" stroke-width="8" fill="none"/><circle cx="50" cy="50" r="44" stroke="${col}" stroke-width="8" fill="none" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><div class="val">${h}<small>HEALTH</small></div></div>`;
  }

  async function load() {
    const [data, timeline] = await Promise.all([api(`/api/assets/${encodeURIComponent(id)}`), api(`/api/assets/${encodeURIComponent(id)}/timeline`)]);
    state.data = data; state.timeline = timeline;
    document.title = `${data.asset.id} · Machine Memory`;
    renderHero(); renderMemory(); renderOpen(); renderTimeline(); loadInsights();
  }

  async function renderHero() {
    const a = state.data.asset;
    const since = a.last_service_hours != null ? Math.round(a.smu_hours - a.last_service_hours) : null;
    let pub = location.origin;
    try { pub = (await api('/api/public-url')).url; } catch { /* use origin */ }
    $('hero').innerHTML = `
      <div class="ico">${machineIcon(a.family)}</div>
      <div>
        <div class="row wrap" style="gap:10px">${statusPill(a.status)}<span class="id">${esc(a.id)}</span><span class="faint mono" style="font-size:12px">S/N ${esc(a.serial)}</span></div>
        <h1 style="margin-top:10px">${esc(a.model)} <span class="muted" style="font-weight:600">${esc(a.family)}</span></h1>
        <div class="facts">
          <div class="fact"><div class="k">Job site</div><div class="v">${esc(a.site_name)}</div></div>
          <div class="fact"><div class="k">Hours</div><div class="v">${Math.round(a.smu_hours).toLocaleString()}</div></div>
          <div class="fact"><div class="k">Fuel</div><div class="v">${Math.round(a.fuel_pct)}%</div></div>
          <div class="fact"><div class="k">Since last PM</div><div class="v">${since != null ? since + ' h' : '—'}</div></div>
          <div class="fact"><div class="k">Built</div><div class="v">${a.year}</div></div>
          <div class="fact"><div class="k">Operator</div><div class="v">${esc(a.operator_name || '—')}</div></div>
        </div>
      </div>
      <div class="row" style="gap:18px;align-items:flex-start">${ring(a.health)}<a href="/operator?unit=${encodeURIComponent(a.id)}" title="Open the report screen for ${esc(a.id)}"><img class="qr-mini" alt="QR tag for ${esc(a.id)}" src="/api/qr.svg?data=${encodeURIComponent(`${pub}/operator?unit=${a.id}`)}"></a></div>`;
    $('graphLink').href = `/graph?focus=${encodeURIComponent('asset:' + a.id.toLowerCase())}`;
  }

  function renderMemory() {
    const mem = state.data.memory;
    const ic = { pattern: 'alert', environment: 'activity', fleet: 'graph', bulletin: 'wrench', service: 'clock', repair: 'wrench', note: 'history' };
    $('memory').innerHTML = mem.length ? mem.map((m) => `<div class="mem">${icon(ic[m.kind] || 'history')}<span>${esc(m.text)}</span></div>`).join('') : emptyState({ icon: 'history', title: 'Nothing distilled yet', body: 'After a few reports, repeat problems and links to conditions like heat or dust show up here.' });
  }

  function renderOpen() {
    const { alerts, actions } = state.data;
    $('openItems').innerHTML = (alerts.length || actions.length)
      ? alerts.map((a) => `<div class="alert-card ${esc(a.severity)}"><div class="t">${esc(a.title)}</div><div class="b mono" style="font-size:12px">${ago(a.created_at)} · ${a.status === 'ack' ? 'seen' : esc(a.status)}</div></div>`).join('') +
        (actions.length ? `<div style="margin-top:10px">${actions.map((t) => `<div class="mem">${icon('check')}<span><span class="label" style="margin-right:6px">${esc(ROLE[t.assignee_role] || t.assignee_role)}</span>${esc(t.text)}</span></div>`).join('')}</div>` : '')
      : emptyState({ icon: 'check', title: 'Nothing open on this machine', body: 'No unresolved alerts or tasks. New ones appear the moment someone reports a problem.' });
  }

  async function loadInsights() {
    $('roleTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === state.role));
    try {
      const out = await api(`/api/assets/${encodeURIComponent(id)}/insights?role=${state.role}`);
      $('insights').innerHTML = out.items.map((i) => `<div class="ins ${esc(i.level)}"><div class="tt">${esc(i.title)}</div><div class="dd">${esc(i.detail)}</div></div>`).join('');
    } catch (err) { $('insights').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }
  $('roleTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { state.role = b.dataset.r; store.set('assetRole', state.role); loadInsights(); });

  const FILTERS = { all: 'Everything', issues: 'Problems', repairs: 'Repairs and service', safety: 'Safety', telemetry: 'Sensor alarms' };
  function renderTimeline() {
    $('filters').innerHTML = Object.entries(FILTERS).map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
    $('filters').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { state.filter = b.dataset.f; renderTimeline(); });
    const f = state.filter;
    const items = state.timeline.filter((r) => f === 'all' || (f === 'issues' && r.category === 'mechanical') || (f === 'repairs' && r.category === 'maintenance') || (f === 'safety' && r.category === 'safety') || (f === 'telemetry' && r.source === 'telemetry'));
    $('tlCount').textContent = state.timeline.length ? `${state.timeline.length} entries since ${new Date(state.timeline[state.timeline.length - 1].created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : '';
    const emptyCopy = { all: ['Nothing on record yet', 'The first report, repair or sensor alarm for this machine starts its history.'], issues: ['No problems reported', 'Nobody has reported a mechanical problem on this machine.'], repairs: ['No repairs or services logged', 'Repairs logged from the job-site view will appear here.'], safety: ['No safety reports', 'No hazards have been reported around this machine.'], telemetry: ['No sensor alarms', 'Turn on simulated sensors in the job-site view; readings over a limit are filed here.'] }[f];
    $('timeline').innerHTML = items.map((r) => `<div class="tl-item ${r.category === 'maintenance' ? 'maintenance' : esc(r.severity)}"><span class="dot"></span>
      <div class="hd"><span class="when">${dateTime(r.created_at)}</span>${r.category !== 'maintenance' ? sevPill(r.severity) : '<span class="tag">service</span>'}<span>${esc(SOURCE_LABEL[r.source] || r.source)}${r.person_name ? ' · ' + esc(r.person_name) : ''}</span></div>
      <div class="sm">${esc(r.summary)}</div><div class="qt">“${esc(r.raw_text)}”</div>
      ${r.photo_path ? `<img src="${esc(r.photo_path)}" alt="Photo attached to this report" style="max-width:180px;border-radius:3px;margin-top:6px;border:1px solid var(--line)">` : ''}</div>`).join('') || `<div style="margin-left:-24px">${emptyState({ icon: 'history', title: emptyCopy[0], body: emptyCopy[1] })}</div>`;
  }

  // ---------- mini graph ----------
  async function loadMini() {
    const g = await api(`/api/assets/${encodeURIComponent(id)}/graph`);
    const COLORS = { site: '#ffcd11', asset: '#ffcd11', model: '#ffcd11', case: '#199e70', fix: '#199e70', component: '#3987e5', condition: '#3987e5', symptom: '#d95926', code: '#d95926', hazard: '#d95926', person: '#8a8f96', report: '#5d6269' };
    const nodes = new vis.DataSet(g.nodes.map((n) => ({ id: n.id, label: n.type === 'report' ? undefined : n.label, title: n.label, color: COLORS[n.type] || '#888', shape: n.type === 'asset' ? 'dot' : n.type === 'symptom' ? 'triangle' : n.type === 'case' ? 'star' : 'dot', size: n.id === `asset:${id.toLowerCase()}` ? 22 : n.type === 'report' ? 5 : 10, font: { color: '#d9dde1', size: 11, strokeWidth: 3, strokeColor: '#0f1113' } })));
    const edges = new vis.DataSet(g.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, color: { color: 'rgba(140,150,160,.3)' }, width: Math.min(4, 0.6 + Math.log2(e.weight || 1)) })));
    new vis.Network($('mini'), { nodes, edges }, { physics: { solver: 'forceAtlas2Based', stabilization: { iterations: 150 } }, edges: { smooth: false }, interaction: { hover: true } });
    if (!g.nodes.length) $('mini').innerHTML = emptyState({ icon: 'graph', title: 'No connections yet', body: 'Once this machine has a report, its parts and symptoms link up here.' });
  }

  // ---------- ask ----------
  api('/api/health').then((h) => { $('aiMode').textContent = h.ai === 'claude' ? 'Claude' : 'offline'; }).catch(() => {});
  const SUGGEST = ['Has this happened before?', 'What should I check before my shift?', 'What fixed it last time?', 'Are other machines having this problem?'];
  $('askChips').innerHTML = SUGGEST.map((s) => `<button class="chip" type="button">${esc(s)}</button>`).join('');
  $('askChips').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('askInput').value = c.textContent; $('askForm').requestSubmit(); });
  $('askLog').innerHTML = `<div class="bubble bot muted">Answers come only from ${esc(id)}’s record and its model’s fleet history, with report numbers so you can check them.</div>`;
  $('askForm').onsubmit = async (e) => {
    e.preventDefault();
    const qText = $('askInput').value.trim();
    if (!qText) return;
    $('askInput').value = '';
    const log = $('askLog');
    log.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(qText)}</div><div class="bubble bot" id="pending"><span class="sk line" style="width:220px"></span><span class="sk line" style="width:150px"></span></div>`);
    log.scrollTop = log.scrollHeight;
    try {
      const role = state.role === 'fleet_manager' ? 'fleet_manager' : state.role;
      const out = await api('/api/ask', { body: { question: qText, assetId: id, role } });
      document.getElementById('pending').outerHTML = `<div class="bubble bot md">${md(out.answer)}${out.trace?.length ? `<div class="trace">looked at: ${out.trace.map((t) => esc(t.tool.replace(/_/g, ' '))).join(', ')}</div>` : ''}</div>`;
    } catch (err) { document.getElementById('pending').outerHTML = `<div class="bubble bot">${emptyState({ icon: 'wifiOff', error: true, title: 'No answer', body: esc(err.message) })}</div>`; }
    log.scrollTop = log.scrollHeight;
  };

  let t = null;
  connectStream({
    report: ({ report }) => { if (report.asset_id === id) { toast(`New on this machine: ${esc(report.summary)}`); clearTimeout(t); t = setTimeout(load, 300); } },
    asset: (a) => { if (a.id === id) { clearTimeout(t); t = setTimeout(load, 300); } },
  }, $('live'));

  $('insights').innerHTML = skeleton(4); $('memory').innerHTML = skeleton(3); $('timeline').innerHTML = skeleton(6);
  load().catch((err) => { $('hero').innerHTML = emptyState({ icon: 'search', error: true, title: `Couldn’t open ${esc(id)}`, body: esc(err.message), action: '<a href="/site">Back to job sites</a>' }); $('insights').innerHTML = ''; $('memory').innerHTML = ''; $('timeline').innerHTML = ''; });
  loadMini().catch(() => { $('mini').innerHTML = '<div class="empty">Graph unavailable</div>'; });
})();
