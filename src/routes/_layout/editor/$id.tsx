import { createFileRoute } from '@tanstack/react-router';
import EditorView from '@/views/EditorView';

export const Route = createFileRoute('/_layout/editor/$id')({
  component: EditorView,
});
