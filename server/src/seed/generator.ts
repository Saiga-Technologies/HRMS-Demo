/**
 * Demo data generator for the nine demo client companies (see registry.ts).
 *
 * `seedDemoCompany(def)` runs once, inside the company's tenant context, when its database is first
 * opened empty. It first applies the country template (settings, components, leave types, holidays,
 * document types, …: countries.ts — the same code the agency "Add company" wizard uses), then adds
 * people and history: employees, logins, salary structures, leave, attendance, payroll runs,
 * documents, recruitment, assets, journeys and announcements.
 *
 * Everything is deterministic (PRNG seeded by the slug; dates relative to the company's today()),
 * so every server instance generates identical ids and values.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StatementSync } from 'node:sqlite';
import { insert, run, all, getDb, transaction, UPLOAD_DIR } from '../db.js';
import { nowIso, today, addDays, zoneOffsetMinutes, distanceMeters, round2 } from '../util.js';
import { hashPassword } from '../auth.js';
import { DEMO_PASSWORD, sampleFile } from '../seed.js';
import { computeBreakdown } from '../routes/payroll.js';
import { parseCv, scoreCv } from '../cvparser.js';
import type { DemoCompany } from './registry.js';
import { applyTemplateRows, insertShift, isGcc, payrollSettingsFor, defaultShiftFor, type CountryTemplateOpts, type ShiftSeed } from './countries.js';
import { PROFILES, type CompanyProfile, type DeptOrg } from './profiles.js';
import { makeRng, indianPool, POOLS, GCC_MIX, NATIONAL_OF, NATIONALITY_LABEL, slugName, type Rng, type NamePool } from './names.js';

export { applyCountryTemplate, applyTemplateRows, type CountryTemplateOpts } from './countries.js';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
let cachedHash: string | null = null;
/** scrypt is slow; one hash (random salt) is reused for every demo login of this process. */
const demoHash = () => (cachedHash ??= hashPassword(DEMO_PASSWORD));

const pad2 = (n: number) => String(n).padStart(2, '0');
const dowOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthShift = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
};
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** ISO 13616 IBAN with valid mod-97 check digits. */
function iban(country: string, bban: string) {
  const numeric = (bban + country + '00').toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return `${country}${pad2(98 - rem)}${bban}`;
}

/* ------------------------------------------------------------------ */
/* Country-specific personal data                                      */
/* ------------------------------------------------------------------ */
const IN_BANKS: [string, string][] = [['HDFC Bank', 'HDFC0'], ['ICICI Bank', 'ICIC0'], ['State Bank of India', 'SBIN0'], ['Axis Bank', 'UTIB0'], ['Kotak Mahindra Bank', 'KKBK0']];
const IN_REGIONAL_BANK: Record<string, [string, string]> = { Kerala: ['Federal Bank', 'FDRL0'], Maharashtra: ['Bank of Maharashtra', 'MAHB0'], Telangana: ['Union Bank of India', 'UBIN0'] };
const GCC_BANKS: Record<string, [name: string, swift: string, code: string][]> = {
  AE: [['Emirates NBD', 'EBILAEAD', '026'], ['First Abu Dhabi Bank', 'NBADAEAA', '035'], ['Abu Dhabi Commercial Bank', 'ADCBAEAA', '030'], ['Mashreq Bank', 'BOMLAEAD', '033'], ['Dubai Islamic Bank', 'DUIBAEAD', '024']],
  SA: [['Saudi National Bank', 'NCBKSAJE', '10'], ['Al Rajhi Bank', 'RJHISARI', '80'], ['Riyad Bank', 'RIBLSARI', '20'], ['SAB', 'SABBSARI', '45'], ['Alinma Bank', 'INMASARI', '05']],
  QA: [['Qatar National Bank', 'QNBAQAQA', 'QNBA'], ['Commercial Bank of Qatar', 'CBQAQAQA', 'CBQA'], ['Doha Bank', 'DOHBQAQA', 'DOHB'], ['Qatar Islamic Bank', 'QISBQAQA', 'QISB'], ['Dukhan Bank', 'BRWAQAQA', 'BRWA']],
};
// Publicly listed ABA routing numbers of large banks (no real accounts are implied).
const US_BANKS: Record<string, [string, string][]> = {
  California: [['Wells Fargo', '121000248'], ['Bank of America', '121000358'], ['JPMorgan Chase', '322271627']],
  'New York': [['JPMorgan Chase', '021000021'], ['Citibank', '021000089'], ['Bank of America', '026009593']],
  Texas: [['JPMorgan Chase', '111000614'], ['Wells Fargo', '111900659'], ['Bank of America', '111000025']],
};
const US_AREA: Record<string, string[]> = { California: ['415', '628', '510'], 'New York': ['212', '646', '917', '718'], Texas: ['713', '832', '281', '432'] };
const QID_COUNTRY: Record<string, string> = { Qatari: '634', Indian: '356', Filipino: '608', Nepali: '524', Egyptian: '818', Lebanese: '422', British: '826', Pakistani: '586', Jordanian: '400', Bangladeshi: '050' };

function phoneFor(cc: string, rng: Rng, region: string) {
  switch (cc) {
    case 'IN': return `+91 ${rng.pick(['98', '99', '97', '96', '90', '88', '70', '63'])}${rng.digits(3)} ${rng.digits(5)}`;
    case 'AE': return `+971 5${rng.pick(['0', '2', '4', '5', '6', '8'])} ${rng.digits(3)} ${rng.digits(4)}`;
    case 'SA': return `+966 5${rng.pick(['0', '3', '4', '5', '6', '9'])} ${rng.digits(3)} ${rng.digits(4)}`;
    case 'QA': return `+974 ${rng.pick(['3', '5', '6', '7'])}${rng.digits(3)} ${rng.digits(4)}`;
    default: return `+1 (${rng.pick(US_AREA[region] || ['212'])}) 555-01${rng.digits(2)}`; // 555-01xx: reserved fictional range
  }
}

/* ------------------------------------------------------------------ */
/* Org plan                                                            */
/* ------------------------------------------------------------------ */
interface Slot {
  dept: string; title: string; level: number; kind: 'ceo' | 'head' | 'lead' | 'staff';
  posKey: string; ops: boolean; wfh: boolean; hrRole?: 'head' | 'payroll';
}
interface Person extends Slot {
  idx: number; id: number; managerIdx: number | null;
  first: string; last: string; gender: 'male' | 'female'; nationality: string; email: string;
  join: string; exit: string | null; status: 'onboarding' | 'probation' | 'active' | 'notice' | 'exited';
  dob: string; locationId: number; lat: number; lng: number; shift: ShiftSeed & { id: number };
  employmentType: string; userId: number | null; pool: NamePool;
  structure: { basic: number; components: { component_id: number; value: number }[]; currency: string; effective_from: string };
}

