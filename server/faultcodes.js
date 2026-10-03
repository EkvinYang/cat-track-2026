// Fault-code breakdown. Cat diagnostic codes name a component (CID, or SPN on J1939 machines) and a
// failure mode (FMI); event codes (E360…) name a condition. The FMI table is the standard SAE J1939
// list Cat uses; the component table covers the common engine and aftertreatment sensors whose CID
// and SPN numbers coincide. Anything else is shown as "not in Cat Track's table" with a cat.com
// search link, so nobody is handed a guessed meaning. The English text is the key for the Spanish
// and Hindi wording in i18n.js; `component.part` stays the canonical English part name.
import { q, parseJson } from './db.js';
import { t, vocabName, normalizeLang } from './i18n.js';

const FMI = {
  0: ['Above normal range, most severe', 'The reading is valid but well above where it should be. This is the most severe of the three warning levels.', 'critical'],
  1: ['Below normal range, most severe', 'The reading is valid but well below where it should be. This is the most severe of the three warning levels.', 'critical'],
  2: ['Erratic, intermittent or incorrect', 'The signal jumps around or drops out. Usually wiring, a connector or a failing sensor.', 'medium'],
  3: ['Voltage above normal / shorted high', 'The circuit voltage is higher than it should be, often a short to a power wire.', 'high'],
  4: ['Voltage below normal / shorted low', 'The circuit voltage is lower than it should be, often a short to ground.', 'high'],
  5: ['Current below normal / open circuit', 'Too little current is flowing: a broken wire, loose connector or open coil.', 'high'],
  6: ['Current above normal / grounded circuit', 'Too much current is flowing: a grounded wire or a shorted coil.', 'high'],
  7: ['Mechanical system not responding', 'The part was commanded but did not respond, or is out of adjustment.', 'high'],
  8: ['Abnormal frequency or pulse width', 'The signal frequency or pulse width is outside the expected range.', 'medium'],
  9: ['Abnormal update rate', 'Data from this device is arriving too slowly or not at all.', 'medium'],
  10: ['Abnormal rate of change', 'The value is changing faster than physically possible.', 'medium'],
  11: ['Failure mode not identifiable', 'A fault exists but the controller cannot tell what kind.', 'medium'],
  12: ['Bad device or component', 'The device itself has failed its internal checks.', 'high'],
  13: ['Out of calibration', 'The device needs calibrating.', 'medium'],
  14: ['Special instructions', 'See the service information for this specific code.', 'medium'],
  15: ['Above normal range, least severe', 'The reading is valid but a little above normal. The least severe of three warning levels.', 'medium'],
  16: ['Above normal range, moderately severe', 'The reading is valid and clearly above normal. The middle of three warning levels.', 'high'],
  17: ['Below normal range, least severe', 'The reading is valid but a little below normal. The least severe of three warning levels.', 'medium'],
  18: ['Below normal range, moderately severe', 'The reading is valid and clearly below normal. The middle of three warning levels.', 'high'],
  19: ['Network data in error', 'Data received over the machine network is invalid.', 'medium'],
  20: ['Data drifted high', 'The reading has slowly drifted above its expected value.', 'medium'],
  21: ['Data drifted low', 'The reading has slowly drifted below its expected value.', 'medium'],
  31: ['Condition exists', 'The condition named by the code is present.', 'medium'],
};

// [what is measured, Cat Track part it belongs to]
const COMPONENT = {
  41: ['8 V sensor supply', 'Electrical system'],
  91: ['Throttle / accelerator position', 'Operator controls'],
  94: ['Fuel delivery pressure', 'Fuel system'],
  96: ['Fuel level', 'Fuel system'],
  100: ['Engine oil pressure', 'Engine oil system'],
  102: ['Intake manifold (boost) pressure', 'Turbocharger'],
  105: ['Intake manifold air temperature', 'Air intake & filter'],
  107: ['Air filter differential pressure', 'Air intake & filter'],
  108: ['Barometric pressure', 'Sensors & display'],
  110: ['Engine coolant temperature', 'Cooling system'],
  111: ['Engine coolant level', 'Cooling system'],
  157: ['Fuel rail pressure', 'Fuel system'],
  168: ['Electrical system voltage', 'Electrical system'],
  171: ['Ambient air temperature', 'Sensors & display'],
  172: ['Intake manifold air temperature', 'Air intake & filter'],
  174: ['Fuel temperature', 'Fuel system'],
  175: ['Engine oil temperature', 'Engine oil system'],
  177: ['Transmission oil temperature', 'Transmission'],
  190: ['Engine speed', 'Engine'],
  247: ['SAE J1939 data link', 'Electrical system'],
  248: ['Cat Data Link', 'Electrical system'],
  262: ['5 V sensor supply', 'Electrical system'],
  1761: ['DEF tank level', 'Aftertreatment (DPF/DEF)'],
  3216: ['Aftertreatment intake NOx', 'Aftertreatment (DPF/DEF)'],
  3226: ['Aftertreatment outlet NOx', 'Aftertreatment (DPF/DEF)'],
  3251: ['DPF differential pressure', 'Aftertreatment (DPF/DEF)'],
};
// Cat CIDs 1–16 are the fuel injectors for cylinders 1–16.
for (let c = 1; c <= 16; c++) COMPONENT[`cid:${c}`] = ['Cylinder {n} injector', 'Fuel system', { n: c }];

