// Ingestion pipeline: field report → structured observation → knowledge graph → memory recall →
// site alerts + action items → CAT Engineering escalation → live push to every panel.
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, nowIso, UPLOAD_DIR, parseJson, alertRow } from './db.js';
import { upsertNode, upsertEdge, nodeId, newDelta, slug } from './graph.js';
import { extractObservation } from './extract.js';
import { componentSystem, sevRank } from './vocab.js';
import {
  getAsset, recentReports, recallSimilar, rankFixes, fixesForModel, recomputeAssetState, normalizeAssetId, hydrateReport,
} from './memory.js';
import { publish } from './events.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const ROLE_LABEL = { operator: 'Operators', technician: 'Technicians', site_manager: 'Site manager', safety_officer: 'Safety officer', fleet_manager: 'Fleet manager' };

function savePhoto(dataUrl) {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const file = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[3], 'base64'));
  return { url: `/uploads/${file}`, mediaType: m[1], data: m[3] };
}

function casePriority(c, severity, distinctAssets) {
  if (severity === 'critical' || c.occurrences >= 4 || (c.occurrences >= 3 && distinctAssets >= 2)) return 'P1';
  if (severity === 'high' || c.occurrences >= 2) return 'P2';
  return 'P3';
}

/** People on the job site who receive an alert (site staff for the given roles + roaming staff). */
export function recipientsFor(siteId, roles) {
  if (!roles.length) return [];
  const marks = roles.map(() => '?').join(',');
  return q.all(`SELECT id, name, role FROM people WHERE (site_id = ? OR site_id IS NULL) AND role IN (${marks}) ORDER BY role, name`, siteId, ...roles);
}

/**
 * Ingest one observation from the field.
 * @param {object} input { assetId, personId, text, source, photo (data URL), createdAt, forceRules, silent, overrides }
 */
