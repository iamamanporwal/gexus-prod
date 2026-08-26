import { createFileRoute } from '@tanstack/react-router';
import ShareView from '@/views/ShareView';

/**
 * Public share links live OUTSIDE `_layout`, so a visitor arriving from a
 * shared link gets the model and nothing else — no sidebar listing their own
 * (empty) history, no app chrome competing with the thing they came to see.
 * The path is unchanged: `_layout` is pathless, so this is still `/share/$id`.
 */
export const Route = createFileRoute('/share/$id')({
  component: ShareView,
  head: () => ({
    meta: [
      { title: 'Shared 3D model · GEXUS' },
      {
        name: 'description',
        content:
          'Explore this 3D model in your browser, then remix it into your own.',
      },
      // Unfurl cards for the places these links actually get pasted. Static
      // for now — a per-model title and thumbnail needs the conversation
      // resolved during SSR, which is a follow-up, not a blocker.
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Shared 3D model · GEXUS' },
      {
        property: 'og:description',
        content:
          'Explore this 3D model in your browser, then remix it into your own.',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Shared 3D model · GEXUS' },
      {
        name: 'twitter:description',
        content:
          'Explore this 3D model in your browser, then remix it into your own.',
      },
    ],
  }),
});
