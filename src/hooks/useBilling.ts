import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/services/api';
import {
  billingStatusSchema,
  LOCAL_BILLING_STATUS,
  type BillingStatus,
} from '@/lib/billing';

// Poll adam-billing for subscription state + token balances. The 30s cadence
// is inherited from the old AuthProvider poll; adam-billing is the source of
// truth, there is no local realtime channel for it.
//
// Previously gated on there being a signed-in user. There is no sign-in any
// more, so this always runs — the server resolves the local identity itself.
export function useBilling() {
  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'status'],
    refetchInterval: 30000,
    queryFn: async (): Promise<BillingStatus> => {
      try {
        return await apiJson('billing-status', {}, billingStatusSchema);
      } catch (err) {
        if (import.meta.env.DEV) return LOCAL_BILLING_STATUS;
        throw err;
      }
    },
  });

  return { billing: data ?? null, isBillingLoading: isLoading };
}
