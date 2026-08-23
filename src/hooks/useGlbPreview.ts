import { useConversation } from '@/contexts/ConversationContext';
import { supabase } from '@/lib/db';
import { useQuery } from '@tanstack/react-query';

export const useGlbPreview = ({ id }: { id?: string }) => {
  const { conversation } = useConversation();

  const query = useQuery({
    queryKey: ['preview', id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;

      // Get most recent successful preview (handles multiple previews per mesh).
      //
      // Two deliberate choices about the query shape:
      //
      //   - The conversation filter is what makes it pass Security Rules:
      //     list operations are proven from the query's constraints, and
      //     `ownsParent(conversation_id)` / `parentIsPublic` are only
      //     evaluable when conversation_id is pinned. Without it the query
      //     is denied outright — even for the preview's owner.
      //   - Equality-only, no `.order()`: Firestore serves pure equality
      //     queries without a composite index, while adding orderBy would
      //     demand one per exact field combination. The matches are the
      //     previews of a single mesh — a handful — so the newest-first
      //     pick happens here instead. ISO-8601 strings sort lexically.
      const { data: previews, error: previewError } = await supabase
        .from('previews')
        .select('*')
        .eq('conversation_id', conversation.id)
        .eq('mesh_id', id)
        .eq('status', 'success');

      const preview = previews
        ?.slice()
        .sort((a, b) =>
          String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')),
        )[0];

      if (previewError || !preview) return null;

      const downloadStart = Date.now();

      const { data: previewBlob } = await supabase.storage
        .from('previews')
        .download(
          `${preview.user_id}/${preview.conversation_id}/${preview.id}.glb`,
        );

      const downloadEnd = Date.now();
      const downloadTime = downloadEnd - downloadStart;

      return {
        blob: previewBlob || null,
        updatedAt: new Date(preview.updated_at).getTime() + downloadTime,
      };
    },
    // Poll for preview availability during mesh generation
    refetchInterval: (query) => {
      // Only poll if we don't have a successful preview yet
      return !query.state.data ? 3000 : false;
    },
  });

  return {
    data: query.data?.blob || null,
    updatedAt: query.data?.updatedAt || null,
    isLoading: query.isLoading,
    error: query.error,
  };
};
