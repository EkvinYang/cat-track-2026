// Turns raw field input (dictated voice notes, typed text, telemetry anomalies, photos) into a
// structured observation: components, symptoms, fault codes, conditions, hazards, severity,
// category, crew action items and operator guidance.
import {
  COMPONENTS, SYMPTOMS, CONDITIONS, HAZARDS, CATEGORIES, SEVERITIES, ROLES,
  matchAll, extractFaultCodes, canonical, normalizeCode, sevRank,
} from './vocab.js';
import { llmEnabled, llmInfo, structured, describeLlmError } from './llm.js';

const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const firstSentence = (t) => {
  const s = String(t).trim().replace(/\s+/g, ' ');
  const m = s.match(/^(.{12,160}?[.!?])(\s|$)/);
  const out = m ? m[1] : s.slice(0, 140);
  return out.length < s.length && !m ? out + '…' : out;
};

const COMPLETION_RE = /\b(completed|replaced|serviced|changed (the )?(oil|filters?)|pm ?\d*|greased|installed|repaired|fixed|swapped|rebuilt|resolved|tightened|adjusted)\b/;
const RECURRENCE_RE = /\b(still|again|keeps?|came back|returned|recurr)/;
const OPERATIONAL_RE = /fuel (delivery|truck)|schedul|delay|waiting|\bidle\b|crew|permit|survey|materials?|traffic|weather|haul road|access road|staging|loading area/;
const ROUTINE_RE = /\b(all good|no issues|no problems|looks good|normal|walk ?around|pre-?op|inspection complete|ok\b)/;
const CRITICAL_RE = /shut (it )?down|had to stop|stopped working|won'?t move|spraying|pouring|emergency|massive|gushing|on fire|smoking badly|seized/;
const MAJOR_RE = /\b(big|major|bad(ly)?|a lot|heavy|severe|serious|fast|steady stream)\b/;
const MINOR_RE = /\b(minor|slight(ly)?|small|little|light|seep|weep|a bit)\b/;

