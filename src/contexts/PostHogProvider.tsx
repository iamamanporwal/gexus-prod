import { useEffect } from 'react';
import { useLocation } from '@tanstack/react-router';
import { analytics, initPostHog } from '@/lib/posthog';
import { LOCAL_USER } from '@shared/localUser';

interface PostHogProviderProps {
  children: React.ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  const location = useLocation();

  // Initialize PostHog once on mount
  useEffect(() => {
    initPostHog();
  }, []);

  // Identify the local user. There is no sign-in, so the identity never
  // changes and this runs once rather than tracking a session.
  useEffect(() => {
    analytics.identify(LOCAL_USER.id, { email: LOCAL_USER.email });
  }, []);

  // Track page views on route change
  useEffect(() => {
    analytics.capture('$pageview', {
      $current_url: window.location.href,
    });
  }, [location.pathname]);

  return <>{children}</>;
}
