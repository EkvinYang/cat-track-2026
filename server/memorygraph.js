// The knowledge graph the way Site Memory models it: an asset tree (site → machine → component),
// episodes (every report), normalized fault signatures, fix cards, pattern clusters and parts,
// joined by Site Memory's edge types. Same node and edge shapes as Site Memory's ops.buildGraph,
// built from Cat Track's records so the two products can be read side by side.
import { q, parseJson } from './db.js';

const CLASS = { 'Hydraulic Excavator': 'excavator', 'Off-Highway Truck': 'truck', 'Track-Type Dozer': 'dozer', 'Wheel Loader': 'loader', 'Motor Grader': 'grader' };
const machineClass = (family) => CLASS[family] || String(family || 'machine').toLowerCase();
const KIND = { voice: 'voice_note', text: 'voice_note', telemetry: 'sensor_alarm', repair: 'repair', inspection: 'inspection' };
const RECURRENCE_MS = 30 * 86400000;

export function memoryGraph() {
  const sites = q.all('SELECT id, name FROM sites ORDER BY id');
  const assets = q.all('SELECT id, model, family, serial, site_id, commissioned_at FROM assets ORDER BY id');
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const reports = q.all('SELECT id, asset_id, site_id, source, category, severity, summary, raw_text, extraction, created_at FROM reports ORDER BY created_at').map((r) => ({ ...r, ex: parseJson(r.extraction, {}) }));
  const nodes = []; const edges = [];
  const seen = new Set();
  const node = (n) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } return n.id; };
  const edge = (sourceType, sourceId, edgeType, targetType, targetId, occurredAt) => edges.push({ sourceType, sourceId, edgeType, targetType, targetId, ...(occurredAt ? { occurredAt } : {}) });
  const ms = (iso) => (iso ? new Date(iso).getTime() : undefined);

  // Asset tree: site → machine (HOSTS) → component (CONTAINS), component INSTALLED_ON machine.
  for (const s of sites) node({ id: `site:${s.id}`, type: 'site', label: s.name, props: { siteId: s.id } });
  for (const a of assets) {
    node({ id: `machine:${a.id}`, type: 'machine', label: `${a.id} · ${a.model}`, props: { siteId: a.site_id, unitNumber: a.id, serialNumber: a.serial, installedAt: ms(a.commissioned_at) } });
    edge('site', `site:${a.site_id}`, 'HOSTS', 'machine', `machine:${a.id}`);
  }
  const componentId = (assetId, comp) => `component:${assetId}:${comp}`;
  for (const r of reports) {
    const a = assetById.get(r.asset_id); if (!a) continue;
    for (const comp of (r.ex.components || []).slice(0, 2)) {
      const id = componentId(a.id, comp);
      if (seen.has(id)) continue;
      node({ id, type: 'component', label: comp, props: { siteId: a.site_id, machineId: a.id, installedAt: ms(r.created_at) } });
      edge('machine', `machine:${a.id}`, 'CONTAINS', 'component', id);
      edge('component', id, 'INSTALLED_ON', 'machine', `machine:${a.id}`, ms(r.created_at));
    }
  }

  // Fault signatures: machine class + component + fault code, the unit Site Memory matches on.
  const sigKey = (cls, comp, code) => `${cls}|${comp}|${code || ''}`;
  const signatures = new Map(); // key → { id, cls, comp, code, symptoms: Map }
  const signatureFor = (a, comp, code) => {
    const cls = machineClass(a.family);
    const key = sigKey(cls, comp, code);
    if (!signatures.has(key)) signatures.set(key, { id: `signature:${key}`, cls, comp, code, symptoms: new Map() });
    return signatures.get(key);
  };
  const lastSigOn = new Map(); // `${asset}|${comp}` → signature id (what a later repair addresses)

  // Episodes: every report. HAD from the most specific asset; MATCHES / ADDRESSED a signature.
  const episodesBySig = new Map(); // sigId → [{ id, asset, at, repair }]
  for (const r of reports) {
    const a = assetById.get(r.asset_id); if (!a) continue;
    const id = `episode:${r.id}`;
    const kind = r.ex.retracted ? 'correction' : r.category === 'maintenance' && r.source !== 'inspection' ? 'repair' : KIND[r.source] || 'voice_note';
    const extraction = r.ex.ai_status === 'failed' ? 'failed' : r.ex.ai_status === 'pending' ? 'pending' : 'ok';
    const comp = r.ex.components?.[0] || null;
    node({ id, type: 'episode', label: `${kind}: ${String(r.raw_text || '').slice(0, 60)}`, props: { occurredAt: ms(r.created_at), siteId: r.site_id, superseded: Boolean(r.ex.retracted), summary: String(r.raw_text || '').slice(0, 160), extractionStatus: extraction, reportId: r.id, codes: r.ex.fault_codes || [] } });
    edge(comp ? 'component' : 'machine', comp ? componentId(a.id, comp) : `machine:${a.id}`, 'HAD', 'episode', id, ms(r.created_at));
    if (!comp) continue;
    if (kind === 'repair') {
      const target = lastSigOn.get(`${a.id}|${comp}`) || signatureFor(a, comp, null).id;
      edge('episode', id, 'ADDRESSED', 'signature', target, ms(r.created_at));
      (episodesBySig.get(target) || episodesBySig.set(target, []).get(target)).push({ id, asset: a.id, at: ms(r.created_at), repair: true });
    } else if (kind !== 'correction') {
      const sig = signatureFor(a, comp, r.ex.fault_codes?.[0] || null);
      for (const s of r.ex.symptoms || []) sig.symptoms.set(s, (sig.symptoms.get(s) || 0) + 1);
      edge('episode', id, 'MATCHES', 'signature', sig.id, ms(r.created_at));
      lastSigOn.set(`${a.id}|${comp}`, sig.id);
      (episodesBySig.get(sig.id) || episodesBySig.set(sig.id, []).get(sig.id)).push({ id, asset: a.id, at: ms(r.created_at), repair: false });
    }
  }
  // FOLLOWED_BY: a repair, then the same fault back on the same machine within 30 days.
  for (const list of episodesBySig.values()) {
    for (const rp of list.filter((e) => e.repair)) {
      const back = list.find((e) => !e.repair && e.asset === rp.asset && e.at > rp.at && e.at - rp.at <= RECURRENCE_MS);
      if (back) edge('episode', rp.id, 'FOLLOWED_BY', 'episode', back.id);
    }
  }
  for (const s of signatures.values()) {
    const top = [...s.symptoms.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k.toLowerCase()).slice(0, 3);
    node({ id: s.id, type: 'signature', label: `${s.comp}${s.code ? ` · ${s.code}` : ''}`, props: { summary: top.length ? top.join(', ') : 'repairs only' } });
    const partId = `part:${s.cls}:${s.comp}`;
    node({ id: partId, type: 'part', label: `${s.comp} (${s.cls})` });
    edge('signature', s.id, 'AFFECTS', 'part', partId);
  }
  // The signature that stands for a class + component (the code-less one if it exists, else the busiest).
  const mainSig = (cls, comp) => {
    const own = signatures.get(sigKey(cls, comp, null));
    if (own) return own.id;
    const cands = [...signatures.values()].filter((s) => s.cls === cls && s.comp === comp);
    cands.sort((x, y) => (episodesBySig.get(y.id)?.length || 0) - (episodesBySig.get(x.id)?.length || 0));
    return cands[0]?.id || null;
  };
  const familyOfModel = new Map(assets.map((a) => [a.model, a.family]));

  // Fix cards: known fixes. FIX_FOR their signature, EVIDENCED_BY the repairs behind them.
  for (const f of q.all('SELECT * FROM fixes ORDER BY id')) {
    const fam = familyOfModel.get(f.model);
    const sig = fam && f.component ? mainSig(machineClass(fam), f.component) : null;
    const resolved = f.success + f.fail;
    const status = resolved >= 3 && f.fail / resolved > 0.5 ? 'needs_review' : 'active';
    node({ id: `fix_card:${f.id}`, type: 'fix_card', label: f.title, props: { status, summary: `held ${f.success} · recurred ${f.fail}` } });
    if (sig) edge('fix_card', `fix_card:${f.id}`, 'FIX_FOR', 'signature', sig);
    if (f.report_id && seen.has(`episode:${f.report_id}`)) edge('fix_card', `fix_card:${f.id}`, 'EVIDENCED_BY', 'episode', `episode:${f.report_id}`);
  }
  // Repairs that describe the fix (sharing two or more of its words) are its evidence, as in Site Memory.
  const words = (t) => new Set(String(t || '').toLowerCase().match(/[a-z]{4,}/g) || []);
  const repairText = new Map(reports.filter((r) => r.category === 'maintenance').map((r) => [`episode:${r.id}`, words(r.raw_text)]));
  for (const f of q.all('SELECT id, title, model, component, report_id FROM fixes')) {
    const fam = familyOfModel.get(f.model);
    const sig = fam && f.component ? mainSig(machineClass(fam), f.component) : null;
    if (!sig) continue;
    const fw = words(f.title);
    for (const ep of episodesBySig.get(sig) || []) {
      if (!ep.repair || ep.id === `episode:${f.report_id}`) continue;
      const rw = repairText.get(ep.id) || new Set();
      if ([...fw].filter((w) => rw.has(w)).length >= 2) edge('fix_card', `fix_card:${f.id}`, 'EVIDENCED_BY', 'episode', ep.id);
    }
  }
  for (const fb of q.all('SELECT DISTINCT fix_id, report_id FROM fix_feedback WHERE report_id IS NOT NULL')) {
    if (seen.has(`fix_card:${fb.fix_id}`) && seen.has(`episode:${fb.report_id}`)) edge('fix_card', `fix_card:${fb.fix_id}`, 'EVIDENCED_BY', 'episode', `episode:${fb.report_id}`);
  }

  // Pattern clusters: CAT Engineering cases. GROUPS their signature, CONTAINS_EVENT their reports.
  for (const c of q.all(`SELECT c.*, (SELECT COUNT(DISTINCT r.asset_id) FROM case_reports cr JOIN reports r ON r.id = cr.report_id WHERE cr.case_id = c.id) AS units FROM eng_cases c ORDER BY c.id`)) {
    const fam = familyOfModel.get(c.model);
    const sig = fam && c.component ? mainSig(machineClass(fam), c.component) : null;
    node({ id: `cluster:${c.id}`, type: 'cluster', label: `Pattern: ${c.component || 'unknown'} (${c.units} units)`, props: { status: c.status, summary: c.root_cause || c.quick_fix || c.title } });
    if (sig) edge('cluster', `cluster:${c.id}`, 'GROUPS', 'signature', sig);
    for (const m of q.all('SELECT report_id FROM case_reports WHERE case_id = ?', c.id)) {
      if (seen.has(`episode:${m.report_id}`)) edge('cluster', `cluster:${c.id}`, 'CONTAINS_EVENT', 'episode', `episode:${m.report_id}`);
    }
  }
  return { nodes, edges };
}
