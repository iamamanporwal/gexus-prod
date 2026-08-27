import { createFileRoute, redirect } from '@tanstack/react-router';

// This route used to bounce people out to an external billing page. It stays
// as a route only so old /subscription links do not 404; it now lands on
// settings, which is the one billing surface that is actually ours.
export const Route = createFileRoute('/_layout/subscription')({
  beforeLoad: () => {
    throw redirect({ to: '/settings' });
  },
});
