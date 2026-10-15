import React from 'react';
import { Icon } from './Icons';

/** Icons HR can pick for a department, in picker order. */
export const DEPT_ICONS = [
  'building', 'crown', 'code', 'server', 'box', 'heartHandshake', 'wallet', 'trendingUp', 'megaphone', 'headset',
  'shield', 'scale', 'truck', 'cart', 'factory', 'wrench', 'flask', 'palette', 'graduation', 'barChart', 'globe', 'users',
] as const;

const GUESSES: [RegExp, string][] = [
  [/exec|leader|board|ceo|director/i, 'crown'],
  [/engineer|develop|tech|software|it\b/i, 'code'],
  [/platform|infra|devops|cloud|ops/i, 'server'],
  [/product/i, 'box'],
  [/human|people|hr\b|talent/i, 'heartHandshake'],
  [/financ|account|treasur|payroll/i, 'wallet'],
  [/sales|business dev|revenue/i, 'trendingUp'],
  [/market|brand|communic/i, 'megaphone'],
  [/support|service|care|success/i, 'headset'],
  [/legal|complian/i, 'scale'],
  [/secur|risk/i, 'shield'],
  [/logist|supply|warehouse|transport/i, 'truck'],
  [/procure|purchas/i, 'cart'],
  [/manufact|production|plant/i, 'factory'],
  [/mainten|facilit/i, 'wrench'],
  [/research|r&d|lab|quality/i, 'flask'],
  [/design|creative/i, 'palette'],
  [/train|learn|academ/i, 'graduation'],
  [/analy|data|strategy/i, 'barChart'],
];

/** The department's chosen icon, or a sensible guess from its name. */
export function deptIcon(name?: string | null, icon?: string | null): string {
  if (icon) return icon;
  const hit = GUESSES.find(([re]) => re.test(name || ''));
  return hit ? hit[1] : 'building';
}

/** Icon tile tinted with the department colour. */
export function DeptIcon({ name, icon, color, size = 28 }: { name?: string | null; icon?: string | null; color?: string | null; size?: number }) {
  return (
    <span className="dept-icon" style={{ ['--dept' as any]: color || '#64748b', width: size, height: size }} aria-hidden>
      <Icon name={deptIcon(name, icon)} size={Math.round(size * 0.56)} strokeWidth={2} />
    </span>
  );
}

/** Department name with its icon tile; `code` shows as a muted second line. */
export function DeptBadge({ name, icon, color, code, size = 'sm' }: { name?: string | null; icon?: string | null; color?: string | null; code?: string | null; size?: 'sm' | 'md' }) {
  if (!name) return <span className="muted">—</span>;
  const px = size === 'md' ? 34 : 24;
  return (
    <span className={`dept-badge dept-badge-${size}`}>
      <DeptIcon name={name} icon={icon} color={color} size={px} />
      <span className="dept-badge-text">
        <span className="dept-badge-name">{name}</span>
        {code ? <span className="dept-badge-code mono">{code}</span> : null}
      </span>
    </span>
  );
}

/** Grid of icon buttons for the department form. */
export function DeptIconPicker({ value, color, onChange }: { value: string; color: string; onChange: (icon: string) => void }) {
  return (
    <div className="dept-icon-picker" role="radiogroup" aria-label="Department icon">
      {DEPT_ICONS.map((ic) => (
        <button type="button" key={ic} role="radio" aria-checked={value === ic} title={ic} className={`dept-icon-option${value === ic ? ' selected' : ''}`} onClick={() => onChange(ic)} data-testid={`dept-icon-${ic}`}>
          <DeptIcon icon={ic} color={color} size={30} />
        </button>
      ))}
    </div>
  );
}
