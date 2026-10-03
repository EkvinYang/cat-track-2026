// Turns raw field input (dictated voice notes, typed text, telemetry anomalies, photos) into a
// structured observation: components, symptoms, fault codes, conditions, hazards, severity,
// category, crew action items and operator guidance.
import {
  COMPONENTS, SYMPTOMS, CONDITIONS, HAZARDS, CATEGORIES, SEVERITIES, ROLES,
  matchAll, extractFaultCodes, canonical, normalizeCode, sevRank,
} from './vocab.js';
import { llmEnabled, structured, describeLlmError } from './llm.js';

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

  return {
    summary, category, severity,
    components: uniq(components), symptoms: uniq(problemSymptoms), fault_codes: uniq(fault_codes),
    conditions: uniq(conditions), safety_hazards: uniq(safety_hazards),
    is_mechanical_failure, needs_engineering,
    action_items: actions, operator_guidance, likely_causes: [], memory_facts,
  };
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'category', 'severity', 'components', 'symptoms', 'fault_codes', 'conditions', 'safety_hazards',
    'is_mechanical_failure', 'needs_engineering', 'action_items', 'operator_guidance', 'likely_causes', 'memory_facts'],
  properties: {
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
Field crews dictate short, messy voice notes (speech-to-text errors are common). Turn each note into a structured observation.

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
- Use the provided machine history and known fixes to inform causes and guidance, but never invent facts that aren't supported.`;

/** Claude-backed extraction with the machine's memory as context; falls back to the rule engine. */
export async function extractObservation(rawText, ctx = {}) {
  const rules = ruleExtract(rawText, ctx);
  if (!llmEnabled() || ctx.forceRules) return { ...rules, ai_mode: 'rules' };

  const history = (ctx.history || []).map((h) => `- ${h.created_at.slice(0, 10)} [${h.severity}/${h.category}] ${h.summary}`).join('\n') || '- (no prior reports)';
  const fixes = (ctx.fixes || []).map((f) => `- ${f.title} (${f.component}/${f.symptom}; worked ${f.success}x, failed ${f.fail}x)`).join('\n') || '- (none)';
  const machine = ctx.asset
    ? `${ctx.asset.id}: ${ctx.asset.model} (${ctx.asset.family}), ${Math.round(ctx.asset.smu_hours)} SMU hours, site ${ctx.siteName || ctx.asset.site_id}${ctx.siteClimate ? `, climate: ${ctx.siteClimate}` : ''}`
    : 'Unknown machine';
  const content = [];
  if (ctx.photo) {
    content.push({ type: 'image', source: { type: 'base64', media_type: ctx.photo.mediaType, data: ctx.photo.data } });
  }
  content.push({
    type: 'text',
    text: `Machine: ${machine}\nReporter: ${ctx.reporter || 'unknown'} (${ctx.reporterRole || 'operator'})\nSource: ${ctx.source || 'voice'}\n\nRecent machine memory:\n${history}\n\nKnown fixes for this model:\n${fixes}\n\n${ctx.photo ? 'A photo from the field is attached; use it as evidence.\n\n' : ''}Field note:\n"""${rawText}"""`,
  });

  try {
    const out = await structured({ system: SYSTEM, content, schema: EXTRACTION_SCHEMA, effort: 'low' });
    const snap = (list, arr) => uniq((arr || []).map((x) => canonical(list, x)));
    const merged = {
      summary: String(out.summary || rules.summary).slice(0, 140),
      category: CATEGORIES.includes(out.category) ? out.category : rules.category,
      severity: SEVERITIES.includes(out.severity) ? out.severity : rules.severity,
      components: snap(COMPONENTS, out.components),
      symptoms: snap(SYMPTOMS, out.symptoms),
      fault_codes: uniq([...(out.fault_codes || []).map(normalizeCode), ...rules.fault_codes]),
      conditions: snap(CONDITIONS, out.conditions),
      safety_hazards: snap(HAZARDS, out.safety_hazards),
      is_mechanical_failure: Boolean(out.is_mechanical_failure),
      needs_engineering: Boolean(out.needs_engineering),
      action_items: (out.action_items || []).filter((a) => a && a.text).slice(0, 6),
      operator_guidance: out.operator_guidance || rules.operator_guidance,
      likely_causes: (out.likely_causes || []).slice(0, 3),
      memory_facts: (out.memory_facts || []).slice(0, 2),
    };
    // Safety net: never let the model downgrade a critical hazard the rule engine is sure about.
    if (sevRank(rules.severity) === 3 && sevRank(merged.severity) < 3) merged.severity = 'critical';
    return { ...merged, ai_mode: 'claude' };
  } catch (err) {
    console.warn('[extract] Claude extraction failed, using rule engine:', describeLlmError(err));
    return { ...rules, ai_mode: 'rules', ai_error: describeLlmError(err) };
  }
}
