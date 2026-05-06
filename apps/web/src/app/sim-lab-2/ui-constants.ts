// Last touched by agent: 2026-05-05T18:04:00Z
// Purpose: Shared UI constants for Sim Lab 2 rendering and role labels.

import type { ManagerProfileKey } from './worker-protocol';

export const POS_LABEL: Record<string, string> = {
  P: 'P',
  C: 'C',
  B1: '1B',
  B2: '2B',
  SS: 'SS',
  B3: '3B',
  LF: 'LF',
  CF: 'CF',
  RF: 'RF',
  DH: 'DH',
};

export const PROFILE_KEYS: ManagerProfileKey[] = ['balanced', 'aggressive', 'conservative', 'analytics'];

export const PROFILE_LABELS: Record<ManagerProfileKey, string> = {
  balanced: 'Balanced Manager',
  aggressive: 'Aggressive Skipper',
  conservative: 'Conservative Skipper',
  analytics: 'Analytics-Driven Manager',
};

export const PROFILE_ICONS: Record<string, string> = {
  balanced: '⚖️',
  aggressive: '🔥',
  conservative: '🛡️',
  analytics: '📊',
};

export const ROLE_BADGE_CLASS: Record<string, string> = {
  // Tuned for long-session readability on dark UI; RP2/RP3 are intentionally far apart.
  SP: 'text-zinc-100 bg-zinc-800 border-zinc-500',
  RP1: 'text-blue-100 bg-blue-950/70 border-blue-500',
  RP2: 'text-teal-100 bg-teal-950/70 border-teal-500',
  RP3: 'text-violet-100 bg-violet-950/70 border-violet-500',
  RP4: 'text-amber-100 bg-amber-950/70 border-amber-500',
  MR: 'text-fuchsia-100 bg-fuchsia-950/70 border-fuchsia-500',
  CL: 'text-rose-100 bg-rose-950/70 border-rose-500',
};

export function parseRoleTag(detail: string): { role: string | null; text: string } {
  const match = detail.match(/^\[([A-Z0-9]+)\]\s*/);
  if (!match) return { role: null, text: detail };
  return {
    role: match[1],
    text: detail.replace(/^\[[A-Z0-9]+\]\s*/, ''),
  };
}