export async function ingestReport(input) {
  const text = String(input.text || '').trim();
  if (!text) throw new HttpError(400, 'Report text is empty — dictate or type what you observed.');
  if (text.length > 4000) throw new HttpError(400, 'Report is too long (max 4000 characters).');
  const assetId = normalizeAssetId(input.assetId);
  const asset = getAsset(assetId);
  if (!asset) throw new HttpError(404, `Unknown unit ID "${input.assetId}". Scan the machine's QR tag or check the ID.`);
  const person = input.personId ? q.get('SELECT * FROM people WHERE id = ?', input.personId) : null;
  const createdAt = input.createdAt || nowIso();
  const source = input.source || 'voice';
  const photo = input.photo ? savePhoto(input.photo) : null;

  // 1. Perceive: structured extraction, informed by this machine's memory.
  const history = recentReports(asset.id, 8);
  const ex = await extractObservation(text, {
    assetId: asset.id, asset, siteName: asset.site_name, siteClimate: asset.site_climate,
    reporter: person?.name, reporterRole: person?.role, source, history,
    fixes: fixesForModel(asset.model), photo: photo ? { mediaType: photo.mediaType, data: photo.data } : null,
    forceRules: input.forceRules,
  });
  if (input.overrides) Object.assign(ex, input.overrides);

  // 2. Recall: what does the fleet already know about this?
  const similar = recallSimilar(ex, asset, { limit: 5 });
  const fixes = (ex.is_mechanical_failure || ex.category === 'mechanical') ? rankFixes(asset.model, ex.components, ex.symptoms) : [];

  const delta = newDelta();
  const result = tx(() => {
    // 3. Remember: persist the report and weave it into the knowledge graph.
    const ins = q.run(
      `INSERT INTO reports (asset_id, site_id, person_id, source, raw_text, photo_path, category, severity, summary, extraction, ai_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      asset.id, asset.site_id, person?.id, source, text, photo?.url, ex.category, ex.severity, ex.summary,
      { ...ex, similar: similar.map((s) => ({ id: s.id, score: s.score, reasons: s.reasons })) }, ex.ai_mode, createdAt);
    const reportId = Number(ins.lastInsertRowid);

    const rNode = upsertNode('report', String(reportId), ex.summary.slice(0, 48), { reportId, severity: ex.severity, category: ex.category, asset: asset.id, source, created_at: createdAt }, delta, createdAt);
    const aNode = upsertNode('asset', asset.id, asset.id, { model: asset.model, family: asset.family, status: asset.status }, delta, createdAt);
    const mNode = upsertNode('model', asset.model, asset.model, { family: asset.family }, delta, createdAt);
    const sNode = upsertNode('site', asset.site_id, asset.site_name, { location: asset.site_location }, delta, createdAt);
    upsertEdge(rNode, aNode, 'ABOUT', delta, createdAt);
    upsertEdge(aNode, mNode, 'INSTANCE_OF', delta, createdAt);
    upsertEdge(aNode, sNode, 'LOCATED_AT', delta, createdAt);
    if (person) {
      const pNode = upsertNode('person', person.id, person.name, { role: person.role }, delta, createdAt);
      upsertEdge(rNode, pNode, 'REPORTED_BY', delta, createdAt);
    }
    const compNodes = ex.components.map((c) => {
      const id = upsertNode('component', c, c, { system: componentSystem(c) }, delta, createdAt);
      upsertEdge(rNode, id, 'AFFECTS', delta, createdAt);
      upsertEdge(mNode, id, 'HAS_COMPONENT', delta, createdAt);
      return id;
    });
    const symNodes = ex.symptoms.map((s) => {
      const id = upsertNode('symptom', s, s, {}, delta, createdAt);
      upsertEdge(rNode, id, 'EXHIBITS', delta, createdAt);
      return id;
    });
    for (const cId of compNodes.slice(0, 2)) for (const sId of symNodes) upsertEdge(cId, sId, 'SHOWS', delta, createdAt);
    for (const code of ex.fault_codes) {
      const id = upsertNode('code', code, code, {}, delta, createdAt);
      upsertEdge(rNode, id, 'RAISED', delta, createdAt);
      for (const cId of compNodes.slice(0, 1)) upsertEdge(id, cId, 'INDICATES', delta, createdAt);
    }
    for (const cond of ex.conditions) {
      const id = upsertNode('condition', cond, cond, {}, delta, createdAt);
      upsertEdge(rNode, id, 'UNDER', delta, createdAt);
      for (const sId of symNodes) upsertEdge(sId, id, 'CORRELATES_WITH', delta, createdAt);
    }
    for (const hz of ex.safety_hazards) {
      const id = upsertNode('hazard', hz, hz, {}, delta, createdAt);
      upsertEdge(rNode, id, 'FLAGS', delta, createdAt);
      upsertEdge(id, sNode, 'OBSERVED_AT', delta, createdAt);
    }
    for (const s of similar.filter((x) => x.score >= 7).slice(0, 3)) upsertEdge(rNode, nodeId('report', String(s.id)), 'SIMILAR_TO', delta, createdAt);
    for (const fact of ex.memory_facts || []) {
      q.run(`INSERT INTO memory_facts (asset_id, fact, kind, source_report_id, fact_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(asset_id, fact_key) DO UPDATE SET fact = excluded.fact, updated_at = excluded.updated_at`,
        asset.id, fact, ex.category === 'maintenance' ? 'repair' : 'note', reportId, slug(fact).slice(0, 80), createdAt, createdAt);
    }

    // 4. Escalate mechanical failures to CAT Engineering (fleet-wide case keyed by model + part + symptom).
    let engCase = null;
    const primaryC = ex.components[0];
    const primaryS = ex.symptoms.find((s) => s !== 'Warning / fault code') || ex.symptoms[0] || 'Fault';
    if (ex.needs_engineering && primaryC) {
      const key = `${asset.model}|${primaryC}`;
      let c = q.get('SELECT * FROM eng_cases WHERE case_key = ?', key);
      if (!c) {
        const r = q.run(`INSERT INTO eng_cases (case_key, model, component, symptom, title, status, priority, occurrences, first_seen, last_seen, updated_at)
                         VALUES (?, ?, ?, ?, ?, 'new', 'P3', 0, ?, ?, ?)`, key, asset.model, primaryC, primaryS, `${asset.model} — ${primaryC}: ${primaryS.toLowerCase()}`, createdAt, createdAt, createdAt);
        c = q.get('SELECT * FROM eng_cases WHERE id = ?', Number(r.lastInsertRowid));
      }
      q.run('INSERT OR IGNORE INTO case_reports (case_id, report_id) VALUES (?, ?)', c.id, reportId);
      const occurrences = q.get('SELECT COUNT(*) AS n FROM case_reports WHERE case_id = ?', c.id).n;
      const distinctAssets = q.get('SELECT COUNT(DISTINCT r.asset_id) AS n FROM case_reports cr JOIN reports r ON r.id = cr.report_id WHERE cr.case_id = ?', c.id).n;
      const maxSev = q.get(`SELECT MAX(CASE r.severity WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END) AS m FROM case_reports cr JOIN reports r ON r.id = cr.report_id WHERE cr.case_id = ?`, c.id).m;
      const priority = casePriority({ occurrences }, ['low', 'medium', 'high', 'critical'][maxSev], distinctAssets);
      const reopened = c.status === 'closed';
      q.run(`UPDATE eng_cases SET occurrences = ?, last_seen = ?, priority = ?, status = ?, updated_at = ? WHERE id = ?`,
        occurrences, createdAt > (c.last_seen || '') ? createdAt : c.last_seen, priority, reopened ? 'new' : c.status, createdAt, c.id);
      engCase = { ...q.get('SELECT * FROM eng_cases WHERE id = ?', c.id), distinctAssets, reopened };
      const caseNode = upsertNode('case', String(c.id), `Case #${c.id}: ${primaryC}`, { caseId: c.id, priority, status: engCase.status, occurrences }, delta, createdAt);
      upsertEdge(rNode, caseNode, 'PART_OF', delta, createdAt);
      upsertEdge(caseNode, mNode, 'CONCERNS', delta, createdAt);
      if (compNodes[0]) upsertEdge(caseNode, compNodes[0], 'CONCERNS', delta, createdAt);
    }

    // 5. Alert the people on site and hand them concrete action items.
    let alert = null; const actions = []; let recipients = [];
    const alertWorthy = sevRank(ex.severity) >= 1 || ex.category === 'safety';
    if (alertWorthy && ex.category !== 'maintenance') {
      const kind = ex.category === 'safety' ? 'safety' : (ex.is_mechanical_failure || ex.category === 'mechanical') ? 'mechanical' : 'operational';
      const roles = new Set(['site_manager']);
      if (kind === 'mechanical') { roles.add('technician'); if (sevRank(ex.severity) >= 2) roles.add('operator'); }
      if (kind === 'safety') { roles.add('operator'); roles.add('safety_officer'); roles.add('technician'); }
      if (sevRank(ex.severity) >= 3) roles.add('fleet_manager');
      for (const a of ex.action_items || []) if (a.assignee_role) roles.add(a.assignee_role);
      const audience = [...roles];
      recipients = recipientsFor(asset.site_id, audience).filter((p) => p.id !== person?.id);
      const body = [ex.operator_guidance, fixes[0] ? `Memory: "${fixes[0].title}" fixed this ${fixes[0].success}× before (${fixes[0].confidence}% success).` : '', engCase ? `Escalated to CAT Engineering — case #${engCase.id} (${engCase.occurrences} fleet reports).` : '']
        .filter(Boolean).join(' ');
      const ar = q.run(`INSERT INTO alerts (site_id, asset_id, report_id, case_id, kind, severity, title, body, audience, status, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        asset.site_id, asset.id, reportId, engCase?.id, kind, ex.severity, `${asset.id} · ${ex.summary}`, body, audience, createdAt, createdAt);
      alert = alertRow(q.get('SELECT * FROM alerts WHERE id = ?', Number(ar.lastInsertRowid)));
      const items = [...(ex.action_items || [])];
      if (fixes[0] && fixes[0].confidence >= 50) items.push({ assignee_role: 'technician', text: `Try known fix: ${fixes[0].title} (${fixes[0].confidence}% field success)` });
      for (const it of items.slice(0, 7)) {
        const r = q.run(`INSERT INTO action_items (alert_id, site_id, asset_id, text, assignee_role, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
          alert.id, asset.site_id, asset.id, it.text, it.assignee_role || 'site_manager', createdAt);
        actions.push(q.get('SELECT * FROM action_items WHERE id = ?', Number(r.lastInsertRowid)));
      }
    }
    return { reportId, alert, actions, engCase, recipients };
  });

  const assetState = recomputeAssetState(asset.id);
  const report = hydrateReport(q.get(`SELECT r.*, p.name AS person_name, p.role AS person_role FROM reports r LEFT JOIN people p ON p.id = r.person_id WHERE r.id = ?`, result.reportId));
  const graphDelta = {
    nodes: delta.nodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i),
    edges: delta.edges.filter((e, i, arr) => arr.findIndex((f) => f.id === e.id) === i),
  };
  const routed = [];
  if (result.alert) {
    const byRole = {};
    for (const p of result.recipients) (byRole[p.role] ||= []).push(p.name);
    routed.push({ to: `${asset.site_name} crew`, detail: Object.entries(byRole).map(([r, names]) => `${ROLE_LABEL[r] || r}: ${names.join(', ')}`).join(' · '), count: result.recipients.length });
  }
  if (result.engCase) routed.push({ to: 'CAT Engineering', detail: `Case #${result.engCase.id} · ${result.engCase.title} · ${result.engCase.occurrences} fleet report(s) · ${result.engCase.priority}`, count: 1 });

  const out = {
    report, extraction: ex, asset: { ...getAsset(asset.id), ...assetState }, alert: result.alert, actions: result.actions,
    engCase: result.engCase, similar, fixes, routed,
    graph: { newNodes: graphDelta.nodes.filter((n) => n.isNew).length, newEdges: graphDelta.edges.filter((e) => e.isNew).length, reinforced: graphDelta.edges.filter((e) => !e.isNew).length + graphDelta.nodes.filter((n) => !n.isNew).length },
  };

  if (!input.silent) {
    publish('report', { report, asset: out.asset });
    publish('graph', graphDelta);
    publish('asset', out.asset);
    if (result.alert) publish('alert', { alert: result.alert, actions: result.actions, recipients: result.recipients.length });
    if (result.engCase) publish('case', { case: result.engCase, reportId: result.reportId });
  }
  return out;
}

