// Knowledge graph explorer: the fleet's memory as a living map that grows in real time.
(function () {
  const { api, esc, ago, sevPill, toast, connectStream, topbar, icon } = CT;
  const $ = (id) => document.getElementById(id);
  document.getElementById('top').innerHTML = topbar('/graph');

  const TYPES = {
    site: { label: 'Job sites', color: '#ffcd11', shape: 'square', size: 18 },
    asset: { label: 'Machines', color: '#ffcd11', shape: 'dot', size: 15 },
    model: { label: 'Models', color: '#f1f2f3', shape: 'diamond', size: 13 },
    case: { label: 'Engineering cases', color: '#e879f9', shape: 'star', size: 15 },
    component: { label: 'Components', color: '#ff8a1f', shape: 'dot', size: 10 },
    symptom: { label: 'Symptoms', color: '#ff4d4f', shape: 'triangle', size: 10 },
    code: { label: 'Fault codes', color: '#b48cff', shape: 'box', size: 12 },
    condition: { label: 'Conditions', color: '#5aa9ff', shape: 'hexagon', size: 10 },
    hazard: { label: 'Safety hazards', color: '#ff6b6b', shape: 'triangleDown', size: 11 },
    fix: { label: 'Fixes', color: '#2dd4bf', shape: 'square', size: 8 },
    person: { label: 'People', color: '#3ecf8e', shape: 'dot', size: 7 },
    report: { label: 'Reports & events', color: '#7b838c', shape: 'dot', size: 4 },
  };
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
      font: { color: n.type === 'code' ? '#1a0f2e' : '#d9dde1', size: n.type === 'asset' || n.type === 'site' ? 15 : 12, face: 'Barlow', strokeWidth: n.type === 'code' ? 0 : 3, strokeColor: '#0c0d0f' },
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
    $('legend').innerHTML = Object.entries(TYPES).map(([k, t]) => `<label><input type="checkbox" data-t="${k}" ${visible[k] ? 'checked' : ''}><span class="sw" style="background:${t.color}"></span>${t.label}<span class="n">${counts[k] || 0}</span></label>`).join('');
    $('legend').querySelectorAll('[data-t]').forEach((c) => c.onchange = () => { visible[c.dataset.t] = c.checked; nodeView.refresh(); });
  }

  async function load() {
    const g = await api('/api/graph');
    nodes.add(g.nodes.map(styleNode));
    edges.add(g.edges.map(styleEdge));
    recount();
    if (!g.nodes.length) $('loading').textContent = 'No memory yet — submit a report from the operator panel.';
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
      <div class="row spread"><span class="pill" style="background:${t.color}22;color:${t.color};border-color:${t.color}66">${esc(t.label.replace(/s$/, ''))}</span><button class="btn sm ghost" id="closeDrawer">${icon('x')}</button></div>
      <h2 style="font-size:24px;margin-top:8px">${esc(r ? r.summary : d.node.label)}</h2>
      <div class="muted" style="font-size:13px;margin-top:2px">seen ${d.node.weight}× · first ${ago(d.node.created_at)}</div>
      ${d.node.type === 'asset' ? `<a class="btn sm primary" style="margin-top:10px" href="/asset?id=${encodeURIComponent(d.node.label)}">Open machine memory ${icon('arrow')}</a>` : ''}
      ${d.node.type === 'case' ? `<a class="btn sm primary" style="margin-top:10px" href="/engineering?case=${d.node.props.caseId}">Open in CAT Engineering ${icon('arrow')}</a>` : ''}
      ${r ? `<div class="card" style="margin-top:12px"><div class="row wrap" style="gap:6px">${sevPill(r.severity)}<span class="pill sev-info">${esc(r.category)}</span><span class="faint" style="font-size:12px">${esc(r.asset_id)} · ${ago(r.created_at)}</span></div><div style="margin-top:8px">"${esc(r.raw_text)}"</div><div class="faint" style="font-size:12px;margin-top:6px">${esc(r.person_name || r.source)}</div></div>` : ''}
      <div style="margin-top:14px">${Object.entries(groups).map(([type, ls]) => `<div style="margin-bottom:8px">${ls.slice(0, 14).map((l) => `<div class="lk" data-go="${esc(l.other.id)}"><span class="et">${l.direction === 'in' ? '← ' : ''}${esc(type.replace(/_/g, ' '))}</span><span class="sw" style="width:9px;height:9px;border-radius:3px;background:${(TYPES[l.other.type] || TYPES.report).color}"></span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.other.label)}</span>${l.weight > 1 ? `<span class="faint" style="font-size:12px">×${l.weight}</span>` : ''}</div>`).join('')}${ls.length > 14 ? `<div class="faint" style="font-size:12px;padding-left:8px">+${ls.length - 14} more</div>` : ''}</div>`).join('')}</div>`;
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
    $('growth').innerHTML = `${icon('graph')} Memory grew: <b>+${added}</b> nodes, <b>+${linked}</b> links, <b>${reinforced}</b> reinforced`;
    $('growth').classList.remove('hidden');
    clearTimeout(growthTimer); growthTimer = setTimeout(() => $('growth').classList.add('hidden'), 6000);
  }

  connectStream({
    graph: applyDelta,
    report: ({ report }) => toast(`${icon('mic')} New memory: <b>${esc(report.asset_id)}</b> · ${esc(report.summary)}`),
  }, $('live'));

  load().then(() => {
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus) setTimeout(() => focusNode(focus), 700);
  }).catch((err) => { $('loading').textContent = err.message; });
})();