const EVENTS = {
  E360: ['Low engine oil pressure', 'Engine oil system', 'critical', 'Engine oil pressure has dropped below the safe limit. Stop the engine as soon as it is safe.'],
  E361: ['High engine coolant temperature', 'Cooling system', 'high', 'The engine is running hotter than it should. Reduce load and let it cool at idle.'],
  E362: ['Engine overspeed', 'Engine', 'high', 'The engine has run faster than its limit, often when descending a grade.'],
};

export const catSearchUrl = (code) => `https://www.cat.com/en_US/search/search-results.html?search=${encodeURIComponent(code)}`;

/**
 * Break one code (as Cat Track stores it, e.g. "CID 110 FMI 15", "SPN 3251 FMI 0", "E361") into parts,
 * worded in `lang`. `component.part` is the canonical part name; `component.partLabel` is it in `lang`.
 */
export function decodeFaultCode(raw, lang = 'en') {
  const l = normalizeLang(lang) || 'en';
  const tr = (key, vars) => t(l, key, vars);
  const code = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const out = { code, scheme: 'other', id: null, fmi: null, component: null, failure: null, severity: null, known: false, summary: '', search: catSearchUrl(code) };
  let m = /^(CID|SPN|MID)\s?(\d{1,6})(?:\s?FMI\s?(\d{1,2}))?$/.exec(code);
  if (m) {
    out.scheme = m[1]; out.id = Number(m[2]); out.fmi = m[3] != null ? Number(m[3]) : null;
    const comp = (m[1] === 'CID' && COMPONENT[`cid:${out.id}`]) || COMPONENT[out.id];
    if (comp) out.component = { label: tr(comp[0], comp[2]), part: comp[1], partLabel: vocabName(l, comp[1]) };
    const f = out.fmi != null ? FMI[out.fmi] : null;
    if (f) { out.failure = { label: tr(f[0]), detail: tr(f[1]) }; out.severity = f[2]; }
    out.known = Boolean(comp && (f || out.fmi == null));
    const id = `${m[1]} ${out.id}`;
    if (f && comp) out.summary = tr('{what}: {failure}.', { what: out.component.label, failure: out.failure.label.toLowerCase() });
    else if (f) out.summary = tr('{code} (component not in Cat Track’s table): {failure}.', { code: id, failure: out.failure.label.toLowerCase() });
    else if (comp) out.summary = tr('{what} fault.', { what: out.component.label });
    else out.summary = tr('{code} isn’t in Cat Track’s code table. Look it up on cat.com or in Cat SIS.', { code: id });
    return out;
  }
  m = /^E(\d{3,4})(?:-\d)?$/.exec(code);
  if (m) {
    out.scheme = 'event'; out.id = Number(m[1]);
    const ev = EVENTS[`E${m[1]}`];
    if (ev) {
      out.component = { label: tr(ev[0]), part: ev[1], partLabel: vocabName(l, ev[1]) };
      out.severity = ev[2]; out.failure = { label: tr('Event'), detail: tr(ev[3]) }; out.known = true;
      out.summary = `${out.component.label}. ${out.failure.detail}`;
    } else out.summary = tr('Cat event code {code}. Not in Cat Track’s table; look it up on cat.com or in Cat SIS.', { code });
    return out;
  }
  if (/^[PCBU]\d{4}$/.test(code)) { out.scheme = 'obd'; out.summary = tr('OBD diagnostic trouble code {code}.', { code }); return out; }
  // "code 2041" said without a CID/SPN or FMI: only the number is known.
  m = /^CODE (\d{2,4})$/.exec(code);
  if (m) { out.id = Number(m[1]); out.search = catSearchUrl(m[1]); out.summary = tr('Code {n}: the report gave no CID, SPN or FMI. Look it up on cat.com or in Cat SIS.', { n: m[1] }); return out; }
  out.summary = tr('Code {code}. Look it up on cat.com or in Cat SIS.', { code });
  return out;
}

/** How often a code shows up in the record: reports, machines, and when it was last seen. */
export function codeStats(code, { assetId = null } = {}) {
  const rows = q.all(`SELECT id, asset_id, site_id, created_at, extraction FROM reports WHERE extraction LIKE ? ORDER BY created_at DESC LIMIT 500`, `%${String(code).replace(/[%_]/g, '')}%`)
    .filter((r) => { const e = parseJson(r.extraction, {}); return !e.retracted && (e.fault_codes || []).includes(code); });
  return {
    reports: rows.length,
    machines: new Set(rows.map((r) => r.asset_id)).size,
    sites: new Set(rows.map((r) => r.site_id)).size,
    onThisMachine: assetId ? rows.filter((r) => r.asset_id === assetId).length : null,
    lastSeen: rows[0]?.created_at || null,
  };
}
