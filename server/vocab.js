// Shared vocabulary that keeps the knowledge graph consistent no matter whether a report was
// understood by Claude or by the offline rule engine. Every free-text entity is snapped to a
// canonical name here before it becomes a graph node.

export const COMPONENTS = [
  { name: 'Hydraulic hose', system: 'Hydraulics', re: /\bhoses?\b|hydraulic lines?/ },
  { name: 'Boom cylinder', system: 'Hydraulics', re: /\bboom\b/ },
  { name: 'Stick cylinder', system: 'Hydraulics', re: /\bstick\b|\barm cylinder/ },
  { name: 'Bucket & linkage', system: 'Implements', re: /\bbucket\b|linkage|\bpins?\b|bushings?/ },
  { name: 'Hydraulic pump', system: 'Hydraulics', re: /hydraulic pump|main pump|implement pump/ },
  { name: 'Swing drive', system: 'Hydraulics', re: /\bswing\b/ },
  { name: 'Quick coupler', system: 'Implements', re: /coupler/ },
  { name: 'Cooling system', system: 'Engine', re: /coolant|radiator|water pump|\bfans?\b|thermostat|oil cooler/ },
  { name: 'Turbocharger', system: 'Engine', re: /turbo/ },
  { name: 'Aftertreatment (DPF/DEF)', system: 'Engine', re: /\bdpf\b|\bdef\b|aftertreatment|\bregen|diesel exhaust fluid|particulate/ },
  { name: 'Fuel system', system: 'Engine', re: /fuel (pump|filter|line|injector|leak|system)|injectors?/ },
  { name: 'Air intake & filter', system: 'Engine', re: /air (filter|cleaner|intake)/ },
  { name: 'Engine oil system', system: 'Engine', re: /engine oil|oil pressure/ },
  { name: 'Engine', system: 'Engine', re: /\bengine\b|\bmotor\b/ },
  { name: 'Transmission', system: 'Powertrain', re: /transmission|gearbox|\bgears?\b|shifting|shifts? (hard|rough|late|slow|harsh)/ },
  { name: 'Torque converter', system: 'Powertrain', re: /torque converter/ },
  { name: 'Final drive', system: 'Powertrain', re: /final drive/ },
  { name: 'Axle & differential', system: 'Powertrain', re: /\baxles?\b|differential/ },
  { name: 'Track & undercarriage', system: 'Undercarriage', re: /\btracks?\b|undercarriage|track chain|track shoes?|track tension/ },
  { name: 'Idlers & rollers', system: 'Undercarriage', re: /idlers?|rollers?\b|sprockets?/ },
  { name: 'Brakes', system: 'Powertrain', re: /\bbrakes?\b|braking/ },
  { name: 'Tires', system: 'Chassis', re: /\btires?\b|\btyres?\b|\bflat\b/ },
  { name: 'Steering', system: 'Chassis', re: /steering/ },
  { name: 'Electrical system', system: 'Electrical', re: /batter(y|ies)|alternator|wiring|electrical|\bfuses?\b|\bstarter\b|harness/ },
  { name: 'Sensors & display', system: 'Electrical', re: /sensors?|display|monitor\b|cameras?|gauges?|screen/ },
  { name: 'Lights', system: 'Electrical', re: /(?<!warning )(?<!engine )(?<!check )\blights?\b|beacon|headlights?/ },
  { name: 'Cab & HVAC', system: 'Cab', re: /\bcab\b|air condition|\ba\/c\b|\bhvac\b|heater|\bseat\b|\bdoors?\b|window|wipers?/ },
  { name: 'Operator controls', system: 'Cab', re: /joysticks?|pedals?|levers?\b/ },
  { name: 'Blade', system: 'Implements', re: /\bblade\b|moldboard/ },
  { name: 'Ripper', system: 'Implements', re: /ripper/ },
  { name: 'Ground engaging tools', system: 'Implements', re: /\bteeth\b|\btooth\b|cutting edge|end bits?/ },
  { name: 'Frame & structure', system: 'Structure', re: /\bframe\b|\bwelds?\b|chassis|structur/ },
  { name: 'Dump body & hoist', system: 'Implements', re: /dump body|truck bed|\bhoist\b/ },
  { name: 'Hydraulic system', system: 'Hydraulics', re: /hydraulic/ },
];

