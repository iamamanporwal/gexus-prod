import { supabase, guestUserId } from '@/lib/db';
import { Profile } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Creates the caller's profiles row if it does not exist yet.
 *
 * Under Postgres this row was seeded by a migration for the one hard-coded
 * local identity. With real accounts there is no migration to seed anything:
 * every visitor arrives with a uid that has no row, so `useProfile` below
 * failed permanently for everyone — which is why the greeting never showed a
 * name and the notification preference could not be saved.
 *
 * The uid is used as the document id so this is idempotent: a second call
 * merges instead of creating a duplicate row. `ignoreDuplicates` keeps an
 * existing row's name intact, so a returning user's edited name is never
 * overwritten by their Google display name on the next sign-in.
 */
export async function ensureProfile({
  userId,
  fullName,
}: {
  userId: string;
  fullName?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      user_id: userId,
      full_name: fullName?.trim() || 'Guest',
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Updates the stored name to match the identity provider, but only when the
 * row is still carrying the placeholder a guest was created with. Someone who
 * renamed themselves keeps their choice.
 */
export async function adoptProviderName({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string | null | undefined;
}): Promise<void> {
  const name = fullName?.trim();
  if (!name) return;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  const existing = (data as Profile | null)?.full_name?.trim();
  if (existing && existing !== 'Guest') return;

  await supabase
    .from('profiles')
    .update({ full_name: name, updated_at: new Date().toISOString() })
    .eq('id', userId);
}

// The profiles row for the current account, created on demand by
// `ensureProfile` at boot (see AuthProvider).
export function useProfile() {
  return useQuery({
    queryKey: ['profile', guestUserId()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', guestUserId())
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return (data as Profile | null) ?? null;
    },
  });
}

export function useAvatarUrl(avatarPath: string | null | undefined) {
  return useQuery({
    queryKey: ['avatar-url', avatarPath],
    queryFn: async () => {
      if (!avatarPath) return null;

      // Download the file to get a blob URL that's cached by React Query
      const { data, error } = await supabase.storage
        .from('images')
        .download(avatarPath);

      if (error) throw error;
      if (!data) return null;

      // Create a blob URL from the downloaded data
      return URL.createObjectURL(data);
    },
    enabled: !!avatarPath,
    staleTime: 1000 * 60 * 60 * 24, // Cache for 24 hours
    gcTime: 1000 * 60 * 60 * 24 * 7, // Keep in cache for 7 days
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: Partial<Profile>) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          ...(profile.full_name && { full_name: profile.full_name }),
          ...(profile.avatar_path && { avatar_path: profile.avatar_path }),
          ...(profile.notifications_enabled !== undefined && {
            notifications_enabled: profile.notifications_enabled,
          }),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', guestUserId())
        .select()
        .single();

      if (error) throw error;

      return data;
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData(['profile', guestUserId()], data);
      }
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      // Validate file type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        throw new Error(
          'Invalid file type. Please upload a JPEG, PNG, or WebP image.',
        );
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error(
          'File too large. Please upload an image smaller than 5MB.',
        );
      }

      // Upload image with upsert to automatically replace existing
      const filePath = `${guestUserId()}/profile`;

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      // Update profile with avatar path
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          avatar_path: filePath,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', guestUserId())
        .select()
        .single();

      if (updateError) throw updateError;

      return data;
    },
    onSuccess: (data) => {
      if (data) {
        // Update profile cache
        queryClient.setQueryData(['profile', guestUserId()], data);
        // Invalidate avatar URL cache to fetch new image
        queryClient.invalidateQueries({
          queryKey: ['avatar-url', data.avatar_path],
        });
      }
    },
  });
}