/** Engineering → field: publish a quick fix, remember it as a fix, and alert every site running that model. */
export function issueQuickFix(caseId, { title, steps, engineer }) {
  const c = q.get('SELECT * FROM eng_cases WHERE id = ?', caseId);
  if (!c) throw new HttpError(404, 'Case not found');
  if (!title || !String(title).trim()) throw new HttpError(400, 'Quick fix needs a title');
  const at = nowIso();
  const delta = newDelta();
  const out = tx(() => {
    const fr = q.run(`INSERT INTO fixes (model, component, symptom, title, steps, source, author, case_id, success, fail, created_at) VALUES (?, ?, ?, ?, ?, 'engineering', ?, ?, 0, 0, ?)`,
      c.model, c.component, c.symptom, String(title).trim(), steps || '', engineer || 'CAT Engineering', c.id, at);
    const fixId = Number(fr.lastInsertRowid);
    q.run(`UPDATE eng_cases SET status = 'quick_fix_issued', quick_fix = ?, engineer = COALESCE(?, engineer), updated_at = ? WHERE id = ?`, String(title).trim(), engineer, at, c.id);
    const fNode = upsertNode('fix', String(fixId), String(title).slice(0, 40), { fixId, source: 'engineering' }, delta, at);
    upsertEdge(fNode, nodeId('case', String(c.id)), 'RESOLVES', delta, at);
    upsertEdge(fNode, nodeId('model', c.model), 'APPLIES_TO', delta, at);
    upsertEdge(fNode, nodeId('component', c.component), 'REPAIRS', delta, at);
    // Alert every site that runs this model.
    const assets = q.all('SELECT id, site_id FROM assets WHERE model = ?', c.model);
    const sites = [...new Set(assets.map((a) => a.site_id))];
    const alerts = [];
    for (const siteId of sites) {
      const ar = q.run(`INSERT INTO alerts (site_id, asset_id, case_id, kind, severity, title, body, audience, status, created_at, updated_at)
                        VALUES (?, NULL, ?, 'bulletin', 'medium', ?, ?, ?, 'open', ?, ?)`,
        siteId, c.id, `CAT Engineering quick fix · ${c.model}: ${String(title).trim()}`, steps || '', ['technician', 'site_manager', 'operator'], at, at);
      const alert = alertRow(q.get('SELECT * FROM alerts WHERE id = ?', Number(ar.lastInsertRowid)));
      for (const a of assets.filter((x) => x.site_id === siteId)) {
        q.run(`INSERT INTO action_items (alert_id, site_id, asset_id, text, assignee_role, status, created_at) VALUES (?, ?, ?, ?, 'technician', 'open', ?)`,
          alert.id, siteId, a.id, `Apply CAT quick fix to ${a.id}: ${String(title).trim()}`, at);
      }
      alerts.push(alert);
    }
    return { fixId, alerts };
  });
  publish('graph', delta);
  publish('case', { case: q.get('SELECT * FROM eng_cases WHERE id = ?', c.id) });
  for (const a of out.alerts) publish('alert', { alert: a, actions: [], recipients: 0 });
  return { case: q.get('SELECT * FROM eng_cases WHERE id = ?', c.id), fixId: out.fixId, sitesNotified: out.alerts.length };
}