export const SYMPTOMS = [
  { name: 'Leak', re: /leak|seep|\bdrip|spray(ing|ed)?\b|weep|puddle/ },
  { name: 'Overheating', re: /overheat|running hot|runs hot|run hot|too hot|high (coolant |oil |engine |hydraulic )?temp|temp(erature)? (is )?(high|rising|spik|climb|warning)|boil/ },
  { name: 'Abnormal noise', re: /nois|grind|squeal|squeak|knock|clunk|rattl|whin(e|ing)|\bbang|screech|clank|chatter/ },
  { name: 'Vibration', re: /vibrat|shak(e|ing|y)|wobbl/ },
  { name: 'Smoke', re: /smok/ },
  { name: 'Engine derate', re: /derat/ },
  { name: 'Loss of power', re: /loss of power|lost power|low power|no power\b|sluggish|bogg|\bweak|underpower|lacks? power|slow (to )?respon|responding slow(ly)?|slow (hydraulics|cycle|swing|lift)/ },
  { name: 'No-start', re: /won'?t start|no[- ]start|not starting|doesn'?t start|fails? to start|dead battery|won'?t crank/ },
  { name: 'Warning / fault code', re: /warning|alarm|\bfault|error code|check engine|\bcodes?\b|\bcid\b|\bfmi\b|\bspn\b/ },
  { name: 'Crack / damage', re: /crack|\bbroke|broken|\bbent\b|damag|\btear\b|\btorn\b|snapp|split|\bdent/ },
  { name: 'Wear', re: /\bwear|\bworn|bald|\bthin(ning)?\b/ },
  { name: 'Low pressure', re: /low pressure|pressure (drop|low|loss)|lost pressure|losing pressure/ },
  { name: 'Low fluid level', re: /low (oil|coolant|fluid|level)|level (is )?low|top(ped)? (up|off)/ },
  { name: 'Erratic operation', re: /erratic|jerk|intermittent|unresponsive|sticking|\bstuck\b|drift|\blag|slipp|shifting hard|hard shift|harsh shift/ },
  { name: 'Spongy / weak braking', re: /spongy|feels? soft|soft pedal|takes longer to stop|won'?t hold|brakes? (are |feel )?weak/ },
  { name: 'Not cooling / no airflow', re: /blowing (warm|hot)|not cooling|no air ?flow|weak air/ },
  { name: 'Fluid contamination', re: /contamina|milky|metal (shavings|particles|flakes)|debris in/ },
  { name: 'Burning smell', re: /smell|burning|\bodou?r/ },
  { name: 'Electrical fault', re: /flicker|short(ed|ing)? out|won'?t (turn|power) on|no power to|\bdead\b/ },
];

export const CONDITIONS = [
  { name: 'High ambient heat', re: /hot (day|weather|afternoon|out|conditions)|\bheat\b|heatwave|scorch|swelter|\b(9[5-9]|1[0-2]\d)\s?°?\s?(f|degrees f)\b|\b(3[5-9]|4\d)\s?°?\s?(c|degrees c)\b/ },
  { name: 'Wet / muddy ground', re: /\brain|\bwet\b|\bmud|flood|standing water/ },
  { name: 'Dusty', re: /\bdust/ },
  { name: 'Cold weather', re: /cold (start|morning|weather|snap)|freez|\bsnow|\bice\b|\bicy\b|frost/ },
  { name: 'Night shift', re: /\bnight|\bdark\b/ },
  { name: 'Steep grade', re: /\bslope|\bgrade\b|incline|\bhill|\bramp\b|\bclimb\b|uphill/ },
  { name: 'Rocky terrain', re: /\brock|boulder|shot rock|blast/ },
  { name: 'Heavy load / long shift', re: /heavy load|overload|full load|max(imum)? load|long shift|double shift|continuous|all day/ },
  { name: 'Soft ground', re: /soft ground|unstable ground|sinking|soft soil/ },
];

export const HAZARDS = [
  { name: 'Loss of machine control', critical: true, re: /brake fail|no brakes|brakes? (went|gave) out|can'?t stop|couldn'?t stop|runaway|steering (loss|fail)|lost steering|rolled/ },
  { name: 'Fire risk', critical: true, re: /\bfire\b|\bflames?\b/ },
  { name: 'Injury', critical: true, re: /injur|\bhurt\b|bleed|first aid|ambulance/ },
  { name: 'Ground instability', re: /soft ground|unstable|trench|excavation edge|collapse|cave[- ]?in|edge of the (cut|pit)/ },
  { name: 'Near miss', re: /near miss|almost (hit|struck)|nearly (hit|struck)|close call/ },
  { name: 'Pedestrian interaction', re: /spotter|blind spot|pedestrian|people walking|workers? on foot|ground crew|someone walk/ },
  { name: 'Utility strike risk', re: /power lines?|overhead lines?|gas line|water main|buried (cable|line)|utility/ },
  { name: 'Missing safety equipment', re: /seat ?belt|\brops\b|guard (is )?missing|missing guard|fire extinguisher|backup alarm/ },
  { name: 'Slip / trip / fall', re: /slipped (on|and|off)|\bslip (on|and)\b|\btripped\b|\bfell\b|fall (from|off|hazard)|ladder|handrail|grab handle/ },
  { name: 'Fume exposure', re: /fumes|exhaust in (the )?cab|carbon monoxide/ },
];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const CATEGORIES = ['mechanical', 'safety', 'maintenance', 'operational', 'observation'];
export const ROLES = ['operator', 'technician', 'site_manager', 'safety_officer', 'fleet_manager'];
export const sevRank = (s) => Math.max(0, SEVERITIES.indexOf(s));

const titleCase = (s) => String(s).trim().replace(/\s+/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Snap a free-text entity (e.g. from Claude) to the closest canonical vocabulary entry. */
export function canonical(list, raw) {
  const text = String(raw || '').toLowerCase().trim();
  if (!text) return null;
  const exact = list.find((v) => v.name.toLowerCase() === text);
  if (exact) return exact.name;
  const hit = list.find((v) => v.re.test(text));
  return hit ? hit.name : titleCase(raw);
}

export const componentSystem = (name) => COMPONENTS.find((c) => c.name === name)?.system || 'General';

export function matchAll(list, text) {
  return list.filter((v) => v.re.test(text)).map((v) => v.name);
}

const FAULT_RE = /\b(CID\s?\d{1,4}(?:\s?FMI\s?\d{1,2})?|SPN\s?\d{1,6}(?:\s?FMI\s?\d{1,2})?|E\d{3,4}(?:-\d)?|[PCBU]\d{4})\b/gi;
export function extractFaultCodes(text) {
  const codes = new Set();
  for (const m of String(text).matchAll(FAULT_RE)) {
    codes.add(m[1].toUpperCase().replace(/\s+/g, ' ').replace(/(CID|SPN|FMI)(\d)/g, '$1 $2'));
  }
  for (const m of String(text).matchAll(/\b(?:fault |error )?code\s+(\d{2,4})\b/gi)) codes.add(`CODE ${m[1]}`);
  return [...codes];
}

export const normalizeCode = (c) => String(c).toUpperCase().trim().replace(/\s+/g, ' ').replace(/(CID|SPN|FMI)(\d)/g, '$1 $2');
