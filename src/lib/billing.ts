// Billing types and helpers.
//
// These used to live in AuthContext because billing was keyed on the signed-in
// user. Authentication is gone, but billing state is still a real concept the
// UI renders (token counts, plan pills), so it lives here on its own.
//
// Locally the server bypasses the billing service entirely when
// ENVIRONMENT="local" and reports an unlimited pro plan — see
// src/server/billingClient.ts.
import { z } from 'zod';

export type SubscriptionLevel = 'standard' | 'pro' | 'max';
export type PlanLevel = SubscriptionLevel | 'free';

export type BillingStatus = {
  user: {
    hasTrialed: boolean;
  };
  subscription: {
    level: SubscriptionLevel;
    status: string | null;
    currentPeriodEnd: string | null;
  } | null;
  tokens: {
    free: number;
    subscription: number;
    purchased: number;
    total: number;
  };
};

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function getLevel(billing: BillingStatus | null | undefined): PlanLevel {
  if (!billing?.subscription) return 'free';
  if (!ACTIVE_STATUSES.has(billing.subscription.status ?? '')) return 'free';
  return billing.subscription.level;
}

export const billingStatusSchema = z.object({
  user: z.object({ hasTrialed: z.boolean() }),
  subscription: z
    .object({
      level: z.union([
        z.literal('standard'),
        z.literal('pro'),
        z.literal('max'),
      ]),
      status: z.string().nullable(),
      currentPeriodEnd: z.string().nullable(),
    })
    .nullable(),
  tokens: z.object({
    free: z.number(),
    subscription: z.number(),
    purchased: z.number(),
    total: z.number(),
  }),
});

// Used when the billing endpoint can't be reached in dev, so the UI still
// renders a coherent plan instead of blanking out.
export const LOCAL_BILLING_STATUS: BillingStatus = {
  user: { hasTrialed: false },
  subscription: {
    level: 'pro',
    status: 'active',
    currentPeriodEnd: new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  },
  tokens: {
    free: 1_000_000,
    subscription: 1_000_000,
    purchased: 1_000_000,
    total: 3_000_000,
  },
};