/** Field → memory: resolving an alert records the repair and (optionally) teaches a new fix. */
export async function resolveAlert(alertId, { personId, resolution, fixId, worked }) {
  const alert = q.get('SELECT * FROM alerts WHERE id = ?', alertId);
  if (!alert) throw new HttpError(404, 'Alert not found');
  const at = nowIso();
  const report = alert.report_id ? hydrateReport(q.get('SELECT * FROM reports WHERE id = ?', alert.report_id)) : null;
  const asset = alert.asset_id ? getAsset(alert.asset_id) : null;
  let learnedFixId = null;
  tx(() => {
    q.run(`UPDATE alerts SET status = 'resolved', ack_by = COALESCE(ack_by, ?), resolution = ?, updated_at = ? WHERE id = ?`, personId, resolution || null, at, alertId);
    q.run(`UPDATE action_items SET status = 'done', done_by = COALESCE(done_by, ?), done_at = COALESCE(done_at, ?) WHERE alert_id = ? AND status = 'open'`, personId, at, alertId);
    if (fixId) {
      q.run(`UPDATE fixes SET ${worked ? 'success = success + 1' : 'fail = fail + 1'} WHERE id = ?`, fixId);
      q.run('INSERT INTO fix_feedback (fix_id, asset_id, report_id, worked, person_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', fixId, alert.asset_id, alert.report_id, worked ? 1 : 0, personId, at);
    }
    // Learn a new field fix from the technician's words, unless they confirmed an existing fix worked.
    if (resolution && report && asset && report.extraction.components?.[0] && !(fixId && worked)) {
      const ex = report.extraction;
      const existing = q.get('SELECT id FROM fixes WHERE model = ? AND component = ? AND lower(title) = lower(?)', asset.model, ex.components[0], resolution.trim());
      if (existing) {
        q.run('UPDATE fixes SET success = success + 1 WHERE id = ?', existing.id);
        learnedFixId = existing.id;
      } else {
        const person = personId ? q.get('SELECT name FROM people WHERE id = ?', personId) : null;
        const r = q.run(`INSERT INTO fixes (model, component, symptom, title, steps, source, author, case_id, success, fail, created_at) VALUES (?, ?, ?, ?, '', 'field', ?, ?, 1, 0, ?)`,
          asset.model, ex.components[0], (ex.symptoms || []).find((s) => s !== 'Warning / fault code') || null, resolution.trim(), person?.name || 'Field technician', alert.case_id, at);
        learnedFixId = Number(r.lastInsertRowid);
      }
    }
  });
  let repairReport = null;
  if (resolution && asset) {
    repairReport = await ingestReport({
      assetId: asset.id, personId, source: 'repair', forceRules: true,
      text: `Repair completed: ${resolution.trim()}${report ? ` (resolves: ${report.summary})` : ''}`,
      overrides: { category: 'maintenance', severity: 'low', needs_engineering: false, is_mechanical_failure: false, action_items: [], memory_facts: [`Repaired: ${resolution.trim()}`] },
    });
    if (learnedFixId) {
      const delta = newDelta();
      const fNode = upsertNode('fix', String(learnedFixId), resolution.trim().slice(0, 40), { fixId: learnedFixId, source: 'field' }, delta, at);
      upsertEdge(nodeId('report', String(repairReport.report.id)), fNode, 'APPLIED', delta, at);
      if (report?.extraction.components?.[0]) upsertEdge(fNode, nodeId('component', report.extraction.components[0]), 'REPAIRS', delta, at);
      if (asset) upsertEdge(fNode, nodeId('model', asset.model), 'APPLIES_TO', delta, at);
      publish('graph', delta);
    }
  }
  const state = asset ? recomputeAssetState(asset.id) : null;
  const updated = alertRow(q.get('SELECT * FROM alerts WHERE id = ?', alertId));
  publish('alert-updated', { alert: updated });
  if (state) publish('asset', { ...getAsset(asset.id), ...state });
  return { alert: updated, learnedFixId, repairReportId: repairReport?.report.id || null };
}

export function parseAudience(a) { return parseJson(a.audience, []); }