function planOrg(org: DeptOrg[], total: number) {
  const slots: Slot[] = [];
  const weighted: { dept: DeptOrg; title: string; level: number; weight: number }[] = [];
  for (const d of org) {
    const isExec = d.code === 'EXEC';
    const sub = !!d.parent && d.parent !== 'EXEC';
    const base = { dept: d.code, ops: !!d.ops, wfh: !!d.wfh };
    slots.push({ ...base, title: d.head, level: isExec ? 10 : sub ? 7 : 8, kind: isExec ? 'ceo' : 'head', posKey: `${d.code}|${d.head}`, hrRole: d.code === 'HR' ? 'head' : undefined });
    for (const l of d.leads || []) slots.push({ ...base, title: l, level: 6, kind: 'lead', posKey: `${d.code}|${l}` });
    (d.fixed || []).forEach(([title, level, count], fi) => {
      for (let i = 0; i < count; i++) slots.push({ ...base, title, level, kind: isExec ? 'head' : 'staff', posKey: `${d.code}|${title}`, hrRole: d.code === 'HR' && fi === 0 && i === 0 ? 'payroll' : undefined });
    });
    for (const [title, level, weight] of d.staff || []) weighted.push({ dept: d, title, level, weight });
  }
  const remaining = total - slots.length;
  if (remaining < 0) throw new Error(`Org needs at least ${slots.length} people`);
  const wsum = weighted.reduce((s, w) => s + w.weight, 0);
  const alloc = weighted.map((w) => { const exact = (remaining * w.weight) / wsum; return { w, n: Math.floor(exact), frac: exact - Math.floor(exact) }; });
  let left = remaining - alloc.reduce((s, a) => s + a.n, 0);
  for (const a of [...alloc].sort((x, y) => y.frac - x.frac)) { if (left <= 0) break; a.n += 1; left -= 1; }
  for (const a of alloc) for (let i = 0; i < a.n; i++) slots.push({ dept: a.w.dept.code, title: a.w.title, level: a.w.level, kind: 'staff', posKey: `${a.w.dept.code}|${a.w.title}`, ops: !!a.w.dept.ops, wfh: !!a.w.dept.wfh });
  return slots;
}

/* ------------------------------------------------------------------ */
/* Salary bands (monthly basic) per market and level                   */
/* ------------------------------------------------------------------ */
const BANDS: Record<string, Record<number, [number, number]>> = {
  INR: { 10: [320000, 350000], 9: [220000, 280000], 8: [120000, 200000], 7: [95000, 140000], 6: [70000, 100000], 5: [42000, 70000], 4: [28000, 45000], 3: [18000, 27000] },
  AED: { 10: [42000, 45000], 9: [32000, 38000], 8: [22000, 32000], 7: [17000, 24000], 6: [12000, 18000], 5: [8000, 12000], 4: [5000, 8000], 3: [3000, 4500] },
  SAR: { 10: [46000, 50000], 9: [35000, 42000], 8: [25000, 35000], 7: [19000, 26000], 6: [14000, 20000], 5: [9000, 13000], 4: [6000, 9000], 3: [3500, 5000] },
  QAR: { 10: [37000, 40000], 9: [28000, 34000], 8: [20000, 28000], 7: [15000, 21000], 6: [11000, 16000], 5: [7000, 10000], 4: [4500, 7000], 3: [3000, 4000] },
  USD: { 10: [20000, 22000], 9: [16000, 19000], 8: [13000, 17000], 7: [11000, 14000], 6: [9000, 12000], 5: [7000, 9000], 4: [5000, 7000], 3: [4000, 5000] },
};
const ROUND_TO: Record<string, number> = { INR: 500, AED: 100, SAR: 100, QAR: 100, USD: 50 };
const ADJ: Record<string, { bonus: number; reimb: number; advance: number }> = {
  INR: { bonus: 15000, reimb: 3250, advance: 10000 }, AED: { bonus: 2500, reimb: 450, advance: 1500 }, SAR: { bonus: 2500, reimb: 420, advance: 1500 },
  QAR: { bonus: 2500, reimb: 380, advance: 1500 }, USD: { bonus: 1500, reimb: 240, advance: 500 },
};

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */
/** Fills one demo company's database (runs inside that company's tenant context). */
export function seedDemoCompany(def: DemoCompany) {
  const started = performance.now();
  const prof = PROFILES[def.slug];
  if (!prof) throw new Error(`No demo profile for company ${def.slug}`);
  const files: { stored: string; buf: Buffer }[] = [];
  transaction(() => build(def, prof, files));
  for (const f of files) fs.writeFileSync(path.join(UPLOAD_DIR, f.stored), f.buf);
  const ms = performance.now() - started;
  if (process.env.HRMS_SEED_TIMING) console.log(`[seed] ${def.slug}: ${def.employees} employees in ${ms.toFixed(0)} ms`);
  return ms;
}

