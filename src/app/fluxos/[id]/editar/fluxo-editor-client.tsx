"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowLeft,
  Bot,
  Check,
  CircleHelp,
  Clock3,
  GitBranch,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  Workflow,
  Zap,
} from "lucide-react";
import type { Automation, AutomationTrigger, DelayMode, FlowEdgeDefinition, FlowNodeDefinition, MatchType, QuickReply, ReplyMode } from "@/lib/db/repositories";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { mediaTypeLabel } from "@/lib/rotulos";


type Props = {
  automation: Automation;
  backHref: string;
  accountId: string | null;
  isInstagramConnected: boolean;
};

type Notice = { tone: "success" | "error"; text: string } | null;
type FlowNodeKind =
  | "trigger"
  | "keywords"
  | "publicReply"
  | "condition"
  | "dm"
  | "quickReplies"
  | "link"
  | "reminder"
  | "end"
  | "commentReply"
  | "privateReply"
  | "buttonMessage"
  | "mediaMessage"
  | "reaction"
  | "tagAction"
  | "automationLink";
type FlowNodeCategory = "trigger" | "action" | "logic" | "data" | "control";
type DelayUnit = "seconds" | "minutes" | "hours";
type MediaStatus = "idle" | "loading" | "ready" | "error";
type MediaActionType = "image" | "gif" | "audio";

type FlowNodeConfig = {
  text?: string;
  buttonLabel?: string;
  url?: string;
  payload?: string;
  mediaUrl?: string;
  mediaType?: MediaActionType;
  tagName?: string;
  automationId?: string;
  reactionEmoji?: string;
  delayMode?: DelayMode;
  delayValue?: string;
  delayMin?: string;
  delayMax?: string;
  delayUnit?: DelayUnit;
};

type InstagramMedia = {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  permalink?: string;
};

type FlowNodeData = {
  kind: FlowNodeKind;
  title: string;
  subtitle: string;
  summary: string;
  badge: string;
  active: boolean;
  config?: FlowNodeConfig;
};

type UaiFlowNode = Node<FlowNodeData, "uaiNode">;
type UaiFlowEdge = Edge<{ label?: string }>;

type FlowFormState = {
  name: string;
  active: boolean;
  triggers: AutomationTrigger[];
  keywords: string;
  match_type: MatchType;
  post_id: string;
  public_reply_mode: ReplyMode;
  public_replies: string[];
  welcome_dm: string;
  quick_reply_label: string;
  quick_replies: QuickReply[];
  link_text: string;
  link_button_label: string;
  link_url: string;
  reply_delay_mode: DelayMode;
  reply_delay_value: string;
  reply_delay_min: string;
  reply_delay_max: string;
  reply_delay_unit: DelayUnit;
  reminder_text: string;
  reminder_delay_mode: DelayMode;
  reminder_delay_value: string;
  reminder_delay_min: string;
  reminder_delay_max: string;
  reminder_delay_unit: DelayUnit;
  require_follower: boolean;
  non_follower_dm: string;
  non_follower_button_label: string;
  follower_confirmation_text: string;
  follower_confirmation_greetings: string[];
};

const defaultFollowerConfirmationGreetings = ["Oii", "Olá", "Eii", "Eae", "Opa"];

const variables = [
  { tag: "{{username}}", label: "Usuário", preview: "@usuario" },
  { tag: "{{first_name}}", label: "Primeiro nome", preview: "Maria" },
  { tag: "{{name}}", label: "Nome", preview: "Maria Silva" },
  { tag: "{{profile_url}}", label: "Perfil", preview: "instagram.com/usuario" },
  { tag: "{{automation_name}}", label: "Automação", preview: "FluxoEuQuero1" },
];
const nodeTypes = { uaiNode: AutomationNode };
const defaultEdgeOptions = {
  type: "smoothstep",
  animated: true,
  style: { stroke: "var(--ms-primary)", strokeWidth: 2 },
};

