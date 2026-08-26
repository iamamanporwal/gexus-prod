import { useConversation } from '@/contexts/ConversationContext';
import { supabase } from '@/lib/db';
import { downloadConversationAsset } from '@/lib/conversationAssets';
import { MeshData } from '@shared/types';
import { useQuery } from '@tanstack/react-query';

export const useMeshData = ({ id }: { id: string }) => {
  const { conversation } = useConversation();

  const dataQuery = useQuery({
    queryKey: ['meshData', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meshes')
        .select('*')
        .eq('id', id)
        .limit(1)
        .single()
        .overrideTypes<MeshData>();

      if (error) {
        throw error;
      }

      return data;
    },
    // Poll while pending to ensure UI progresses past 95% as soon as status flips
    refetchInterval: (query) => {
      const current = query.state.data as MeshData | undefined;
      return current && current.status === 'pending' ? 3000 : false;
    },
  });

  const blobQuery = useQuery({
    queryKey: ['mesh', id],
    enabled:
      !!id &&
      !dataQuery.isLoading &&
      dataQuery.data &&
      dataQuery.data.status === 'success',
    queryFn: async () => {
      const fileExtension = dataQuery.data?.file_type || 'glb';
      // Owner reads storage directly; a share-link viewer goes through the
      // public proxy, which is the only path Storage rules permit them.
      return downloadConversationAsset({
        ownerId: conversation.user_id,
        conversationId: conversation.id,
        kind: 'meshes',
        file: `${id}.${fileExtension}`,
      });
    },
    refetchOnMount: false,
  });

  return {
    data: dataQuery,
    blob: blobQuery,
  };
};