/** Offline rule engine: deterministic, instant, no network. */
export function ruleExtract(rawText, ctx = {}) {
  const text = String(rawText || '').toLowerCase();
  let components = matchAll(COMPONENTS, text);
  const symptoms = matchAll(SYMPTOMS, text);
  const conditions = matchAll(CONDITIONS, text);
  const hazardDefs = HAZARDS.filter((h) => h.re.test(text));
  const safety_hazards = hazardDefs.map((h) => h.name);
  const fault_codes = extractFaultCodes(rawText);

  // A generic "Hydraulic system" is redundant when a specific hydraulic part was named.
  const specificHyd = components.some((c) => ['Hydraulic hose', 'Boom cylinder', 'Stick cylinder', 'Hydraulic pump', 'Swing drive'].includes(c));
  if (specificHyd) components = components.filter((c) => c !== 'Hydraulic system');
  if (components.includes('Cooling system') || components.includes('Engine oil system') || components.includes('Turbocharger')) {
    components = components.filter((c) => c !== 'Engine');
  }
  if (!components.length && symptoms.includes('Overheating')) components.push(/hydraulic/.test(text) ? 'Hydraulic system' : 'Cooling system');
  // An engine that "runs hot" is a cooling-system problem unless another hot system was named.
  if (symptoms.includes('Overheating') && components.includes('Engine') && !components.some((c) => ['Cooling system', 'Hydraulic system', 'Transmission', 'Turbocharger'].includes(c))) {
    components = ['Cooling system', ...components.filter((c) => c !== 'Engine')];
  }
  if (!components.length && (symptoms.includes('Engine derate') || symptoms.includes('Smoke'))) components.push('Engine');
  if (!components.length && fault_codes.length) components.push('Engine');

  const isCompletion = COMPLETION_RE.test(text) && !RECURRENCE_RE.test(text);
  const problemSymptoms = symptoms.filter((s) => s !== 'Warning / fault code' || fault_codes.length || /warning|alarm|fault/.test(text));

  // Severity
  let severity = 'low';
  const hasCriticalHazard = hazardDefs.some((h) => h.critical);
  if (hasCriticalHazard || CRITICAL_RE.test(text) || (symptoms.includes('Smoke') && components.includes('Engine'))) severity = 'critical';
  else if (
    safety_hazards.length ||
    symptoms.some((s) => ['Overheating', 'No-start', 'Engine derate', 'Smoke', 'Low pressure', 'Fluid contamination'].includes(s)) ||
    (symptoms.includes('Leak') && (MAJOR_RE.test(text) || components.some((c) => /Hydraulic|cylinder|Brakes|Fuel/.test(c))) && !MINOR_RE.test(text)) ||
    (symptoms.includes('Crack / damage') && components.some((c) => /Frame|Boom|Stick|Brakes|Steering|Tires/.test(c))) ||
    components.includes('Brakes') || components.includes('Steering') ||
    fault_codes.length
  ) severity = 'high';
  else if (problemSymptoms.length) severity = 'medium';
  if (RECURRENCE_RE.test(text) && severity === 'medium') severity = 'high';
  if (isCompletion && severity !== 'critical') severity = 'low';
  if (ROUTINE_RE.test(text) && !problemSymptoms.length && !safety_hazards.length) severity = 'low';

  // Category
  let category = 'observation';
  const mechanicalSignal = problemSymptoms.length > 0 && components.length > 0;
  if (isCompletion) category = 'maintenance';
  else if (hasCriticalHazard || (safety_hazards.length && !mechanicalSignal)) category = 'safety';
  else if (mechanicalSignal || (components.length && severity !== 'low')) category = 'mechanical';
  else if (safety_hazards.length) category = 'safety';
  else if (OPERATIONAL_RE.test(text)) category = 'operational';

  const is_mechanical_failure = !isCompletion && components.length > 0 && problemSymptoms.length > 0;
  const WEAR_ITEMS = ['Ground engaging tools', 'Blade', 'Tires', 'Air intake & filter', 'Lights', 'Bucket & linkage'];
  const routineWear = problemSymptoms.every((s) => s === 'Wear') && components.every((c) => WEAR_ITEMS.includes(c));
  const needs_engineering = is_mechanical_failure && severity !== 'low' && !routineWear;

  const primaryC = components[0];
  const primaryS = problemSymptoms.find((s) => s !== 'Warning / fault code') || problemSymptoms[0];
  let summary;
  if (category === 'mechanical' && primaryC && primaryS) {
    summary = `${primaryS} — ${primaryC}${fault_codes.length ? ` (${fault_codes.join(', ')})` : ''}`;
  } else if (category === 'safety' && safety_hazards.length) {
    summary = `${safety_hazards[0]}: ${firstSentence(rawText)}`;
  } else {
    summary = firstSentence(rawText);
  }

  const asset = ctx.assetId || 'the machine';
  const actions = [];
  const add = (assignee_role, t) => actions.push({ assignee_role, text: t });
  if (category === 'mechanical' || is_mechanical_failure) {
    if (severity === 'critical') add('operator', `Stop operation, lower implements to the ground and tag out ${asset}`);
    else if (severity === 'high') add('operator', `Limit ${asset} to light duty until a technician inspects it`);
    add('technician', `Inspect ${primaryC || 'machine'} for ${String(primaryS || 'reported issue').toLowerCase()} on ${asset}`);
    if (symptoms.includes('Leak')) add('operator', 'Place spill containment under the machine; check fluid level before restart');
    if (symptoms.includes('Overheating')) add('operator', 'Idle 3–5 min to cool down, then shut off; check coolant level and blow out radiator/cooler cores');
    if (symptoms.includes('Abnormal noise') || symptoms.includes('Vibration')) add('technician', `Check ${primaryC || 'drivetrain'} for loose, worn or failing parts`);
    if (fault_codes.length || symptoms.includes('Warning / fault code')) add('technician', 'Pull the active/logged fault codes with Cat ET and attach to the work order');
    if (symptoms.includes('Crack / damage')) add('technician', 'Perform crack/weld inspection before the machine returns to production');
  }
  if (safety_hazards.length) {
    if (severity === 'critical') add('site_manager', 'Stop work in the affected area and account for all personnel');
    add('site_manager', 'Establish an exclusion zone / barricade around the hazard');
    if (safety_hazards.includes('Pedestrian interaction')) add('site_manager', 'Assign a dedicated spotter at this location');
    if (safety_hazards.includes('Utility strike risk')) add('site_manager', 'Call for a utility locate before any further digging');
    if (safety_hazards.includes('Ground instability')) add('site_manager', 'Keep machines back from the edge; request a geotechnical check');
    if (safety_hazards.includes('Injury')) add('safety_officer', 'Provide first aid and notify the site safety officer immediately');
    add('safety_officer', 'Document the hazard and brief the crew at the next toolbox talk');
  }
  if (category === 'operational') add('site_manager', `Review and schedule: ${firstSentence(rawText)}`);

  let operator_guidance = 'Thanks — logged to this machine\'s memory. No action needed right now.';
  if (severity === 'critical') operator_guidance = 'Stop safely now. Lower all implements, set the parking brake, shut down and move away from the hazard. Your site lead and technician have been alerted.';
  else if (symptoms.includes('Leak') && /Hydraulic|cylinder/.test(primaryC || '')) operator_guidance = 'Do not keep working with an active hydraulic leak — pressurised oil can cause injection injuries. Lower the boom, shut down and wait for the technician.';
  else if (symptoms.includes('Overheating')) operator_guidance = 'Reduce load and let the machine idle to cool before shutting down. Never open a hot radiator cap. A technician has been notified.';
  else if (severity === 'high') operator_guidance = 'Keep to light duty and watch the gauges. A technician has been notified and the site crew alerted.';
  else if (severity === 'medium') operator_guidance = 'Noted. Keep an eye on it this shift and report if it gets worse.';
  if (category === 'safety' && severity !== 'critical') operator_guidance = 'Stay clear of the hazard and keep others away. Your site manager has been alerted.';

  const memory_facts = [];
  if (isCompletion) memory_facts.push(`Service record: ${firstSentence(rawText)}`);

  const base = {
    summary, category, severity,
    components: uniq(components), symptoms: uniq(problemSymptoms), fault_codes: uniq(fault_codes),
    conditions: uniq(conditions), safety_hazards: uniq(safety_hazards),
    is_mechanical_failure, needs_engineering,
    action_items: actions, operator_guidance, likely_causes: [], memory_facts,
  };
  return { ...base, ...ruleIntent(text, rawText, base, isCompletion) };
}

