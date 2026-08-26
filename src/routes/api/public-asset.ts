import { createFileRoute } from '@tanstack/react-router';
import { preflight } from '@/server/api';
import { handlePublicAssetRequest } from '@/server/publicAsset';

export const Route = createFileRoute('/api/public-asset')({
  server: {
    handlers: {
      GET: ({ request }) => handlePublicAssetRequest(request),
      OPTIONS: preflight,
    },
  },
});
