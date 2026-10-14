/**
 * CV text extraction, parsing and ATS-style scoring.
 *
 * Everything here is deterministic and explainable: the parser returns the evidence it found
 * (emails, phones, experience sources, degrees, skills) and the scorer returns a per-category
 * breakdown (matched / missing skills, covered requirement lines, experience fit…) that the UI
 * shows verbatim. No ML, no network: pdf-parse / jszip for text, regexes and dictionaries after.
 */
import JSZip from 'jszip';
import { createRequire } from 'node:module';

/* ------------------------------------------------------------------ */
/* Text extraction                                                     */
/* ------------------------------------------------------------------ */
export type CvFormat = 'pdf' | 'docx' | 'txt';

/**
 * pdf-parse (pdfjs) runs `new DOMMatrix()` at module load. Locally the optional @napi-rs/canvas package
 * provides it, but serverless bundles (Vercel) leave that native package out, and a top-level import
 * would then crash the whole API on boot. So load it lazily, and when no canvas is available give it a
 * minimal DOMMatrix: text extraction never renders, it only needs the constructor to exist.
 */
let pdfParse: Promise<typeof import('pdf-parse')> | null = null;
function loadPdfParse() {
  if (!pdfParse) {
    if (typeof (globalThis as any).DOMMatrix === 'undefined') {
      try {
        const canvas = createRequire(import.meta.url)('@napi-rs/canvas');
        (globalThis as any).DOMMatrix = canvas.DOMMatrix;
      } catch {
        (globalThis as any).DOMMatrix = MinimalDOMMatrix;
      }
    }
    pdfParse = import('pdf-parse');
  }
  return pdfParse;
}

/** Identity-capable 2D matrix with the handful of members pdfjs touches outside rendering. */
class MinimalDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
  }
  multiplySelf() { return this; }
  preMultiplySelf() { return this; }
  translate() { return this; }
  scale() { return this; }
  invertSelf() { return this; }
}

export async function extractText(buffer: Buffer, format: CvFormat): Promise<string> {
  if (format === 'pdf') {
    const { PDFParse } = await loadPdfParse();
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const r = await parser.getText();
      return cleanText(r.text || '');
    } finally {
      await parser.destroy();
    }
  }
  if (format === 'docx') {
    const zip = await JSZip.loadAsync(buffer);
    const doc = zip.file('word/document.xml');
    if (!doc) throw new Error('Not a Word document (word/document.xml missing)');
    const xml = await doc.async('string');
    const text = xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return cleanText(text);
  }
  return cleanText(buffer.toString('utf8'));
}

/** Normalise line endings, strip pdf-parse page markers, collapse whitespace. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Dictionaries                                                        */
/* ------------------------------------------------------------------ */
/** ~150 common tech + business skills. Canonical spelling first; synonyms map onto it. */
export const SKILL_DICTIONARY: string[] = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'C++', 'C', 'Go', 'Rust', 'Ruby', 'PHP', 'Kotlin', 'Swift', 'Scala', 'R', 'MATLAB', 'Perl', 'Dart', 'Objective-C', 'Bash', 'PowerShell',
  // Web / frontend
  'HTML', 'CSS', 'Sass', 'React', 'Angular', 'Vue', 'Svelte', 'Next.js', 'Redux', 'Tailwind', 'Bootstrap', 'Webpack', 'Vite', 'jQuery', 'Responsive design', 'Accessibility',
  // Backend / frameworks
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Spring', '.NET', 'ASP.NET', 'Rails', 'Laravel', 'GraphQL', 'REST APIs', 'gRPC', 'Microservices', 'WebSockets',
  // Data / databases
  'SQL', 'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB', 'Oracle', 'SQL Server', 'Snowflake', 'BigQuery', 'Kafka', 'RabbitMQ', 'Spark', 'Hadoop', 'Airflow', 'ETL', 'Data modelling', 'Data warehousing',
  // Cloud / DevOps
  'AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD', 'Linux', 'Nginx', 'Serverless', 'Lambda', 'Observability', 'Prometheus', 'Grafana', 'Datadog', 'Distributed systems', 'System design', 'Performance tuning',
  // Quality / process
  'Git', 'Unit testing', 'Jest', 'Cypress', 'Playwright', 'Selenium', 'TDD', 'Agile', 'Scrum', 'Kanban', 'Jira', 'Code review', 'Pair programming', 'Technical documentation',
  // Data science / ML
  'Machine learning', 'Deep learning', 'NLP', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'scikit-learn', 'Data analysis', 'Statistics', 'Power BI', 'Tableau', 'Excel',
  // Mobile
  'Android', 'iOS', 'React Native', 'Flutter',
  // Security
  'Security', 'OAuth', 'Penetration testing', 'Cryptography',
  // Business / soft
  'Negotiation', 'CRM', 'Salesforce', 'HubSpot', 'Presentation', 'Lead generation', 'Account management', 'B2B sales', 'SaaS', 'Cold calling', 'Pipeline management', 'Forecasting', 'Customer success',
  'Communication', 'Leadership', 'Mentoring', 'Project management', 'Product management', 'Stakeholder management', 'Problem solving', 'Team management', 'Recruitment', 'Onboarding', 'Payroll', 'Compliance', 'Budgeting', 'Financial analysis', 'Accounting', 'Bookkeeping', 'Audit', 'Taxation', 'SAP', 'Tally', 'Procurement', 'Vendor management', 'Operations', 'Customer support', 'Content writing', 'SEO', 'Digital marketing', 'Social media', 'Analytics', 'UX design', 'UI design', 'Figma', 'Photoshop',
];

