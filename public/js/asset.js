// Machine memory page: one asset's whole life — profile, distilled memory, role insights,
// lifecycle timeline, its slice of the knowledge graph, and a chat with the machine.
(function () {
  const { api, esc, ago, dateTime, sevPill, statusPill, md, toast, connectStream, store, topbar, icon, ROLE, SOURCE_ICON } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('');
  const id = (new URLSearchParams(location.search).get('id') || '').toUpperCase();
  const state = { data: null, role: store.get('assetRole', 'operator'), filter: 'all', timeline: [] };
  if (!id) { $('hero').innerHTML = '<div class="empty">No machine selected. <a href="/site">Pick one from the Site Command Center</a>.</div>'; return; }

  function ring(h) {
    const c = 2 * Math.PI * 44; const off = c * (1 - h / 100);
    const col = h < 60 ? 'var(--critical)' : h < 80 ? 'var(--yellow)' : 'var(--low)';
    return `<div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="#262a2f" stroke-width="9" fill="none"/><circle cx="50" cy="50" r="44" stroke="${col}" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><div class="val">${h}<small>HEALTH</small></div></div>`;
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
      <div class="ico">${icon('machine')}</div>
      <div>
        <div class="row wrap" style="gap:8px">${statusPill(a.status)}<span class="faint mono">${esc(a.id)} · S/N ${esc(a.serial)}</span></div>
        <h1 style="margin-top:6px">${esc(a.model)} <span class="muted" style="font-size:24px">${esc(a.family)}</span></h1>
        <div class="facts">
          <div class="fact"><div class="k">Site</div><div class="v" style="font-size:16px">${esc(a.site_name)}</div></div>
          <div class="fact"><div class="k">SMU hours</div><div class="v">${Math.round(a.smu_hours).toLocaleString()}</div></div>
          <div class="fact"><div class="k">Fuel</div><div class="v">${Math.round(a.fuel_pct)}%</div></div>
          <div class="fact"><div class="k">Since PM</div><div class="v">${since != null ? since + ' h' : '—'}</div></div>
          <div class="fact"><div class="k">In service since</div><div class="v">${a.year}</div></div>
          <div class="fact"><div class="k">Memory entries</div><div class="v">${state.data.stats.total}</div></div>
        </div>
      </div>
      <div class="row" style="gap:16px">${ring(a.health)}<a href="/operator?unit=${encodeURIComponent(a.id)}" title="Operator panel for this unit"><img class="qr-mini" alt="QR tag for ${esc(a.id)}" src="/api/qr.svg?data=${encodeURIComponent(`${pub}/operator?unit=${a.id}`)}"></a></div>`;
    $('graphLink').href = `/graph?focus=${encodeURIComponent('asset:' + a.id.toLowerCase())}`;
  }

  function renderMemory() {
    const mem = state.data.memory;
    const ic = { pattern: 'alert', environment: 'activity', fleet: 'graph', bulletin: 'wrench', service: 'clock', repair: 'wrench', note: 'brain' };
    $('memory').innerHTML = mem.length ? mem.map((m) => `<div class="mem">${icon(ic[m.kind] || 'brain')}<span>${esc(m.text)}</span></div>`).join('') : '<div class="empty">No distilled memory yet.</div>';
  }

  function renderOpen() {
    const { alerts, actions } = state.data;
    $('openItems').innerHTML = (alerts.length || actions.length)
      ? alerts.map((a) => `<div class="alert-card ${esc(a.severity)}"><div class="t">${esc(a.title)}</div><div class="b">${ago(a.created_at)} · ${esc(a.status)}</div></div>`).join('') +
        (actions.length ? `<div style="margin-top:10px">${actions.map((t) => `<div class="mem">${icon('check')}<span><b style="color:var(--yellow);font-size:12px;text-transform:uppercase;letter-spacing:.05em">${esc(ROLE[t.assignee_role] || t.assignee_role)}</b> ${esc(t.text)}</span></div>`).join('')}</div>` : '')
      : '<div class="empty">Nothing open. ✓</div>';
  }

  async function loadInsights() {
    $('roleTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === state.role));
    try {
      const out = await api(`/api/assets/${encodeURIComponent(id)}/insights?role=${state.role}`);
      $('insights').innerHTML = out.items.map((i) => `<div class="ins ${esc(i.level)}"><div class="tt">${esc(i.title)}</div><div class="dd">${esc(i.detail)}</div></div>`).join('');
    } catch (err) { $('insights').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }
  $('roleTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { state.role = b.dataset.r; store.set('assetRole', state.role); loadInsights(); });

  const FILTERS = { all: 'All', issues: 'Issues', repairs: 'Repairs & service', safety: 'Safety', telemetry: 'Telemetry' };
  function renderTimeline() {
    $('filters').innerHTML = Object.entries(FILTERS).map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
    $('filters').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { state.filter = b.dataset.f; renderTimeline(); });
    const f = state.filter;
    const items = state.timeline.filter((r) => f === 'all' || (f === 'issues' && r.category === 'mechanical') || (f === 'repairs' && r.category === 'maintenance') || (f === 'safety' && r.category === 'safety') || (f === 'telemetry' && r.source === 'telemetry'));
    $('tlCount').textContent = `${state.timeline.length} entries since ${state.timeline.length ? new Date(state.timeline[state.timeline.length - 1].created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}`;
    $('timeline').innerHTML = items.map((r) => `<div class="tl-item ${r.category === 'maintenance' ? 'maintenance' : esc(r.severity)}"><span class="dot"></span>
      <div class="hd">${icon(SOURCE_ICON[r.source] || 'chat')}<span>${dateTime(r.created_at)}</span>${r.category !== 'maintenance' ? sevPill(r.severity) : '<span class="pill sev-info">service</span>'}<span>${esc(r.person_name || (r.source === 'telemetry' ? 'Telemetry' : ''))}</span></div>
      <div class="sm">${esc(r.summary)}</div><div class="qt">"${esc(r.raw_text)}"</div>
      ${r.photo_path ? `<img src="${esc(r.photo_path)}" alt="Report photo" style="max-width:180px;border-radius:8px;margin-top:6px;border:1px solid var(--line)">` : ''}</div>`).join('') || '<div class="empty">No entries.</div>';
  }

  // ---------- mini graph ----------
  async function loadMini() {
    const g = await api(`/api/assets/${encodeURIComponent(id)}/graph`);
    const COLORS = { site: '#ffcd11', asset: '#ffcd11', model: '#f1f2f3', case: '#e879f9', component: '#ff8a1f', symptom: '#ff4d4f', code: '#b48cff', condition: '#5aa9ff', hazard: '#ff6b6b', fix: '#2dd4bf', person: '#3ecf8e', report: '#7b838c' };
    const nodes = new vis.DataSet(g.nodes.map((n) => ({ id: n.id, label: n.type === 'report' ? undefined : n.label, title: n.label, color: COLORS[n.type] || '#888', shape: n.type === 'asset' ? 'dot' : n.type === 'symptom' ? 'triangle' : n.type === 'case' ? 'star' : 'dot', size: n.id === `asset:${id.toLowerCase()}` ? 22 : n.type === 'report' ? 5 : 10, font: { color: '#d9dde1', size: 11, strokeWidth: 3, strokeColor: '#0f1113' } })));
    const edges = new vis.DataSet(g.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, color: { color: 'rgba(140,150,160,.3)' }, width: Math.min(4, 0.6 + Math.log2(e.weight || 1)) })));
    new vis.Network($('mini'), { nodes, edges }, { physics: { solver: 'forceAtlas2Based', stabilization: { iterations: 150 } }, edges: { smooth: false }, interaction: { hover: true } });
  }

  // ---------- ask ----------
  api('/api/health').then((h) => { $('aiMode').textContent = h.ai === 'claude' ? 'Claude agent' : 'Offline agent'; }).catch(() => {});
  const SUGGEST = ['Has this happened before?', 'What should I check before my shift?', 'What fixed this last time?', 'Is this part of a fleet-wide problem?'];
  $('askChips').innerHTML = SUGGEST.map((s) => `<button class="chip" type="button">${esc(s)}</button>`).join('');
  $('askChips').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('askInput').value = c.textContent; $('askForm').requestSubmit(); });
  $('askLog').innerHTML = `<div class="bubble bot">I'm ${esc(id)}'s memory. Ask me about my history, recurring problems or fixes.</div>`;
  $('askForm').onsubmit = async (e) => {
    e.preventDefault();
    const qText = $('askInput').value.trim();
    if (!qText) return;
    $('askInput').value = '';
    const log = $('askLog');
    log.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(qText)}</div><div class="bubble bot" id="pending"><span class="muted">Recalling…</span></div>`);
    log.scrollTop = log.scrollHeight;
    try {
      const role = state.role === 'fleet_manager' ? 'fleet_manager' : state.role;
      const out = await api('/api/ask', { body: { question: qText, assetId: id, role } });
      document.getElementById('pending').outerHTML = `<div class="bubble bot md">${md(out.answer)}${out.trace?.length ? `<div class="trace">${out.trace.map((t) => `<span>${esc(t.tool)}</span>`).join('')}</div>` : ''}</div>`;
    } catch (err) { document.getElementById('pending').outerHTML = `<div class="bubble bot" style="color:#ff9a9b">${esc(err.message)}</div>`; }
    log.scrollTop = log.scrollHeight;
  };

  let t = null;
  connectStream({
    report: ({ report }) => { if (report.asset_id === id) { toast(`${icon('mic')} New memory: ${esc(report.summary)}`); clearTimeout(t); t = setTimeout(load, 300); } },
    asset: (a) => { if (a.id === id) { clearTimeout(t); t = setTimeout(load, 300); } },
  }, $('live'));

  load().catch((err) => { $('hero').innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
  loadMini().catch(() => { $('mini').innerHTML = '<div class="empty">Graph unavailable</div>'; });
})();
