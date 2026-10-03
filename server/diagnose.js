// Diagnosis: follow a reported error through the knowledge graph to the component behind it, the
// pattern it belongs to, and a solution. Solutions come from the record first (a CAT quick fix, a
// field fix with a track record, a service document); only when the record has none does the AI
// reason one out, and it says so. Sentences are written in the report's language (English is the
// key, see i18n.js); part, problem and code names stay canonical so every screen can translate them.
import { q, parseJson, nowIso } from './db.js';
import { nodeId } from './graph.js';
import { decodeFaultCode, codeStats } from './faultcodes.js';
import { rankFixes } from './memory.js';
import { searchDocs } from './docs.js';
import { llmEnabled, llmInfo, structured, describeLlmError } from './llm.js';
import { translator, langName } from './i18n.js';

const DAY = 86400000;
const WARN = 'Warning / fault code';
// Lower-cases capitalised words (Pérdida → pérdida) and keeps acronyms (DPF, DEF, NOx).
const lowerWords = (s) => String(s).replace(/(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?![\p{L}\p{N}])/gu, (w) => w.toLowerCase());
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`);
const firstSymptom = (ex) => (ex.symptoms || []).find((s) => s !== WARN) || (ex.symptoms || [])[0] || null;
const live = (r) => !parseJson(r.extraction, {}).retracted; // withdrawn reports don't make a pattern

/** Count phrases in the report's language: "1 report" / "3 reports". */
const counter = (tt) => ({
  reports: (n) => (n === 1 ? tt('1 report') : tt('{n} reports', { n })),
  earlier: (n) => (n === 1 ? tt('1 earlier report') : tt('{n} earlier reports', { n })),
  machines: (n) => (n === 1 ? tt('1 machine') : tt('{n} machines', { n })),
  modelMachines: (n, model) => (n === 1 ? tt('1 {model} machine', { model }) : tt('{n} {model} machines', { n, model })),
  sites: (n) => (n === 1 ? tt('1 site') : tt('{n} sites', { n })),
  times: (n) => (n === 1 ? tt('once') : tt('{n} times', { n })),
});

/** Which component the error points at, and why we think so. */
const GENERIC_PARTS = new Set(['Engine', 'Hydraulic system', 'Electrical system']);
function findComponent(ex, codes, symptom, asset, tt, low, n) {
  const named = ex.components?.[0] || null;
  const fromTable = codes.find((c) => c.component?.part);
  // A specific code beats a vague part name ("the engine" with a DPF pressure code is the DPF).
  if (fromTable && (!named || (GENERIC_PARTS.has(named) && fromTable.component.part !== named))) {
    const vars = { code: fromTable.code, what: tt.lang === 'hi' ? fromTable.component.label : lowerWords(fromTable.component.label), named: named ? low(named) : '' };
    return { name: fromTable.component.part, why: named ? tt('Fault code {code} reports on the {what} (the report said {named}).', vars) : tt('Fault code {code} reports on the {what}.', vars) };
  }
  if (named) return { name: named, why: tt('Named in the report.') };
  for (const c of codes) {
    const hit = q.get(`SELECT n.label, e.weight FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ? AND e.type = 'INDICATES' ORDER BY e.weight DESC LIMIT 1`, nodeId('code', c.code));
    if (hit) return { name: hit.label, why: tt('{code} has pointed to the {part} in {reports}.', { code: c.code, part: low(hit.label), reports: n.earlier(hit.weight) }) };
  }
  if (symptom) {
    const onModel = q.get(`SELECT n.label, e.weight FROM edges e JOIN nodes n ON n.id = e.src
        WHERE e.dst = ? AND e.type = 'SHOWS' AND e.src IN (SELECT dst FROM edges WHERE src = ? AND type = 'HAS_COMPONENT') ORDER BY e.weight DESC LIMIT 1`, nodeId('symptom', symptom), nodeId('model', asset.model));
    if (onModel) return { name: onModel.label, why: tt('On {model} machines, {problem} has come from the {part} most often ({reports}).', { model: asset.model, problem: low(symptom), part: low(onModel.label), reports: n.reports(onModel.weight) }) };
    const fleet = q.get(`SELECT n.label, e.weight FROM edges e JOIN nodes n ON n.id = e.src WHERE e.dst = ? AND e.type = 'SHOWS' ORDER BY e.weight DESC LIMIT 1`, nodeId('symptom', symptom));
    if (fleet) return { name: fleet.label, why: tt('Across the fleet, {problem} most often comes from the {part} ({reports}).', { problem: low(symptom), part: low(fleet.label), reports: n.reports(fleet.weight) }) };
  }
  return null;
}

/** Has this happened before: on this machine, on this model, as a CAT Engineering case, in certain conditions? */
function findPattern(component, symptom, asset, codes, tt, low, n) {
  const since90 = new Date(Date.now() - 90 * DAY).toISOString();
  const since180 = new Date(Date.now() - 180 * DAY).toISOString();
  const has = (r) => {
    const e = parseJson(r.extraction, {});
    return !e.retracted && (component ? (e.components || []).includes(component) : true) && (symptom && !component ? (e.symptoms || []).includes(symptom) : true);
  };
  const onMachine = q.all('SELECT id, extraction FROM reports WHERE asset_id = ? AND created_at >= ?', asset.id, since90).filter(has);
  const onModel = q.all(`SELECT r.id, r.asset_id, r.site_id, r.extraction FROM reports r JOIN assets a ON a.id = r.asset_id WHERE a.model = ? AND r.created_at >= ? AND r.category <> 'maintenance'`, asset.model, since180).filter(has);
  const machines = new Set(onModel.map((r) => r.asset_id)).size;
  const sites = new Set(onModel.map((r) => r.site_id)).size;
  const engCase = component ? q.get('SELECT * FROM eng_cases WHERE case_key = ?', `${asset.model}|${component}`) : null;
  const caseMachines = engCase ? q.get('SELECT COUNT(DISTINCT r.asset_id) AS n FROM case_reports cr JOIN reports r ON r.id = cr.report_id WHERE cr.case_id = ?', engCase.id).n : 0;
  const cond = symptom ? q.get(`SELECT n.label, e.weight FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ? AND e.type = 'CORRELATES_WITH' AND e.weight >= 2 ORDER BY e.weight DESC LIMIT 1`, nodeId('symptom', symptom)) : null;
  const codeSeen = codes[0] ? codeStats(codes[0].code) : null;

  const what = component && symptom ? tt('{part} {problem}', { part: tt.lang === 'en' ? tt.v(component) : low(component), problem: low(symptom) }) : component ? tt.v(component) : symptom ? low(symptom) : tt('this problem');
  let label; let kind;
  if (engCase && engCase.occurrences >= 2 && engCase.status !== 'closed') { kind = 'case'; label = tt('CAT Engineering case #{id}: {reports} on {machines} ({priority}).', { id: engCase.id, reports: n.reports(engCase.occurrences), machines: n.modelMachines(caseMachines, asset.model), priority: engCase.priority }); }
  else if (machines >= 2) { kind = 'fleet'; label = tt('Fleet pattern: {reports} of {what} on {machines} across {sites} in 6 months.', { reports: n.reports(onModel.length), what, machines: n.modelMachines(machines, asset.model), sites: n.sites(sites) }); }
  else if (onMachine.length >= 2) { kind = 'machine'; label = tt('Recurring: {reports} of {what} on {id} in 90 days.', { reports: n.reports(onMachine.length), what, id: asset.id }); }
  else { kind = 'first'; label = tt('First report of {what} on {model} in 6 months. No pattern yet.', { what, model: asset.model }); }
  const detail = [];
  if (onMachine.length >= 2 && kind !== 'machine') detail.push(tt('{reports} on {id} itself in 90 days.', { reports: n.reports(onMachine.length), id: asset.id }));
  if (cond) detail.push(tt('Most common condition: {condition} ({reports}).', { condition: low(cond.label), reports: n.reports(cond.weight) }));
  if (codeSeen && codeSeen.reports > 1) detail.push(tt('{code} has come up {times} on {machines}.', { code: codes[0].code, times: n.times(codeSeen.reports), machines: n.machines(codeSeen.machines) }));
  if (engCase?.quick_fix) detail.push(tt('CAT has issued a quick fix for it.'));
  return {
    label, kind, detail, known: kind !== 'first',
    caseId: engCase?.id || null, casePriority: engCase?.priority || null, caseStatus: engCase?.status || null,
    machineReports: onMachine.length, modelReports: onModel.length, machines, sites, engCase,
  };
}

// When nothing is on record and the AI is off: the first checks a technician would make.
const CHECKLIST = {
  Overheating: ['Reduce load and idle for 3–5 minutes, then shut down. Never open a hot radiator cap.', 'Check coolant level when cool; look for leaks at hoses, radiator and water pump.', 'Blow out the radiator and charge-air cores; check the fan and belt.', 'If it repeats, have a technician test the thermostat and pull the fault codes with Cat ET.'],
  Leak: ['Lower implements and shut down; pressurised oil can inject through skin.', 'Find the source: clean the area, run briefly, and look for the first wet spot.', 'Check fittings and clamps for tightness, and hoses for chafing or cracks.', 'Replace the damaged hose or seal; top up and check the level before restarting.'],
  'Abnormal noise': ['Stop and note when the noise happens (load, turning, speed).', 'Check lubrication and fluid levels for the area.', 'Look for loose, worn or broken parts and debris.', 'Have a technician inspect before full duty.'],
  Vibration: ['Reduce speed and load.', 'Check for loose bolts, mounts and damaged parts.', 'Check tire or track condition and balance.', 'Have a technician inspect before full duty.'],
  'Loss of power': ['Check for active fault codes and derate messages.', 'Check the air filter restriction indicator and fuel filters.', 'Look for boost leaks at the turbo and intake piping.', 'Have a technician pull the codes with Cat ET.'],
  'Engine derate': ['Note the derate message and active codes.', 'Check coolant temperature, DEF level and air filter.', 'Avoid heavy load until the cause is found.', 'Have a technician pull the codes with Cat ET.'],
  'No-start': ['Check battery voltage and connections.', 'Check fuel level and the fuel shut-off.', 'Check for active codes and the starter lockout.', 'Call a technician if it still won’t crank.'],
  [WARN]: ['Note the exact code and when it appeared.', 'Check the related fluid levels and gauges.', 'Keep to light duty until it is understood.', 'Have a technician read the codes with Cat ET.'],
  Wear: ['Measure the wear against the service limits.', 'Plan a replacement before it reaches the limit.', 'Check the parts around it for knock-on wear.'],
  'Crack / damage': ['Stop using the damaged part under load.', 'Mark the ends of the crack and photograph it.', 'Have it inspected for weld repair or replacement before returning to production.'],
};
const GENERIC = ['Stop if anything looks unsafe and keep people clear.', 'Check the fluid levels and gauges related to the problem.', 'Pull any active fault codes with Cat ET.', 'Have a technician inspect before returning to full duty.'];

const AI_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['likely_cause', 'solution_title', 'steps', 'confidence'],
  properties: {
    likely_cause: { type: 'string', description: 'the most probable root cause, one sentence' },
    solution_title: { type: 'string', description: 'the fix in a few words, e.g. "Replace the coolant temperature sensor"' },
    steps: { type: 'array', items: { type: 'string' }, description: '3-5 ordered, imperative troubleshooting/repair steps, safety first' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};
const AI_SYSTEM = `You are a senior Caterpillar field service engineer. A crew has reported a problem. The record has no proven fix for it, so reason it through from the evidence given: the decoded fault codes, the component, the machine's history, related fixes and documents. Give the most probable cause and a practical solution a technician can carry out, in order, safety first. Use only the facts given plus sound Cat service practice. Stick to standard, safe field procedures: inspections, measurements, Cat ET tests and service-manual procedures. Never suggest improvised methods, bypassing or disabling sensors and safety systems, or external heat sources. Check before replacing parts, and do not invent part numbers or specifications; say "per the service manual" instead. Answer as JSON matching the schema.`;
const languageRule = (lang) => (lang === 'en' ? ''
  : `\nThe crew speaks ${langName(lang)}: write likely_cause, solution_title and every step in ${langName(lang)}${lang === 'hi' ? ' (Devanagari script)' : ''}. Keep fault codes, model numbers, "Cat ET" and part numbers exactly as written.`);