/** Synonyms / alternative spellings → canonical dictionary entry. Matching is case-insensitive. */
export const SKILL_SYNONYMS: Record<string, string[]> = {
  JavaScript: ['js', 'ecmascript', 'es6', 'es2015'],
  TypeScript: ['ts'],
  'Node.js': ['node', 'nodejs', 'node js'],
  'Next.js': ['nextjs', 'next js'],
  React: ['reactjs', 'react.js', 'react js'],
  Vue: ['vuejs', 'vue.js'],
  Angular: ['angularjs', 'angular.js'],
  PostgreSQL: ['postgres', 'postgresql', 'psql'],
  MySQL: ['mariadb'],
  'SQL Server': ['mssql', 'ms sql', 'microsoft sql server', 't-sql'],
  SQL: ['sql databases', 'relational databases', 'rdbms', 'postgres', 'postgresql', 'mysql', 'sqlite', 'ms sql', 'oracle', 't-sql', 'pl/sql'],
  MongoDB: ['mongo'],
  AWS: ['amazon web services', 'ec2', 's3', 'aws lambda', 'cloudformation'],
  Azure: ['microsoft azure'],
  'Google Cloud': ['gcp', 'google cloud platform'],
  Kubernetes: ['k8s'],
  'CI/CD': ['ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  'REST APIs': ['rest', 'restful', 'rest api', 'restful apis', 'web apis', 'http apis'],
  Microservices: ['micro-services', 'microservice', 'service oriented'],
  'Distributed systems': ['distributed computing', 'distributed architecture'],
  Observability: ['monitoring', 'tracing', 'logging', 'telemetry', 'opentelemetry'],
  'Unit testing': ['unit tests', 'automated testing', 'test automation', 'testing'],
  'Machine learning': ['ml'],
  'Deep learning': ['neural networks'],
  NLP: ['natural language processing'],
  'Spring Boot': ['springboot'],
  '.NET': ['dotnet', '.net core', 'net core'],
  'C#': ['csharp', 'c sharp'],
  'C++': ['cpp'],
  Go: ['golang'],
  Docker: ['containers', 'containerisation', 'containerization'],
  Git: ['github', 'gitlab', 'bitbucket', 'version control'],
  Agile: ['agile methodologies', 'agile development'],
  Excel: ['ms excel', 'microsoft excel', 'spreadsheets'],
  'Power BI': ['powerbi'],
  CRM: ['salesforce', 'hubspot', 'zoho crm', 'pipedrive', 'crm tools'],
  Negotiation: ['negotiating', 'negotiate', 'contract negotiation'],
  Presentation: ['presentations', 'presenting', 'public speaking', 'demos', 'product demos'],
  'B2B sales': ['b2b', 'enterprise sales', 'saas sales', 'inside sales'],
  'Lead generation': ['prospecting', 'lead gen', 'outbound'],
  'Account management': ['key accounts', 'account manager'],
  'Project management': ['pmp', 'prince2'],
  Communication: ['communication skills', 'written communication', 'verbal communication'],
  Leadership: ['team lead', 'leading teams', 'led a team'],
  'System design': ['architecture', 'software architecture', 'technical design'],
  'Performance tuning': ['performance optimisation', 'performance optimization', 'profiling'],
  Security: ['application security', 'appsec', 'infosec', 'owasp'],
  'UX design': ['user experience', 'ux'],
  'UI design': ['user interface design', 'ui'],
  Linux: ['unix', 'ubuntu', 'debian', 'centos'],
  Bash: ['shell scripting', 'shell'],
};

const DEGREE_PATTERNS: [string, RegExp][] = [
  ['PhD', /\b(ph\.?\s?d|doctorate|doctoral)\b/i],
  ['M.Tech', /\bm\.?\s?tech\b/i],
  ['M.E.', /\bm\.\s?e\.?(?=\s|,|$)/i],
  ['MBA', /\bm\.?\s?b\.?\s?a\b/i],
  ['MCA', /\bm\.?\s?c\.?\s?a\b/i],
  ['MSc', /\bm\.?\s?sc\b/i],
  ['MS', /\bm\.\s?s\.?(?=\s|,|$)|\bmaster of science\b/i],
  ['MA', /\bm\.\s?a\.?(?=\s|,|$)|\bmaster of arts\b/i],
  ['M.Com', /\bm\.?\s?com\b/i],
  ['Master', /\bmasters?\b(?!\s+of\s+(science|arts))/i],
  ['B.Tech', /\bb\.?\s?tech\b/i],
  ['B.E.', /\bb\.\s?e\.?(?=\s|,|$)|\bbachelor of engineering\b/i],
  ['BSc', /\bb\.?\s?sc\b/i],
  ['BCA', /\bb\.?\s?c\.?\s?a\b/i],
  ['BBA', /\bb\.?\s?b\.?\s?a\b/i],
  ['B.Com', /\bb\.?\s?com\b/i],
  ['BA', /\bb\.\s?a\.?(?=\s|,|$)|\bbachelor of arts\b/i],
  ['Bachelor', /\bbachelors?\b(?!\s+of\s+(engineering|arts))/i],
  ['Diploma', /\bdiploma\b/i],
];

const TITLE_WORDS = /\b(engineer|developer|programmer|architect|manager|analyst|designer|consultant|lead|executive|accountant|specialist|administrator|intern|officer|head|director|scientist|associate|coordinator|recruiter|representative|technician|founder|vp|cto|ceo|coo|cfo)\b/i;
const HEADER_LINE = /^(curriculum vitae|cv|resume|résumé)$/i;
const SUMMARY_HEADER = /^(professional\s+)?(summary|profile|objective|about\s*me|career\s+objective|overview)\s*[:\-–]?\s*(.*)$/i;
const SECTION_HEADER = /^(experience|work experience|employment|employment history|professional experience|education|skills|technical skills|projects|certifications|achievements|languages|interests|references|contact|summary|profile|objective)\s*[:\-–]?\s*$/i;
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const RANGE_RE = new RegExp(`(?:${MONTHS}\\s+)?((?:19|20)\\d{2})\\s*(?:-|–|—|to|until|till)\\s*(?:(?:${MONTHS}\\s+)?((?:19|20)\\d{2})|(present|current|now|till date|to date|ongoing|today))`, 'gi');

export interface ParsedCv {
  emails: string[];
  phones: string[];
  experience_years: number | null;
  experience_sources: string[];
  education: string[];
  skills: string[];
  title: string | null;
  summary: string | null;
  name_guess: { first_name: string; last_name: string } | null;
  word_count: number;
}

/* ------------------------------------------------------------------ */
/* Matching helpers                                                    */
/* ------------------------------------------------------------------ */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Word-boundary-ish regex that also works for tokens ending in + or # or containing dots. */
export function termRegex(term: string): RegExp {
  const esc = escapeRe(term.trim()).replace(/\s+/g, '[\\s\\-_/]*');
  return new RegExp(`(?<![\\w])${esc}(?![\\w+#])`, 'i');
}
export function textHas(text: string, term: string): boolean {
  if (!term || !term.trim()) return false;
  return termRegex(term).test(text);
}
/** All spellings for a canonical skill (itself + synonyms, case-insensitive). */
export function skillVariants(skill: string): string[] {
  const out = [skill];
  const syn = Object.entries(SKILL_SYNONYMS).find(([k]) => k.toLowerCase() === skill.toLowerCase());
  if (syn) out.push(...syn[1]);
  return out;
}
/** True when the skill (or any synonym) appears in the text; returns the spelling that matched. */
export function findSkill(text: string, skill: string): string | null {
  for (const v of skillVariants(skill)) if (textHas(text, v)) return v;
  return null;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */
export function parseCv(rawText: string, extraSkills: string[] = []): ParsedCv {
  const text = cleanText(rawText || '');
  const lines = text.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const emails = uniq((text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).map((e) => e.toLowerCase()));
  const phones = uniq((text.match(/\+?\d[\d\s().-]{7,}\d/g) || []).map((p) => p.trim()).filter((p) => { const d = p.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13; }));

  // --- Education
  const education: string[] = [];
  for (const [label, re] of DEGREE_PATTERNS) if (re.test(text) && !education.includes(label)) education.push(label);
  const degreeLine = (l: string) => DEGREE_PATTERNS.some(([, re]) => re.test(l)) || /\b(university|college|school|institute)\b/i.test(l);

  // --- Experience years: explicit statements win over summed date ranges.
  const sources: string[] = [];
  let explicit: number | null = null;
  const explicitRes = [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,3}?\s+experience/gi,
    /experience\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/gi,
    /(?:over|more than|about|around)\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/gi,
  ];
  for (const re of explicitRes) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 60) {
        if (explicit === null || n > explicit) explicit = n;
        sources.push(m[0].trim());
      }
    }
  }
  const intervals: [number, number][] = [];
  const nowYear = new Date().getFullYear();
  for (const line of lines) {
    if (degreeLine(line)) continue; // education ranges are not work experience
    for (const m of line.matchAll(RANGE_RE)) {
      const start = Number(m[1]);
      const end = m[3] ? nowYear : Number(m[2]);
      if (end >= start && end - start <= 50) { intervals.push([start, end]); sources.push(m[0].trim()); }
    }
  }
  const ranged = mergeYears(intervals);
  const experience_years = explicit !== null ? explicit : ranged > 0 ? ranged : null;

  // --- Skills: dictionary + extra terms (JD skills), in order of first occurrence.
  const catalogue = uniqCi([...SKILL_DICTIONARY, ...extraSkills.map((s) => String(s || '').trim()).filter(Boolean)]);
  const found: { skill: string; at: number }[] = [];
  for (const skill of catalogue) {
    let at = -1;
    for (const v of skillVariants(skill)) {
      const m = termRegex(v).exec(text);
      if (m && (at === -1 || m.index < at)) at = m.index;
    }
    if (at >= 0) found.push({ skill, at });
  }
  found.sort((a, b) => a.at - b.at);
  const skills = found.map((f) => f.skill);

  // --- Name guess: first plausible "Firstname Lastname" line.
  let name_guess: ParsedCv['name_guess'] = null;
  for (const l of nonEmpty.slice(0, 8)) {
    if (HEADER_LINE.test(l) || /[@\d]/.test(l) || l.length > 60) continue;
    const words = l.replace(/[,|]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) continue;
    if (SECTION_HEADER.test(l) || TITLE_WORDS.test(l)) continue;
    name_guess = { first_name: words[0], last_name: words.slice(1).join(' ') };
    break;
  }

  // --- Title guess: a short line with a role word near the top (not the name / contact line).
  let title: string | null = null;
  for (const l of nonEmpty.slice(0, 15)) {
    if (/[@]/.test(l) || l.length > 80 || SECTION_HEADER.test(l)) continue;
    if (name_guess && l.toLowerCase().includes(name_guess.first_name.toLowerCase()) && l.toLowerCase().includes(name_guess.last_name.toLowerCase())) continue;
    if (TITLE_WORDS.test(l)) { title = l.replace(/\s*(\||·|-|–)\s*.*$/, '').slice(0, 80); break; }
  }
  if (!title) {
    const i = lines.findIndex((l) => /^(work\s+)?(experience|employment)(\s+history)?\s*:?$/i.test(l));
    if (i >= 0) for (const l of lines.slice(i + 1, i + 6)) if (l && TITLE_WORDS.test(l)) { title = l.replace(/\s*(\||·|-|–|,)\s*(19|20)\d{2}.*$/, '').slice(0, 80); break; }
  }

  // --- Summary: text after a Summary/Objective header, else the first paragraph after the header block.
  let summary: string | null = null;
  const si = lines.findIndex((l) => SUMMARY_HEADER.test(l) && l.length < 60);
  if (si >= 0) {
    const m = lines[si].match(SUMMARY_HEADER);
    const parts: string[] = [];
    if (m && m[3]) parts.push(m[3]);
    for (const l of lines.slice(si + 1)) { if (!l || SECTION_HEADER.test(l)) break; parts.push(l); }
    summary = parts.join(' ').trim().slice(0, 300) || null;
  }
  if (!summary) {
    // First paragraph (≥ 2 lines or ≥ 60 chars) that is not contact info.
    let para: string[] = [];
    for (const l of [...lines, '']) {
      if (!l) {
        const joined = para.join(' ').trim();
        if (joined.length >= 60 && !/@/.test(joined) && !SECTION_HEADER.test(para[0] || '')) { summary = joined.slice(0, 300); break; }
        para = [];
      } else para.push(l);
    }
  }

  return { emails, phones, experience_years, experience_sources: uniq(sources).slice(0, 10), education, skills, title, summary, name_guess, word_count: text.split(/\s+/).filter(Boolean).length };
}

