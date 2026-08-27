import { createFileRoute } from '@tanstack/react-router';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';
import { billing } from '@/server/billingClient';
import { env } from '@/server/env';

// Where Stripe returns the customer once checkout finishes. Derived from the
// request rather than hardcoded: the previous fallback sent people to another
// company's app whenever APP_URL was unset — which is its default state.
const appUrl = (request: Request) =>
  env('APP_URL') || new URL(request.url).origin;
const MAX_TRIAL_PERIOD_DAYS = 7;

export const Route = createFileRoute('/api/billing-checkout')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request);
          const body = await request.json().catch(() => null);
          if (!isRecord(body) || typeof body.priceId !== 'string') {
            return json({ error: 'invalid_request' }, 400);
          }
          const trialPeriodDays =
            typeof body.trialPeriodDays === 'number'
              ? body.trialPeriodDays
              : undefined;
          if (
            trialPeriodDays !== undefined &&
            (!Number.isInteger(trialPeriodDays) ||
              trialPeriodDays < 0 ||
              trialPeriodDays > MAX_TRIAL_PERIOD_DAYS)
          ) {
            return json({ error: 'invalid_request' }, 400);
          }
          const result = await billing.createCheckout(user.id, {
            priceId: body.priceId,
            successUrl: appUrl(request),
            cancelUrl: appUrl(request),
            trialPeriodDays,
          });
          return json(result);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'checkout_failed',
            },
            isUnauthorizedError(err) ? 401 : 502,
          );
        }
      },
    },
  },
});