function build(def: DemoCompany, prof: CompanyProfile, files: { stored: string; buf: Buffer }[]) {
  const rng = makeRng(`hrms-demo:${def.slug}`);
  const now = nowIso();
  const T = today();
  const year = Number(T.slice(0, 4));
  const cc = def.country_code;
  const gcc = isGcc(cc);
  const db = getDb();

  /* ---------- Country template (shared with the Add-company wizard) ---------- */
  const opts: CountryTemplateOpts = {
    country_code: cc, region: def.region, name: def.name, legal_name: def.legal_name, currency: def.currency, timezone: def.timezone,
    weekly_offs: def.weekly_offs, pay_day: def.pay_day, city: def.city, lat: def.lat, lng: def.lng, brand_color: def.brand_color, logo_text: def.logo_text,
    address: prof.address, phone: prof.phone, tagline: prof.tagline, accent_color: prof.accent_color, employee_code_prefix: prof.prefix,
    location_name: prof.hq_name, departments: prof.org, default_shift: prof.default_shift, remote_friendly: prof.org.some((d) => d.wfh),
  };
  const tpl = applyTemplateRows(opts);
  const payrollSettings = payrollSettingsFor(opts);

  const hq = { id: tpl.locationId, lat: def.lat, lng: def.lng, name: prof.hq_name, city: def.city };
  const site2 = prof.site2 ? { id: insert('work_locations', { name: prof.site2.name, address: prof.site2.address, lat: prof.site2.lat, lng: prof.site2.lng, radius_m: 250, active: 1, created_at: now }), ...prof.site2 } : null;
  const defaultShift = { ...(prof.default_shift || defaultShiftFor(cc)), id: tpl.shiftId };
  const opsShifts = (prof.ops_shifts || []).map((s) => ({ ...s, id: insertShift(s, def.weekly_offs) }));

  /* ---------- Holidays / weekly offs ---------- */
  const holidays = new Map(all<any>('SELECT date, name FROM holidays').map((h) => [h.date as string, h.name as string]));
  const isOff = (d: string) => def.weekly_offs.includes(dowOf(d));
  const isWorking = (d: string) => !isOff(d) && !holidays.has(d);
  const workingDaysBetween = (a: string, b: string) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (isWorking(d)) n++; return n; };
  const prevWorking = (d: string) => { while (!isWorking(d)) d = addDays(d, -1); return d; };
  const nextWorking = (d: string) => { while (!isWorking(d)) d = addDays(d, 1); return d; };

  /* ---------- Positions ---------- */
  const slots = planOrg(prof.org, def.employees);
  const deptOf = new Map(prof.org.map((d) => [d.code, d]));
  const posCount = new Map<string, number>();
  for (const s of slots) posCount.set(s.posKey, (posCount.get(s.posKey) || 0) + 1);
  const posId = new Map<string, number>();
  const headPosKey = (dept: string) => `${dept}|${deptOf.get(dept)!.head}`;
  const ceoPos = headPosKey('EXEC');
  let pn = 0;
  for (const s of slots) {
    if (posId.has(s.posKey)) continue;
    const d = deptOf.get(s.dept)!;
    let reportsTo: string | null = null;
    if (s.kind === 'ceo') reportsTo = null;
    else if (s.kind === 'head' && s.dept === 'EXEC') reportsTo = ceoPos;
    else if (s.kind === 'head') reportsTo = d.parent ? headPosKey(d.parent) : ceoPos;
    else if (s.kind === 'lead') reportsTo = headPosKey(s.dept);
    else reportsTo = d.leads?.length ? `${s.dept}|${d.leads[0]}` : headPosKey(s.dept);
    pn += 1;
    posId.set(s.posKey, insert('positions', {
      title: s.title, code: `${s.dept}-${String(pn).padStart(2, '0')}`, department_id: tpl.departments[s.dept], reports_to_position_id: reportsTo ? posId.get(reportsTo) ?? null : null,
      level: s.level, grade: `L${s.level}`, headcount: posCount.get(s.posKey), active: 1, created_at: now,
    }));
  }

  /* ---------- People: managers, status, dates ---------- */
  const order = [...slots].sort((a, b) => { const r = { ceo: 0, head: 1, lead: 2, staff: 3 }; return r[a.kind] - r[b.kind]; });
  // Heads of top-level departments first, sub-department heads after their parent's head.
  const headIdx = new Map<string, number>();
  const leadIdx = new Map<string, number[]>();
  const people: Person[] = [];
  const industryMale = /construction|oilfield|logistics/i.test(def.industry) ? 0.85 : /hospitality/i.test(def.industry) ? 0.6 : 0.52;

  // Nationalities (GCC mix; the HR head is a national — common practice, and Saudization).
  const nationalities: string[] = [];
  if (gcc) {
    const mix = GCC_MIX[cc];
    for (const [nat, share] of mix) for (let i = 0; i < Math.round(share * def.employees); i++) nationalities.push(nat);
    while (nationalities.length < def.employees) nationalities.push(mix[1][0]);
    nationalities.length = def.employees;
    rng.shuffle(nationalities);
  }
  const national = gcc ? NATIONAL_OF[cc] : cc === 'US' ? 'American' : 'Indian';

  const usedNames = new Set<string>();
  const usedEmails = new Set<string>();
  const poolFor = (nat: string): NamePool => (nat === 'Indian' && cc === 'IN' ? indianPool(def.region) : POOLS[nat] || POOLS.American);

  order.forEach((s, idx) => {
    const d = deptOf.get(s.dept)!;
    // Manager
    let managerIdx: number | null = null;
    if (s.kind === 'head') managerIdx = s.dept === 'EXEC' ? 0 : d.parent && d.parent !== 'EXEC' ? headIdx.get(d.parent) ?? 0 : 0;
    else if (s.kind === 'lead') managerIdx = headIdx.get(s.dept) ?? 0;
    else if (s.kind === 'staff') {
      const leads = leadIdx.get(s.dept);
      managerIdx = leads?.length ? leads[idx % leads.length] : headIdx.get(s.dept) ?? 0;
    }
    if ((s.kind === 'head' && s.dept !== 'EXEC') || s.kind === 'ceo') headIdx.set(s.dept, idx);
    if (s.kind === 'lead') leadIdx.set(s.dept, [...(leadIdx.get(s.dept) || []), idx]);

    // Nationality and name
    let nat = gcc ? nationalities[idx] : national;
    if (gcc && s.hrRole === 'head') {
      const j = nationalities.indexOf(national, idx);
      if (nationalities[idx] !== national && j > idx) [nationalities[idx], nationalities[j]] = [nationalities[j], nationalities[idx]];
      nat = nationalities[idx];
    }
    if (cc === 'US' && rng.chance(0.08)) nat = rng.pick(['Indian', 'British', 'Filipino']); // a few visa holders
    const maleShare = s.ops && s.kind === 'staff' ? industryMale : 0.55;
    let gender: 'male' | 'female' = rng.chance(maleShare) ? 'male' : 'female';
    if (nat === 'Bangladeshi' || nat === 'Nepali') gender = rng.chance(0.9) ? 'male' : 'female';
    const pool = poolFor(nat);
    let first = '', last = '';
    for (let tries = 0; tries < 8; tries++) {
      first = rng.pick(gender === 'male' ? pool.male : pool.female);
      last = rng.pick(pool.last);
      if (!usedNames.has(`${first} ${last}`)) break;
    }
    usedNames.add(`${first} ${last}`);
    let local = `${slugName(first)}.${slugName(last)}`;
    for (let n = 2; usedEmails.has(local); n++) local = `${slugName(first)}.${slugName(last)}${n}`;
    usedEmails.add(local);

    // Tenure
    const tenureDays = s.kind === 'ceo' ? rng.int(2700, 2950) : s.kind === 'head' ? rng.int(900, 2800) : s.kind === 'lead' ? rng.int(600, 2500) : rng.int(200, 2600);
    const join = addDays(T, -tenureDays);
    const ageMin = s.kind === 'ceo' ? 46 : s.level >= 8 ? 38 : s.level >= 6 ? 31 : 22;
    const age = ageMin + rng.int(0, s.kind === 'ceo' ? 10 : 14);
    const dob = `${year - age}-${pad2(rng.int(1, 12))}-${pad2(rng.int(1, 28))}`;

    const loc = site2 && s.ops && s.kind !== 'head' && rng.chance(0.4) ? site2 : hq;
    const shift = s.ops && opsShifts.length && s.kind !== 'head' ? opsShifts[idx % opsShifts.length] : defaultShift;
    const mix = prof.employment_mix || [['full_time', 1]];
    let employmentType = s.kind === 'staff' ? rng.weighted(mix as [string, number][]) : 'full_time';
    if (employmentType === 'intern' && s.level > 3) employmentType = 'full_time';

    people.push({
      ...s, idx, id: 0, managerIdx, first, last, gender, nationality: NATIONALITY_LABEL[nat] || nat, email: `${local}@${def.slug}.example`,
      join, exit: null, status: 'active', dob, pool, locationId: loc.id, lat: loc.lat, lng: loc.lng, shift, employmentType, userId: null,
      structure: { basic: 0, components: [], currency: def.currency, effective_from: join },
    });
  });

  // Lifecycle: recent joiners, people serving notice, leavers (staff without reports only).
  const reportsOf = (i: number) => people.filter((p) => p.managerIdx === i);
  const plainStaff = people.filter((p) => p.kind === 'staff' && !p.hrRole && reportsOf(p.idx).length === 0);
  const pickStaff = () => {
    const free = plainStaff.filter((p) => p.status === 'active' && p.join <= addDays(T, -200));
    return free[rng.int(0, free.length - 1)];
  };
  const onboard = pickStaff(); onboard.join = addDays(T, -3); onboard.status = 'onboarding';
  // Joins land on the 1st or 15th and exits on a month end, so no payslip covers just a day or two.
  const snapJoin = (d: string) => `${d.slice(0, 8)}${Number(d.slice(8)) >= 15 ? '15' : '01'}`;
  for (const daysAgo of [24, 52, 95]) { const p = pickStaff(); p.join = snapJoin(addDays(T, -daysAgo)); p.status = 'probation'; }
  for (const p of people) if (p.status === 'active' && daysBetween(p.join, T) < 180) p.status = 'probation';
  const notice = pickStaff(); notice.status = 'notice'; notice.exit = addDays(T, 21);
  if (def.employees >= 60) { const n2 = pickStaff(); n2.status = 'notice'; n2.exit = addDays(T, 40); }
  for (const monthsAgo of [1, 2]) { const p = pickStaff(); p.status = 'exited'; p.exit = addDays(`${monthShift(T.slice(0, 7), -monthsAgo + 1)}-01`, -1); }

  /* ---------- Insert employees ---------- */
  const codeOf = (i: number) => `${prof.prefix}${String(i + 1).padStart(4, '0')}`;
  const regionalBank = IN_REGIONAL_BANK[def.region];
  for (const p of people) {
    const birthYear = Number(p.dob.slice(0, 4));
    let bank_name: string, account: string, ifsc: string, tax_id: string, pf: string | null = null;
    const custom: Record<string, any> = { blood_group: rng.pick(['O+', 'O+', 'B+', 'A+', 'AB+', 'O-', 'A-', 'B-']) };
    if (cc === 'IN') {
      const [bn, code] = regionalBank && rng.chance(0.25) ? regionalBank : rng.pick(IN_BANKS);
      bank_name = bn; ifsc = code + rng.digits(6); account = rng.digits(rng.pick([12, 13, 14]));
      tax_id = rng.letters(3) + 'P' + p.last[0].toUpperCase() + rng.digits(4) + rng.letters(1);
      pf = '10' + rng.digits(10);
      custom.uan = pf; custom.aadhaar_last4 = rng.digits(4); custom.tshirt_size = rng.pick(['S', 'M', 'M', 'L', 'XL']);
    } else if (gcc) {
      const [bn, swift, code] = rng.pick(GCC_BANKS[cc]);
      bank_name = bn; ifsc = swift;
      account = cc === 'AE' ? iban('AE', code + rng.digits(16)) : cc === 'SA' ? iban('SA', code + rng.digits(18)) : iban('QA', code + rng.digits(21));
      const isNational = p.nationality === NATIONALITY_LABEL[national];
      if (cc === 'AE') tax_id = `784-${birthYear}-${rng.digits(7)}-${rng.digits(1)}`;
      else if (cc === 'SA') tax_id = (isNational ? '1' : '2') + rng.digits(9);
      else tax_id = `${birthYear < 2000 ? '2' : '3'}${String(birthYear).slice(2)}${QID_COUNTRY[p.nationality] || '356'}${rng.digits(5)}`;
      if (!isNational) {
        custom.passport_number = rng.letters(1) + rng.digits(7);
        custom.visa_expiry = addDays(T, rng.int(40, 720));
        custom.sponsor = def.legal_name;
      }
      custom.hajj_eligible = isNational || ['Pakistani', 'Egyptian', 'Jordanian', 'Bangladeshi'].includes(p.nationality) ? rng.chance(0.5) : false;
    } else {
      const [bn, routing] = rng.pick(US_BANKS[def.region] || US_BANKS['New York']);
      bank_name = bn; ifsc = routing; account = rng.digits(rng.pick([10, 11, 12]));
      tax_id = `***-**-${rng.digits(4)}`; // SSNs are never stored in full in the demo
      custom.w4_filing_status = rng.weighted([['Single', 5], ['Married filing jointly', 4], ['Head of household', 1]] as const);
      custom.work_authorization = p.nationality === 'American' ? rng.weighted([['US citizen', 9], ['Permanent resident', 1]] as const) : rng.pick(['H-1B', 'L-1', 'OPT / EAD']);
      custom.state = def.region;
    }
    const city = p.locationId === hq.id ? def.city : site2?.city || def.city;
    const relation = rng.pick(gcc || cc === 'IN' ? ['Spouse', 'Father', 'Mother', 'Brother'] : ['Spouse', 'Partner', 'Mother', 'Father', 'Sister']);
    const confirmation = daysBetween(p.join, T) >= 180 ? addDays(p.join, 180) : null;
    p.id = insert('employees', {
      employee_code: codeOf(p.idx), first_name: p.first, last_name: p.last, email: p.email, phone: phoneFor(cc, rng, def.region), dob: p.dob, gender: p.gender,
      marital_status: daysBetween(p.dob, T) > 365 * 30 ? rng.weighted([['married', 3], ['single', 1]] as const) : rng.weighted([['single', 3], ['married', 1]] as const),
      nationality: p.nationality, address: `${rng.int(1, 240)}, ${city}, ${def.region}`, city, country: def.country,
      department_id: tpl.departments[p.dept], position_id: posId.get(p.posKey), manager_id: p.managerIdx !== null ? people[p.managerIdx].id : null,
      work_location_id: p.locationId, shift_id: p.shift.id, join_date: p.join, confirmation_date: confirmation, exit_date: p.exit,
      employment_type: p.employmentType, status: p.status,
      emergency_contact_name: `${relation === 'Spouse' || relation === 'Partner' ? rng.pick(p.pool[p.gender === 'male' ? 'female' : 'male']) : rng.pick(p.pool.male)} ${p.last} (${relation})`,
      emergency_contact_phone: phoneFor(cc, rng, def.region),
      bank_name, bank_account_name: `${p.first} ${p.last}`, bank_account_number: account, bank_ifsc: ifsc, tax_id, pf_number: pf,
      custom_fields: custom, notes: p.status === 'notice' ? `Resigned; last working day ${p.exit}` : p.status === 'exited' ? 'Resigned — full and final settlement processed' : null,
      created_at: now, updated_at: now,
    });
  }
  for (const [dept, i] of headIdx) run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [people[i].id, tpl.departments[dept]]);

  /* ---------- Logins ---------- */
  const hash = demoHash();
  const user = (email: string, role: string, p: Person) => { p.userId = insert('users', { email, password_hash: hash, role, employee_id: p.id, active: 1, must_change_password: 0, created_at: now }); return p.userId; };
  const hrHead = people.find((p) => p.hrRole === 'head')!;
  const payrollP = people.find((p) => p.hrRole === 'payroll')!;
  const activeReports = (i: number) => reportsOf(i).filter((r) => r.status === 'active');
  const mgrCandidates = people.filter((p) => (p.kind === 'lead' || p.kind === 'head') && p.dept !== 'HR' && p.dept !== 'EXEC').sort((a, b) => activeReports(b.idx).length - activeReports(a.idx).length || (a.kind === 'lead' ? -1 : 1));
  const mgr = mgrCandidates[0];
  const emp = activeReports(mgr.idx).find((r) => r.kind === 'staff') || activeReports(mgr.idx)[0];
  const hrUserId = user(`hr@${def.slug}.example`, 'hr', hrHead);
  const payrollUserId = user(`payroll@${def.slug}.example`, 'hr', payrollP);
  user(`manager@${def.slug}.example`, 'manager', mgr);
  user(`employee@${def.slug}.example`, 'employee', emp);
  /** First person up the chain with a login (the default approver), else the HR head. */
  const approverOf = (p: Person): Person => { let m = p.managerIdx; while (m !== null) { if (people[m].userId) return people[m]; m = people[m].managerIdx; } return hrHead; };

  /* ---------- Salary structures ---------- */
  const band = BANDS[def.currency];
  const step = ROUND_TO[def.currency];
  const fyStartMonth = cc === 'IN' ? 4 : 1;
  let fyStart = `${year}-${pad2(fyStartMonth)}-01`;
  while (fyStart > addDays(T, -120)) fyStart = `${Number(fyStart.slice(0, 4)) - 1}-${fyStart.slice(5)}`;
  const comp = tpl.components;
  for (const p of people) {
    const [lo, hi] = band[p.level] || band[4];
    const basic = Math.round((lo + rng.next() * (hi - lo)) / step) * step;
    const overrides: { component_id: number; value: number }[] = [];
    let ctc = basic * 12;
    const isNational = gcc && p.nationality === NATIONALITY_LABEL[national];
    if (cc === 'IN') {
      const spl = Math.round((basic * (0.15 + rng.next() * 0.2)) / 100) * 100;
      overrides.push({ component_id: comp.SPL, value: spl });
      const hraPct = def.city === 'Mumbai' ? 50 : 40;
      ctc = Math.round((basic * (1 + hraPct / 100) + 1600 + spl + Math.min(basic, 15000) * 0.12) * 12);
    } else if (gcc) {
      const housing = rng.pick([25, 25, 30, 30, 35]);
      overrides.push({ component_id: comp.HOUSING, value: housing });
      let transport = 0;
      if (cc !== 'SA') { transport = p.level >= 8 ? 2000 : p.level >= 6 ? 1500 : cc === 'AE' ? 1000 : 800; overrides.push({ component_id: comp.TRANSPORT, value: transport }); }
      else transport = basic * 0.1;
      if (isNational) {
        if (cc === 'AE') overrides.push({ component_id: comp.GPSSA, value: 11 });
        if (cc === 'SA') overrides.push({ component_id: comp.GOSI, value: round2(9.75 * (1 + housing / 100)) }); // 9.75% of basic + housing
        if (cc === 'QA') overrides.push({ component_id: comp.GRSIA, value: 7 });
      }
      ctc = Math.round((basic * (1 + housing / 100) + transport) * 12);
    } else if (rng.chance(0.6)) {
      overrides.push({ component_id: comp.K401, value: 4 });
    }
    p.structure = { basic, components: overrides, currency: def.currency, effective_from: p.join > fyStart ? p.join : fyStart };
    insert('salary_structures', { employee_id: p.id, effective_from: p.structure.effective_from, currency: def.currency, basic, components: overrides, ctc_annual: ctc, notes: isNational ? 'National: social insurance applies' : null, created_by: hrUserId, created_at: now });
  }

  /* ---------- Leave: balances, history, requests ---------- */
  const lt = tpl.leaveTypes;
  const types = all<any>('SELECT * FROM leave_types');
  const mainCode = cc === 'IN' ? 'CL' : cc === 'US' ? 'PTO' : 'AL';
  const balIns = db.prepare('INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated, carried, adjusted, used) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const current = people.filter((p) => p.status !== 'exited');
  for (const p of current) {
    const joinedThisYear = p.join > `${year}-01-01`;
    const monthsLeft = joinedThisYear ? 12 - Number(p.join.slice(5, 7)) + 1 : 12;
    for (const t of types) {
      const accrual = t.paid && t.annual_quota <= 30 && t.code !== 'SL' && t.code !== 'CO';
      const allocated = joinedThisYear && accrual ? Math.round((t.annual_quota * monthsLeft) / 12 * 2) / 2 : t.annual_quota;
      const carried = t.carry_forward && !joinedThisYear && p.join < `${year - 1}-07-01` ? rng.int(0, Math.min(t.max_carry_forward, 8)) : 0;
      balIns.run(p.id, t.id, year, allocated, carried, 0, 0);
    }
  }
  const leaveDays = new Map<number, Set<string>>();
  const useLeave = (p: Person, typeId: number, days: number, start: string, end: string) => {
    run('UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [days, p.id, typeId, year]);
    const set = leaveDays.get(p.id) || new Set<string>();
    for (let d = start; d <= end; d = addDays(d, 1)) if (isWorking(d)) set.add(d);
    leaveDays.set(p.id, set);
  };
  const leave = (p: Person, code: string, start: string, len: number, status: string, reason: string, reviewNote: string | null = null) => {
    start = nextWorking(start);
    let end = start, n = 1;
    while (n < len) { end = addDays(end, 1); if (isWorking(end)) n++; }
    const days = workingDaysBetween(start, end);
    const approver = approverOf(p);
    const appliedOn = addDays(start, status === 'pending' ? -3 : -rng.int(5, 15));
    const created = `${appliedOn < T ? appliedOn : addDays(T, -1)}T05:30:00.000Z`;
    const reviewed = status === 'approved' || status === 'rejected';
    const id = insert('leave_requests', { employee_id: p.id, leave_type_id: lt[code], start_date: start, end_date: end, days, reason, status, requested_by: p.userId, approver_employee_id: approver.id, reviewed_by: reviewed ? approver.userId : null, reviewed_at: reviewed ? created.replace('T05', 'T09') : null, review_note: reviewNote, created_at: created, updated_at: created });
    insert('leave_history', { leave_request_id: id, action: 'applied', by_user: p.userId, note: reason, created_at: created });
    if (reviewed) insert('leave_history', { leave_request_id: id, action: status, by_user: approver.userId, note: reviewNote, created_at: created.replace('T05', 'T09') });
    if (status === 'cancelled') insert('leave_history', { leave_request_id: id, action: 'cancelled', by_user: p.userId, note: 'Plans changed', created_at: created.replace('T05', 'T07') });
    if (status === 'approved') useLeave(p, lt[code], days, start, end);
  };
  // Earlier this year: approved leave for ~35% of people (before the attendance window).
  const windowStart = addDays(T, -60);
  const histEnd = addDays(windowStart, -3);
  const yearStart = `${year}-01-05`;
  if (histEnd > yearStart) {
    for (const p of current) {
      if (!rng.chance(0.35) || p.join > yearStart) continue;
      const span = daysBetween(yearStart, histEnd);
      const code = rng.weighted([[mainCode, 5], ['SL', 3], [cc === 'IN' ? 'EL' : mainCode, 2]] as const);
      leave(p, code, addDays(yearStart, rng.int(0, Math.max(0, span - 5))), rng.int(1, 3), 'approved', code === 'SL' ? rng.pick(['Fever', 'Viral infection', 'Medical appointment']) : rng.pick(['Family function', 'Personal work', 'Vacation', 'Travel home']));
    }
  }
  // Visible requests around today.
  const pool = rng.shuffle(current.filter((p) => p.status === 'active' && p !== emp && p.kind !== 'ceo'));
  let li = 0;
  const nextP = () => pool[li++ % pool.length];
  leave(emp, mainCode, addDays(T, 9), 2, 'pending', 'Family trip');
  leave(nextP(), mainCode, addDays(T, 5), 3, 'pending', gcc ? 'Annual vacation home' : 'Vacation');
  leave(nextP(), 'SL', addDays(T, 1), 1, 'pending', 'Doctor appointment');
  leave(nextP(), 'SL', addDays(T, -12), 2, 'approved', 'Fever');
  leave(nextP(), mainCode, addDays(T, -26), 3, 'approved', 'Personal work');
  leave(nextP(), mainCode, addDays(T, -45), 2, 'approved', 'Family function');
  leave(nextP(), mainCode, addDays(T, 18), 4, 'approved', gcc ? 'Annual leave — travelling home' : 'Planned vacation');
  leave(nextP(), mainCode, addDays(T, -8), 2, 'rejected', 'Short trip', 'Month-end close — please pick another week');
  leave(nextP(), mainCode, addDays(T, 30), 1, 'cancelled', 'Personal work');
  if (cc === 'SA') leave(nextP(), 'MR', addDays(T, 24), 5, 'pending', 'Marriage');
  if (cc === 'US') leave(nextP(), 'PL', addDays(T, 35), 10, 'pending', 'Parental leave — new baby');

  /* ---------- Attendance (last ~60 days, local times → UTC) ---------- */
  const std = cc === 'IN' ? 540 : 480;
  const offsetCache = new Map<string, number>();
  const utc = (date: string, minutes: number) => {
    let off = offsetCache.get(date);
    if (off === undefined) { off = zoneOffsetMinutes(def.timezone, new Date(date + 'T12:00:00Z')); offsetCache.set(date, off); }
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + (minutes - off) * 60000).toISOString();
  };
  const attIns = db.prepare(`INSERT INTO attendance_records (employee_id, date, punch_in_at, punch_in_lat, punch_in_lng, punch_in_location_id, punch_in_within_fence, punch_in_distance_m,
    punch_out_at, punch_out_lat, punch_out_lng, punch_out_location_id, punch_out_within_fence, punch_out_distance_m, status, work_minutes, break_minutes, overtime_minutes, late_minutes, source, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'punch', ?, ?, ?)`);
  const brkIns = db.prepare('INSERT INTO attendance_breaks (attendance_id, type, start_at, end_at, minutes) VALUES (?, ?, ?, ?, ?)');
  const geo = (p: Person, remote: boolean) => {
    if (remote) { const lat = p.lat + (rng.next() - 0.5) * 0.12, lng = p.lng + (rng.next() - 0.5) * 0.12; return { lat, lng, loc: null, within: 0, dist: Math.round(distanceMeters(p.lat, p.lng, lat, lng)) }; }
    const far = rng.chance(0.01);
    const j = far ? 0.003 : 0.0004;
    const lat = p.lat + (rng.next() - 0.5) * j, lng = p.lng + (rng.next() - 0.5) * j;
    const dist = Math.round(distanceMeters(p.lat, p.lng, lat, lng));
    return { lat: round6(lat), lng: round6(lng), loc: p.locationId, within: dist <= 200 ? 1 : 0, dist };
  };
  const punch = (stmt: StatementSync, p: Person, date: string, opts: { late?: number; status?: string; outEarly?: number; noOut?: boolean; note?: string | null; extraOut?: number }) => {
    const start = toMin(p.shift.start_time);
    const span = (toMin(p.shift.end_time) - start + 1440) % 1440;
    const late = opts.late ?? 0;
    const inMin = start + (late > 0 ? late : -rng.int(0, 20) + rng.int(0, 9));
    const outMin = opts.outEarly ? inMin + opts.outEarly : start + span + rng.int(-5, 40) + (opts.extraOut ?? 0);
    const remote = opts.status === 'wfh';
    const gi = geo(p, remote), go = geo(p, remote);
    const allowed = p.shift.break_minutes_allowed ?? 60;
    const brk = opts.outEarly ? 0 : Math.max(20, allowed - rng.int(0, 15));
    const work = opts.noOut ? 0 : outMin - inMin - brk;
    const inAt = utc(date, inMin), outAt = opts.noOut ? null : utc(date, outMin);
    const id = Number(stmt.run(p.id, date, inAt, gi.lat, gi.lng, gi.loc, gi.within, gi.dist, outAt, outAt ? go.lat : null, outAt ? go.lng : null, outAt ? go.loc : null, outAt ? go.within : null, outAt ? go.dist : null,
      opts.status || 'present', work, brk, Math.max(0, work - std), late > (p.shift.grace_minutes ?? 10) ? late : 0, opts.note ?? null, now, now).lastInsertRowid);
    if (brk) { const bs = inMin + Math.min(240, Math.floor((outMin - inMin) / 2)); brkIns.run(id, 'lunch', utc(date, bs), utc(date, bs + brk), brk); }
    return id;
  };
  const activeOn = (p: Person, d: string) => p.join <= d && (!p.exit || p.exit >= d);
  const specialDays = new Map<string, string>(); // `${empId}|${date}` → kind (corrections)
  const yesterday = addDays(T, -1);
  const lastWorking = prevWorking(yesterday);
  const corrTargets = rng.shuffle(current.filter((p) => p.status === 'active' && p !== mgr && p.join < windowStart)).slice(0, 3);
  if (corrTargets[0]) specialDays.set(`${corrTargets[0].id}|${lastWorking}`, 'missed_punch_out');
  if (corrTargets[1]) specialDays.set(`${corrTargets[1].id}|${prevWorking(addDays(lastWorking, -1))}`, 'missed_both');
  for (let d = windowStart; d <= yesterday; d = addDays(d, 1)) {
    if (!isWorking(d)) continue;
    for (const p of people) {
      if (!activeOn(p, d)) continue;
      if (leaveDays.get(p.id)?.has(d)) continue;
      const special = specialDays.get(`${p.id}|${d}`);
      if (special === 'missed_both') continue;
      if (special === 'missed_punch_out') { punch(attIns, p, d, { noOut: true }); continue; }
      if (rng.chance(0.02)) continue; // absent (no punch)
      if (rng.chance(0.01)) { punch(attIns, p, d, { status: 'half_day', outEarly: rng.int(250, 290), note: 'Left early — half day' }); continue; }
      const wfh = p.wfh && rng.chance(0.15);
      punch(attIns, p, d, { late: rng.chance(0.08) ? rng.int(12, 55) : 0, status: wfh ? 'wfh' : 'present' });
    }
  }
  // Weekend / weekly-off work for a few people: feeds the comp-off auto-detection demo.
  let offDay = addDays(T, -2);
  while (!(isOff(offDay) && !holidays.has(offDay))) offDay = addDays(offDay, -1);
  const weekendCrew = rng.shuffle(current.filter((p) => p.status === 'active' && p.kind === 'staff' && p !== emp && !p.hrRole)).slice(0, 3);
  for (const p of weekendCrew) punch(attIns, p, offDay, { extraOut: 0, note: rng.pick(['Weekend shipment / stock count', 'Weekend release support', 'Month-end support on weekly off']) });
  // Pending attendance appeals.
  const corr = (p: Person | undefined, date: string, kind: string, extra: Record<string, any>, reason: string) => {
    if (!p) return;
    insert('attendance_corrections', { employee_id: p.id, date, kind, reason, status: 'pending', requested_by: p.userId ?? hrUserId, approver_employee_id: approverOf(p).id, created_at: `${T}T04:00:00.000Z`, ...extra });
  };
  const shiftEnd = (p: Person) => toMin(p.shift.end_time);
  if (corrTargets[0]) corr(corrTargets[0], lastWorking, 'missed_punch_out', { requested_punch_out: utc(lastWorking, shiftEnd(corrTargets[0]) + 10) }, 'Forgot to punch out — left after the evening handover');
  if (corrTargets[1]) { const d = prevWorking(addDays(lastWorking, -1)); corr(corrTargets[1], d, 'missed_both', { requested_punch_in: utc(d, toMin(corrTargets[1].shift.start_time)), requested_punch_out: utc(d, shiftEnd(corrTargets[1])) }, 'Was at a client / site visit all day; phone battery died'); }
  if (corrTargets[2]) corr(corrTargets[2], lastWorking, 'correction', { requested_punch_in: utc(lastWorking, toMin(corrTargets[2].shift.start_time) - 5) }, 'Biometric reader at the entrance was down in the morning');

  /* ---------- Payroll history ---------- */
  const thisPeriod = T.slice(0, 7);
  const payDate = (period: string) => {
    const [y, m] = period.split('-').map(Number);
    const dim = daysInMonth(y, m);
    const day = def.pay_day === 'last_working_day' ? dim : Math.min(def.pay_day, dim);
    return prevWorking(`${period}-${pad2(day)}`);
  };
  const adjustments: { p: Person; type: string; amount: number; note: string }[] = [];
  {
    const a = ADJ[def.currency];
    const sales = current.find((p) => /sales|account|business/i.test(p.title) && p.status === 'active') || pool[0];
    adjustments.push({ p: sales, type: 'bonus', amount: a.bonus, note: 'Quarterly performance bonus' });
    adjustments.push({ p: pool[1], type: 'reimbursement', amount: a.reimb, note: 'Travel reimbursement' });
    adjustments.push({ p: pool[2], type: 'advance', amount: a.advance, note: 'Salary advance recovery' });
    for (const x of adjustments) insert('payroll_adjustments', { employee_id: x.p.id, period: thisPeriod, type: x.type, amount: x.amount, note: x.note, created_by: payrollUserId, created_at: `${addDays(T, -4)}T06:00:00.000Z` });
  }
  const payslipIns = db.prepare(`INSERT INTO payslips (run_id, employee_id, working_days, paid_days, lop_days, basic, earnings, deductions, gross, total_deductions, net, currency, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const makeRun = (period: string, status: 'draft' | 'processed' | 'approved' | 'paid', stamps: { created: string; processed?: string; approved?: string; paid?: string }) => {
    const [y, m] = period.split('-').map(Number);
    const dim = daysInMonth(y, m);
    const start = `${period}-01`, end = `${period}-${pad2(dim)}`;
    const runId = insert('payroll_runs', { period, status, working_days: dim, totals: {}, notes: null, created_by: payrollUserId, created_at: stamps.created, processed_at: stamps.processed ?? null, approved_at: stamps.approved ?? null, paid_at: stamps.paid ?? null, approved_by: stamps.approved ? hrUserId : null });
    if (status === 'draft') return runId;
    const totals = { employees: 0, gross: 0, deductions: 0, net: 0, skipped: 0 };
    for (const p of people) {
      if (p.join > end || (p.exit && p.exit < start) || p.structure.effective_from > end) continue;
      const from = p.join > start ? p.join : start;
      const to = p.exit && p.exit < end ? p.exit : end;
      let lop = dim - (daysBetween(from, to) + 1);
      if (period !== thisPeriod && rng.chance(0.04)) lop += 1;
      const paid = dim - lop;
      const adj = period === thisPeriod ? adjustments.filter((a) => a.p === p).map((a, i) => ({ id: i + 1, type: a.type, amount: a.amount, note: a.note })) : [];
      const b = computeBreakdown(p.structure, paid / dim, adj, payrollSettings as any);
      payslipIns.run(runId, p.id, dim, paid, lop, b.basic, JSON.stringify(b.earnings), JSON.stringify(b.deductions), b.gross, b.total_deductions, b.net, def.currency, lop ? `Loss of pay: ${lop} day(s)` : null, status === 'paid' ? 'paid' : 'generated', stamps.processed!);
      totals.employees += 1; totals.gross += b.gross; totals.deductions += b.total_deductions; totals.net += b.net;
    }
    run('UPDATE payroll_runs SET totals = ? WHERE id = ?', [JSON.stringify({ ...totals, gross: round2(totals.gross), deductions: round2(totals.deductions), net: round2(totals.net) }), runId]);
    return runId;
  };
  const stamp = (d: string, hh: number) => `${d}T${pad2(hh)}:00:00.000Z`;
  for (const k of [3, 2, 1]) {
    const period = monthShift(thisPeriod, -k);
    const pd = payDate(period);
    makeRun(period, 'paid', { created: stamp(addDays(pd, -7), 5), processed: stamp(addDays(pd, -3), 9), approved: stamp(addDays(pd, -2), 11), paid: stamp(pd, 6) });
  }
  if (def.run_state !== 'none') {
    const created = stamp(addDays(T, -2), 5);
    if (def.run_state === 'draft') makeRun(thisPeriod, 'draft', { created });
    else if (def.run_state === 'processed') makeRun(thisPeriod, 'processed', { created, processed: stamp(addDays(T, -1), 9) });
    else makeRun(thisPeriod, 'approved', { created, processed: stamp(addDays(T, -2), 9), approved: stamp(addDays(T, -1), 11) });
  }

  /* ---------- Documents (≤ 25 small files) ---------- */
  const dt = tpl.docTypes;
  const docPeople = rng.shuffle(current.filter((p) => p.status !== 'onboarding')).slice(0, Math.min(24, Math.round(def.employees * 0.4)));
  const expiryPlan = gcc ? [5, 12, 19, 26, -6, -15] : [9, 23, -11];   // a handful expiring within 30 days, a couple expired
  let expIdx = 0;
  const docTypeRows = new Map(all<any>('SELECT id, name, requires_expiry, allowed_formats FROM document_types').map((r) => [r.id as number, r]));
  docPeople.forEach((p, i) => {
    const isNational = p.nationality === NATIONALITY_LABEL[national];
    let key: string;
    if (cc === 'IN') key = ['passport', 'pan', 'dl', 'aadhaar', 'contract', 'degree'][i % 6];
    else if (gcc) key = isNational ? ['national_id', 'passport', 'insurance', 'contract'][i % 4] : ['visa', 'passport', 'work_permit', 'national_id', 'insurance', 'contract'][i % 6];
    else if (dt.license && /nurse|physician|practitioner/i.test(p.title)) key = 'license';
    else key = ['dl', 'i9', 'w4', 'state_id', p.nationality !== 'American' ? 'work_auth' : 'w4'][i % 5];
    if (cc === 'SA' && key === 'national_id' && !isNational) key = 'visa';
    const typeId = dt[key];
    const typeRow = typeId ? docTypeRows.get(typeId) : null;
    if (!typeId || !typeRow) return;
    const formats: string[] = JSON.parse(typeRow.allowed_formats);
    const fmt = formats[i % formats.length];
    const expiry = typeRow.requires_expiry ? addDays(T, expIdx < expiryPlan.length ? expiryPlan[expIdx++] : rng.int(60, 900)) : null;
    const title = typeRow.name;
    const stored = `doc_${def.slug}_${p.id}_${typeId}.${fmt}`;
    const buf = sampleFile(fmt, `${title} - ${p.first} ${p.last}`);
    files.push({ stored, buf });
    const number = key === 'pan' ? `${rng.letters(5)}${rng.digits(4)}${rng.letters(1)}` : key === 'aadhaar' ? `XXXX XXXX ${rng.digits(4)}` : key === 'passport' ? `${rng.letters(1)}${rng.digits(7)}` : key === 'i9' || key === 'w4' ? null : `${key.toUpperCase().slice(0, 3)}-${rng.digits(8)}`;
    const issued = expiry ? addDays(expiry, -365 * (key === 'passport' ? 10 : 2)) : p.join;
    insert('documents', { employee_id: p.id, document_type_id: typeId, title, original_name: `${title.replace(/[^A-Za-z0-9]+/g, '_')}_${p.last.replace(/[^A-Za-z]/g, '')}.${fmt}`, stored_name: stored, mime: fmt === 'pdf' ? 'application/pdf' : fmt === 'png' ? 'image/png' : 'image/jpeg', format: fmt, size_bytes: buf.length, issued_date: issued, expiry_date: expiry, document_number: number, status: 'valid', uploaded_by: hrUserId, created_at: stamp(p.join > addDays(T, -400) ? p.join : addDays(T, -rng.int(30, 400)), 6) });
  });

  /* ---------- Recruitment ---------- */
  const allSkills = prof.vacancies.flatMap((v) => v.skills);
  const candPool = gcc ? ['Indian', 'Filipino', 'Egyptian', 'Pakistani', NATIONAL_OF[cc], 'Jordanian'] : [cc === 'US' ? 'American' : 'Indian'];
  const stages = ['new', 'screening', 'interview', 'offer', 'rejected', 'new'];
  let ci = 0;
  prof.vacancies.forEach((v, vi) => {
    const vd = deptOf.get(v.dept)!;
    const posKey = vd.staff?.length ? `${v.dept}|${vd.staff[0][0]}` : headPosKey(v.dept);
    const positionId = posKey ? posId.get(posKey)! : null;
    const jdId = insert('job_descriptions', { title: v.title, position_id: positionId, department_id: tpl.departments[v.dept], summary: v.summary, responsibilities: v.responsibilities, requirements: v.requirements, skills: v.skills, employment_type: 'full_time', experience_min: v.experience_min, experience_max: v.experience_max, salary_min: v.salary_min, salary_max: v.salary_max, location: v.dept && site2 && deptOf.get(v.dept)?.ops ? `${def.city} / ${site2.city}` : def.city, status: 'published', version: 1, created_by: hrUserId, created_at: now, updated_at: now });
    const vacId = insert('vacancies', { title: v.title, position_id: positionId, department_id: tpl.departments[v.dept], job_description_id: jdId, openings: v.openings, budget_annual: v.budget_annual, status: 'open', raised_by: hrUserId, opened_at: addDays(T, -rng.int(8, 40)), notes: null, created_at: now });
    const n = prof.vacancies.length === 1 ? 5 : vi === 0 ? 4 : 2;
    for (let k = 0; k < n; k++, ci++) {
      const stage = stages[ci % stages.length];
      const nat = rng.pick(candPool);
      const pl = poolFor(nat);
      const g = rng.chance(0.5) ? 'male' : 'female';
      const first = rng.pick(pl[g]), last = rng.pick(pl.last);
      const email = `${slugName(first)}.${slugName(last)}${rng.int(1, 99)}@example.com`;
      const phone = phoneFor(cc, rng, def.region);
      const yearsExp = Math.max(0, v.experience_min + rng.int(-1, v.experience_max - v.experience_min + 1));
      const skills = rng.shuffle([...v.skills]).slice(0, Math.max(2, v.skills.length - rng.int(0, 2)));
      const prevCo = rng.pick(['Northwind Group', 'Blue Harbor Co.', 'Summit Partners', 'Crescent Holdings', 'Atlas Services']);
      const cv = `${first} ${last}\n${v.title}\n${email} | ${phone} | ${def.city}\n\nSummary\n${v.title} with ${yearsExp} years of experience. ${v.summary}\n\nSkills\n${skills.join(', ')}\n\nExperience\n${v.title}, ${prevCo} (${year - yearsExp} - Present)\n- ${v.responsibilities[0]}.\n- ${v.responsibilities[1] || v.responsibilities[0]}.\n\nEducation\n${rng.pick(["Bachelor's degree", 'B.Sc', 'Diploma', 'B.Tech', 'MBA'])}, ${rng.pick(['State University', 'Institute of Technology', 'City College'])} (${year - yearsExp - 4} - ${year - yearsExp})`;
      const parsed = parseCv(cv, allSkills);
      const { score, breakdown } = scoreCv(parsed, cv, { id: jdId, title: v.title, skills: v.skills, requirements: v.requirements, experience_min: v.experience_min, experience_max: v.experience_max } as any);
      const createdAgo = rng.int(1, 25);
      const at = (ago: number, hh = 6) => stamp(addDays(T, -ago), hh);
      const candId = insert('candidates', { first_name: first, last_name: last, email, phone, source: rng.pick(['LinkedIn', 'Careers page', 'Referral', 'Job board', 'Agency']), vacancy_id: vacId, position_id: positionId, cv_original_name: null, cv_stored_name: null, cv_mime: null, cv_text: cv, parsed, score, score_breakdown: breakdown, stage, rating: stage === 'new' ? null : rng.int(2, 5), expected_salary: Math.round((v.salary_min + rng.next() * (v.salary_max - v.salary_min)) / 1000) * 1000, notice_days: rng.pick([0, 15, 30, 30, 60, 90]), created_by: hrUserId, created_at: at(createdAgo), updated_at: at(Math.max(0, createdAgo - 2)) });
      insert('candidate_events', { candidate_id: candId, type: 'score', note: `Scored ${score} against ${v.title}`, data: JSON.stringify({ score, jd_id: jdId }), by_user: hrUserId, created_at: at(createdAgo) });
      const path_ = stage === 'rejected' ? ['screening', 'rejected'] : ['screening', 'interview', 'offer'].slice(0, ['new', 'screening', 'interview', 'offer'].indexOf(stage));
      let prev = 'new';
      path_.forEach((to, si) => { insert('candidate_events', { candidate_id: candId, type: 'stage_change', note: to === 'rejected' ? 'Not a fit for the role requirements' : null, data: JSON.stringify({ from: prev, to }), by_user: hrUserId, created_at: at(Math.max(0, createdAgo - 1 - si), 8) }); prev = to; });
    }
  });

  /* ---------- Assets ---------- */
  const holders = rng.shuffle(current.filter((p) => p.status !== 'onboarding' && p !== emp));
  prof.assets.forEach(([name, category, model, vendor, cost], i) => {
    const assigned = i < Math.ceil(prof.assets.length * 0.6);
    const holder = i === 0 ? emp : holders[i];
    const purchase = addDays(T, -rng.int(120, 900));
    const id = insert('assets', { asset_tag: `${prof.prefix}-AST-${String(i + 1).padStart(3, '0')}`, name, category, serial_number: `${vendor.slice(0, 3).toUpperCase()}${rng.digits(7)}`, model, vendor, purchase_date: purchase, purchase_cost: cost, warranty_expiry: addDays(purchase, i === 1 ? daysBetween(purchase, T) + 20 : 365 * 3), status: assigned ? 'assigned' : i === prof.assets.length - 1 ? 'maintenance' : 'available', condition: 'good', location: hq.name, specs: category === 'Laptop' ? { ram: '16 GB', storage: '512 GB SSD' } : {}, created_at: now, updated_at: now });
    if (assigned && holder) insert('asset_assignments', { asset_id: id, employee_id: holder.id, assigned_at: stamp(holder.join > purchase ? holder.join : purchase, 5), assigned_by: hrUserId, condition_out: 'good', notes: i === 0 ? 'Primary device' : null });
  });

  /* ---------- Journeys ---------- */
  const templates = all<any>('SELECT * FROM journey_stage_templates ORDER BY sort_order');
  const jIns = db.prepare(`INSERT INTO journey_stages (employee_id, template_id, name, description, sort_order, color, icon, status, started_at, completed_at, owner, checklist, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of people) {
    const inProgress = p.status === 'onboarding' ? 10 : p.status === 'probation' ? 11 : p.status === 'exited' ? -1 : 13;
    templates.forEach((t, i) => {
      const status = inProgress === -1 ? 'completed' : i < inProgress ? 'completed' : i === inProgress ? 'in_progress' : 'pending';
      const startDay = i <= 10 ? addDays(p.join, -(10 - i) * 3) : i === 11 ? p.join : addDays(p.join, 180);
      const doneDay = i <= 9 ? addDays(startDay, 2) : i === 10 ? p.join : i === 11 ? addDays(p.join, 179) : i === 12 ? addDays(p.join, 180) : p.exit || addDays(p.join, 180);
      const checklist = i === 8 ? [{ label: 'ID proof', done: true }, { label: 'Address proof', done: true }, { label: gcc ? 'Visa & medical' : cc === 'US' ? 'Form I-9 & W-4' : 'PAN & Aadhaar', done: status === 'completed' }] : [];
      jIns.run(p.id, t.id, t.name, t.description, i, t.color, t.icon, status, status !== 'pending' ? stamp(startDay, 4) : null, status === 'completed' ? stamp(doneDay, 12) : null, t.owner_role, JSON.stringify(checklist), now, now);
    });
  }

  /* ---------- Announcements ---------- */
  const [py, pm] = thisPeriod.split('-').map(Number);
  const nextHoliday = all<any>('SELECT name, date FROM holidays WHERE date > ? ORDER BY date LIMIT 1', [T])[0];
  insert('announcements', { title: `${MONTHS[pm - 1]} ${py} payroll: input cut-off`, body: `Please submit overtime, reimbursements and leave corrections by ${addDays(payDate(thisPeriod), -7)}. Attendance locks on ${addDays(payDate(thisPeriod), -5)} and salaries will be credited on ${payDate(thisPeriod)}.`, audience: 'all', pinned: 1, publish_at: stamp(addDays(T, -3), 4), expires_at: null, created_by: payrollUserId, created_at: stamp(addDays(T, -3), 4), updated_at: stamp(addDays(T, -3), 4) });
  if (nextHoliday) insert('announcements', { title: `Holiday: ${nextHoliday.name.replace(/ – day \d+/, '')}`, body: `The office will be closed on ${nextHoliday.date} for ${nextHoliday.name.replace(/ – day \d+/, '').replace(' (expected)', '')}.${/expected/.test(nextHoliday.name) ? ' The date is subject to the official moon-sighting announcement.' : ''} Teams on rotating shifts will receive their roster from their supervisor.`, audience: 'all', pinned: 0, publish_at: stamp(addDays(T, -6), 4), expires_at: null, created_by: hrUserId, created_at: stamp(addDays(T, -6), 4), updated_at: stamp(addDays(T, -6), 4) });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