function mergeYears(intervals: [number, number][]): number {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = sorted[0];
  for (const [s, e] of sorted.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else { total += ce - cs; [cs, ce] = [s, e]; }
  }
  total += ce - cs;
  return total;
}
function uniq<T>(a: T[]): T[] { return Array.from(new Set(a)); }
function uniqCi(a: string[]): string[] {
  const seen = new Set<string>();
  return a.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */
export interface JdForScoring {
  id: number;
  title: string;
  skills: string[];
  requirements: string[];
  experience_min?: number | null;
  experience_max?: number | null;
}
export interface ScoreBreakdown {
  jd_id: number;
  jd_title: string;
  total: number;
  skills: { weight: number; points: number; matched: string[]; missing: string[]; partial: { skill: string; via: string }[]; note: string };
  requirements: { weight: number; points: number; covered: string[]; uncovered: string[]; note: string };
  experience: { weight: number; points: number; years: number | null; min: number | null; max: number | null; note: string };
  education: { weight: number; points: number; degrees: string[]; note: string };
  extras: { weight: number; points: number; email: boolean; phone: boolean; length_ok: boolean; note: string };
}
export const WEIGHTS = { skills: 45, requirements: 20, experience: 20, education: 10, extras: 5 } as const;

const STOPWORDS = new Set(['with', 'and', 'the', 'of', 'in', 'for', 'to', 'or', 'a', 'an', 'on', 'at', 'by', 'as', 'is', 'are', 'be', 'from', 'that', 'this', 'into', 'using', 'used', 'use', 'years', 'year', 'yrs', 'experience', 'experienced', 'strong', 'good', 'excellent', 'ability', 'able', 'must', 'have', 'has', 'having', 'should', 'plus', 'least', 'minimum', 'working', 'work', 'hands', 'hands-on', 'knowledge', 'understanding', 'familiarity', 'familiar', 'proven', 'track', 'record', 'skills', 'skill', 'required', 'preferred', 'nice', 'bonus', 'etc', 'such', 'like', 'including', 'within', 'across', 'degree', 'relevant', 'related', 'equivalent', 'fundamentals', 'solid', 'background', 'exposure', 'comfortable', 'willing', 'willingness',
  // generic CV vocabulary that is not evidence of a specific requirement
  'software', 'production', 'building', 'build', 'built', 'data', 'systems', 'system', 'development', 'developer', 'engineering', 'engineer', 'team', 'teams', 'business', 'technical', 'technology', 'technologies', 'tools', 'applications', 'application', 'services', 'service', 'projects', 'project', 'products', 'product', 'role', 'company', 'customers', 'customer', 'clients', 'client']);

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreCv(parsed: ParsedCv, cvText: string, jd: JdForScoring): { score: number; breakdown: ScoreBreakdown } {
  const text = cleanText(cvText || '');
  const lower = new Set(parsed.skills.map((s) => s.toLowerCase()));

  // Skills (45): fraction of JD skills present (direct or via a synonym).
  const jdSkills = (jd.skills || []).map((s) => String(s).trim()).filter(Boolean);
  const matched: string[] = [];
  const missing: string[] = [];
  const partial: { skill: string; via: string }[] = [];
  for (const s of jdSkills) {
    if (textHas(text, s)) { matched.push(s); continue; }
    const via = findSkill(text, s);
    if (via) { matched.push(s); partial.push({ skill: s, via }); continue; }
    if (lower.has(s.toLowerCase())) { matched.push(s); continue; }
    missing.push(s);
  }
  const skillsPts = jdSkills.length ? round1((matched.length / jdSkills.length) * WEIGHTS.skills) : WEIGHTS.skills / 2;
  const skillsNote = jdSkills.length ? `${matched.length} of ${jdSkills.length} required skills found${partial.length ? ` (${partial.length} via synonym)` : ''}` : 'The job description lists no skills; neutral credit given';

  // Requirements (20): each requirement line is covered when at least one significant word appears in the CV,
  // or, for pure "N+ years" lines, when the parsed experience meets N.
  const reqs = (jd.requirements || []).map((r) => String(r).trim()).filter(Boolean);
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const r of reqs) {
    const words = r.toLowerCase().replace(/[^a-z0-9+#./ -]/g, ' ').split(/[\s/,]+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, '')).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+\+?$/.test(w));
    const yearsReq = r.match(/(\d+)\s*\+?\s*(?:years?|yrs?)/i);
    let ok = words.some((w) => textHas(text, w) || findSkill(text, w));
    if (!ok && yearsReq && parsed.experience_years !== null && parsed.experience_years >= Number(yearsReq[1])) ok = true;
    if (!words.length && yearsReq) ok = parsed.experience_years !== null && parsed.experience_years >= Number(yearsReq[1]);
    (ok ? covered : uncovered).push(r);
  }
  const reqPts = reqs.length ? round1((covered.length / reqs.length) * WEIGHTS.requirements) : WEIGHTS.requirements / 2;
  const reqNote = reqs.length ? `${covered.length} of ${reqs.length} requirement lines have matching keywords` : 'No requirements listed; neutral credit given';

  // Experience (20): full inside [min, max]; scaled down below min; mildly reduced above max.
  const min = jd.experience_min ?? null;
  const max = jd.experience_max ?? null;
  const y = parsed.experience_years;
  let expPts: number;
  let expNote: string;
  if (min === null && max === null) { expPts = WEIGHTS.experience; expNote = 'No experience range on the job description'; }
  else if (y === null) { expPts = 0; expNote = 'No experience statement or dated work history found in the CV'; }
  else if (min !== null && y < min) { expPts = round1(WEIGHTS.experience * Math.max(0, 1 - (min - y) / min)); expNote = `${y} yr${y === 1 ? '' : 's'} is below the ${min} yr minimum`; }
  else if (max !== null && y > max) { expPts = round1(WEIGHTS.experience * Math.max(0.5, 1 - ((y - max) / Math.max(max, 1)) * 0.5)); expNote = `${y} yrs exceeds the ${max} yr ceiling (possibly over-qualified)`; }
  else { expPts = WEIGHTS.experience; expNote = `${y} yr${y === 1 ? '' : 's'} fits the ${min ?? 0}–${max ?? '∞'} yr range`; }

  // Education (10): any recognised degree.
  const eduPts = parsed.education.length ? WEIGHTS.education : 0;
  const eduNote = parsed.education.length ? `Degree(s) found: ${parsed.education.join(', ')}` : 'No degree keywords found';

  // Extras (5): contactable + sensible length.
  const email = parsed.emails.length > 0;
  const phone = parsed.phones.length > 0;
  const lengthOk = parsed.word_count >= 40 && parsed.word_count <= 4000;
  const extrasPts = (email ? 2 : 0) + (phone ? 2 : 0) + (lengthOk ? 1 : 0);
  const extrasNote = [email ? 'email found' : 'no email', phone ? 'phone found' : 'no phone', lengthOk ? 'reasonable length' : `unusual length (${parsed.word_count} words)`].join(', ');

  const total = Math.max(0, Math.min(100, Math.round(skillsPts + reqPts + expPts + eduPts + extrasPts)));
  return {
    score: total,
    breakdown: {
      jd_id: jd.id, jd_title: jd.title, total,
      skills: { weight: WEIGHTS.skills, points: skillsPts, matched, missing, partial, note: skillsNote },
      requirements: { weight: WEIGHTS.requirements, points: reqPts, covered, uncovered, note: reqNote },
      experience: { weight: WEIGHTS.experience, points: expPts, years: y, min, max, note: expNote },
      education: { weight: WEIGHTS.education, points: eduPts, degrees: parsed.education, note: eduNote },
      extras: { weight: WEIGHTS.extras, points: extrasPts, email, phone, length_ok: lengthOk, note: extrasNote },
    },
  };
}
