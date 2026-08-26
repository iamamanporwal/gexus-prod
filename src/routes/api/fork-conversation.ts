import { createFileRoute } from '@tanstack/react-router';
import { handleForkConversationRequest } from '@/server/forkConversation';

export const Route = createFileRoute('/api/fork-conversation')({
  server: {
    handlers: {
      POST: ({ request }) => handleForkConversationRequest(request),
      OPTIONS: ({ request }) => handleForkConversationRequest(request),
      // Registered only so a GET answers 405 as JSON. Leaving the method
      // unhandled makes the router fall through to the SPA shell, and a caller
      // that reached here by mistake gets a page of HTML instead of an error
      // it can read.
      GET: ({ request }) => handleForkConversationRequest(request),
    },
  },
});
