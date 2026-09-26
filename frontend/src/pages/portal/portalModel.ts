import { z } from 'zod';

export interface PortalPlans {
  pricePerMonthCents: number;
  plans: string;
  purchaseUrl: string;
  siteTitle: string;
}

export interface PortalMe {
  username: string;
  email: string;
  balanceCents: number;
  pricePerMonthCents: number;
  expiryTime: number;
  traffic: {
    up: number;
    down: number;
    total: number;
    enable: boolean;
    expiryTime: number;
  } | null;
}

export interface PortalNode {
  remark: string;
  protocol: string;
  enable: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
}

export interface PortalSubLinks {
  links: string[];
  subUrl?: string;
  subJsonUrl?: string;
  subClashUrl?: string;
}

export interface PortalTxn {
  id: number;
  username: string;
  kind: string;
  amountCents: number;
  balanceAfter: number;
  ref: string;
  createdAt: number;
}

export interface PortalPlan {
  months: number;
  label: string;
}

export function parsePortalPlans(plans: PortalPlans): PortalPlan[] {
  const fallback = [{ months: 1, label: '' }];
  if (!plans.plans) return stripLabels(fallback, plans);
  try {
    const raw = JSON.parse(plans.plans) as unknown;
    if (!Array.isArray(raw) || raw.length === 0) return stripLabels(fallback, plans);
    const out: PortalPlan[] = [];
    for (const item of raw) {
      if (typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 120) {
        out.push({ months: item, label: '' });
      } else if (
        typeof item === 'object' &&
        item !== null &&
        Number.isInteger((item as { months?: unknown }).months) &&
        (item as { months: number }).months >= 1 &&
        (item as { months: number }).months <= 120
      ) {
        out.push({
          months: (item as { months: number }).months,
          label: String((item as { label?: unknown }).label ?? ''),
        });
      }
    }
    return out.length > 0 ? stripLabels(out, plans) : stripLabels(fallback, plans);
  } catch {
    return stripLabels(fallback, plans);
  }
}

function stripLabels(items: PortalPlan[], plans: PortalPlans): PortalPlan[] {
  if (!plans.plans) {
    return items.map((p) => ({ ...p, label: defaultPlanLabel(p.months) }));
  }
  return items;
}

function defaultPlanLabel(months: number): string {
  return `${months}个月`;
}

export const PortalLoginSchema = z.object({
  username: z.string().min(1, 'username'),
  password: z.string().min(1, 'password'),
});

export const PortalRedeemSchema = z.object({
  code: z.string().min(1, 'portal.codeRequired'),
});

export type PortalLoginValues = z.infer<typeof PortalLoginSchema>;
export type PortalRedeemValues = z.infer<typeof PortalRedeemSchema>;

// Format the internal cent value as a Chinese yuan amount for customer-facing UI.
export function formatCents(cents: number): string {
  return `¥ ${(cents / 100).toFixed(2)}`;
}

export function planCostCents(months: number, pricePerMonthCents: number): number {
  return months * pricePerMonthCents;
}
