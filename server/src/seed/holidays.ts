/**
 * Public holidays per country (and Indian state) for the demo companies.
 *
 * Fixed-date and rule-based holidays (US federal holidays, national days) are computed for any year.
 * Lunar / lunisolar festivals are listed per year: Islamic holidays use the dates expected from the
 * astronomical calendar and carry "(expected)" in the name, since the authorities confirm them only
 * after the moon sighting. Indian festival dates follow the published central / state calendars.
 */
export interface HolidayDef { name: string; date: string }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
const shift = (date: string, n: number) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** n-th `weekday` (0 = Sunday) of a month; n = -1 means the last one. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = ymd(y, m, 1);
    const offset = (weekday - dow(first) + 7) % 7;
    return shift(first, offset + (n - 1) * 7);
  }
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return shift(last, -((dow(last) - weekday + 7) % 7));
}

/* ---------------- Islamic holidays (expected dates) ---------------- */
const ISLAMIC: Record<number, { fitr: string; arafat: string; adha: string; hijri: string; mawlid: string }> = {
  2025: { fitr: '2025-03-30', arafat: '2025-06-05', adha: '2025-06-06', hijri: '2025-06-26', mawlid: '2025-09-04' },
  2026: { fitr: '2026-03-20', arafat: '2026-05-26', adha: '2026-05-27', hijri: '2026-06-16', mawlid: '2026-08-25' },
  2027: { fitr: '2027-03-09', arafat: '2027-05-15', adha: '2027-05-16', hijri: '2027-06-06', mawlid: '2027-08-14' },
  2028: { fitr: '2028-02-26', arafat: '2028-05-04', adha: '2028-05-05', hijri: '2028-05-25', mawlid: '2028-08-03' },
};
const days = (name: string, start: string, n: number, dayLabel = true): HolidayDef[] =>
  Array.from({ length: n }, (_, i) => ({ name: dayLabel && n > 1 ? `${name} – day ${i + 1} (expected)` : `${name} (expected)`, date: shift(start, i) }));

function uae(y: number): HolidayDef[] {
  const out: HolidayDef[] = [{ name: "New Year's Day", date: ymd(y, 1, 1) }];
  const isl = ISLAMIC[y];
  if (isl) {
    out.push(...days('Eid al-Fitr', isl.fitr, 3));
    out.push({ name: 'Arafat Day (expected)', date: isl.arafat });
    out.push(...days('Eid al-Adha', isl.adha, 3));
    out.push({ name: 'Islamic New Year (expected)', date: isl.hijri });
    out.push({ name: "Prophet Muhammad's Birthday (expected)", date: isl.mawlid });
  }
  out.push({ name: 'Commemoration Day', date: ymd(y, 12, 1) }, { name: 'UAE National Day', date: ymd(y, 12, 2) }, { name: 'UAE National Day holiday', date: ymd(y, 12, 3) });
  return out;
}
function ksa(y: number): HolidayDef[] {
  const out: HolidayDef[] = [{ name: 'Founding Day', date: ymd(y, 2, 22) }];
  const isl = ISLAMIC[y];
  if (isl) {
    out.push(...days('Eid al-Fitr', isl.fitr, 4));
    out.push({ name: 'Arafat Day (expected)', date: isl.arafat });
    out.push(...days('Eid al-Adha', isl.adha, 3));
  }
  out.push({ name: 'Saudi National Day', date: ymd(y, 9, 23) });
  return out;
}
function qatar(y: number): HolidayDef[] {
  const out: HolidayDef[] = [{ name: 'National Sport Day', date: nthWeekday(y, 2, 2, 2) }];
  const isl = ISLAMIC[y];
  if (isl) {
    out.push(...days('Eid al-Fitr', isl.fitr, 3));
    out.push({ name: 'Arafat Day (expected)', date: isl.arafat });
    out.push(...days('Eid al-Adha', isl.adha, 3));
  }
  out.push({ name: 'Qatar National Day', date: ymd(y, 12, 18) });
  return out;
}

