import type { Request, Response, NextFunction } from 'express';
import { agency, DEFAULT_COMPANY_SLUG } from './db.js';
import { tenantStore } from './context.js';
import { decodeSession } from './auth.js';
import { HttpError } from './util.js';

/**
 * Multi-company routing.
 *
 * - Company logins (client HR, managers, employees) are pinned to their company by their session;
 *   their URLs are unchanged (`/api/...`).
 * - Agency staff address a company explicitly: `/api/c/<slug>/...` (the client adds the prefix while
 *   the browser is under `/c/<slug>/`). Without a prefix they can only use agency-level endpoints.
 * - Unauthenticated requests (login, public careers page, API keys) use the prefix, the slug inside
 *   an API key, or the default company.
 *
 * The rest of the request then runs inside the company's context (context.ts), so `getDb()` and
 * `today()` resolve to that company.
 */
export interface CompanyRow { id: number; slug: string; name: string; timezone: string; country_code: string; currency: string; status: string }

const cache = new Map<string, { row: CompanyRow | null; at: number }>();
export function companyBySlug(slug: string): CompanyRow | null {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 30_000) return hit.row;
  const row = agency.get<CompanyRow>('SELECT id, slug, name, timezone, country_code, currency, status FROM companies WHERE slug = ?', [slug]) || null;
  cache.set(slug, { row, at: Date.now() });
  return row;
}
export const invalidateCompanyCache = () => cache.clear();

/** Companies an agency user may open: owners/admins see all, others their assigned ones. */
export function agencyCanAccess(agencyUserId: number, role: string | undefined, slug: string): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return !!agency.get(
    `SELECT 1 FROM agency_user_companies uc JOIN companies c ON c.id = uc.company_id WHERE uc.agency_user_id = ? AND c.slug = ?
     UNION SELECT 1 FROM companies c WHERE c.slug = ? AND c.account_manager_id = ?`,
    [agencyUserId, slug, slug, agencyUserId],
  );
}

const AGENCY_LEVEL = /^\/api\/(agency|auth|health|settings\/public)(\/|$)/;

export function tenancy(req: Request, _res: Response, next: NextFunction) {
  if (!req.url.startsWith('/api')) return next();
  const m = req.url.match(/^\/api\/c\/([a-z0-9][a-z0-9-]*)(\/.*)?$/);
  let prefixed: string | undefined;
  if (m) {
    prefixed = m[1];
    req.url = '/api' + (m[2] || '/');
  }
  const session = decodeSession(req);
  req.authSession = session;

  let slug: string | undefined;
  if (session?.kind === 'company') {
    slug = session.slug;
    if (prefixed && prefixed !== slug) return next(new HttpError(403, 'This login belongs to a different company'));
  } else if (session?.kind === 'agency') {
    slug = prefixed;
    if (slug) {
      const role = session.role ?? agency.get<any>('SELECT role FROM agency_users WHERE id = ?', [session.userId])?.role;
      if (!agencyCanAccess(session.userId, role, slug)) return next(new HttpError(403, 'You are not assigned to this company'));
    } else if (!AGENCY_LEVEL.test(req.path)) {
      return next(new HttpError(400, 'Open a company first (agency staff address companies under /c/<company>/)'));
    }
  } else {
    const key = String(req.headers['x-api-key'] || '');
    const keySlug = key.match(/^hrms_([a-z0-9-]+)_/)?.[1];
    slug = prefixed || keySlug || DEFAULT_COMPANY_SLUG;
  }

  if (!slug) return next();
  const company = companyBySlug(slug);
  if (!company && slug !== DEFAULT_COMPANY_SLUG) return next(new HttpError(404, 'Unknown company'));
  req.companySlug = slug;
  tenantStore.run({ slug, timezone: company?.timezone || 'Asia/Kolkata' }, next);
}