async function reasonSolution({ text, asset, codes, component, pattern, symptom, fixes, docs, history, timeoutMs, lang }) {
  const lines = [
    `Machine: ${asset.id}, ${asset.model} (${asset.family}), ${Math.round(asset.smu_hours || 0)} hours, site ${asset.site_name || asset.site_id}${asset.site_climate ? `, climate ${asset.site_climate}` : ''}.`,
    `Report: """${text}"""`,
    codes.length ? `Fault codes: ${codes.map((c) => `${c.code} = ${c.summary}`).join(' | ')}` : 'Fault codes: none reported.',
    `Problem: ${symptom || 'not stated'}. Component: ${component ? `${component.name} (${component.why})` : 'unknown'}.`,
    `Pattern: ${pattern.label} ${pattern.detail.join(' ')}`,
    fixes.length ? `Fixes tried on this model for this part (not yet proven): ${fixes.map((f) => `"${f.title}" worked ${f.success} of ${f.success + f.fail}`).join('; ')}` : 'No fixes on record for this part on this model.',
    history.length ? `Recent reports on this machine: ${history.map((h) => `${h.created_at.slice(0, 10)} ${h.summary}`).join(' | ')}` : '',
    docs.length ? `Documents: ${docs.map((d) => `[${d.ref}] ${d.title}: ${d.excerpt}`).join(' | ')}` : '',
  ].filter(Boolean).join('\n');
  const started = Date.now();
  const out = await structured({ system: AI_SYSTEM + languageRule(lang), text: lines, schema: AI_SCHEMA, maxTokens: 1500, timeoutMs });
  // The screens number the steps, so drop the model's own "1." / "-" and trim long ones at a word.
  const steps = (Array.isArray(out.steps) ? out.steps : []).filter((s) => typeof s === 'string' && s.trim())
    .map((s) => cut(s.trim().replace(/^(?:\d{1,2}[.):]|[-•*])\s+/, ''), 320)).filter(Boolean).slice(0, 6);
  if (!steps.length || !String(out.solution_title || '').trim()) throw new Error('The AI returned no usable steps');
  return {
    source: 'ai', title: cut(String(out.solution_title).trim(), 140), cause: cut(String(out.likely_cause || '').trim(), 300), steps,
    confidence: ['low', 'medium', 'high'].includes(out.confidence) ? out.confidence : 'low',
    model: llmInfo().label, seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

/** A fix's written steps as a list: one per line, per "→", or per sentence. */
const splitSteps = (text, re = /\n|\s+→\s+|(?<=\.)\s+(?=[A-Z])/) => String(text || '').split(re)
  .map((s) => s.trim()).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 6);

