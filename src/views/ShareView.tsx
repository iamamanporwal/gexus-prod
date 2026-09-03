import { MessageBubble } from '@/components/chat/MessageBubble';
import { ParameterSection } from '@/components/parameter/ParameterSection';
import { ParameterSheetContent } from '@/components/parameter/ParameterSheetContent';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MeshPreview } from '@/components/viewer/MeshPreview';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { ShareHeader } from '@/components/share/ShareHeader';
import { SharePromptBar } from '@/components/share/SharePromptBar';
import { ConversationContext } from '@/contexts/ConversationContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { messageRowToChatMessage, type ChatMessage } from '@/lib/aiMessages';
import { supabase } from '@/lib/db';
import { errorMessage } from '@/lib/errorMessage';
import { publicPath, updateParameter } from '@/lib/utils';
import { useForkConversation } from '@/services/conversationService';
import parseParameters from '@shared/parseParameters';
import type { AppUIMessage } from '@shared/chatAi';
import { isParametricArtifact } from '@shared/parametricParts';
import Tree from '@shared/Tree';
import type {
  Conversation,
  Message,
  Parameter,
  ParametricArtifact,
} from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConversationView } from './ConversationView';

type ActivePreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

/**
 * Read-only sibling of `EditorView`. Renders a public conversation tree
 * with the same layout chrome as the editor (chat / preview / parameters
 * panels), but mounts NO chat instance, no `useChat`, no mutations.
 *
 * Branch navigation works locally: the viewer can flip between sibling
 * branches by walking a local `leafId` state, which doesn't touch the
 * DB's `current_message_leaf_id` (they don't own the conversation).
 * Parameters can be tweaked for exploration but the changes stay in
 * memory.
 */
export default function ShareView() {
  const { id: conversationId } = useParams({ from: '/share/$id' });

  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .limit(1)
        // maybeSingle, not single: a link to a conversation that was made
        // private again, or deleted, is a normal thing to receive. It should
        // render the "not shared" state below, not throw.
        .maybeSingle()
        .overrideTypes<Conversation>();
      if (error) throw error;
      return data;
    },
  });

  const { data: messages = [], isLoading: areMessagesLoading } = useQuery({
    queryKey: ['share-messages', conversationId],
    enabled: !!conversationId && !!conversation,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .overrideTypes<Message[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isConversationLoading || areMessagesLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!conversation) return <ShareUnavailable />;

  return (
    <ConversationContext.Provider value={{ conversation }}>
      <ConversationShare conversation={conversation} messages={messages} />
    </ConversationContext.Provider>
  );
}

/**
 * Shown when the link resolves to nothing readable — deleted, or switched back
 * to private. Deliberately not a bare 404: the person arrived from a link
 * someone sent them, so the page explains what happened and still offers the
 * product rather than dead-ending.
 */
function ShareUnavailable() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-adam-bg-secondary-dark px-6 text-center text-adam-text-primary">
      <img
        src={publicPath('gexus-wordmark.svg')}
        alt="GEXUS"
        className="h-5 w-auto opacity-80"
      />
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">This model isn&apos;t shared</h1>
        <p className="max-w-sm text-sm text-adam-text-secondary">
          The link may have been turned off by its owner, or the model was
          deleted.
        </p>
      </div>
      <Link to="/">
        <Button variant="light" className="h-10 px-5">
          Build your own
        </Button>
      </Link>
    </div>
  );
}

interface ConversationShareProps {
  conversation: Conversation;
  messages: Message[];
}

