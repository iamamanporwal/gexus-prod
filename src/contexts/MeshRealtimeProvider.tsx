import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '@/lib/supabase';
import { LOCAL_USER_ID } from '@shared/localUser';
import { useProfile } from '@/services/profileService';

// Realtime mesh/preview invalidation + the "3D model is ready" notification.
//
// This used to live inside AuthProvider, keyed on the signed-in user and torn
// down on sign-out. With authentication gone the channel is keyed on the
// constant local id and simply lives for the lifetime of the app.

const ensurePermission = async () => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
};

export function MeshRealtimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const notificationsEnabled = profile?.notifications_enabled ?? false;

  // Ask for browser notification permission once the preference is on.
  useEffect(() => {
    if (notificationsEnabled) void ensurePermission();
  }, [notificationsEnabled]);

  useEffect(() => {
    const channel = supabase
      .channel(`mesh-updates-${LOCAL_USER_ID}`)
      .on(
        'broadcast',
        {
          event: 'mesh-updated',
        },
        async ({ payload }) => {
          if (payload.kind === 'mesh') {
            queryClient.invalidateQueries({
              queryKey: ['meshData', payload.id],
            });
            queryClient.invalidateQueries({ queryKey: ['mesh', payload.id] });
            queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });

            if (
              payload.status === 'success' &&
              notificationsEnabled &&
              !window.location.pathname.includes(
                `/editor/${payload.conversation_id}`,
              )
            ) {
              if (await ensurePermission()) {
                const notification = new Notification('3D model is ready', {
                  body: 'Your generated 3D model has finished. Click to open.',
                  icon: `${import.meta.env.BASE_URL}/Adam-Logo.png`,
                });
                notification.onclick = () => {
                  window.focus();
                  navigate({
                    to: '/editor/$id',
                    params: { id: payload.conversation_id },
                  });
                  notification.close();
                };
              }
            }
          }

          if (payload.kind === 'preview') {
            queryClient.invalidateQueries({
              queryKey: ['preview', payload.id],
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, navigate, notificationsEnabled]);

  return <>{children}</>;
}
