// Knowledge graph explorer: the fleet's memory as a living map that grows in real time.
(function () {
  const { api, esc, ago, sevPill, toast, connectStream, topbar, icon } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('/graph');

  // Four hue groups (validated for colour-blind separation on this surface) + neutral grey.
  // Machines carry the brand yellow; shape tells types apart inside a group.
  const C = { fleet: '#ffcd11', problem: '#d95926', part: '#3987e5', learned: '#199e70', record: '#8a8f96', report: '#5d6269' };
  const TYPES = {
    site: { label: 'Job sites', group: 'Machines', color: C.fleet, shape: 'square', size: 18 },
    asset: { label: 'Machines', group: 'Machines', color: C.fleet, shape: 'dot', size: 15 },
    model: { label: 'Models', group: 'Machines', color: C.fleet, shape: 'diamond', size: 13 },
    symptom: { label: 'Symptoms', group: 'What went wrong', color: C.problem, shape: 'triangle', size: 10 },
    code: { label: 'Fault codes', group: 'What went wrong', color: C.problem, shape: 'box', size: 12 },
    hazard: { label: 'Safety hazards', group: 'What went wrong', color: C.problem, shape: 'triangleDown', size: 11 },
    component: { label: 'Parts', group: 'Where and when', color: C.part, shape: 'dot', size: 10 },
    condition: { label: 'Conditions', group: 'Where and when', color: C.part, shape: 'hexagon', size: 10 },
    case: { label: 'Engineering cases', group: 'What was learned', color: C.learned, shape: 'star', size: 15 },
    fix: { label: 'Fixes', group: 'What was learned', color: C.learned, shape: 'square', size: 8 },
    person: { label: 'People', group: 'Who and what', color: C.record, shape: 'dot', size: 7 },
    report: { label: 'Reports', group: 'Who and what', color: C.report, shape: 'dot', size: 4 },
  };
  const SHAPE_SVG = {
    dot: '<circle cx="7" cy="7" r="5.5"/>', square: '<rect x="1.5" y="1.5" width="11" height="11"/>', diamond: '<polygon points="7,0.5 13.5,7 7,13.5 0.5,7"/>',
    triangle: '<polygon points="7,1 13.5,13 0.5,13"/>', triangleDown: '<polygon points="0.5,1 13.5,1 7,13"/>', box: '<rect x="0.5" y="3" width="13" height="8" rx="1.5"/>',
    hexagon: '<polygon points="3.5,1 10.5,1 13.5,7 10.5,13 3.5,13 0.5,7"/>', star: '<polygon points="7,0.5 8.8,5 13.5,5.2 9.8,8.2 11,13 7,10.3 3,13 4.2,8.2 0.5,5.2 5.2,5"/>',
  };
  const swatch = (t) => `<svg class="sw" viewBox="0 0 14 14" aria-hidden="true" style="fill:${t.color}">${SHAPE_SVG[t.shape]}</svg>`;
  const visible = Object.fromEntries(Object.keys(TYPES).map((t) => [t, true]));
  const counts = {};

  const nodes = new vis.DataSet();
  const edges = new vis.DataSet();
  const nodeView = new vis.DataView(nodes, { filter: (n) => visible[n.ctType] });

  function styleNode(n) {
    const t = TYPES[n.type] || TYPES.report;
    const grow = Math.min(10, Math.log2((n.weight || 1) + 1) * 1.8);
    const showLabel = n.type !== 'report';
    return {
      id: n.id, ctType: n.type, weight: n.weight || 1,
      label: showLabel ? n.label : undefined,
      title: `${t.label.replace(/s$/, '')}: ${n.label}${n.weight > 1 ? ` (seen ${n.weight}×)` : ''}`,
      shape: t.shape, size: t.size + (n.type === 'report' ? 0 : grow),
      color: { background: t.color, border: t.color, highlight: { background: '#ffffff', border: t.color }, hover: { background: t.color, border: '#ffffff' } },
      font: { color: n.type === 'code' ? '#ffffff' : '#d9d7d0', size: n.type === 'asset' || n.type === 'site' ? 15 : 12, face: n.type === 'asset' || n.type === 'code' ? 'IBM Plex Mono' : 'Barlow', strokeWidth: n.type === 'code' ? 0 : 3, strokeColor: '#0f1012' },
      borderWidth: 1,
    };
  }
  const styleEdge = (e) => ({ id: e.id, from: e.from, to: e.to, ctType: e.type, title: `${e.type}${e.weight > 1 ? ` ×${e.weight}` : ''}`, width: Math.min(6, 0.6 + Math.log2(e.weight || 1)), color: { color: 'rgba(140,150,160,.28)', highlight: '#ffcd11', hover: '#ffcd11' } });

  let network = null;
  function createNetwork() {
    network = new vis.Network($('netCanvas'), { nodes: nodeView, edges }, {
      autoResize: true,
      interaction: { hover: true, tooltipDelay: 120, navigationButtons: false, keyboard: false },
      physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -90, centralGravity: 0.012, springLength: 110, springConstant: 0.05, avoidOverlap: 0.5, damping: 0.5 }, stabilization: { iterations: 300, updateInterval: 50 }, maxVelocity: 40 },
      edges: { smooth: false, selectionWidth: 2 },
      nodes: { borderWidthSelected: 3 },
    });
    network.on('click', (p) => { if (p.nodes[0]) showNode(p.nodes[0]); });
    return new Promise((resolve) => network.once('stabilizationIterationsDone', () => { $('loading').classList.add('hidden'); network.fit({ animation: { duration: 600 } }); resolve(); }));
  }

  function recount() {
    for (const k of Object.keys(TYPES)) counts[k] = 0;
    nodes.forEach((n) => { counts[n.ctType] = (counts[n.ctType] || 0) + 1; });
    $('stN').textContent = nodes.length; $('stE').textContent = edges.length;
    let lastGroup = '';
    $('legend').innerHTML = Object.entries(TYPES).map(([k, t]) => {
      const head = t.group !== lastGroup ? `<div class="lg-group">${t.group}</div>` : '';
      lastGroup = t.group;
      return `${head}<label><input type="checkbox" data-t="${k}" ${visible[k] ? 'checked' : ''}>${swatch(t)}${t.label}<span class="n">${counts[k] || 0}</span></label>`;
    }).join('');
    $('legend').querySelectorAll('[data-t]').forEach((c) => c.onchange = () => { visible[c.dataset.t] = c.checked; nodeView.refresh(); });
  }

  async function load() {
    const g = await api('/api/graph');
    nodes.add(g.nodes.map(styleNode));
    edges.add(g.edges.map(styleEdge));
    recount();
    if (!g.nodes.length) { $('loading').innerHTML = CT.emptyState({ icon: 'graph', title: 'The record is empty', body: 'Send a report from the <a href="/operator">operator screen</a> and the first machine, part and symptom will appear here.' }); $('loading').style.pointerEvents = 'auto'; return; }
    await createNetwork();
  }

  // ---------- details ----------
  async function showNode(id) {
    let d;
    try { d = await api(`/api/graph/node?id=${encodeURIComponent(id)}`); } catch (err) { toast(esc(err.message), 'high'); return; }
    const t = TYPES[d.node.type] || TYPES.report;
    const groups = {};
    for (const l of d.links) (groups[l.type] ||= []).push(l);
    const r = d.report;
    $('drawer').innerHTML = `
      <div class="row spread"><span class="row" style="gap:7px">${swatch(t)}<span class="label">${esc(t.label.replace(/s$/, ''))}</span></span><button class="btn sm ghost" id="closeDrawer" aria-label="Close">${icon('x')}</button></div>
      <h2 style="font-family:var(--f-display);font-weight:700;font-size:28px;line-height:1.05;margin-top:10px">${esc(r ? r.summary : d.node.label)}</h2>
      <div class="muted mono" style="font-size:12px;margin-top:6px">seen ${d.node.weight} time${d.node.weight === 1 ? '' : 's'} · first ${ago(d.node.created_at)}</div>
      ${d.node.type === 'asset' ? `<a class="btn sm primary" style="margin-top:12px" href="/asset?id=${encodeURIComponent(d.node.label)}">Full history ${icon('arrow')}</a>` : ''}
      ${d.node.type === 'case' ? `<a class="btn sm primary" style="margin-top:12px" href="/engineering?case=${d.node.props.caseId}">Open the case ${icon('arrow')}</a>` : ''}
      ${r ? `<div class="card" style="margin-top:12px"><div class="row wrap" style="gap:6px">${sevPill(r.severity)}<span class="tag">${esc(r.category)}</span><span class="faint mono" style="font-size:11px">${esc(r.asset_id)} · ${ago(r.created_at)}</span></div><div style="margin-top:8px">“${esc(r.raw_text)}”</div><div class="faint" style="font-size:12px;margin-top:6px">${esc(r.person_name || r.source)}</div></div>` : ''}
      <div style="margin-top:14px">${Object.entries(groups).map(([type, ls]) => `<div style="margin-bottom:8px">${ls.slice(0, 14).map((l) => `<div class="lk" data-go="${esc(l.other.id)}"><span class="et">${l.direction === 'in' ? '← ' : ''}${esc(type.replace(/_/g, ' '))}</span>${swatch(TYPES[l.other.type] || TYPES.report).replace('class="sw"', 'class="sw" style="width:10px;height:10px;fill:' + (TYPES[l.other.type] || TYPES.report).color + '"')}<span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.other.label)}</span>${l.weight > 1 ? `<span class="faint" style="font-size:12px">×${l.weight}</span>` : ''}</div>`).join('')}${ls.length > 14 ? `<div class="faint" style="font-size:12px;padding-left:8px">+${ls.length - 14} more</div>` : ''}</div>`).join('')}</div>`;
    $('drawer').classList.remove('hidden');
    $('closeDrawer').onclick = () => { $('drawer').classList.add('hidden'); network.unselectAll(); };
    $('drawer').querySelectorAll('[data-go]').forEach((el) => el.onclick = () => focusNode(el.dataset.go));
  }
  function focusNode(id) {
    const n = nodes.get(id);
    if (!n) return;
    if (!visible[n.ctType]) { visible[n.ctType] = true; nodeView.refresh(); recount(); }
    network.selectNodes([id]);
    network.focus(id, { scale: 1.3, animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
    showNode(id);
  }
  $('search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const qv = $('search').value.trim().toLowerCase();
    if (!qv) return;
    const hit = nodes.get({ filter: (n) => (n.label || '').toLowerCase() === qv })[0] || nodes.get({ filter: (n) => (n.label || n.title || '').toLowerCase().includes(qv) })[0];
    if (hit) focusNode(hit.id); else toast('No matching node');
  });
  $('physics').onchange = () => network?.setOptions({ physics: { enabled: $('physics').checked } });
  $('fitBtn').onclick = () => network?.fit({ animation: { duration: 500 } });

  // ---------- live growth ----------
  let growthTimer = null;
  function applyDelta(delta) {
    if (!network) return;
    let added = 0; let linked = 0; let reinforced = 0;
    const flash = [];
    for (const n of delta.nodes || []) {
      const styled = styleNode(n);
      if (nodes.get(n.id)) { nodes.update(styled); reinforced++; }
      else {
        // drop new nodes next to something they connect to so the map grows organically
        const link = (delta.edges || []).find((e) => (e.from === n.id && nodes.get(e.to)) || (e.to === n.id && nodes.get(e.from)));
        const anchor = link ? (link.from === n.id ? link.to : link.from) : null;
        const pos = anchor ? network.getPositions([anchor])[anchor] : null;
        nodes.add({ ...styled, ...(pos ? { x: pos.x + (Math.random() - 0.5) * 60, y: pos.y + (Math.random() - 0.5) * 60 } : {}) });
        added++;
      }
      flash.push(n.id);
    }
    for (const e of delta.edges || []) {
      if (edges.get(e.id)) { edges.update(styleEdge(e)); } else { edges.add(styleEdge(e)); linked++; }
    }
    for (const id of flash) nodes.update({ id, borderWidth: 5, color: { border: '#ffffff' } });
    setTimeout(() => { for (const id of flash) { const n = nodes.get(id); if (n) nodes.update({ id, borderWidth: 1, color: { ...n.color, border: n.color.background } }); } }, 2600);
    recount();
    $('loading').classList.add('hidden');
    $('growth').innerHTML = `New report filed: <b>${added}</b> new ${added === 1 ? 'fact' : 'facts'}, <b>${linked}</b> new links, <b>${reinforced}</b> existing ones confirmed.`;
    $('growth').classList.remove('hidden');
    clearTimeout(growthTimer); growthTimer = setTimeout(() => $('growth').classList.add('hidden'), 6000);
  }

  connectStream({
    graph: applyDelta,
    report: ({ report }) => toast(`<span class="id">${esc(report.asset_id)}</span> · ${esc(report.summary)}`),
  }, $('live'));

  load().then(() => {
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus) setTimeout(() => focusNode(focus), 700);
  }).catch((err) => { $('loading').textContent = err.message; });
})();