/* ---------------- United States (federal, with observed dates) ---------------- */
function observed(name: string, date: string): HolidayDef {
  const d = dow(date);
  if (d === 6) return { name: `${name} (observed)`, date: shift(date, -1) };
  if (d === 0) return { name: `${name} (observed)`, date: shift(date, 1) };
  return { name, date };
}
function us(y: number, region: string): HolidayDef[] {
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  const out: HolidayDef[] = [
    observed("New Year's Day", ymd(y, 1, 1)),
    { name: 'Martin Luther King Jr. Day', date: nthWeekday(y, 1, 1, 3) },
    { name: "Presidents' Day", date: nthWeekday(y, 2, 1, 3) },
    { name: 'Memorial Day', date: nthWeekday(y, 5, 1, -1) },
    observed('Juneteenth', ymd(y, 6, 19)),
    observed('Independence Day', ymd(y, 7, 4)),
    { name: 'Labor Day', date: nthWeekday(y, 9, 1, 1) },
    { name: 'Thanksgiving Day', date: thanksgiving },
    observed('Christmas Day', ymd(y, 12, 25)),
  ];
  // Common company holiday (a California state holiday; widely given in Texas too).
  if (region === 'California' || region === 'Texas') out.push({ name: 'Day after Thanksgiving', date: shift(thanksgiving, 1) });
  return out;
}

/* ---------------- India (central + state) ---------------- */
type IndiaYear = Record<string, string>;
const INDIA: Record<number, IndiaYear> = {
  2025: { sankranti: '2025-01-14', holi: '2025-03-14', ugadi: '2025-03-30', fitr: '2025-03-31', goodfriday: '2025-04-18', vishu: '2025-04-14', bakrid: '2025-06-07', onam1: '2025-09-04', onam: '2025-09-05', ganesh: '2025-08-27', navami: '2025-10-01', dussehra: '2025-10-02', diwali: '2025-10-20' },
  2026: { sankranti: '2026-01-14', holi: '2026-03-04', ugadi: '2026-03-19', fitr: '2026-03-21', goodfriday: '2026-04-03', vishu: '2026-04-14', bakrid: '2026-05-27', onam1: '2026-08-25', onam: '2026-08-26', ganesh: '2026-09-14', navami: '2026-10-19', dussehra: '2026-10-20', diwali: '2026-11-08' },
  2027: { sankranti: '2027-01-14', holi: '2027-03-22', ugadi: '2027-04-07', fitr: '2027-03-10', goodfriday: '2027-03-26', vishu: '2027-04-14', bakrid: '2027-05-17', onam1: '2027-09-11', onam: '2027-09-12', ganesh: '2027-09-04', navami: '2027-10-08', dussehra: '2027-10-09', diwali: '2027-10-29' },
};
function india(y: number, region: string): HolidayDef[] {
  const f = INDIA[y];
  const out: HolidayDef[] = [{ name: 'Republic Day', date: ymd(y, 1, 26) }, { name: 'Independence Day', date: ymd(y, 8, 15) }, { name: 'Gandhi Jayanti', date: ymd(y, 10, 2) }, { name: 'Christmas', date: ymd(y, 12, 25) }];
  if (f) {
    out.push({ name: 'Id-ul-Fitr', date: f.fitr }, { name: 'Bakrid / Id-ul-Zuha', date: f.bakrid }, { name: 'Dussehra', date: f.dussehra }, { name: 'Diwali', date: f.diwali });
    if (region === 'Maharashtra') out.push({ name: 'Holi', date: f.holi }, { name: 'Gudi Padwa', date: f.ugadi }, { name: 'Ganesh Chaturthi', date: f.ganesh });
    if (region === 'Kerala') out.push({ name: 'Vishu', date: f.vishu }, { name: 'Good Friday', date: f.goodfriday }, { name: 'First Onam', date: f.onam1 }, { name: 'Thiruvonam', date: f.onam }, { name: 'Mahanavami', date: f.navami });
    if (region === 'Telangana') out.push({ name: 'Makar Sankranti', date: f.sankranti }, { name: 'Holi', date: f.holi }, { name: 'Ugadi', date: f.ugadi }, { name: 'Ganesh Chaturthi', date: f.ganesh });
  }
  if (region === 'Maharashtra') out.push({ name: 'Maharashtra Day', date: ymd(y, 5, 1) });
  if (region === 'Kerala') out.push({ name: 'May Day', date: ymd(y, 5, 1) });
  if (region === 'Telangana') out.push({ name: 'Telangana Formation Day', date: ymd(y, 6, 2) });
  return out;
}

export function holidaysFor(country_code: string, region: string | undefined, year: number): HolidayDef[] {
  const list = country_code === 'IN' ? india(year, region || '')
    : country_code === 'AE' ? uae(year)
    : country_code === 'SA' ? ksa(year)
    : country_code === 'QA' ? qatar(year)
    : country_code === 'US' ? us(year, region || '')
    : [];
  const seen = new Set<string>();
  return list.filter((h) => { const k = `${h.name}|${h.date}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.date.localeCompare(b.date));
}