export const INTENTS = ['new_issue', 'update_existing', 'resolved', 'request_advice', 'request_help', 'question', 'correction', 'delete_report', 'routine_log'];
const RESOLVED_RE = /\b(fixed|resolved|repaired|sorted( it)? out|took care of|working (again|fine|now)|back (in service|to normal|up and running|in operation)|good to go|problem solved|no longer (leaking|overheating|making)|all clear now)\b/;
const ADVICE_RE = /\b(advise|advice|what (should|do|can) (i|we) do|what now|how (do|should|can) (i|we)|should i|can i keep|is it safe|recommend|next steps?)\b/;
const HELP_RE = /\b(need|send|request(ing)?|get me|bring|call)\b.{0,30}\b(technician|mechanic|tech|parts?|fuel( truck)?|spotter|operator|help|someone|service truck|lowboy|tow)\b/;
const CORRECTION_RE = /\b(i meant|correction|ignore (my|the) (last|previous)|scratch that|(last|previous) (report|one) was wrong|wrong (machine|unit|part|report)|disregard|should have said)\b/;
// "Delete my last report", "remove the report about the hose", "scratch that": take reports off the record.
const DELETE_RE = /\b(delete|remove|erase|cancel|scrap|discard|wipe|get rid of|take (out|down)|throw (out|away)|withdraw)\b[^.?!]{0,60}\b(reports?|logs?|entr(y|ies)|notes?|messages?|records?|requests?|submissions?|last one|that one|previous one)\b|^(please )?(delete|erase|scrap|remove) (that|this|it)\b|^(never ?mind|scratch that|disregard (that|my last|the last)|forget (that|it|my last))\b/;
const DELETE_WORDS_RE = /\b(delete|remove|erase|cancel|scrap|discard|wipe|get rid|withdraw|ignore|disregard|never ?mind|scratch|forget|take (that|it) back|undo)\b/i;
const REPLACEMENT_RE = /\b(i meant|instead|should (have )?(said|been|be)|actually (it'?s|it was|the))\b/;
const UPDATE_RE = /\b(update|still|getting worse|worse now|follow[- ]?up|came back)\b/;
const QUESTION_RE = /\?\s*$|^(when|what|how|which|who|is|are|does|do|can|should|where|why)\b/;

/** Offline intent detection — what the person wants done, not just what they saw. */
function ruleIntent(lower, rawText, ex, isCompletion) {
  const hasProblem = ex.components.length > 0 || ex.symptoms.length > 0 || ex.safety_hazards.length > 0;
  const wants_advice = ADVICE_RE.test(lower);
  const help = lower.match(HELP_RE);
  let intent = 'new_issue';
  if (DELETE_RE.test(lower) && !REPLACEMENT_RE.test(lower)) intent = 'delete_report';
  else if (CORRECTION_RE.test(lower)) intent = hasProblem ? 'correction' : 'delete_report';
  else if ((RESOLVED_RE.test(lower) || isCompletion) && !/\b(still|again|not fixed|didn'?t (fix|work))\b/.test(lower)) intent = 'resolved';
  else if (help) intent = 'request_help';
  else if (wants_advice) intent = 'request_advice';
  else if (UPDATE_RE.test(lower) && hasProblem) intent = 'update_existing';
  else if (!hasProblem && QUESTION_RE.test(rawText.trim().toLowerCase())) intent = 'question';
  else if (!hasProblem && ex.severity === 'low') intent = 'routine_log';
  return {
    intent, wants_advice: wants_advice || intent === 'request_advice',
    references_alert_id: 0, references_report_id: 0, delete_report_ids: [],
    resolution: intent === 'resolved' ? firstSentence(rawText) : '',
    advice_steps: [],
    help_role: help ? (/fuel|spotter|operator/.test(help[0]) ? 'site_manager' : 'technician') : 'none',
    help_request: help ? firstSentence(rawText) : '',
  };
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'wants_advice', 'references_alert_id', 'references_report_id', 'delete_report_ids', 'resolution', 'advice_steps', 'help_role', 'help_request',
    'summary', 'category', 'severity', 'components', 'symptoms', 'fault_codes', 'conditions', 'safety_hazards',
    'is_mechanical_failure', 'needs_engineering', 'action_items', 'operator_guidance', 'likely_causes', 'memory_facts'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    wants_advice: { type: 'boolean' },
    references_alert_id: { type: 'integer', description: 'id of the OPEN ISSUE this note resolves or updates, else 0' },
    references_report_id: { type: 'integer', description: 'for a correction: id of the RECENT REPORT being corrected, else 0' },
    delete_report_ids: { type: 'array', items: { type: 'integer' }, description: 'for delete_report: ids of the RECENT REPORTS to delete, else empty' },
    resolution: { type: 'string', description: 'if resolved: what was done, in the reporter\'s own words (trim filler, never paraphrase); empty if they did not say' },
    advice_steps: { type: 'array', items: { type: 'string' }, description: '2-4 ordered, imperative next steps for the reporter' },
    help_role: { type: 'string', enum: [...ROLES, 'none'] },
    help_request: { type: 'string', description: 'what person, part or service was asked for, in the reporter\'s own words; else empty' },
    summary: { type: 'string', description: 'One-line headline, <= 90 chars, e.g. "Leak — Hydraulic hose at boom foot"' },
    category: { type: 'string', enum: CATEGORIES },
    severity: { type: 'string', enum: SEVERITIES },
    components: { type: 'array', items: { type: 'string' } },
    symptoms: { type: 'array', items: { type: 'string' } },
    fault_codes: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    safety_hazards: { type: 'array', items: { type: 'string' } },
    is_mechanical_failure: { type: 'boolean' },
    needs_engineering: { type: 'boolean' },
    action_items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['assignee_role', 'text'],
        properties: { assignee_role: { type: 'string', enum: ROLES }, text: { type: 'string' } },
      },
    },
    operator_guidance: { type: 'string' },
    likely_causes: { type: 'array', items: { type: 'string' } },
    memory_facts: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `You are the perception layer of Cat Track, a persistent memory system for Caterpillar machines and job sites.
Field crews dictate short, messy voice notes (speech-to-text errors are common). Work out what the person wants done, then turn the note into a structured observation.

Intent (what the person wants — pick one):
- new_issue: reports a problem that is not already among the OPEN ISSUES.
- update_existing: adds information about a problem already among the OPEN ISSUES (same part, "still", "worse") — set references_alert_id.
- resolved: says a problem was fixed or handled — set references_alert_id to the open issue it fixes (0 if unclear), resolution = what was done. Use category "maintenance", severity "low", no action_items, needs_engineering false.
- request_advice: asks what to do or how to proceed — set wants_advice and give advice_steps. If it also describes a problem, still extract the problem fully.
- request_help: asks for a person, part or service to be sent — set help_role and help_request.
- question: asks for information (service due, specs, history) without reporting a problem.
- correction: says an earlier report was wrong AND gives the right details — set references_report_id from RECENT REPORTS, and extract the corrected problem.
- delete_report: asks to delete, remove, cancel or ignore one or more earlier reports without giving replacement details ("delete my last report", "scratch that", "remove the report about the boom hose", "delete everything I sent today"). Set delete_report_ids from RECENT REPORTS: match the part, problem, author and time they describe; "my last report" = the newest one by this reporter. Leave it empty if you can't tell. Parts or symptoms they mention describe the report to delete, not a new problem: use category "observation", severity "low", no action_items, no advice_steps, needs_engineering false.
- routine_log: an inspection or routine service with nothing wrong.
Only use ids that appear in the lists provided. advice_steps: 2-4 short, ordered, imperative steps the reporter can take now, safety first, grounded in the history, known fixes and documents; give them whenever wants_advice is true or severity is medium or worse, otherwise an empty list.

Rules:
- Use these canonical names whenever they fit.
  Components: ${COMPONENTS.map((c) => c.name).join('; ')}.
  Symptoms: ${SYMPTOMS.map((s) => s.name).join('; ')}.
  Conditions: ${CONDITIONS.map((c) => c.name).join('; ')}.
  Safety hazards: ${HAZARDS.map((h) => h.name).join('; ')}.
- Fault codes: normalise to forms like "CID 110 FMI 15", "SPN 3364 FMI 4", "E360". Fix obvious speech-to-text spellings ("see eye dee one ten" -> "CID 110").
- severity: critical = immediate danger to people or imminent failure (stop the machine); high = machine should not keep working normally; medium = needs attention this shift/week; low = routine or informational.
- category "maintenance" = a completed service/repair; "mechanical" = a machine problem; "safety" = a hazard to people; "operational" = logistics/schedule; "observation" = anything else.
- is_mechanical_failure = the machine (not the site) has a fault. needs_engineering = a mechanical problem worth reporting to Caterpillar engineering (product quality / design signal); false for routine wear items, abuse or completed services.
- action_items: 1-5 concrete, imperative tasks for the people on site, each with the right role.
- operator_guidance: 1-2 plain-language sentences spoken directly to the operator about what to do right now.
- likely_causes: 0-3 short technician-facing hypotheses grounded in the machine's history when relevant.
- memory_facts: 0-2 durable facts worth remembering about THIS machine long-term (e.g. "Boom hose re-routed with abrasion sleeve on 2026-10-02"). Empty if nothing durable.
- Use the provided machine history, known fixes and product documents to inform causes and guidance. If a policy or spec in the documents applies, follow it in operator_guidance and action_items. Never invent facts that aren't supported.`;

/** Rule engine first; the model review (if any) runs separately via modelExtract. */
export async function extractObservation(rawText, ctx = {}) {
  const rules = ruleExtract(rawText, ctx);
  if (!llmEnabled() || ctx.forceRules) return { ...rules, ai_mode: 'rules' };
  try { return await modelExtract(rawText, ctx, rules); } catch (err) {
    console.warn('[extract] model extraction failed, using rule engine:', describeLlmError(err));
    return { ...rules, ai_mode: 'rules', ai_error: describeLlmError(err) };
  }
}

/** Model-backed extraction with the machine's memory as context. Throws on failure. */
export async function modelExtract(rawText, ctx = {}, rules = ruleExtract(rawText, ctx)) {

  const age = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const history = (ctx.history || []).map((h) => `- [R${h.id}] ${h.created_at.slice(0, 10)}, ${age(h.created_at)}${h.person_name ? `, by ${h.person_name}` : ''} [${h.severity}/${h.category}] ${h.summary}`).join('\n') || '- (no prior reports)';
  const open = (ctx.openAlerts || []).map((a) => `- [${a.id}] ${a.severity} · ${a.title} · opened ${a.created_at.slice(0, 10)}`).join('\n') || '- (none)';
  const fixes = (ctx.fixes || []).slice(0, 6).map((f) => `- ${f.title} (${f.component}/${f.symptom}; worked ${f.success}x, failed ${f.fail}x)`).join('\n') || '- (none)';
  const machine = ctx.asset
    ? `${ctx.asset.id}: ${ctx.asset.model} (${ctx.asset.family}), ${Math.round(ctx.asset.smu_hours)} SMU hours, site ${ctx.siteName || ctx.asset.site_id}${ctx.siteClimate ? `, climate: ${ctx.siteClimate}` : ''}`
    : 'Unknown machine';
  const docs = (ctx.docs || []).map((d) => `- [D${d.doc_id}] ${d.title} (${d.doc_type}): ${d.excerpt}`).join('\n') || '- (none)';
  const text = `Machine: ${machine}\nReporter: ${ctx.reporter || 'unknown'} (${ctx.reporterRole || 'operator'})\nSource: ${ctx.source || 'voice'}\n\nOPEN ISSUES on this machine (id in brackets):\n${open}\n\nRECENT REPORTS on this machine:\n${history}\n\nKnown fixes for this model:\n${fixes}\n\nRelevant product documents (spec sheets, policies):\n${docs}\n\n${ctx.photo ? 'A photo from the field may be attached; use it as evidence if present.\n\n' : ''}Field note:\n"""${rawText}"""`;

  {
    const out = await structured({ system: SYSTEM, text, image: ctx.photo, schema: EXTRACTION_SCHEMA, ...(ctx.timeoutMs ? { timeoutMs: ctx.timeoutMs } : {}) });
    // Open models don't always honour the schema exactly, so coerce every field defensively.
    const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((v) => typeof v === 'string' && v.trim());
    const snap = (vocab, arr) => uniq(list(arr).map((x) => canonical(vocab, x)));
    const merged = {
      summary: String(out.summary || rules.summary).slice(0, 140),
      category: CATEGORIES.includes(out.category) ? out.category : rules.category,
      severity: SEVERITIES.includes(out.severity) ? out.severity : rules.severity,
      components: snap(COMPONENTS, out.components),
      symptoms: snap(SYMPTOMS, out.symptoms),
      fault_codes: uniq([...list(out.fault_codes).map(normalizeCode), ...rules.fault_codes]),
      conditions: snap(CONDITIONS, out.conditions),
      safety_hazards: snap(HAZARDS, out.safety_hazards),
      is_mechanical_failure: Boolean(out.is_mechanical_failure),
      needs_engineering: Boolean(out.needs_engineering),
      action_items: (Array.isArray(out.action_items) ? out.action_items : [])
        .filter((a) => a && typeof a.text === 'string' && a.text.trim())
        .map((a) => ({ text: a.text.trim().slice(0, 240), assignee_role: ROLES.includes(a.assignee_role) ? a.assignee_role : 'site_manager' }))
        .slice(0, 6),
      operator_guidance: typeof out.operator_guidance === 'string' && out.operator_guidance.trim() ? out.operator_guidance.trim() : rules.operator_guidance,
      likely_causes: list(out.likely_causes).slice(0, 3),
      memory_facts: list(out.memory_facts).slice(0, 2),
      intent: INTENTS.includes(out.intent) ? out.intent : rules.intent,
      wants_advice: Boolean(out.wants_advice) || rules.wants_advice,
      references_alert_id: Number.isInteger(Number(out.references_alert_id)) ? Number(out.references_alert_id) : 0,
      references_report_id: Number.isInteger(Number(out.references_report_id)) ? Number(out.references_report_id) : 0,
      delete_report_ids: (Array.isArray(out.delete_report_ids) ? out.delete_report_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 25),
      resolution: typeof out.resolution === 'string' ? out.resolution.trim().slice(0, 240) : '',
      advice_steps: list(out.advice_steps).map((x) => x.trim().slice(0, 220)).slice(0, 5),
      help_role: [...ROLES, 'none'].includes(out.help_role) ? out.help_role : 'none',
      help_request: typeof out.help_request === 'string' ? out.help_request.trim().slice(0, 200) : '',
    };
    // Deleting reports must come from the person's own words, never from a model's guess: a real
    // problem misread as "delete" would file nothing and remove something.
    if (merged.intent === 'delete_report' && !DELETE_WORDS_RE.test(rawText)) merged.intent = rules.intent === 'delete_report' ? 'new_issue' : rules.intent;
    // Safety net: never let the model downgrade a critical hazard the rule engine is sure about —
    // unless the note is about something already fixed, a correction or a question.
    if (!['resolved', 'correction', 'question', 'routine_log', 'delete_report'].includes(merged.intent) && sevRank(rules.severity) === 3 && sevRank(merged.severity) < 3) merged.severity = 'critical';
    // ...and never more than one level below what the safety rules found for a reported problem.
    if (!['resolved', 'question', 'routine_log', 'delete_report'].includes(merged.intent) && sevRank(merged.severity) < sevRank(rules.severity) - 1) merged.severity = SEVERITIES[sevRank(rules.severity) - 1];
    // An empty model answer is worse than the rule engine's; keep the rules' entities in that case.
    if (!merged.components.length && !merged.symptoms.length && !merged.safety_hazards.length && (rules.components.length || rules.safety_hazards.length)) {
      Object.assign(merged, { components: rules.components, symptoms: rules.symptoms, safety_hazards: rules.safety_hazards, conditions: merged.conditions.length ? merged.conditions : rules.conditions });
      merged.is_mechanical_failure ||= rules.is_mechanical_failure;
      merged.needs_engineering ||= rules.needs_engineering;
    }
    if (!merged.action_items.length) merged.action_items = rules.action_items;
    return { ...merged, ai_mode: 'llm', ai_label: llmInfo().label };
  }
}
