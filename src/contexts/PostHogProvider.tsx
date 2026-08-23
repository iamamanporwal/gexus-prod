import { useEffect } from 'react';
import { useLocation } from '@tanstack/react-router';
import { analytics, initPostHog } from '@/lib/posthog';
import { guestUserId } from '@/lib/db';

interface PostHogProviderProps {
  children: React.ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  const location = useLocation();

  // Initialize PostHog once on mount
  useEffect(() => {
    initPostHog();
  }, []);

  // Identify the guest by their anonymous-auth uid. Stable per browser, so
  // repeat visits attribute to the same person — which is the whole reason to
  // identify at all. No email is sent: an anonymous user has none, and a
  // synthetic one would pollute PostHog with addresses that look real.
  //
  // Safe to read synchronously: this provider mounts inside GuestSessionGate.
  useEffect(() => {
    analytics.identify(guestUserId());
  }, []);

  // Track page views on route change
  useEffect(() => {
    analytics.capture('$pageview', {
      $current_url: window.location.href,
    });
  }, [location.pathname]);

  return <>{children}</>;
}