function ConversationShare({ conversation, messages }: ConversationShareProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isSignedIn, requestSignIn } = useAuth();
  const { mutate: fork, isPending: isForking } = useForkConversation();

  // A prompt typed on the share page before signing in. Held so it is not lost
  // across the sign-in popup: the person gets remixed straight into the editor
  // afterwards, rather than being dropped somewhere and having to retype.
  const pendingPromptRef = useRef<string>('');

  const remix = useCallback(
    (prompt: string) => {
      fork(conversation.id, {
        onSuccess: (result) => {
          toast({
            title: 'Copied to your workspace',
            description: 'Edit freely — the original is untouched.',
          });
          navigate({
            to: '/editor/$id',
            params: { id: result.conversationId },
            // The typed prompt travels in the URL rather than in memory so it
            // survives the full page load the editor route performs.
            search: prompt ? { prompt } : {},
          });
        },
        onError: (error) => {
          toast({
            title: 'Could not remix',
            description: errorMessage(
              error,
              'Something went wrong copying this model.',
            ),
            variant: 'destructive',
          });
        },
      });
    },
    [conversation.id, fork, navigate, toast],
  );

  // The gate. Everything that would CHANGE something routes through here;
  // looking, rotating the model and flipping branches never does.
  const requireAccount = useCallback(
    (reason: 'edit' | 'prompt' | 'remix', prompt = '') => {
      if (isSignedIn) return true;
      pendingPromptRef.current = prompt;
      requestSignIn(reason);
      return false;
    },
    [isSignedIn, requestSignIn],
  );

  // Once they come back signed in, finish what they started.
  const wasSignedInRef = useRef(isSignedIn);
  useEffect(() => {
    if (wasSignedInRef.current === isSignedIn) return;
    wasSignedInRef.current = isSignedIn;
    if (!isSignedIn) return;
    const prompt = pendingPromptRef.current;
    pendingPromptRef.current = '';
    remix(prompt);
  }, [isSignedIn, remix]);

  const handleRemixClick = useCallback(() => {
    if (!requireAccount('remix')) return;
    remix('');
  }, [requireAccount, remix]);

  const handlePromptSubmit = useCallback(
    (prompt: string) => {
      if (!requireAccount('prompt', prompt)) return;
      remix(prompt);
    },
    [requireAccount, remix],
  );

  // Local leaf — the share viewer can flip between branches without
  // touching `conversations.current_message_leaf_id` in the DB.
  const [localLeafId, setLocalLeafId] = useState<string>(
    conversation.current_message_leaf_id ?? messages.at(-1)?.id ?? '',
  );
  // Snap the local leaf to the conversation's current leaf when the DB
  // pointer changes (e.g. a refetch arrives). Only fires when the
  // upstream leaf actually changes — preserves the viewer's manual
  // branch nav otherwise.
  const prevLeafRef = useRef(conversation.current_message_leaf_id);
  useEffect(() => {
    if (prevLeafRef.current === conversation.current_message_leaf_id) return;
    prevLeafRef.current = conversation.current_message_leaf_id;
    if (conversation.current_message_leaf_id) {
      setLocalLeafId(conversation.current_message_leaf_id);
    }
  }, [conversation.current_message_leaf_id]);

  const chatMessages = useMemo(
    () => messages.map(messageRowToChatMessage),
    [messages],
  );
  const messageTree = useMemo(() => new Tree(chatMessages), [chatMessages]);
  const branch = useMemo(
    () => messageTree.getPath(localLeafId),
    [messageTree, localLeafId],
  );

  // Preview / parameters state — same shape as EditorView but with no
  // server-side persistence.
  const [activePreview, setActivePreview] = useState<ActivePreview>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [currentOutput, setCurrentOutput] = useState<Blob | undefined>();
  const [mobilePreviewVersion, setMobilePreviewVersion] = useState(0);
  const baseCodeRef = useRef<string | null>(null);

  // Auto-switch the preview pane to the latest artifact / mesh in the
  // current branch when it changes.
  const lastAutoAppliedPreviewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = findLatestPreview(branch);
    if (!latest) return;
    const key =
      latest.type === 'artifact'
        ? `artifact:${latest.messageId}:${latest.artifact.code.length}`
        : `mesh:${latest.messageId}:${latest.meshId}`;
    if (lastAutoAppliedPreviewKeyRef.current === key) return;
    lastAutoAppliedPreviewKeyRef.current = key;
    if (latest.type === 'artifact') {
      baseCodeRef.current = latest.artifact.code;
      setParameters(parseParameters(latest.artifact.code));
      setCurrentOutput(undefined);
      setActivePreview({
        type: 'artifact',
        messageId: latest.messageId,
        artifact: latest.artifact,
      });
      setMobilePreviewVersion((version) => version + 1);
    } else {
      setCurrentOutput(undefined);
      setActivePreview({
        type: 'mesh',
        messageId: latest.messageId,
        meshId: latest.meshId,
      });
      setMobilePreviewVersion((version) => version + 1);
    }
  }, [branch]);

  const handleViewArtifact = useCallback(
    (artifact: ParametricArtifact, messageId: string) => {
      baseCodeRef.current = artifact.code;
      setParameters(parseParameters(artifact.code));
      setCurrentOutput(undefined);
      setActivePreview({ type: 'artifact', messageId, artifact });
      setMobilePreviewVersion((version) => version + 1);
    },
    [],
  );
  const handleViewMesh = useCallback((meshId: string, messageId: string) => {
    setCurrentOutput(undefined);
    setActivePreview({ type: 'mesh', messageId, meshId });
    setMobilePreviewVersion((version) => version + 1);
  }, []);

  const changeParameters = useCallback(
    (nextParameters: Parameter[]) => {
      if (!baseCodeRef.current || activePreview?.type !== 'artifact') return;
      let nextCode = baseCodeRef.current;
      for (const parameter of nextParameters) {
        nextCode = updateParameter(nextCode, parameter);
      }
      setParameters(nextParameters);
      setActivePreview({
        ...activePreview,
        artifact: {
          ...activePreview.artifact,
          code: nextCode,
        },
      });
    },
    [activePreview],
  );

  const hasArtifact =
    activePreview?.type === 'artifact' && parameters.length > 0;

  // Parameter sliders stay live for a visitor: exploring "what does this look
  // like 20mm taller" is exactly the inspection a share link should allow, and
  // the change is in-memory only — nothing here writes to the owner's model.
  // The gate is on keeping a change, not on trying one.

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-adam-bg-secondary-dark">
      <ShareHeader
        title={conversation.title}
        isRemixing={isForking}
        onRemix={handleRemixClick}
      />
      <div className="min-h-0 flex-1">
        <ShareBody
          hasArtifact={hasArtifact}
          conversation={conversation}
          activePreview={activePreview}
          parameters={parameters}
          currentOutput={currentOutput}
          setCurrentOutput={setCurrentOutput}
          mobilePreviewVersion={mobilePreviewVersion}
          branch={branch}
          onSelectLeaf={setLocalLeafId}
          onViewArtifact={handleViewArtifact}
          onViewMesh={handleViewMesh}
          changeParameters={changeParameters}
          isSignedIn={isSignedIn}
          isForking={isForking}
          onPromptSubmit={handlePromptSubmit}
          onBlockedInteraction={() => requireAccount('prompt')}
        />
      </div>
    </div>
  );
}

