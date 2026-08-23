import { createFileRoute } from '@tanstack/react-router';
import { handleAvailableModelsRequest } from '@/server/availableModels';

export const Route = createFileRoute('/api/available-models')({
  server: {
    handlers: {
      GET: ({ request }) => handleAvailableModelsRequest(request),
      OPTIONS: ({ request }) => handleAvailableModelsRequest(request),
    },
  },
});
