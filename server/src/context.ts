import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request company ("tenant") context. Every client company has its own SQLite database; the
 * tenancy middleware (tenancy.ts) resolves which company a request is for and runs the rest of the
 * request inside `tenantStore.run(...)`, so `getDb()` and `today()` pick the right company without
 * any route having to pass it around.
 */
export interface TenantCtx {
  slug: string;
  timezone: string;
}
export const tenantStore = new AsyncLocalStorage<TenantCtx>();
export const currentTenant = (): TenantCtx | undefined => tenantStore.getStore();

/** Run `fn` as company `slug` (used by seeding, agency roll-ups and background work). */
export function runAsTenant<T>(ctx: TenantCtx, fn: () => T): T {
  return tenantStore.run(ctx, fn);
}
