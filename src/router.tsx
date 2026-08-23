import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

type AppRouter = ReturnType<typeof createAppRouter>;

let clientRouter: AppRouter | undefined;

// Derived from Vite's `base` rather than written out, so the router can never
// drift from the path the app is actually served at. The server handler takes
// its basepath from the build config and would override a wrong value here;
// the browser does not, so a stale literal silently breaks every client-side
// navigation while SSR keeps looking fine.
const viteBase = import.meta.env.BASE_URL;
const basepath =
  viteBase.length > 1 && viteBase.endsWith('/')
    ? viteBase.slice(0, -1)
    : viteBase;

function createAppRouter() {
  return createTanStackRouter({
    routeTree,
    basepath,
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

export function getRouter() {
  if (typeof window !== 'undefined') {
    clientRouter ??= createAppRouter();
    return clientRouter;
  }

  return createAppRouter();
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
