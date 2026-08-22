import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { guestUserId } from '@/lib/db';
import { watchMeshUpdates } from '@/lib/firebaseMeshWatch';
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
    // Was a Supabase broadcast channel. Firestore has no pub/sub, but the thing
    // being announced is a document change, so watching the document is both
    // available and better: a broadcast sent while this client was reloading
    // was lost forever, leaving a spinner up until a manual refresh.
    const unsubscribe = watchMeshUpdates(guestUserId(), async (update) => {
      queryClient.invalidateQueries({ queryKey: ['meshData', update.id] });
      queryClient.invalidateQueries({ queryKey: ['mesh', update.id] });
      queryClient.invalidateQueries({ queryKey: ['preview', update.id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });

      if (
        update.status === 'success' &&
        notificationsEnabled &&
        !window.location.pathname.includes(`/editor/${update.conversation_id}`)
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
              params: { id: update.conversation_id },
            });
            notification.close();
          };
        }
      }
    });

    return unsubscribe;
  }, [queryClient, navigate, notificationsEnabled]);

  return <>{children}</>;
}
