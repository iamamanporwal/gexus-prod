import { createFileRoute } from '@tanstack/react-router';
import { LoginView } from '@/views/LoginView';

export const Route = createFileRoute('/login')({
  // `redirect` carries where to land after signing in. Parsed here rather than
  // read straight off the URL so the value reaching the component is always a
  // string or undefined; LoginView still sanitises it against open redirects
  // before navigating.
  // Optional property, not a nullable one — see the note on the editor route:
  // a nullable property makes `search` mandatory at every link site.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  component: LoginView,
  head: () => ({
    meta: [
      { title: 'Sign in · GEXUS' },
      {
        name: 'description',
        content: 'Sign in to GEXUS to build, save and share 3D models.',
      },
    ],
  }),
});