export function FluxoEditorClient({ automation, backHref, accountId, isInstagramConnected }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [formState, setFormState] = useState<FlowFormState>(() => automationToFormState(automation));
  const [nodes, setNodes] = useState<UaiFlowNode[]>(() => createInitialNodes(automation));
  const [edges, setEdges] = useState<UaiFlowEdge[]>(() => createInitialEdges(automation));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>(isInstagramConnected ? "loading" : "idle");
  const [mediaError, setMediaError] = useState<string | null>(null);

  const displayNodes = useMemo(
    () => nodes.map((node) => ({ ...node, data: buildNodeData(node.data.kind, formState, node.data.config) })),
    [formState, nodes],
  );

  const displayEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    selected: edge.id === selectedEdgeId,
    style: edge.id === selectedEdgeId ? { ...defaultEdgeOptions.style, stroke: "#ef4444", strokeWidth: 3 } : edge.style,
  })), [edges, selectedEdgeId]);
  const selectedNode = selectedNodeId ? displayNodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? displayEdges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const metrics = useMemo(() => getFlowMetrics(nodes), [nodes]);

  useEffect(() => {
    if (!isInstagramConnected) return;

    let active = true;

    fetch(`/api/media${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`, { credentials: "same-origin" })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? ((await response.json()) as { data?: InstagramMedia[]; error?: string })
          : { error: "Sua sessão expirou. Entre de novo para carregar os posts e Reels." };

        if (!response.ok) throw new Error(payload.error || "Não consegui carregar os posts e Reels.");
        return payload.data ?? [];
      })
      .then((items) => {
        if (!active) return;
        setMedia(items);
        setMediaStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        setMediaStatus("error");
        setMediaError(error instanceof Error ? error.message : "Não consegui carregar os posts e Reels.");
      });

    return () => {
      active = false;
    };
  }, [accountId, isInstagramConnected]);


  const onNodesChange = useCallback((changes: NodeChange<UaiFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<UaiFlowEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, ...defaultEdgeOptions, label: connectionLabel(connection) }, current));
  }, []);

  function updateForm<K extends keyof FlowFormState>(key: K, value: FlowFormState[K]) {
    setFormState((current) => ({ ...current, [key]: value }));
  }

  function updatePublicReply(index: number, value: string) {
    setFormState((current) => ({
      ...current,
      public_replies: current.public_replies.map((reply, replyIndex) => replyIndex === index ? value : reply),
    }));
  }

  function addPublicReply() {
    setFormState((current) => ({ ...current, public_replies: [...current.public_replies, ""] }));
  }

  function removePublicReply(index: number) {
    setFormState((current) => {
      const publicReplies = current.public_replies.filter((_, replyIndex) => replyIndex !== index);
      return { ...current, public_replies: publicReplies.length ? publicReplies : [""] };
    });
  }
  function updateFollowerGreeting(index: number, value: string) {
    setFormState((current) => ({
      ...current,
      follower_confirmation_greetings: current.follower_confirmation_greetings.map((greeting, greetingIndex) => greetingIndex === index ? value : greeting),
    }));
  }

  function addFollowerGreeting() {
    setFormState((current) => ({ ...current, follower_confirmation_greetings: [...current.follower_confirmation_greetings, ""] }));
  }

  function removeFollowerGreeting(index: number) {
    setFormState((current) => {
      const greetings = current.follower_confirmation_greetings.filter((_, greetingIndex) => greetingIndex !== index);
      return { ...current, follower_confirmation_greetings: greetings.length ? greetings : [""] };
    });
  }
  function addOrSelectNode(kind: FlowNodeKind) {
    const existing = displayNodes.find((node) => node.data.kind === kind);
    if (existing && !isRepeatableNodeKind(kind)) {
      setSelectedEdgeId(null);
      setSelectedNodeId(existing.id);
      return;
    }

    const id = `${kind}-${Date.now()}`;
    const config = defaultNodeConfig(kind);
    const nextNode: UaiFlowNode = {
      id,
      type: "uaiNode",
      position: nextNodePosition(nodes),
      data: buildNodeData(kind, formState, config),
    };

    setNodes((current) => [...current, nextNode]);
    setSelectedEdgeId(null);
    setSelectedNodeId(id);
  }

  function updateSelectedNodeConfig(patch: Partial<FlowNodeConfig>) {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => node.id === selectedNodeId ? {
      ...node,
      data: {
        ...node.data,
        config: cleanNodeConfig({ ...(node.data.config ?? {}), ...patch }),
      },
    } : node));
  }

  function deleteSelectedEdge() {
    if (!selectedEdgeId) return;
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }

  function updateSelectedEdgeLabel(label: string) {
    if (!selectedEdgeId) return;
    setEdges((current) => current.map((edge) => edge.id === selectedEdgeId ? { ...edge, label: label.trim() || undefined } : edge));
  }

  function deleteSelectedStep() {
    if (!selectedNode || !canDeleteStep(selectedNode.data.kind)) return;
    if (isRepeatableNodeKind(selectedNode.data.kind)) {
      setNodes((current) => current.filter((node) => node.id !== selectedNode.id));
      setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
      setSelectedNodeId(null);
      return;
    }

    setFormState((current) => clearStepConfig(current, selectedNode.data.kind));
    setSelectedNodeId(null);
  }
  function toggleTrigger(trigger: AutomationTrigger) {
    setFormState((current) => {
      const hasTrigger = current.triggers.includes(trigger);
      const triggers = hasTrigger ? current.triggers.filter((item) => item !== trigger) : [...current.triggers, trigger];
      return { ...current, triggers: triggers.length ? triggers : current.triggers };
    });
  }

  async function saveFlow() {
    setSaving(true);
    setNotice(null);

    const payload = {
      ...formStateToPayload(formState, automation.name),
      flow_nodes: serializeFlowNodes(nodes),
      flow_edges: serializeFlowEdges(edges),
    };

    try {
      const response = await fetch(`/api/automations/${automation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { data?: Automation; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Não consegui salvar o fluxo.");
      setNotice({ tone: "success", text: "Fluxo salvo." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao salvar fluxo." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="h-[calc(100svh-5.5rem)] min-h-[520px] overflow-hidden rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] shadow-[var(--ms-shadow)] xl:min-h-[640px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-[var(--ms-border)] bg-[var(--ms-surface)] px-3 py-2.5 sm:px-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(220px,1fr)_120px] sm:items-end">
              <label className="field min-w-0 gap-1">
                <span>Nome da automação</span>
                <input className="input h-10 py-0 text-base font-semibold" value={formState.name} onChange={(event) => updateForm("name", event.target.value)} />
              </label>
              <label className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] px-3 text-sm font-semibold" title="Ativar ou pausar este fluxo">
                <input checked={formState.active} onChange={(event) => updateForm("active", event.target.checked)} type="checkbox" />
                Ativo
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {notice ? (
                <span className={notice.tone === "success" ? "status-pill status-pill-green h-10" : "status-pill h-10 text-red-500"} aria-live="polite">
                  {notice.tone === "success" ? <Check size={14} /> : null}
                  {notice.text}
                </span>
              ) : null}
              <Link className="btn-secondary h-10 px-3" href={backHref} title="Voltar para a lista de fluxos"><ArrowLeft size={16} /> Voltar</Link>
              <button className="btn-secondary h-10 px-3" disabled title="Testar fluxo" type="button"><Workflow size={16} /> Testar</button>
              <button className="btn-primary h-10 px-3" disabled={saving} onClick={saveFlow} title="Salvar as alterações do fluxo" type="button">
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[340px_minmax(0,1fr)]">
          {selectedEdge ? (
            <EdgeInspectorPanel
              edge={selectedEdge}
              sourceNode={displayNodes.find((node) => node.id === selectedEdge.source) ?? null}
              targetNode={displayNodes.find((node) => node.id === selectedEdge.target) ?? null}
              onBack={() => setSelectedEdgeId(null)}
              onDelete={deleteSelectedEdge}
              onUpdateLabel={updateSelectedEdgeLabel}
            />
          ) : selectedNode ? (
            <InspectorPanel
              canDelete={canDeleteStep(selectedNode.data.kind)}
              formState={formState}
              media={media}
              mediaError={mediaError}
              mediaStatus={mediaStatus}
              node={selectedNode}
              saving={saving}
              onAddPublicReply={addPublicReply}
              onAddFollowerGreeting={addFollowerGreeting}
              onBack={() => setSelectedNodeId(null)}
              onDelete={deleteSelectedStep}
              onRemoveFollowerGreeting={removeFollowerGreeting}
              onRemovePublicReply={removePublicReply}
              onSave={saveFlow}
              onUpdateFollowerGreeting={updateFollowerGreeting}
              onUpdatePublicReply={updatePublicReply}
              onAddQuickReply={() => updateForm("quick_replies", [...formState.quick_replies, { title: "", payload: "" }].slice(0, 13))}
              onRemoveQuickReply={(index) => updateForm("quick_replies", formState.quick_replies.filter((_, replyIndex) => replyIndex !== index))}
              onToggleTrigger={toggleTrigger}
              onUpdate={updateForm}
              onUpdateNodeConfig={updateSelectedNodeConfig}
              onUpdateQuickReply={(index, field, value) => {
                updateForm("quick_replies", formState.quick_replies.map((reply, replyIndex) => replyIndex === index ? { ...reply, [field]: value } : reply));
              }}
            />
          ) : (
            <FlowPalette onAddNode={addOrSelectNode} />
          )}

          <div className="relative min-h-[420px] border-b border-[var(--ms-border)] bg-[var(--ms-surface-soft)] xl:min-h-0 xl:border-b-0 xl:border-l">
            <ReactFlow<UaiFlowNode, UaiFlowEdge>
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeClick={(event, edge) => {
                event.stopPropagation();
                setSelectedNodeId(null);
                setSelectedEdgeId(edge.id);
              }}
              onNodeClick={(_, node) => {
                setSelectedEdgeId(null);
                setSelectedNodeId(node.id);
              }}
              onPaneClick={() => {
                setSelectedEdgeId(null);
                setSelectedNodeId(null);
              }}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.3}
              maxZoom={1.45}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--ms-border-strong)" gap={22} size={1.2} />
              <Controls className="!border !border-[var(--ms-border)] !bg-[var(--ms-surface)]" />
              <MiniMap
                className="!hidden !border !border-[var(--ms-border)] !bg-[var(--ms-surface)] md:!block"
                nodeColor={(node) => getMiniMapColor((node as UaiFlowNode).data.kind)}
                pannable
                zoomable
              />
              <Panel position="top-left" className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-2 shadow-sm">
                <div className="flex flex-wrap gap-2 text-xs font-semibold text-[var(--ms-muted)]">
                  <span className="status-pill min-h-8"><Workflow size={13} /> {metrics.nodes} blocos</span>
                  <span className="status-pill min-h-8"><GitBranch size={13} /> {edges.length} ligacoes</span>
                  <span className={formState.active ? "status-pill status-pill-green min-h-8" : "status-pill min-h-8"}>{formState.active ? "Ativo" : "Pausado"}</span>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </div>
      </div>
    </section>
  );
}

function EdgeInspectorPanel({
  edge,
  sourceNode,
  targetNode,
  onBack,
  onDelete,
  onUpdateLabel,
}: {
  edge: UaiFlowEdge;
  sourceNode: UaiFlowNode | null;
  targetNode: UaiFlowNode | null;
  onBack: () => void;
  onDelete: () => void;
  onUpdateLabel: (label: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-[var(--ms-border)] bg-[var(--ms-surface)] xl:border-b-0 xl:border-r">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="grid gap-4">
          <button className="btn-secondary h-9 justify-self-start px-3" onClick={onBack} type="button">
            <ArrowLeft size={15} /> Voltar
          </button>

          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-500">
                <GitBranch size={17} />
              </span>
              <div className="min-w-0">
                <p className="eyebrow">Conexão selecionada</p>
                <h2 className="mt-1 truncate text-lg font-semibold">Ligação entre blocos</h2>
                <p className="mt-1 truncate text-xs font-semibold text-red-500">Clique em excluir para remover do fluxo</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase text-[var(--ms-muted)]">Origem</p>
              <p className="mt-1 font-semibold">{sourceNode?.data.title ?? edge.source}</p>
              {edge.sourceHandle ? <p className="mt-1 text-xs text-[var(--ms-muted)]">Saída: {translateHandle(edge.sourceHandle)}</p> : null}
            </div>
            <div className="border-t border-[var(--ms-border)] pt-3">
              <p className="text-xs font-bold uppercase text-[var(--ms-muted)]">Destino</p>
              <p className="mt-1 font-semibold">{targetNode?.data.title ?? edge.target}</p>
            </div>
          </div>

          <label className="field">
            <span>Texto da conexão</span>
            <input className="input" value={typeof edge.label === "string" ? edge.label : ""} onChange={(event) => onUpdateLabel(event.target.value)} placeholder="Ex: segue" />
          </label>
        </div>
      </div>

      <div className="grid shrink-0 gap-2 border-t border-[var(--ms-border)] bg-[var(--ms-surface)] p-3">
        <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600" onClick={onDelete} type="button">
          <Trash2 size={16} /> Excluir conexão
        </button>
      </div>
    </aside>
  );
}
function AutomationNode({ data, selected }: NodeProps<UaiFlowNode>) {
  const canReceive = data.kind !== "trigger";
  const canSend = data.kind !== "end";
  const theme = getNodeTheme(data.kind);
  const style = {
    borderColor: selected ? theme.accent : "var(--ms-border)",
    boxShadow: selected ? `0 0 0 3px ${theme.ring}, 0 18px 40px rgba(0,0,0,0.18)` : "0 10px 26px rgba(0,0,0,0.12)",
  } satisfies CSSProperties;

  return (
    <div className="relative w-[17rem] rounded-lg border bg-[var(--ms-surface)] p-3 transition-shadow" style={style}>
      <Handle id="in" type="target" position={Position.Left} style={{ visibility: canReceive ? "visible" : "hidden", background: theme.accent }} className="!size-3 !border-2 !border-[var(--ms-surface)]" />
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border" style={{ backgroundColor: theme.soft, borderColor: theme.border, color: theme.accent }}>
          <NodeIcon kind={data.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-bold">{data.title}</p>
            <span className={data.active ? "status-pill status-pill-green min-h-7 shrink-0 px-2 text-[10px]" : "status-pill min-h-7 shrink-0 px-2 text-[10px]"}>{data.badge}</span>
          </div>
          <p className="mt-1 truncate text-xs font-semibold" style={{ color: theme.accent }}>{theme.label}</p>
        </div>
      </div>
      <p className="mt-3 truncate text-xs font-semibold text-[var(--ms-muted)]">{data.subtitle}</p>
      <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--ms-muted)]">{data.summary}</p>
      {data.kind === "condition" ? (
        <>
          <span className="absolute right-3 top-[36%] rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-600">segue</span>
          <Handle id="yes" type="source" position={Position.Right} style={{ top: "38%", background: "#10b981" }} className="!size-3 !border-2 !border-[var(--ms-surface)]" />
          <span className="absolute bottom-[18%] right-3 rounded-md bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-600">não segue</span>
          <Handle id="no" type="source" position={Position.Right} style={{ top: "74%", background: "#f59e0b" }} className="!size-3 !border-2 !border-[var(--ms-surface)]" />
        </>
      ) : (
        <Handle id="out" type="source" position={Position.Right} style={{ visibility: canSend ? "visible" : "hidden", background: theme.accent }} className="!size-3 !border-2 !border-[var(--ms-surface)]" />
      )}
    </div>
  );
}
function InspectorPanel({
  canDelete,
  formState,
  media,
  mediaError,
  mediaStatus,
  node,
  saving,
  onAddPublicReply,
  onAddFollowerGreeting,
  onBack,
  onDelete,
  onRemoveFollowerGreeting,
  onRemovePublicReply,
  onSave,
  onUpdateFollowerGreeting,
  onUpdatePublicReply,
  onAddQuickReply,
  onRemoveQuickReply,
  onToggleTrigger,
  onUpdate,
  onUpdateNodeConfig,
  onUpdateQuickReply,
}: {
  canDelete: boolean;
  formState: FlowFormState;
  media: InstagramMedia[];
  mediaError: string | null;
  mediaStatus: MediaStatus;
  node: UaiFlowNode;
  saving: boolean;
  onAddPublicReply: () => void;
  onAddFollowerGreeting: () => void;
  onBack: () => void;
  onDelete: () => void;
  onRemoveFollowerGreeting: (index: number) => void;
  onRemovePublicReply: (index: number) => void;
  onSave: () => void;
  onUpdateFollowerGreeting: (index: number, value: string) => void;
  onUpdatePublicReply: (index: number, value: string) => void;
  onAddQuickReply: () => void;
  onRemoveQuickReply: (index: number) => void;
  onToggleTrigger: (trigger: AutomationTrigger) => void;
  onUpdate: <K extends keyof FlowFormState>(key: K, value: FlowFormState[K]) => void;
  onUpdateNodeConfig: (patch: Partial<FlowNodeConfig>) => void;
  onUpdateQuickReply: (index: number, field: keyof QuickReply, value: string) => void;
}) {
  const theme = getNodeTheme(node.data.kind);

  return (
    <aside className="flex min-h-0 flex-col border-b border-[var(--ms-border)] bg-[var(--ms-surface)] xl:border-b-0 xl:border-r">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="grid gap-4">
          <button className="btn-secondary h-9 justify-self-start px-3" onClick={onBack} type="button">
            <ArrowLeft size={15} /> Voltar
          </button>

          <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border" style={{ backgroundColor: theme.soft, borderColor: theme.border, color: theme.accent }}>
                <NodeIcon kind={node.data.kind} />
              </span>
              <div className="min-w-0">
                <p className="eyebrow">Passo atual</p>
                <h2 className="mt-1 truncate text-lg font-semibold">{node.data.title}</h2>
                <p className="mt-1 truncate text-xs font-semibold" style={{ color: theme.accent }}>{theme.label}</p>
              </div>
            </div>
          </div>

          {shouldShowVariableBox(node.data.kind) ? <VariableBox /> : null}

          {node.data.kind === "trigger" ? (
            <div className="grid gap-4">
              <div className="field">
                <span>Origem</span>
                <div className="grid gap-2 text-sm">
                  <label className="check"><input checked={formState.triggers.includes("comments")} onChange={() => onToggleTrigger("comments")} type="checkbox" /> Comentário</label>
                  <label className="check"><input checked={formState.triggers.includes("story")} onChange={() => onToggleTrigger("story")} type="checkbox" /> Story</label>
                  <label className="check"><input checked={formState.triggers.includes("dm")} onChange={() => onToggleTrigger("dm")} type="checkbox" /> Mensagem no direct</label>
                </div>
              </div>
              <TriggerPostPicker media={media} mediaError={mediaError} mediaStatus={mediaStatus} selectedPostId={formState.post_id} onSelectPost={(postId) => onUpdate("post_id", postId)} />
            </div>
          ) : null}

          {node.data.kind === "keywords" ? (
            <KeywordsEditor
              keywords={formState.keywords}
              matchType={formState.match_type}
              onKeywordsChange={(keywords) => onUpdate("keywords", keywords)}
              onMatchTypeChange={(matchType) => onUpdate("match_type", matchType)}
            />
          ) : null}
          {node.data.kind === "publicReply" ? (
            <div className="grid gap-4">
              <DelayEditor
                label="Espera inteligente"
                mode={formState.reply_delay_mode}
                unit={formState.reply_delay_unit}
                value={formState.reply_delay_value}
                min={formState.reply_delay_min}
                max={formState.reply_delay_max}
                onModeChange={(mode) => onUpdate("reply_delay_mode", mode)}
                onUnitChange={(unit) => onUpdate("reply_delay_unit", unit)}
                onValueChange={(value) => onUpdate("reply_delay_value", value)}
                onMinChange={(value) => onUpdate("reply_delay_min", value)}
                onMaxChange={(value) => onUpdate("reply_delay_max", value)}
              />
              <TextAlternativesEditor
                mode={formState.public_reply_mode}
                replies={formState.public_replies}
                onAdd={onAddPublicReply}
                onModeChange={(mode) => onUpdate("public_reply_mode", mode)}
                onRemove={onRemovePublicReply}
                onUpdate={onUpdatePublicReply}
              />
            </div>
          ) : null}
          {node.data.kind === "condition" ? (
            <div className="grid gap-4">
              <label className="check"><input checked={formState.require_follower} onChange={(event) => onUpdate("require_follower", event.target.checked)} type="checkbox" /> Exigir seguidor</label>
              <label className="field"><span>Mensagem para quem não segue</span><textarea className="input min-h-24" value={formState.non_follower_dm} onChange={(event) => onUpdate("non_follower_dm", event.target.value)} /></label>
              <label className="field"><span>Botão para seguir</span><input className="input" value={formState.non_follower_button_label} onChange={(event) => onUpdate("non_follower_button_label", event.target.value)} /></label>
              <GreetingListEditor greetings={formState.follower_confirmation_greetings} onAdd={onAddFollowerGreeting} onRemove={onRemoveFollowerGreeting} onUpdate={onUpdateFollowerGreeting} />
              <label className="field"><span>Confirmação para quem segue</span><textarea className="input min-h-24" value={formState.follower_confirmation_text} onChange={(event) => onUpdate("follower_confirmation_text", event.target.value)} /></label>
            </div>
          ) : null}

          {node.data.kind === "dm" ? (
            <div className="grid gap-4">
              <DelayEditor
                label="Tempo de envio"
                mode={formState.reply_delay_mode}
                unit={formState.reply_delay_unit}
                value={formState.reply_delay_value}
                min={formState.reply_delay_min}
                max={formState.reply_delay_max}
                onModeChange={(mode) => onUpdate("reply_delay_mode", mode)}
                onUnitChange={(unit) => onUpdate("reply_delay_unit", unit)}
                onValueChange={(value) => onUpdate("reply_delay_value", value)}
                onMinChange={(value) => onUpdate("reply_delay_min", value)}
                onMaxChange={(value) => onUpdate("reply_delay_max", value)}
              />
              <label className="field"><span>Mensagem inicial</span><textarea className="input min-h-36" value={formState.welcome_dm} onChange={(event) => onUpdate("welcome_dm", event.target.value)} /></label>
            </div>
          ) : null}

          {node.data.kind === "quickReplies" ? (
            <QuickRepliesEditor formState={formState} onAdd={onAddQuickReply} onRemove={onRemoveQuickReply} onUpdate={onUpdate} onUpdateQuickReply={onUpdateQuickReply} />
          ) : null}

          {node.data.kind === "link" ? (
            <div className="grid gap-4">
              <label className="field"><span>Texto com link</span><input className="input" value={formState.link_text} onChange={(event) => onUpdate("link_text", event.target.value)} /></label>
              <label className="field"><span>Botão do link</span><input className="input" value={formState.link_button_label} onChange={(event) => onUpdate("link_button_label", event.target.value)} /></label>
              <label className="field"><span>URL</span><input className="input" type="url" value={formState.link_url} onChange={(event) => onUpdate("link_url", event.target.value)} /></label>
            </div>
          ) : null}

          {node.data.kind === "reminder" ? (
            <div className="grid gap-4">
              <DelayEditor
                label="Tempo do lembrete"
                mode={formState.reminder_delay_mode}
                unit={formState.reminder_delay_unit}
                value={formState.reminder_delay_value}
                min={formState.reminder_delay_min}
                max={formState.reminder_delay_max}
                onModeChange={(mode) => onUpdate("reminder_delay_mode", mode)}
                onUnitChange={(unit) => onUpdate("reminder_delay_unit", unit)}
                onValueChange={(value) => onUpdate("reminder_delay_value", value)}
                onMinChange={(value) => onUpdate("reminder_delay_min", value)}
                onMaxChange={(value) => onUpdate("reminder_delay_max", value)}
              />
              <label className="field"><span>Lembrete</span><textarea className="input min-h-32" value={formState.reminder_text} onChange={(event) => onUpdate("reminder_text", event.target.value)} /></label>
            </div>
          ) : null}

          {isCustomConfigNodeKind(node.data.kind) ? (
            <CustomNodeConfigEditor
              config={node.data.config ?? defaultNodeConfig(node.data.kind)}
              kind={node.data.kind}
              onUpdate={onUpdateNodeConfig}
            />
          ) : null}

          {node.data.kind === "end" ? (
            <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4 text-sm leading-6 text-[var(--ms-muted)]">
              {node.data.summary}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid shrink-0 gap-2 border-t border-[var(--ms-border)] bg-[var(--ms-surface)] p-3">
        <button className="btn-secondary h-10 w-full" disabled={!canDelete} onClick={onDelete} title={canDelete ? "Excluir a configuração deste passo" : "Este passo é obrigatório"} type="button">
          <Trash2 size={16} /> Excluir Passo
        </button>
        <button className="btn-primary h-10 w-full" disabled={saving} onClick={onSave} type="button">
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </aside>
  );
}

function FlowPalette({ onAddNode }: { onAddNode: (kind: FlowNodeKind) => void }) {
  const sections: Array<{ title: string; category: FlowNodeCategory; items: Array<{ label: string; kind: FlowNodeKind; icon: FlowNodeKind; status?: string; repeatable?: boolean }> }> = [
    { title: "Gatilhos", category: "trigger", items: [{ label: "Comentário / Post", kind: "trigger", icon: "trigger" }, { label: "Palavra-chave", kind: "keywords", icon: "keywords" }, { label: "Gatilho por tag", kind: "tagAction", icon: "tagAction", status: "preparar" }] },
    { title: "Ações no Instagram", category: "action", items: [{ label: "Responder comentário", kind: "commentReply", icon: "commentReply", repeatable: true }, { label: "Responder no privado", kind: "privateReply", icon: "privateReply", repeatable: true }, { label: "Enviar mensagem", kind: "dm", icon: "dm" }, { label: "Botão / link / código do botão", kind: "buttonMessage", icon: "buttonMessage", repeatable: true }, { label: "Enviar mídia", kind: "mediaMessage", icon: "mediaMessage", repeatable: true }, { label: "Enviar reação", kind: "reaction", icon: "reaction", repeatable: true }] },
    { title: "Lógica", category: "logic", items: [{ label: "Condição", kind: "condition", icon: "condition" }, { label: "Esperar", kind: "reminder", icon: "reminder" }] },
    { title: "Dados e saída", category: "data", items: [{ label: "Respostas rápidas", kind: "quickReplies", icon: "quickReplies" }, { label: "Adicionar etiqueta", kind: "tagAction", icon: "tagAction", repeatable: true }, { label: "Conectar automação", kind: "automationLink", icon: "automationLink", repeatable: true }, { label: "Finalizar", kind: "end", icon: "end" }] },
  ];

  return (
    <aside className="min-h-0 overflow-y-auto border-b border-[var(--ms-border)] bg-[var(--ms-surface)] p-3 sm:p-4 xl:border-b-0 xl:border-r">
      <div className="grid gap-4">
        <div>
          <p className="eyebrow">Biblioteca</p>
          <h2 className="mt-1 text-xl font-semibold">Blocos</h2>
        </div>

        {sections.map((section) => {
          const theme = getCategoryTheme(section.category);
          return (
            <section className="grid gap-2" key={section.title}>
              <p className="px-1 text-[11px] font-bold uppercase" style={{ color: theme.accent }}>{section.title}</p>
              <div className="grid gap-2">
                {section.items.map((item) => {
                  const itemTheme = getNodeTheme(item.kind);
                  return (
                    <button
                      className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] px-3 text-left text-sm font-bold hover:border-[var(--ms-border-strong)]"
                      key={`${section.title}-${item.label}`}
                      onClick={() => onAddNode(item.kind)}
                      title={item.repeatable ? "Adicionar novo bloco" : "Abrir ou criar bloco"}
                      type="button"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: itemTheme.soft, color: itemTheme.accent }}><NodeIcon kind={item.icon} /></span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.status ? <span className="rounded-md border border-[var(--ms-border)] px-2 py-1 text-[10px] text-[var(--ms-muted)]">{item.status}</span> : null}
                      {item.repeatable ? <Plus size={14} className="text-[var(--ms-muted)]" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function CustomNodeConfigEditor({ config, kind, onUpdate }: { config: FlowNodeConfig; kind: FlowNodeKind; onUpdate: (patch: Partial<FlowNodeConfig>) => void }) {
  const delayMode = config.delayMode ?? "fixed";
  const delayUnit = config.delayUnit ?? "seconds";
  const delayValue = config.delayValue ?? "0";
  const delayMin = config.delayMin ?? "0";
  const delayMax = config.delayMax ?? "0";

  return (
    <div className="grid gap-4">
      {kind === "commentReply" ? (
        <>
          <DelayEditor
            label="Espera inteligente"
            mode={delayMode}
            unit={delayUnit}
            value={delayValue}
            min={delayMin}
            max={delayMax}
            onModeChange={(mode) => onUpdate({ delayMode: mode })}
            onUnitChange={(unit) => onUpdate({ delayUnit: unit })}
            onValueChange={(value) => onUpdate({ delayValue: value })}
            onMinChange={(value) => onUpdate({ delayMin: value })}
            onMaxChange={(value) => onUpdate({ delayMax: value })}
          />
          <label className="field"><span>Resposta no comentário</span><textarea className="input min-h-32" value={config.text ?? ""} onChange={(event) => onUpdate({ text: event.target.value })} placeholder="Ex: Te enviei no privado" /></label>
        </>
      ) : null}

      {kind === "privateReply" ? (
        <>
          <DelayEditor
            label="Tempo de envio"
            mode={delayMode}
            unit={delayUnit}
            value={delayValue}
            min={delayMin}
            max={delayMax}
            onModeChange={(mode) => onUpdate({ delayMode: mode })}
            onUnitChange={(unit) => onUpdate({ delayUnit: unit })}
            onValueChange={(value) => onUpdate({ delayValue: value })}
            onMinChange={(value) => onUpdate({ delayMin: value })}
            onMaxChange={(value) => onUpdate({ delayMax: value })}
          />
          <label className="field"><span>Mensagem privada</span><textarea className="input min-h-36" value={config.text ?? ""} onChange={(event) => onUpdate({ text: event.target.value })} placeholder="Ex: Oi {{first_name}}, aqui está o acesso" /></label>
        </>
      ) : null}

      {kind === "buttonMessage" ? (
        <div className="grid gap-4">
          <label className="field"><span>Mensagem</span><textarea className="input min-h-28" value={config.text ?? ""} onChange={(event) => onUpdate({ text: event.target.value })} placeholder="Ex: Escolha uma opção abaixo" /></label>
          <label className="field"><span>Texto do botão</span><input className="input" maxLength={20} value={config.buttonLabel ?? ""} onChange={(event) => onUpdate({ buttonLabel: event.target.value })} placeholder="Ex: Acessar" /></label>
          <label className="field"><span>URL</span><input className="input" type="url" value={config.url ?? ""} onChange={(event) => onUpdate({ url: event.target.value })} placeholder="https://..." /></label>
          <label className="field"><span>Código do botão</span><input className="input" value={config.payload ?? ""} onChange={(event) => onUpdate({ payload: event.target.value })} placeholder="Ex: etapa:bonus" /></label>
        </div>
      ) : null}

      {kind === "mediaMessage" ? (
        <div className="grid gap-4">
          <label className="field"><span>Tipo de mídia</span><select className="input" value={config.mediaType ?? "image"} onChange={(event) => onUpdate({ mediaType: event.target.value as MediaActionType })}><option value="image">Imagem</option><option value="gif">GIF</option><option value="audio">Áudio</option></select></label>
          <label className="field"><span>Endereço da mídia</span><input className="input" type="url" value={config.mediaUrl ?? ""} onChange={(event) => onUpdate({ mediaUrl: event.target.value })} placeholder="https://..." /></label>
          <label className="field"><span>Legenda ou apoio</span><textarea className="input min-h-24" value={config.text ?? ""} onChange={(event) => onUpdate({ text: event.target.value })} /></label>
        </div>
      ) : null}

      {kind === "reaction" ? (
        <div className="grid gap-4">
          <label className="field"><span>Emoji da reação</span><input className="input" maxLength={8} value={config.reactionEmoji ?? "<3"} onChange={(event) => onUpdate({ reactionEmoji: event.target.value })} /></label>
          <p className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 text-sm text-[var(--ms-muted)]">Usado para marcar a última mensagem recebida com uma reação quando esta etapa for ativada.</p>
        </div>
      ) : null}

      {kind === "tagAction" ? (
        <div className="grid gap-4">
          <label className="field"><span>Etiqueta</span><input className="input" value={config.tagName ?? ""} onChange={(event) => onUpdate({ tagName: event.target.value })} placeholder="Ex: quente" /></label>
          <p className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 text-sm text-[var(--ms-muted)]">Este bloco prepara a ação de adicionar uma etiqueta ao contato ou usar a etiqueta como entrada de remarketing.</p>
        </div>
      ) : null}

      {kind === "automationLink" ? (
        <div className="grid gap-4">
          <label className="field"><span>ID da automação</span><input className="input" value={config.automationId ?? ""} onChange={(event) => onUpdate({ automationId: event.target.value })} placeholder="Cole o ID da automação" /></label>
          <p className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 text-sm text-[var(--ms-muted)]">Permite preparar a passagem deste contato para outro fluxo.</p>
        </div>
      ) : null}
    </div>
  );
}
function TriggerPostPicker({
  media,
  mediaError,
  mediaStatus,
  selectedPostId,
  onSelectPost,
}: {
  media: InstagramMedia[];
  mediaError: string | null;
  mediaStatus: MediaStatus;
  selectedPostId: string;
  onSelectPost: (postId: string) => void;
}) {
  const selectedPostIds = splitPostIds(selectedPostId);
  const selectedPostSet = new Set(selectedPostIds);
  const scope = selectedPostIds.length ? "specific" : "all";
  const missingPostIds = mediaStatus === "ready" ? selectedPostIds.filter((postId) => !media.some((item) => item.id === postId)) : [];

  function updateSelectedPostIds(postIds: string[]) {
    onSelectPost(joinPostIds(postIds));
  }

  function togglePost(postId: string) {
    updateSelectedPostIds(
      selectedPostSet.has(postId)
        ? selectedPostIds.filter((selectedPostId) => selectedPostId !== postId)
        : [...selectedPostIds, postId],
    );
  }

  return (
    <div className="grid gap-3">
      <SegmentedControl<"all" | "specific">
        label="Post ou Reel"
        value={scope}
        options={[{ label: "Todos", value: "all" }, { label: "Específicos", value: "specific" }]}
        onChange={(value) => onSelectPost(value === "all" ? "" : selectedPostId)}
      />

      {scope === "specific" ? (
        <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
          {selectedPostIds.length ? <p className="status-pill status-pill-green w-fit">{selectedPostIds.length} selecionado(s)</p> : null}
          {mediaStatus === "idle" ? <p className="text-sm text-[var(--ms-muted)]">Conecte o Instagram para listar os posts e Reels.</p> : null}
          {mediaStatus === "loading" ? (
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ms-muted)]" aria-live="polite">
              <Loader2 className="animate-spin" size={15} /> Carregando posts e Reels...
            </div>
          ) : null}
          {mediaStatus === "error" ? <p className="text-sm text-red-500">{mediaError}</p> : null}
          {mediaStatus === "ready" && !media.length ? <p className="text-sm text-[var(--ms-muted)]">O Instagram ainda não mostrou posts nem Reels deste perfil.</p> : null}

          {mediaStatus === "ready" && media.length ? (
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
              {media.map((item) => {
                const imageUrl = item.thumbnail_url || item.media_url;
                const selected = selectedPostSet.has(item.id);
                return (
                  <button
                    className={selected ? "rounded-lg border border-emerald-500 bg-emerald-500/10 p-2 text-left" : "rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-2 text-left hover:border-[var(--ms-border-strong)]"}
                    key={item.id}
                    onClick={() => togglePost(item.id)}
                    type="button"
                  >
                    <div className="flex gap-3">
                      {imageUrl ? (
                        <img
                          alt="Prévia do post"
                          className="size-12 shrink-0 rounded-lg object-cover"
                          src={imageUrl}
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-[var(--ms-surface-soft)] text-xs text-[var(--ms-muted)]">Mídia</div>}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-xs font-bold">
                          <span className="text-emerald-700 dark:text-emerald-300">{mediaTypeLabel(item.media_type)}</span>
                          <span className={selected ? "inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300" : "text-[var(--ms-muted)]"}>
                            {selected ? <Check size={13} /> : null}
                            {selected ? "Selecionado" : "Selecionar"}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--ms-muted)]">{item.caption || "Sem legenda"}</p>
                        <code className="mt-1 block truncate text-[11px] text-[var(--ms-muted)]">{item.id}</code>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {missingPostIds.length ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs font-semibold text-amber-700 dark:text-amber-200">
              {missingPostIds.length === 1 ? "Um post salvo não apareceu na lista atual." : `${missingPostIds.length} posts salvos não apareceram na lista atual.`} Mantive o(s) ID(s) configurado(s) abaixo.
            </p>
          ) : null}
          <label className="field gap-1">
            <span>IDs manuais</span>
            <textarea className="input min-h-24 py-2" placeholder="Cole um ID por linha ou separe por vírgula" value={selectedPostId} onChange={(event) => onSelectPost(event.target.value)} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function KeywordsEditor({
  keywords,
  matchType,
  onKeywordsChange,
  onMatchTypeChange,
}: {
  keywords: string;
  matchType: MatchType;
  onKeywordsChange: (keywords: string) => void;
  onMatchTypeChange: (matchType: MatchType) => void;
}) {
  const fields = keywordFields(keywords);

  function updateKeyword(index: number, value: string) {
    onKeywordsChange(fields.map((keyword, keywordIndex) => keywordIndex === index ? value : keyword).join("\n"));
  }

  function addKeyword() {
    onKeywordsChange([...fields, ""].join("\n"));
  }

  function removeKeyword(index: number) {
    const next = fields.filter((_, keywordIndex) => keywordIndex !== index);
    onKeywordsChange((next.length ? next : [""]).join("\n"));
  }

  return (
    <div className="grid gap-4">
      <label className="field">
        <span>Tipo de comparação</span>
        <select className="input" value={matchType} onChange={(event) => onMatchTypeChange(event.target.value as MatchType)}>
          <option value="contains">Contém a palavra</option>
          <option value="exact">Palavra exata</option>
          <option value="any">Qualquer mensagem</option>
        </select>
      </label>

      <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">Palavras-chave</span>
            <Tooltip>
              <TooltipTrigger render={<button className="inline-flex size-7 items-center justify-center rounded-lg border border-[var(--ms-border)] text-[var(--ms-muted)] transition hover:text-[var(--ms-foreground)]" type="button" aria-label="Como as palavras-chave funcionam" />}>
                <CircleHelp size={14} />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                Não diferencia maiúsculas e minúsculas. Ex: Eu quero, eu quero e EU QUERO acionam o mesmo fluxo.
              </TooltipContent>
            </Tooltip>
          </div>
          <button className="btn-secondary h-9" onClick={addKeyword} type="button"><Plus size={15} /> Adicionar</button>
        </div>

        <div className="grid gap-3">
          {fields.map((keyword, index) => (
            <div className="grid gap-2" key={index}>
              <label className="field gap-1">
                <span>{`Palavra ${index + 1}`}</span>
                <input className="input h-10 py-0" value={keyword} onChange={(event) => updateKeyword(index, event.target.value)} placeholder="Ex: quero" />
              </label>
              {fields.length > 1 ? (
                <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600" onClick={() => removeKeyword(index)} type="button">
                  <Trash2 size={15} /> Excluir
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function GreetingListEditor({
  greetings,
  onAdd,
  onRemove,
  onUpdate,
}: {
  greetings: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-bold">Saudações aleatórias</span>
        <button className="btn-secondary h-9" onClick={onAdd} type="button"><Plus size={15} /> Adicionar</button>
      </div>
      <div className="grid gap-3">
        {greetings.map((greeting, index) => (
          <div className="grid gap-2" key={index}>
            <label className="field gap-1">
              <span>{`Saudação ${index + 1}`}</span>
              <input className="input h-10 py-0" value={greeting} onChange={(event) => onUpdate(index, event.target.value)} placeholder="Ex: Oii" />
            </label>
            {greetings.length > 1 ? (
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600" onClick={() => onRemove(index)} type="button">
                <Trash2 size={15} /> Excluir
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
function TextAlternativesEditor({
  mode,
  replies,
  onAdd,
  onModeChange,
  onRemove,
  onUpdate,
}: {
  mode: ReplyMode;
  replies: string[];
  onAdd: () => void;
  onModeChange: (mode: ReplyMode) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
}) {
  const visibleReplies = mode === "fixed" ? replies.slice(0, 1) : replies;

  return (
    <div className="grid gap-4">
      <SegmentedControl<ReplyMode>
        label="Tipo de resposta"
        value={mode}
        options={[{ label: "Fixa", value: "fixed" }, { label: "Aleatória", value: "random" }]}
        onChange={onModeChange}
      />
      <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold">Respostas no comentário</span>
          {mode === "random" ? <button className="btn-secondary h-9" onClick={onAdd} type="button"><Plus size={15} /> Adicionar</button> : null}
        </div>
        <div className="grid gap-3">
          {visibleReplies.map((reply, index) => (
            <div className="grid gap-2" key={index}>
              <label className="field">
                <span>{mode === "fixed" ? "Resposta fixa" : `Resposta ${index + 1}`}</span>
                <textarea className="input min-h-24" value={reply} onChange={(event) => onUpdate(index, event.target.value)} />
              </label>
              {mode === "random" && replies.length > 1 ? (
                <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600" onClick={() => onRemove(index)} type="button">
                  <Trash2 size={15} />
                  Excluir
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DelayEditor({
  label,
  mode,
  unit,
  value,
  min,
  max,
  onModeChange,
  onUnitChange,
  onValueChange,
  onMinChange,
  onMaxChange,
}: {
  label: string;
  mode: DelayMode;
  unit: DelayUnit;
  value: string;
  min: string;
  max: string;
  onModeChange: (mode: DelayMode) => void;
  onUnitChange: (unit: DelayUnit) => void;
  onValueChange: (value: string) => void;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
      <SegmentedControl<DelayMode>
        label={label}
        value={mode}
        options={[{ label: "Simples", value: "fixed" }, { label: "Aleatório", value: "random" }]}
        onChange={onModeChange}
      />
      <label className="field">
        <span>Unidade</span>
        <select className="input" value={unit} onChange={(event) => onUnitChange(event.target.value as DelayUnit)}>
          <option value="seconds">Segundos</option>
          <option value="minutes">Minutos</option>
          <option value="hours">Horas</option>
        </select>
      </label>
      {mode === "fixed" ? (
        <label className="field"><span>Tempo</span><input className="input" min="0" type="number" value={value} onChange={(event) => onValueChange(event.target.value)} /></label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field"><span>Mínimo</span><input className="input" min="0" type="number" value={min} onChange={(event) => onMinChange(event.target.value)} /></label>
          <label className="field"><span>Máximo</span><input className="input" min="0" type="number" value={max} onChange={(event) => onMaxChange(event.target.value)} /></label>
        </div>
      )}
    </div>
  );
}

function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ label: string; value: T }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-1">
        {options.map((option) => (
          <button
            className={option.value === value ? "h-9 rounded-md bg-[var(--ms-primary)] px-3 text-sm font-bold text-white" : "h-9 rounded-md px-3 text-sm font-bold text-[var(--ms-muted)] hover:bg-[var(--ms-surface-soft)]"}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
function QuickRepliesEditor({
  formState,
  onAdd,
  onRemove,
  onUpdate,
  onUpdateQuickReply,
}: {
  formState: FlowFormState;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: <K extends keyof FlowFormState>(key: K, value: FlowFormState[K]) => void;
  onUpdateQuickReply: (index: number, field: keyof QuickReply, value: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <label className="field"><span>Resposta rápida única</span><input className="input" value={formState.quick_reply_label} onChange={(event) => onUpdate("quick_reply_label", event.target.value)} /></label>
      <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold">Botões</span>
          <button className="btn-secondary h-9" disabled={formState.quick_replies.length >= 13} onClick={onAdd} type="button">
            <Plus size={15} />
            Adicionar
          </button>
        </div>

        {formState.quick_replies.length ? (
          <div className="grid gap-3">
            {formState.quick_replies.map((reply, index) => (
              <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-3" key={index}>
                <label className="field"><span>Título</span><input className="input" maxLength={20} value={reply.title} onChange={(event) => onUpdateQuickReply(index, "title", event.target.value)} /></label>
                <label className="field"><span>Código do botão</span><input className="input" value={reply.payload} onChange={(event) => onUpdateQuickReply(index, "payload", event.target.value)} /></label>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600" onClick={() => onRemove(index)} type="button">
                  <Trash2 size={15} />
                  Excluir
                </button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-[var(--ms-muted)]">Nenhum botão configurado.</p>}
      </div>
    </div>
  );
}

function VariableBox() {
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  async function copyVariable(tag: string) {
    try {
      await navigator.clipboard.writeText(tag);
      setCopiedTag(tag);
      window.setTimeout(() => setCopiedTag((current) => current === tag ? null : current), 1400);
    } catch {
      setCopiedTag(null);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
      <div className="flex items-center gap-2 text-sm font-bold"><Sparkles size={15} /> Variáveis</div>
      <div className="mt-3 grid gap-2">
        {variables.map((variable) => {
          const copied = copiedTag === variable.tag;
          return (
            <button
              className="grid gap-1 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-2 text-left hover:border-[var(--ms-border-strong)]"
              key={variable.tag}
              onClick={() => copyVariable(variable.tag)}
              title={`Copiar ${variable.tag}`}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{variable.label}</span>
                <span className={copied ? "rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300" : "rounded-md border border-[var(--ms-border)] px-2 py-1 text-[10px] font-bold text-[var(--ms-muted)]"}>{copied ? "Copiado" : "Copiar"}</span>
              </div>
              <code className="text-xs font-bold text-[var(--ms-primary)]">{variable.tag}</code>
              <p className="truncate text-xs text-[var(--ms-muted)]">Exemplo: {variable.preview}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function shouldShowVariableBox(kind: FlowNodeKind) {
  return kind === "publicReply" || kind === "condition" || kind === "dm" || kind === "link" || kind === "reminder" || kind === "commentReply" || kind === "privateReply" || kind === "buttonMessage" || kind === "mediaMessage";
}
function canDeleteStep(kind: FlowNodeKind) {
  return kind !== "trigger" && kind !== "end";
}

function clearStepConfig(state: FlowFormState, kind: FlowNodeKind): FlowFormState {
  if (kind === "keywords") return { ...state, keywords: "", match_type: "any" };
  if (kind === "publicReply") return { ...state, public_replies: [""], public_reply_mode: "fixed" };
  if (kind === "condition") {
    return {
      ...state,
      require_follower: false,
      non_follower_dm: "",
      non_follower_button_label: "",
      follower_confirmation_text: "",
      follower_confirmation_greetings: defaultFollowerConfirmationGreetings,
    };
  }
  if (kind === "dm") {
    return {
      ...state,
      welcome_dm: "",
      reply_delay_mode: "fixed",
      reply_delay_value: "0",
      reply_delay_min: "0",
      reply_delay_max: "0",
      reply_delay_unit: "seconds",
    };
  }
  if (kind === "quickReplies") return { ...state, quick_reply_label: "", quick_replies: [] };
  if (kind === "link") return { ...state, link_text: "", link_button_label: "", link_url: "" };
  if (kind === "reminder") {
    return {
      ...state,
      reminder_text: "",
      reminder_delay_mode: "fixed",
      reminder_delay_value: "0",
      reminder_delay_min: "0",
      reminder_delay_max: "0",
      reminder_delay_unit: "seconds",
    };
  }
  return state;
}
function automationToFormState(automation: Automation): FlowFormState {
  const replyDelay = secondsToDelayFields(automation.reply_delay_seconds ?? 0);
  const replyDelayMin = secondsToDelayFields(automation.reply_delay_min_seconds ?? automation.reply_delay_seconds ?? 0, replyDelay.unit);
  const replyDelayMax = secondsToDelayFields(automation.reply_delay_max_seconds ?? automation.reply_delay_seconds ?? 0, replyDelay.unit);
  const reminderSeconds = automation.reminder_delay_seconds ?? (automation.reminder_delay_minutes ?? 1440) * 60;
  const reminderDelay = secondsToDelayFields(reminderSeconds);
  const reminderDelayMin = secondsToDelayFields(automation.reminder_delay_min_seconds ?? reminderSeconds, reminderDelay.unit);
  const reminderDelayMax = secondsToDelayFields(automation.reminder_delay_max_seconds ?? reminderSeconds, reminderDelay.unit);

  return {
    name: automation.name,
    active: automation.active,
    triggers: automation.triggers.length ? automation.triggers : ["comments"],
    keywords: automation.keywords.join("\n"),
    match_type: automation.match_type,
    post_id: automation.post_id || "",
    public_reply_mode: automation.public_reply_mode ?? "random",
    public_replies: automation.public_replies.length ? automation.public_replies : [""],
    welcome_dm: automation.welcome_dm,
    quick_reply_label: automation.quick_reply_label,
    quick_replies: automation.quick_replies ?? [],
    link_text: automation.link_text,
    link_button_label: automation.link_button_label,
    link_url: automation.link_url,
    reply_delay_mode: automation.reply_delay_mode ?? "fixed",
    reply_delay_value: replyDelay.value,
    reply_delay_min: replyDelayMin.value,
    reply_delay_max: replyDelayMax.value,
    reply_delay_unit: replyDelay.unit,
    reminder_text: automation.reminder_text,
    reminder_delay_mode: automation.reminder_delay_mode ?? "fixed",
    reminder_delay_value: reminderDelay.value,
    reminder_delay_min: reminderDelayMin.value,
    reminder_delay_max: reminderDelayMax.value,
    reminder_delay_unit: reminderDelay.unit,
    require_follower: automation.require_follower,
    non_follower_dm: automation.non_follower_dm,
    non_follower_button_label: automation.non_follower_button_label,
    follower_confirmation_text: automation.follower_confirmation_text,
    follower_confirmation_greetings: automation.follower_confirmation_greetings?.length ? automation.follower_confirmation_greetings : defaultFollowerConfirmationGreetings,
  };
}

function formStateToPayload(state: FlowFormState, fallbackName: string) {
  const replyDelaySeconds = unitToSeconds(state.reply_delay_value, state.reply_delay_unit);
  const replyDelayMinSeconds = state.reply_delay_mode === "random" ? unitToSeconds(state.reply_delay_min, state.reply_delay_unit) : replyDelaySeconds;
  const replyDelayMaxSeconds = state.reply_delay_mode === "random" ? unitToSeconds(state.reply_delay_max, state.reply_delay_unit) : replyDelaySeconds;
  const reminderDelaySeconds = unitToSeconds(state.reminder_delay_value, state.reminder_delay_unit);
  const reminderDelayMinSeconds = state.reminder_delay_mode === "random" ? unitToSeconds(state.reminder_delay_min, state.reminder_delay_unit) : reminderDelaySeconds;
  const reminderDelayMaxSeconds = state.reminder_delay_mode === "random" ? unitToSeconds(state.reminder_delay_max, state.reminder_delay_unit) : reminderDelaySeconds;

  return {
    name: state.name.trim() || fallbackName,
    active: state.active,
    triggers: state.triggers,
    keywords: splitLines(state.keywords),
    match_type: state.match_type,
    post_id: joinPostIds(splitPostIds(state.post_id)) || null,
    public_replies: cleanReplyList(state.public_replies),
    public_reply_mode: state.public_reply_mode,
    welcome_dm: state.welcome_dm,
    quick_reply_label: state.quick_reply_label,
    quick_replies: state.quick_replies.map((reply) => ({ title: reply.title.trim(), payload: reply.payload.trim() })).filter((reply) => reply.title && reply.payload),
    link_text: state.link_text,
    link_button_label: state.link_button_label,
    link_url: state.link_url,
    reply_delay_seconds: replyDelaySeconds,
    reply_delay_mode: state.reply_delay_mode,
    reply_delay_min_seconds: Math.min(replyDelayMinSeconds, replyDelayMaxSeconds),
    reply_delay_max_seconds: Math.max(replyDelayMinSeconds, replyDelayMaxSeconds),
    reminder_text: state.reminder_text,
    reminder_delay_minutes: Math.floor(reminderDelaySeconds / 60),
    reminder_delay_seconds: reminderDelaySeconds,
    reminder_delay_mode: state.reminder_delay_mode,
    reminder_delay_min_seconds: Math.min(reminderDelayMinSeconds, reminderDelayMaxSeconds),
    reminder_delay_max_seconds: Math.max(reminderDelayMinSeconds, reminderDelayMaxSeconds),
    require_follower: state.require_follower,
    non_follower_dm: state.non_follower_dm,
    non_follower_button_label: state.non_follower_button_label,
    follower_confirmation_text: state.follower_confirmation_text,
    follower_confirmation_greetings: state.follower_confirmation_greetings.map((item) => item.trim()).filter(Boolean),
  };
}
function createInitialNodes(automation: Automation): UaiFlowNode[] {
  const state = automationToFormState(automation);
  const savedNodes = hydrateFlowNodes(automation.flow_nodes, state);
  if (savedNodes.length) return savedNodes;

  return [
    { id: "trigger", type: "uaiNode", position: { x: 0, y: 190 }, data: buildNodeData("trigger", state) },
    { id: "keywords", type: "uaiNode", position: { x: 320, y: 190 }, data: buildNodeData("keywords", state) },
    { id: "publicReply", type: "uaiNode", position: { x: 640, y: 70 }, data: buildNodeData("publicReply", state) },
    { id: "condition", type: "uaiNode", position: { x: 640, y: 310 }, data: buildNodeData("condition", state) },
    { id: "dm", type: "uaiNode", position: { x: 960, y: 190 }, data: buildNodeData("dm", state) },
    { id: "quickReplies", type: "uaiNode", position: { x: 1280, y: 190 }, data: buildNodeData("quickReplies", state) },
    { id: "link", type: "uaiNode", position: { x: 1600, y: 70 }, data: buildNodeData("link", state) },
    { id: "reminder", type: "uaiNode", position: { x: 1600, y: 310 }, data: buildNodeData("reminder", state) },
    { id: "end", type: "uaiNode", position: { x: 1920, y: 190 }, data: buildNodeData("end", state) },
  ];
}

function createInitialEdges(automation?: Automation): UaiFlowEdge[] {
  const savedEdges = hydrateFlowEdges(automation?.flow_edges);
  if (savedEdges.length) return savedEdges;

  return [
    createEdge("trigger", "keywords"),
    createEdge("keywords", "publicReply", "comentário"),
    createEdge("keywords", "condition", "direct/story"),
    createEdge("publicReply", "condition"),
    createEdge("condition", "dm", "segue", "yes"),
    createEdge("condition", "end", "não segue", "no"),
    createEdge("dm", "quickReplies"),
    createEdge("quickReplies", "link"),
    createEdge("link", "reminder"),
    createEdge("reminder", "end"),
  ];
}

function hydrateFlowNodes(savedNodes: FlowNodeDefinition[] | undefined, state: FlowFormState): UaiFlowNode[] {
  if (!Array.isArray(savedNodes)) return [];
  return savedNodes.flatMap((node) => {
    if (!node.id || !isFlowNodeKind(node.kind)) return [];
    return [{
      id: node.id,
      type: "uaiNode" as const,
      position: normalizeNodePosition(node.position),
      data: buildNodeData(node.kind, state, normalizeFlowNodeConfig(node.config)),
    }];
  });
}

function hydrateFlowEdges(savedEdges: FlowEdgeDefinition[] | undefined): UaiFlowEdge[] {
  if (!Array.isArray(savedEdges)) return [];
  return savedEdges
    .filter((edge) => edge.id && edge.source && edge.target)
    .map((edge) => {
      const sourceHandle = normalizeEdgeSourceHandle(edge);
      const label = edge.label ?? conditionHandleLabel(edge.source, sourceHandle);
      return { ...createEdge(edge.source, edge.target, label, sourceHandle, edge.targetHandle), id: edge.id };
    });
}

function serializeFlowNodes(nodes: UaiFlowNode[]): FlowNodeDefinition[] {
  return nodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    position: normalizeNodePosition(node.position),
    config: cleanNodeConfig(node.data.config),
  }));
}

function serializeFlowEdges(edges: UaiFlowEdge[]): FlowEdgeDefinition[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    label: typeof edge.label === "string" ? edge.label : undefined,
  }));
}

function normalizeNodePosition(position: { x?: number; y?: number } | undefined) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

const flowNodeKinds: FlowNodeKind[] = ["trigger", "keywords", "publicReply", "condition", "dm", "quickReplies", "link", "reminder", "end", "commentReply", "privateReply", "buttonMessage", "mediaMessage", "reaction", "tagAction", "automationLink"];
const repeatableNodeKinds = new Set<FlowNodeKind>(["commentReply", "privateReply", "buttonMessage", "mediaMessage", "reaction", "tagAction", "automationLink"]);

function isFlowNodeKind(value: string): value is FlowNodeKind {
  return flowNodeKinds.includes(value as FlowNodeKind);
}

function isRepeatableNodeKind(kind: FlowNodeKind) {
  return repeatableNodeKinds.has(kind);
}

function isCustomConfigNodeKind(kind: FlowNodeKind) {
  return repeatableNodeKinds.has(kind);
}

function defaultNodeConfig(kind: FlowNodeKind): FlowNodeConfig {
  if (kind === "commentReply") return { text: "", delayMode: "fixed", delayValue: "0", delayMin: "0", delayMax: "0", delayUnit: "seconds" };
  if (kind === "privateReply") return { text: "", delayMode: "fixed", delayValue: "0", delayMin: "0", delayMax: "0", delayUnit: "seconds" };
  if (kind === "buttonMessage") return { text: "", buttonLabel: "", url: "", payload: "" };
  if (kind === "mediaMessage") return { text: "", mediaType: "image", mediaUrl: "" };
  if (kind === "reaction") return { reactionEmoji: "<3" };
  if (kind === "tagAction") return { tagName: "" };
  if (kind === "automationLink") return { automationId: "" };
  return {};
}

function nextNodePosition(nodes: UaiFlowNode[]) {
  const rightMost = nodes.reduce((max, node) => Math.max(max, Number(node.position.x) || 0), 0);
  const lane = nodes.length % 3;
  return { x: rightMost + 320, y: 90 + lane * 180 };
}

function normalizeFlowNodeConfig(value: unknown): FlowNodeConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  return cleanNodeConfig(value as FlowNodeConfig);
}

function cleanNodeConfig(config: FlowNodeConfig | undefined): FlowNodeConfig | undefined {
  if (!config) return undefined;
  const next: FlowNodeConfig = {};
  if (typeof config.text === "string") next.text = config.text;
  if (typeof config.buttonLabel === "string") next.buttonLabel = config.buttonLabel;
  if (typeof config.url === "string") next.url = config.url;
  if (typeof config.payload === "string") next.payload = config.payload;
  if (typeof config.mediaUrl === "string") next.mediaUrl = config.mediaUrl;
  if (config.mediaType === "image" || config.mediaType === "gif" || config.mediaType === "audio") next.mediaType = config.mediaType;
  if (typeof config.tagName === "string") next.tagName = config.tagName;
  if (typeof config.automationId === "string") next.automationId = config.automationId;
  if (typeof config.reactionEmoji === "string") next.reactionEmoji = config.reactionEmoji;
  if (config.delayMode === "fixed" || config.delayMode === "random") next.delayMode = config.delayMode;
  if (typeof config.delayValue === "string") next.delayValue = config.delayValue;
  if (typeof config.delayMin === "string") next.delayMin = config.delayMin;
  if (typeof config.delayMax === "string") next.delayMax = config.delayMax;
  if (config.delayUnit === "seconds" || config.delayUnit === "minutes" || config.delayUnit === "hours") next.delayUnit = config.delayUnit;
  return Object.keys(next).length ? next : undefined;
}

function createEdge(source: string, target: string, label?: string, sourceHandle?: string | null, targetHandle?: string | null): UaiFlowEdge {
  return {
    id: `${source}-${sourceHandle ?? "out"}-${target}-${targetHandle ?? "in"}`,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    targetHandle: targetHandle ?? undefined,
    label,
    ...defaultEdgeOptions,
    labelBgBorderRadius: 6,
    labelBgPadding: [8, 4],
    labelBgStyle: { fill: "var(--ms-surface)", fillOpacity: 0.95 },
    labelStyle: { fill: "var(--ms-muted)", fontSize: 11, fontWeight: 700 },
  };
}


function normalizeEdgeSourceHandle(edge: FlowEdgeDefinition) {
  if (edge.source !== "condition") return edge.sourceHandle;
  if (edge.sourceHandle === "yes" || edge.sourceHandle === "no") return edge.sourceHandle;
  const label = String(edge.label ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (label.includes("nao") || label.includes("bloqueado") || edge.target === "end") return "no";
  return "yes";
}

function conditionHandleLabel(source: string, sourceHandle?: string) {
  if (source !== "condition") return undefined;
  if (sourceHandle === "yes") return "segue";
  if (sourceHandle === "no") return "não segue";
  return undefined;
}
function translateHandle(handle: string) {
  if (handle === "yes") return "segue";
  if (handle === "no") return "não segue";
  return handle;
}
function connectionLabel(connection: Connection) {
  return conditionHandleLabel(connection.source ?? "", connection.sourceHandle ?? undefined);
}
function buildNodeData(kind: FlowNodeKind, state: FlowFormState, config?: FlowNodeConfig): FlowNodeData {
  const keywords = splitLines(state.keywords);
  const publicReplies = cleanReplyList(state.public_replies);
  const quickReplies = state.quick_replies.filter((reply) => reply.title.trim() && reply.payload.trim());
  const triggers = state.triggers.map(translateTrigger).join(" + ");
  const cfg = config ?? {};

  const map: Record<FlowNodeKind, FlowNodeData> = {
    trigger: {
      kind,
      title: "Gatilho",
      subtitle: triggers || "Comentário",
      summary: postSelectionSummary(state.post_id),
      badge: state.active ? "ON" : "OFF",
      active: state.active,
      config,
    },
    keywords: {
      kind,
      title: "Palavras-chave",
      subtitle: translateMatchType(state.match_type),
      summary: keywords.length ? keywords.join(", ") : "Sem palavras configuradas.",
      badge: String(keywords.length),
      active: keywords.length > 0 || state.match_type === "any",
      config,
    },
    publicReply: {
      kind,
      title: "Comentário",
      subtitle: state.public_reply_mode === "random" ? "Resposta aleatória" : "Resposta fixa",
      summary: publicReplies.length ? publicReplies[0] : "Sem resposta pública configurada.",
      badge: state.public_reply_mode === "random" ? String(publicReplies.length) : "fixa",
      active: publicReplies.length > 0,
      config,
    },
    condition: {
      kind,
      title: "Condição",
      subtitle: "Seguidor",
      summary: state.require_follower ? "Confere se o contato segue antes de liberar." : "Fluxo liberado sem checagem de seguidor.",
      badge: state.require_follower ? "ON" : "OFF",
      active: state.require_follower,
      config,
    },
    dm: {
      kind,
      title: "Mensagem inicial",
      subtitle: formatDelaySummary(state.reply_delay_mode, state.reply_delay_value, state.reply_delay_min, state.reply_delay_max, state.reply_delay_unit),
      summary: state.welcome_dm || "Sem mensagem inicial configurada.",
      badge: state.reply_delay_mode === "random" ? "rand" : "fixo",
      active: Boolean(state.welcome_dm),
      config,
    },
    quickReplies: {
      kind,
      title: "Respostas rápidas",
      subtitle: state.quick_reply_label || "Botão único",
      summary: quickReplies.length ? quickReplies.map((reply) => reply.title).join(", ") : "Nenhum botão configurado.",
      badge: String(quickReplies.length),
      active: quickReplies.length > 0 || Boolean(state.quick_reply_label),
      config,
    },
    link: {
      kind,
      title: "Link",
      subtitle: state.link_button_label || "Botão",
      summary: state.link_url || state.link_text || "Sem link configurado.",
      badge: state.link_url ? "URL" : "vazio",
      active: Boolean(state.link_url),
      config,
    },
    reminder: {
      kind,
      title: "Lembrete",
      subtitle: formatDelaySummary(state.reminder_delay_mode, state.reminder_delay_value, state.reminder_delay_min, state.reminder_delay_max, state.reminder_delay_unit),
      summary: state.reminder_text || "Sem lembrete configurado.",
      badge: state.reminder_delay_mode === "random" ? "rand" : "fixo",
      active: Boolean(state.reminder_text),
      config,
    },
    end: {
      kind,
      title: "Fim",
      subtitle: "Encerramento",
      summary: "O contato continua disponível na caixa de entrada e nos contatos.",
      badge: "fim",
      active: true,
      config,
    },
    commentReply: {
      kind,
      title: "Responder comentário",
      subtitle: formatConfigDelay(cfg),
      summary: cfg.text || "Configure a resposta pública do comentário.",
      badge: "coment",
      active: Boolean(cfg.text),
      config: cfg,
    },
    privateReply: {
      kind,
      title: "Resposta no privado",
      subtitle: formatConfigDelay(cfg),
      summary: cfg.text || "Configure a mensagem enviada no privado.",
      badge: "privado",
      active: Boolean(cfg.text),
      config: cfg,
    },
    buttonMessage: {
      kind,
      title: "Botão / link / código do botão",
      subtitle: cfg.buttonLabel || "Botão configurável",
      summary: cfg.url || cfg.payload || cfg.text || "Configure o endereço, o código ou o texto do botão.",
      badge: cfg.url ? "URL" : cfg.payload ? "código" : "botão",
      active: Boolean(cfg.buttonLabel && (cfg.url || cfg.payload)),
      config: cfg,
    },
    mediaMessage: {
      kind,
      title: "Enviar mídia",
      subtitle: translateMediaType(cfg.mediaType ?? "image"),
      summary: cfg.mediaUrl || cfg.text || "Configure o endereço da mídia.",
      badge: cfg.mediaType ?? "image",
      active: Boolean(cfg.mediaUrl),
      config: cfg,
    },
    reaction: {
      kind,
      title: "Enviar reação",
      subtitle: "Reação na mensagem",
      summary: cfg.reactionEmoji ? `Reagir com ${cfg.reactionEmoji}` : "Configure o emoji da reação.",
      badge: cfg.reactionEmoji || "emoji",
      active: Boolean(cfg.reactionEmoji),
      config: cfg,
    },
    tagAction: {
      kind,
      title: "Etiqueta",
      subtitle: "Contato / remarketing",
      summary: cfg.tagName ? `Adicionar etiqueta ${cfg.tagName}` : "Configure a etiqueta do contato.",
      badge: "tag",
      active: Boolean(cfg.tagName),
      config: cfg,
    },
    automationLink: {
      kind,
      title: "Conectar automação",
      subtitle: "Próximo fluxo",
      summary: cfg.automationId ? `Enviar para ${cfg.automationId}` : "Configure a automação de destino.",
      badge: "fluxo",
      active: Boolean(cfg.automationId),
      config: cfg,
    },
  };

  return map[kind];
}

function formatConfigDelay(config: FlowNodeConfig) {
  return formatDelaySummary(config.delayMode ?? "fixed", config.delayValue ?? "0", config.delayMin ?? "0", config.delayMax ?? "0", config.delayUnit ?? "seconds");
}

function translateMediaType(type: MediaActionType) {
  if (type === "gif") return "GIF";
  if (type === "audio") return "Áudio";
  return "Imagem";
}

function getNodeTheme(kind: FlowNodeKind) {
  const category = getNodeCategory(kind);
  return getCategoryTheme(category);
}

function getNodeCategory(kind: FlowNodeKind): FlowNodeCategory {
  if (kind === "trigger") return "trigger";
  if (kind === "keywords" || kind === "condition" || kind === "reminder") return "logic";
  if (kind === "quickReplies" || kind === "tagAction" || kind === "automationLink") return "data";
  if (kind === "end") return "control";
  return "action";
}

function getCategoryTheme(category: FlowNodeCategory) {
  const themes: Record<FlowNodeCategory, { label: string; accent: string; soft: string; border: string; ring: string }> = {
    trigger: { label: "Gatilho", accent: "#10b981", soft: "rgba(16,185,129,0.14)", border: "rgba(16,185,129,0.38)", ring: "rgba(16,185,129,0.2)" },
    action: { label: "Ação no Instagram", accent: "#3b82f6", soft: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.38)", ring: "rgba(59,130,246,0.22)" },
    logic: { label: "Lógica", accent: "#f59e0b", soft: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.38)", ring: "rgba(245,158,11,0.2)" },
    data: { label: "Dados", accent: "#ec4899", soft: "rgba(236,72,153,0.15)", border: "rgba(236,72,153,0.34)", ring: "rgba(236,72,153,0.2)" },
    control: { label: "Controle", accent: "#8b5cf6", soft: "rgba(139,92,246,0.16)", border: "rgba(139,92,246,0.36)", ring: "rgba(139,92,246,0.22)" },
  };
  return themes[category];
}
function NodeIcon({ kind }: { kind: FlowNodeKind }) {
  if (kind === "trigger") return <Zap size={17} />;
  if (kind === "keywords") return <KeyRound size={17} />;
  if (kind === "publicReply" || kind === "commentReply") return <MessageCircle size={17} />;
  if (kind === "condition") return <UserCheck size={17} />;
  if (kind === "dm" || kind === "privateReply") return <Send size={17} />;
  if (kind === "quickReplies" || kind === "buttonMessage") return <MousePointerClick size={17} />;
  if (kind === "link" || kind === "automationLink") return <LinkIcon size={17} />;
  if (kind === "reminder") return <Clock3 size={17} />;
  if (kind === "mediaMessage") return <Workflow size={17} />;
  if (kind === "reaction") return <Sparkles size={17} />;
  if (kind === "tagAction") return <GitBranch size={17} />;
  return <Bot size={17} />;
}

function getMiniMapColor(kind: FlowNodeKind) {
  const colors: Record<FlowNodeKind, string> = {
    trigger: "#004ac6",
    keywords: "#7c3aed",
    publicReply: "#0891b2",
    condition: "#16a34a",
    dm: "#2563eb",
    quickReplies: "#ca8a04",
    link: "#dc2626",
    reminder: "#9333ea",
    end: "#475569",
    commentReply: "#06b6d4",
    privateReply: "#2563eb",
    buttonMessage: "#f59e0b",
    mediaMessage: "#0d9488",
    reaction: "#db2777",
    tagAction: "#ec4899",
    automationLink: "#8b5cf6",
  };
  return colors[kind];
}

function getFlowMetrics(nodes: UaiFlowNode[]) {
  return { nodes: nodes.length };
}

function translateTrigger(trigger: AutomationTrigger) {
  const labels: Record<AutomationTrigger, string> = {
    comments: "Comentário",
    story: "Story",
    dm: "Mensagem no direct",
  };
  return labels[trigger];
}

function translateMatchType(matchType: MatchType) {
  const labels: Record<MatchType, string> = {
    contains: "Contém a palavra",
    exact: "Palavra exata",
    any: "Qualquer mensagem",
  };
  return labels[matchType];
}

function formatDelaySummary(mode: DelayMode, value: string, min: string, max: string, unit: DelayUnit) {
  const unitLabel = translateDelayUnit(unit);
  if (mode === "random") return `${positiveNumber(min)}-${positiveNumber(max)} ${unitLabel}`;
  return `${positiveNumber(value)} ${unitLabel}`;
}

function translateDelayUnit(unit: DelayUnit) {
  const labels: Record<DelayUnit, string> = {
    seconds: "seg",
    minutes: "min",
    hours: "h",
  };
  return labels[unit];
}

function secondsToDelayFields(seconds: number, preferredUnit?: DelayUnit) {
  const unit = preferredUnit ?? bestDelayUnit(seconds);
  const divisor = unitToSecondsMultiplier(unit);
  const value = String(seconds > 0 ? Math.round(seconds / divisor) : 0);
  return { unit, value };
}

function bestDelayUnit(seconds: number): DelayUnit {
  if (seconds >= 3600 && seconds % 3600 === 0) return "hours";
  if (seconds >= 60 && seconds % 60 === 0) return "minutes";
  return "seconds";
}

function unitToSeconds(value: string, unit: DelayUnit) {
  return positiveNumber(value) * unitToSecondsMultiplier(unit);
}

function unitToSecondsMultiplier(unit: DelayUnit) {
  if (unit === "hours") return 3600;
  if (unit === "minutes") return 60;
  return 1;
}

function keywordFields(value: string) {
  if (!value.trim()) return [""];
  const fields = value.includes(",") ? splitLines(value) : value.split(/\r?\n/);
  return fields.length ? fields : [""];
}
function cleanReplyList(replies: string[]) {
  return replies.map((reply) => reply.trim()).filter(Boolean);
}
function positiveNumber(value: string) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function splitLines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function splitPostIds(value: string | null | undefined) {
  return Array.from(new Set(String(value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)));
}

function joinPostIds(postIds: string[]) {
  return Array.from(new Set(postIds.map((postId) => postId.trim()).filter(Boolean))).join("\n");
}

function postSelectionSummary(value: string) {
  const postIds = splitPostIds(value);
  if (!postIds.length) return "Todos os posts e Reels do perfil selecionado.";
  if (postIds.length === 1) return `Post ou Reel ${postIds[0]}`;
  return `${postIds.length} posts e Reels selecionados.`;
}
