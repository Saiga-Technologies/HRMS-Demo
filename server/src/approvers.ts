import type { Request } from 'express';
import { all, get } from './db.js';

/**
 * Reporting-manager hierarchy used for every approval (attendance appeals, leave, comp-off, travel).
 * The chain for an employee is [direct manager, manager's manager, ...]. A request is "pending with"
 * the first person in the chain who has a login; anyone further up the chain may also act on it
 * (escalation), and HR can always act.
 */
export interface Approver { employee_id: number; name: string; employee_code: string; user_id: number | null; level: number }

export function approverChain(employeeId: number): Approver[] {
  const chain: Approver[] = [];
  const seen = new Set<number>([employeeId]);
  let cur = get<any>('SELECT manager_id FROM employees WHERE id = ?', [employeeId])?.manager_id ?? null;
  let level = 1;
  while (cur != null && !seen.has(cur) && level <= 10) {
    seen.add(cur);
    const m = get<any>(`SELECT e.id, e.first_name, e.last_name, e.employee_code, e.manager_id, e.status, u.id AS user_id
                        FROM employees e LEFT JOIN users u ON u.employee_id = e.id AND u.active = 1 WHERE e.id = ?`, [cur]);
    if (!m) break;
    if (m.status !== 'exited') chain.push({ employee_id: m.id, name: `${m.first_name} ${m.last_name}`.trim(), employee_code: m.employee_code, user_id: m.user_id ?? null, level });
    cur = m.manager_id;
    level += 1;
  }
  return chain;
}

/** The person a new request is routed to: the nearest manager with a login, else the nearest manager, else null (HR). */
export function defaultApprover(employeeId: number): Approver | null {
  const chain = approverChain(employeeId);
  return chain.find((a) => a.user_id) ?? chain[0] ?? null;
}

/** True when the signed-in user is HR or sits anywhere in the employee's reporting chain. */
export function canApproveFor(req: Request, employeeId: number): boolean {
  if (!req.user) return false;
  if (req.user.role === 'hr') return true;
  if (!req.user.employee_id || req.user.employee_id === employeeId) return false;
  return approverChain(employeeId).some((a) => a.employee_id === req.user!.employee_id);
}

/** Employee ids whose requests the signed-in user may approve (all reports, direct and indirect). HR: undefined (no filter). */
export function approvableEmployeeIds(req: Request): number[] | undefined {
  if (!req.user) return [];
  if (req.user.role === 'hr') return undefined;
  if (!req.user.employee_id) return [];
  const out: number[] = [];
  const queue = [req.user.employee_id];
  const seen = new Set<number>(queue);
  while (queue.length) {
    const m = queue.shift()!;
    for (const r of all<{ id: number }>("SELECT id FROM employees WHERE manager_id = ? AND status != 'exited'", [m])) {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r.id); queue.push(r.id); }
    }
  }
  return out;
}

export function approverName(employeeId: number | null | undefined): string | null {
  if (!employeeId) return null;
  const e = get<any>('SELECT first_name, last_name FROM employees WHERE id = ?', [employeeId]);
  return e ? `${e.first_name} ${e.last_name}`.trim() : null;
}
