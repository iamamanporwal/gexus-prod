import { createFileRoute } from '@tanstack/react-router';
import EditorView from '@/views/EditorView';

export const Route = createFileRoute('/_layout/editor/$id')({
  // `prompt` carries a message typed somewhere else that should be sent as
  // soon as this conversation opens — currently the prompt bar on a shared
  // model, which remixes into a new conversation and lands here. Passed
  // through the URL rather than in memory because the remix performs a real
  // navigation, and in-memory state would not survive it.
  // The return type is `{ prompt?: string }`, not `{ prompt: string |
  // undefined }`. The difference is load-bearing: with a merely-nullable
  // property, TanStack treats search as REQUIRED and every existing
  // `<Link to="/editor/$id">` in the app stops compiling. Making it genuinely
  // optional keeps this a additive change.
  validateSearch: (search: Record<string, unknown>): { prompt?: string } =>
    typeof search.prompt === 'string' ? { prompt: search.prompt } : {},
  component: EditorView,
});