type ShareBodyProps = {
  hasArtifact: boolean;
  conversation: Conversation;
  activePreview: ActivePreview;
  parameters: Parameter[];
  currentOutput: Blob | undefined;
  setCurrentOutput: (output: Blob | undefined) => void;
  mobilePreviewVersion: number;
  branch: ReturnType<Tree<ChatMessage>['getPath']>;
  onSelectLeaf: (id: string) => void;
  onViewArtifact: (artifact: ParametricArtifact, messageId: string) => void;
  onViewMesh: (meshId: string, messageId: string) => void;
  changeParameters: (parameters: Parameter[]) => void;
  isSignedIn: boolean;
  isForking: boolean;
  onPromptSubmit: (prompt: string) => void;
  onBlockedInteraction: () => void;
};

function ShareBody({
  hasArtifact,
  activePreview,
  parameters,
  currentOutput,
  setCurrentOutput,
  mobilePreviewVersion,
  branch,
  onSelectLeaf,
  onViewArtifact,
  onViewMesh,
  changeParameters,
  isSignedIn,
  isForking,
  onPromptSubmit,
  onBlockedInteraction,
}: ShareBodyProps) {
  return (
    <ConversationView
      hasParameters={hasArtifact}
      mobilePreviewKey={
        activePreview
          ? activePreview.type === 'artifact'
            ? `artifact:${activePreview.messageId}`
            : `mesh:${activePreview.messageId}:${activePreview.meshId}`
          : null
      }
      mobilePreviewVersion={mobilePreviewVersion}
      chatPanelSlot={
        <>
          <ScrollArea className="relative w-full max-w-none flex-1 self-center px-3 py-0 md:min-h-0 md:p-4">
            <div className="pointer-events-none sticky left-0 top-0 z-50 h-3 bg-gradient-to-b from-adam-bg-secondary-dark/90 to-transparent md:hidden" />
            <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-6 md:pb-0">
              {branch.map((node) => (
                <MessageBubble
                  key={node.id}
                  message={node}
                  isLoading={false}
                  onSelectLeaf={onSelectLeaf}
                  onViewArtifact={(artifact) =>
                    onViewArtifact(artifact, node.id)
                  }
                  onViewMesh={(meshId) => onViewMesh(meshId, node.id)}
                />
              ))}
            </div>
          </ScrollArea>

          <SharePromptBar
            isSignedIn={isSignedIn}
            isPending={isForking}
            onSubmit={onPromptSubmit}
            onBlockedInteraction={onBlockedInteraction}
          />
        </>
      }
      previewSlot={
        <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
          {activePreview?.type === 'artifact' ? (
            <OpenSCADPreview
              scadCode={activePreview.artifact.code}
              color="#00A6FF"
              onOutputChange={setCurrentOutput}
            />
          ) : activePreview?.type === 'mesh' ? (
            <MeshPreview meshId={activePreview.meshId} />
          ) : (
            <div className="text-sm text-adam-text-secondary">
              Nothing to preview yet
            </div>
          )}
        </div>
      }
      mobilePreviewSlot={
        <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark">
          {activePreview?.type === 'artifact' ? (
            <OpenSCADPreview
              scadCode={activePreview.artifact.code}
              color="#00A6FF"
              onOutputChange={setCurrentOutput}
              isMobile={true}
              backgroundColor="#212121"
            />
          ) : activePreview?.type === 'mesh' ? (
            <MeshPreview meshId={activePreview.meshId} />
          ) : (
            <div className="text-sm text-adam-text-secondary">
              Nothing to preview yet
            </div>
          )}
        </div>
      }
      parametersSlot={
        <div className="relative h-full">
          <ParameterSection
            parameters={parameters}
            onParameterChange={changeParameters}
            currentOutput={currentOutput}
            dxfExporter={null}
            code={
              activePreview?.type === 'artifact'
                ? activePreview.artifact.code
                : undefined
            }
          />
        </div>
      }
      mobileParametersSlot={
        <ParameterSheetContent
          parameters={parameters}
          onParameterChange={changeParameters}
          currentOutput={currentOutput}
          dxfExporter={null}
          code={
            activePreview?.type === 'artifact'
              ? activePreview.artifact.code
              : undefined
          }
        />
      }
    />
  );
}

type LatestPreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

function findLatestPreview(
  messages: { id: string; parts: AppUIMessage['parts'] }[],
): LatestPreview {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex];
      if (
        part.type === 'tool-build_parametric_model' &&
        part.state !== 'input-streaming' &&
        isParametricArtifact(part.input)
      ) {
        return {
          type: 'artifact',
          messageId: message.id,
          artifact: part.input,
        };
      }
      if (
        part.type === 'tool-create_mesh' &&
        part.state === 'output-available'
      ) {
        return {
          type: 'mesh',
          messageId: message.id,
          meshId: part.output.id,
        };
      }
    }
  }
  return null;
}
