// Knowledge graph, drawn exactly the way Site Memory draws it (src/pages/KnowledgeGraph.tsx): one
// column per layer (sites → machines → components → episodes → signatures → fix cards → patterns
// → parts), curved edges coloured by kind, hover to trace a branch, click to inspect. Fed by
// /api/graph/memory, which builds Site Memory's node and edge shapes from Cat Track's records.
// Labels go through t() like every other screen; node labels and edge types are shown as stored.
(function () {
  const { api, esc, icon, t } = CT;

  const LAYER_ORDER = ['site', 'machine', 'component', 'episode', 'signature', 'fix_card', 'cluster', 'part'];
  const LAYER_NAME = { site: 'Sites', machine: 'Machines', component: 'Components', episode: 'Episodes', signature: 'Signatures', fix_card: 'Fix cards', cluster: 'Patterns', part: 'Parts' };
  const layerLabel = (type) => t(LAYER_NAME[type] || type);
  // Site Memory's dark-mode classes, as colours: [fill, stroke, text, legend swatch].
  const NODE_CLS = {
    site: ['#e7e5e4', '#a8a29e', '#0c0a09', '#292524'],
    machine: ['#082f49', '#0369a1', '#7dd3fc', '#e0f2fe'],
    component: ['#022c22', '#047857', '#6ee7b7', '#d1fae5'],
    episode: ['#451a03', '#b45309', '#fcd34d', '#fef3c7'],
    signature: ['#2e1065', '#6d28d9', '#c4b5fd', '#ede9fe'],
    fix_card: ['#042f2e', '#0f766e', '#5eead4', '#ccfbf1'],
    cluster: ['#450a0a', '#b91c1c', '#fca5a5', '#fee2e2'],
    part: ['#292524', '#57534e', '#d6d3d1', '#f5f5f4'],
  };
  const EVENT_EDGES = new Set(['HAD', 'MATCHES', 'ADDRESSED', 'USED', 'FOLLOWED_BY']);
  const KNOWLEDGE_EDGES = new Set(['FIX_FOR', 'EVIDENCED_BY', 'GROUPS', 'AFFECTS']);
  const edgeColor = (type) => (EVENT_EDGES.has(type) ? '#fbbf24' : KNOWLEDGE_EDGES.has(type) ? '#a78bfa' : '#44403c');
  const STRUCTURAL = new Set(['site', 'machine', 'component']);
  const TOGGLE_TYPES = ['episode', 'signature', 'fix_card', 'cluster', 'part'];
  const NODE_W = 188, NODE_H = 30, COL_GAP = 96, ROW_GAP = 14, PAD = 44, MAX_NODES = 420;
  const short = (s, n = 30) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const timeAgo = (ts) => {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return t('just now');
    if (mins < 60) return t('{n}m ago', { n: mins });
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return t('{n}h ago', { n: hrs });
    return t('{n}d ago', { n: Math.round(hrs / 24) });
  };
  const LUCIDE = {
    network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
    zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  };
  const lucide = (name, cls = '') => `<svg class="lc ${cls}" viewBox="0 0 24 24" aria-hidden="true">${LUCIDE[name]}</svg>`;

  const state = { graph: null, site: 'all', types: { episode: true, signature: true, fix_card: true, cluster: true, part: false }, search: '', zoom: 0.75, selectedId: null, hoverId: null, layout: null, stale: true, loading: false };
  let root = null;
  const $ = (sel) => root.querySelector(sel);

  function mount(el) {
    root = el;
    root.innerHTML = `
      <div class="kg">
        <div class="kg-top">
          <div>
            <h1 class="kg-title">${t('Knowledge graph')}</h1>
            <p class="kg-sub">${t('Every voice note, alarm, and repair filed against the machine it happened to — then normalized into signatures, fix cards, and cross-site patterns. Click a node to inspect it.')}</p>
          </div>
          <span class="kg-count">${lucide('network')}<span id="kgCount">${t('no data')}</span></span>
        </div>
        <div class="kg-card kg-controls">
          <select class="kg-select" id="kgSite" aria-label="${esc(t('Site'))}"><option value="all">${t('All sites')}</option></select>
          <div class="kg-chips" id="kgChips"></div>
          <label class="kg-search">${icon('search', 'kg-search-ic')}<input id="kgSearch" placeholder="${esc(t('Search nodes…'))}" aria-label="${esc(t('Search nodes'))}"><button type="button" id="kgClear" class="hidden" aria-label="${esc(t('Clear search'))}">${icon('x')}</button></label>
          <div class="kg-zoom"><button type="button" id="kgOut" title="${esc(t('Zoom out'))}" aria-label="${esc(t('Zoom out'))}">${lucide('zoomOut')}</button><span id="kgPct">75%</span><button type="button" id="kgIn" title="${esc(t('Zoom in'))}" aria-label="${esc(t('Zoom in'))}">${lucide('zoomIn')}</button></div>
        </div>
        <p class="kg-dropped hidden" id="kgDropped"></p>
        <div class="kg-grid">
          <div class="kg-card kg-canvas"><div class="kg-scroll" id="kgScroll"><div class="kg-empty">${t('Loading the memory graph…')}</div></div></div>
          <aside class="kg-aside">
            <div id="kgInspector"></div>
            <div class="kg-card kg-pad" id="kgLegend"></div>
          </aside>
        </div>
      </div>`;
    $('#kgSite').onchange = () => { state.site = $('#kgSite').value; render(); };
    $('#kgChips').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; state.types[b.dataset.t] = !state.types[b.dataset.t]; render(); });
    $('#kgSearch').addEventListener('input', () => { state.search = $('#kgSearch').value; $('#kgClear').classList.toggle('hidden', !state.search); render(); });
    $('#kgClear').onclick = () => { state.search = ''; $('#kgSearch').value = ''; $('#kgClear').classList.add('hidden'); render(); };
    $('#kgOut').onclick = () => { state.zoom = Math.max(0.4, +(state.zoom - 0.15).toFixed(2)); applyZoom(); };
    $('#kgIn').onclick = () => { state.zoom = Math.min(1.5, +(state.zoom + 0.15).toFixed(2)); applyZoom(); };
    renderLegend();
    renderInspector();
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    try {
      state.graph = await api('/api/graph/memory');
      state.stale = false;
      const seen = new Map();
      for (const n of state.graph.nodes) if (n.type === 'site' && !seen.has(String(n.props?.siteId ?? n.id))) seen.set(String(n.props?.siteId ?? n.id), n.label);
      $('#kgSite').innerHTML = `<option value="all">${t('All sites')}</option>${[...seen].map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}`;
      $('#kgSite').value = seen.has(state.site) ? state.site : 'all';
      if (!seen.has(state.site)) state.site = 'all';
      if (state.selectedId && !state.graph.nodes.some((n) => n.id === state.selectedId)) state.selectedId = null;
      render();
    } catch (err) {
      $('#kgScroll').innerHTML = `<div class="kg-empty">${t('Couldn’t load the memory graph: {error}', { error: esc(err.message) })}</div>`;
    } finally { state.loading = false; }
  }

  // Same steps as Site Memory: scope to the site's structural branch, walk outward up to three hops
  // into the enabled layers, cap at 420 nodes (oldest episodes go first), one column per layer.
  function computeLayout() {
    const nodes = state.graph?.nodes || [];
    const edges = state.graph?.edges || [];
    if (!nodes.length) return null;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const enabled = new Set(Object.entries(state.types).filter(([, on]) => on).map(([type]) => type));
    const adj = new Map();
    for (const e of edges) {
      if (!byId.has(e.sourceId) || !byId.has(e.targetId)) continue;
      (adj.get(e.sourceId) || adj.set(e.sourceId, []).get(e.sourceId)).push(e);
      (adj.get(e.targetId) || adj.set(e.targetId, []).get(e.targetId)).push(e);
    }
    const kept = new Set();
    for (const n of nodes) {
      if (!STRUCTURAL.has(n.type)) continue;
      if (state.site !== 'all' && String(n.props?.siteId ?? '') !== state.site) continue;
      kept.add(n.id);
    }
    let frontier = [...kept];
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next = [];
      for (const id of frontier) {
        for (const e of adj.get(id) || []) {
          const other = e.sourceId === id ? e.targetId : e.sourceId;
          if (kept.has(other)) continue;
          const type = byId.get(other).type;
          if (STRUCTURAL.has(type) || enabled.has(type)) { kept.add(other); next.push(other); }
        }
      }
      frontier = next;
    }
    let dropped = 0;
    let keptNodes = nodes.filter((n) => kept.has(n.id));
    if (keptNodes.length > MAX_NODES) {
      const eps = keptNodes.filter((n) => n.type === 'episode').sort((a, b) => Number(b.props?.occurredAt ?? 0) - Number(a.props?.occurredAt ?? 0));
      const keep = new Set(eps.slice(0, Math.max(0, MAX_NODES - (keptNodes.length - eps.length))).map((n) => n.id));
      const before = keptNodes.length;
      keptNodes = keptNodes.filter((n) => n.type !== 'episode' || keep.has(n.id));
      dropped = before - keptNodes.length;
    }
    const keptIds = new Set(keptNodes.map((n) => n.id));
    const pos = new Map();
    let maxRows = 1;
    LAYER_ORDER.forEach((type, li) => {
      const col = keptNodes.filter((n) => n.type === type);
      const sorted = type === 'episode' ? col.sort((a, b) => Number(b.props?.occurredAt ?? 0) - Number(a.props?.occurredAt ?? 0)) : col.sort((a, b) => a.label.localeCompare(b.label));
      maxRows = Math.max(maxRows, sorted.length);
      sorted.forEach((n, i) => pos.set(n.id, { x: PAD + NODE_W / 2 + li * (NODE_W + COL_GAP), y: PAD + NODE_H / 2 + i * (NODE_H + ROW_GAP) }));
    });
    const width = PAD * 2 + LAYER_ORDER.length * (NODE_W + COL_GAP) - COL_GAP;
    const height = Math.max(420, PAD * 2 + maxRows * (NODE_H + ROW_GAP) - ROW_GAP);
    const renderEdges = [];
    for (const e of edges) {
      if (!keptIds.has(e.sourceId) || !keptIds.has(e.targetId) || e.sourceId === e.targetId) continue;
      const a = pos.get(e.sourceId); const b = pos.get(e.targetId);
      if (!a || !b) continue;
      const dx = Math.max(46, Math.abs(b.x - a.x) * 0.45);
      renderEdges.push({ s: e.sourceId, t: e.targetId, type: e.edgeType, d: `M ${a.x + NODE_W / 2} ${a.y} C ${a.x + NODE_W / 2 + dx} ${a.y}, ${b.x - NODE_W / 2 - dx} ${b.y}, ${b.x - NODE_W / 2} ${b.y}` });
    }
    const renderNodes = keptNodes.filter((n) => pos.has(n.id)).map((n) => ({ ...n, ...pos.get(n.id), degraded: Boolean(n.props?.superseded) || n.props?.status === 'retired' }));
    const counts = new Map();
    for (const n of renderNodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
    return { renderNodes, renderEdges, width, height, dropped, counts, keptEpisodes: counts.get('episode') || 0, byId, index: new Map(renderNodes.map((n) => [n.id, n])) };
  }

  function render() {
    if (!root) return;
    const L = state.layout = computeLayout();
    $('#kgCount').textContent = L ? t('{nodes} nodes · {edges} edges', { nodes: L.renderNodes.length, edges: L.renderEdges.length }) : t('no data');
    $('#kgChips').innerHTML = TOGGLE_TYPES.map((type) => `<button type="button" data-t="${type}" class="kg-chip ${state.types[type] ? 'on' : ''}" aria-pressed="${state.types[type] ? 'true' : 'false'}"><span class="kg-dot" style="background:${NODE_CLS[type][3]}"></span>${esc(layerLabel(type))}${L?.counts.get(type) ? `<span class="kg-n">${L.counts.get(type)}</span>` : ''}</button>`).join('');
    const dropped = $('#kgDropped');
    dropped.classList.toggle('hidden', !(L && L.dropped > 0));
    if (L && L.dropped > 0) dropped.textContent = t('Showing the {kept} most recent episodes — {dropped} older ones hidden. Filter to one site or turn off episodes to see everything.', { kept: L.keptEpisodes, dropped: L.dropped });
    if (!L) { $('#kgScroll').innerHTML = `<div class="kg-empty">${t('No graph data yet — report a voice note or run the simulator from the dashboard first.')}</div>`; renderInspector(); return; }
    const svgEdges = L.renderEdges.map((e, i) => `<path data-i="${i}" d="${e.d}" fill="none" stroke="${edgeColor(e.type)}" stroke-width="1"/>`).join('');
    const svgNodes = L.renderNodes.map((n) => {
      const [fill, stroke, text] = NODE_CLS[n.type] || NODE_CLS.part;
      return `<g class="kg-node" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})"><title>${esc(n.label)}</title>
        <rect class="kg-box" x="${-NODE_W / 2}" y="${-NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1"${n.degraded ? ' stroke-dasharray="4 3"' : ''}/>
        <rect class="kg-sel" x="${-NODE_W / 2 - 3}" y="${-NODE_H / 2 - 3}" width="${NODE_W + 6}" height="${NODE_H + 6}" rx="12" fill="none" stroke="#f59e0b" stroke-width="2" visibility="hidden"/>
        <text text-anchor="middle" dominant-baseline="central" fill="${text}" font-size="11" font-weight="500">${esc(short(n.label))}</text></g>`;
    }).join('');
    const headers = LAYER_ORDER.map((type, li) => `<text x="${PAD + li * (NODE_W + COL_GAP)}" y="${PAD - 18}" class="kg-col">${esc(layerLabel(type).toLocaleUpperCase(CT.locale))}</text>`).join('');
    $('#kgScroll').innerHTML = `<svg id="kgSvg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width * state.zoom}" height="${L.height * state.zoom}"><g>${svgEdges}</g><g>${svgNodes}</g>${headers}</svg>`;
    const svg = $('#kgSvg');
    svg.addEventListener('click', (ev) => {
      const g = ev.target.closest('.kg-node');
      state.selectedId = g ? (g.dataset.id === state.selectedId ? null : g.dataset.id) : null;
      applyFocus(); renderInspector();
    });
    svg.addEventListener('mouseover', (ev) => { const g = ev.target.closest('.kg-node'); const id = g ? g.dataset.id : null; if (id !== state.hoverId) { state.hoverId = id; applyFocus(); } });
    svg.addEventListener('mouseleave', () => { if (state.hoverId) { state.hoverId = null; applyFocus(); } });
    applyFocus();
    renderInspector();
  }

  // Hover or selection traces a branch: its edges brighten, everything else fades; search fades non-matches.
  function applyFocus() {
    const L = state.layout; if (!L || !$('#kgSvg')) return;
    const focus = state.hoverId ?? state.selectedId;
    const q = state.search.trim().toLowerCase();
    const matches = (n) => !q || n.label.toLowerCase().includes(q);
    const nbrs = new Set();
    const paths = $('#kgSvg').querySelectorAll('path[data-i]');
    L.renderEdges.forEach((e, i) => {
      const hl = focus != null && (e.s === focus || e.t === focus);
      if (hl) nbrs.add(e.s === focus ? e.t : e.s);
      let op = focus ? (hl ? 0.9 : 0.05) : 0.5;
      if (q && !(matches(L.byId.get(e.s)) || matches(L.byId.get(e.t)))) op = Math.min(op, 0.12);
      paths[i].setAttribute('opacity', op);
      paths[i].setAttribute('stroke-width', hl ? 2 : 1);
    });
    for (const g of $('#kgSvg').querySelectorAll('.kg-node')) {
      const n = L.index.get(g.dataset.id);
      if (!n) continue;
      const dim = focus ? n.id !== focus && !nbrs.has(n.id) : false;
      const faded = (q && !matches(n)) || n.degraded;
      g.setAttribute('opacity', dim ? 0.14 : faded ? 0.5 : 1);
      g.querySelector('.kg-box').setAttribute('stroke-width', n.id === state.selectedId ? 2 : nbrs.has(n.id) ? 1.5 : 1);
      g.querySelector('.kg-sel').setAttribute('visibility', n.id === state.selectedId ? 'visible' : 'hidden');
    }
  }
  function applyZoom() {
    $('#kgPct').textContent = `${Math.round(state.zoom * 100)}%`;
    const svg = $('#kgSvg'); const L = state.layout;
    if (svg && L) { svg.setAttribute('width', L.width * state.zoom); svg.setAttribute('height', L.height * state.zoom); }
  }

  function renderInspector() {
    const box = $('#kgInspector');
    const L = state.layout;
    const sel = L?.renderNodes.find((n) => n.id === state.selectedId) || null;
    if (!sel) {
      box.innerHTML = `<div class="kg-card kg-pad kg-dashed"><p class="kg-h">${t('Node inspector')}</p><p class="kg-muted">${t('Click any node to see its details and everything it connects to. Hover to trace a branch.')}</p></div>`;
      return;
    }
    const p = sel.props || {};
    const siteName = (id) => (state.graph.nodes.find((n) => n.type === 'site' && String(n.props?.siteId) === String(id))?.label) || t('another site');
    const rows = [];
    if (p.siteAlias) rows.push([t('Site'), p.siteAlias]); else if (p.siteId) rows.push([t('Site'), siteName(p.siteId)]);
    if (p.occurredAt) rows.push([t('When'), timeAgo(Number(p.occurredAt))]);
    if (p.unitNumber) rows.push([t('Unit'), p.unitNumber]);
    if (p.serialNumber) rows.push([t('Serial'), p.serialNumber]);
    if (p.partNumber) rows.push([t('Part no.'), p.partNumber]);
    if (p.installedAt) rows.push([t('Installed'), timeAgo(Number(p.installedAt))]);
    if (p.removedAt) rows.push([t('Removed'), timeAgo(Number(p.removedAt))]);
    if (p.status) rows.push([t('Status'), t(String(p.status).replace(/_/g, ' '))]);
    if (p.extractionStatus) rows.push([t('Extraction'), t(p.extractionStatus)]);
    if (p.codes?.length) rows.push([t('Fault code'), p.codes.join(', ')]);
    if (p.summary) rows.push([t('Summary'), p.summary]);
    if (p.superseded) rows.push([t('Superseded'), t('yes — deletion correction')]);
    const connected = [];
    for (const e of state.graph.edges) {
      if (e.sourceId === sel.id && L.renderNodes.some((n) => n.id === e.targetId)) connected.push({ type: e.edgeType, id: e.targetId, label: short(L.byId.get(e.targetId)?.label ?? e.targetId, 34) });
      if (e.targetId === sel.id && L.renderNodes.some((n) => n.id === e.sourceId)) connected.push({ type: e.edgeType, id: e.sourceId, label: short(L.byId.get(e.sourceId)?.label ?? e.sourceId, 34) });
    }
    const color = (NODE_CLS[sel.type] || NODE_CLS.part)[2];
    box.innerHTML = `<div class="kg-card kg-pad">
      <div class="kg-ihead"><div><span class="kg-badge" style="color:${color};border-color:${color}4d;background:${color}1a">${esc(layerLabel(sel.type))}</span><h2 class="kg-ititle">${esc(sel.label)}</h2></div><button type="button" class="kg-x" id="kgClose" aria-label="${esc(t('Close'))}">${icon('x')}</button></div>
      <dl class="kg-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${p.reportId ? `<a class="kg-open" href="/reports?q=${encodeURIComponent(String(p.summary || '').slice(0, 40))}">${t('Open this report in the log')}</a>` : ''}
      ${connected.length ? `<div class="kg-conn"><p class="kg-label">${t('Connected ({n})', { n: connected.length })}</p><ul>${connected.map((c) => `<li><button type="button" data-go="${esc(c.id)}"><span class="kg-et">${esc(c.type)}</span><span class="kg-cl">${esc(c.label)}</span></button></li>`).join('')}</ul></div>` : ''}
    </div>`;
    $('#kgClose').onclick = () => { state.selectedId = null; applyFocus(); renderInspector(); };
    box.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { state.selectedId = b.dataset.go; applyFocus(); renderInspector(); });
  }
  function renderLegend() {
    $('#kgLegend').innerHTML = `<p class="kg-label">${t('Legend')}</p>
      <div class="kg-legend">${LAYER_ORDER.map((type) => `<span><i style="background:${NODE_CLS[type][3]}"></i>${esc(layerLabel(type))}</span>`).join('')}</div>
      <div class="kg-lines">
        <p><span style="background:#44403c"></span> ${t('structure — hosts / contains / installed on')}</p>
        <p><span style="background:#fbbf24"></span> ${t('events — had / matches / used / followed by')}</p>
        <p><span style="background:#a78bfa"></span> ${t('knowledge — fix for / evidenced by / groups')}</p>
      </div>
      <p class="kg-note">${t('Dashed outlines mark superseded episodes and retired fix cards. Reading left to right is the memory pipeline: event → signature → fix.')}</p>`;
  }

  window.KGraph = {
    mount,
    /** Show the view; loads (or reloads, if the record changed) the graph. */
    show() { if (state.stale || !state.graph) load(); },
    /** The record changed: reload now if visible, otherwise next time it's shown. */
    invalidate(visible) { state.stale = true; if (visible) load(); },
  };
})();