/** Does this extraction name anything to follow (a fault code, a problem, a part)? */
export const diagnosable = (ex) => Boolean((ex?.fault_codes || []).length || (ex?.symptoms || []).length || (ex?.components || []).length);

/**
 * Diagnose one report. `ex` is its extraction; `asset` comes from getAsset(); `lang` is the report's
 * language. Returns null when there is nothing to diagnose (no code, problem or part named).
 */
export async function diagnose({ ex, asset, text = '', reportId = null, lang = 'en' }, { ai = true, timeoutMs = 10_000 } = {}) {
  if (!diagnosable(ex)) return null;
  const tt = translator(lang);
  const low = (name) => (tt.lang === 'hi' ? tt.v(name) : lowerWords(tt.v(name)));
  const n = counter(tt);
  const codes = (ex.fault_codes || []).map((c) => decodeFaultCode(c, tt.lang));
  const symptom = firstSymptom(ex);
  const hazard = ex.safety_hazards?.[0] || null;

  const error = codes[0]
    ? { kind: 'code', label: codes[0].code, detail: codes[0].summary }
    : symptom ? { kind: 'symptom', label: symptom, detail: hazard ? tt('Also flagged: {hazard}.', { hazard: low(hazard) }) : '' }
      : { kind: 'part', label: ex.components[0], detail: '' };
  const component = findComponent(ex, codes, symptom, asset, tt, low, n);
  const pattern = findPattern(component?.name || null, symptom, asset, codes, tt, low, n);

  let solution = null;
  const engCase = pattern.engCase;
  if (engCase?.quick_fix) {
    const eng = q.get(`SELECT steps FROM fixes WHERE case_id = ? AND source = 'engineering' ORDER BY id DESC LIMIT 1`, engCase.id);
    const steps = splitSteps(eng?.steps);
    solution = { source: 'cat', title: engCase.quick_fix, steps: steps.length ? steps : [engCase.quick_fix], caseId: engCase.id };
  }
  const fixes = component ? rankFixes(asset.model, [component.name], symptom ? [symptom] : [], 4) : [];
  if (!solution) {
    const proven = fixes.find((f) => f.success >= 1 && f.confidence >= 50);
    if (proven) {
      const steps = splitSteps(proven.steps, /\n|;\s+|\s+→\s+/);
      solution = { source: 'fix', title: proven.title, steps: steps.length ? steps : [proven.title], fixId: proven.id, confidence: proven.confidence, record: tt('Worked {n} of {total} times on {model} machines.', { n: proven.success, total: proven.success + proven.fail, model: asset.model }) };
    }
  }
  const docs = searchDocs([codes[0]?.code, component?.name, symptom].filter(Boolean).join(' '), { model: asset.model, limit: 2, excerpt: 420 });
  if (!solution) {
    const bulletin = docs.find((d) => /bulletin|manual/i.test(d.doc_type));
    if (bulletin) solution = { source: 'document', title: bulletin.title, steps: [bulletin.excerpt], docId: bulletin.doc_id, ref: bulletin.ref };
  }
  if (!solution && ai && llmEnabled()) {
    try {
      const history = q.all(`SELECT created_at, summary, extraction FROM reports WHERE asset_id = ? ${reportId ? 'AND id <> ?' : ''} ORDER BY created_at DESC LIMIT 8`, ...(reportId ? [asset.id, reportId] : [asset.id])).filter(live).slice(0, 5);
      solution = await reasonSolution({ text, asset, codes, component, pattern, symptom, fixes, docs, history, timeoutMs, lang: tt.lang });
    } catch (err) {
      console.warn('[diagnose] AI reasoning failed, using the checklist:', describeLlmError(err));
    }
  }
  if (!solution) {
    const what = symptom && symptom !== WARN ? low(symptom) : component ? low(component.name) : symptom ? low(symptom) : tt('this problem');
    solution = { source: 'checklist', title: tt('Standard checks for {what}', { what }), steps: (CHECKLIST[symptom] || GENERIC).map((s) => tt(s)) };
  }

  const { engCase: _drop, ...patternOut } = pattern;
  return { at: nowIso(), lang: tt.lang, error, codes, component, pattern: patternOut, solution, docs: docs.map((d) => ({ docId: d.doc_id, ref: d.ref, title: d.title })) };
}
