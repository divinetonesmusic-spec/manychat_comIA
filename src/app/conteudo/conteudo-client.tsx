"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  ImageIcon,
  Layers,
  List,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from "lucide-react";
import type { ContentMediaItem, ContentPost, ContentPublishType } from "@/lib/db/repositories";

type Props = {
  activeAccountId: string | null;
  connected: boolean;
  username: string | null;
  initialPosts: ContentPost[];
  initialMonth: string; // "2026-10"
};

type Notice = { tone: "success" | "error" | "warn"; text: string } | null;
type View = "calendar" | "list";
type When = "now" | "schedule" | "draft";
type DraftItem = { type: "image" | "video"; url: string; coverUrl: string; key?: string };
type Draft = {
  id?: string;
  publishType: ContentPublishType;
  title: string;
  caption: string;
  firstComment: string;
  mediaUrl: string;
  coverUrl: string;
  mediaKeys: string[];
  items: DraftItem[];
  keyword: string;
  dmText: string;
  linkUrl: string;
  linkLabel: string;
  publicReply: string;
  when: When;
  date: string;
  time: string;
};

const TYPES: Array<{ value: ContentPublishType; label: string; icon: "video" | "image" | "carousel" }> = [
  { value: "reel_video", label: "Reel", icon: "video" },
  { value: "carousel", label: "Carrossel", icon: "carousel" },
  { value: "feed_image", label: "Foto", icon: "image" },
  { value: "story_video", label: "Story vídeo", icon: "video" },
  { value: "story_image", label: "Story foto", icon: "image" },
];

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const EDITABLE = new Set<ContentPost["status"]>(["draft", "scheduled", "failed", "canceled"]);

export function ConteudoClient({ activeAccountId, connected, username, initialPosts, initialMonth }: Props) {
  const [posts, setPosts] = useState<Map<string, ContentPost>>(() => new Map(initialPosts.map((post) => [post.id, post])));
  const [view, setView] = useState<View>("calendar");
  const [month, setMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const loadedMonths = useRef(new Set<string>([initialMonth]));

  const merge = useCallback((list: ContentPost[]) => {
    setPosts((current) => {
      const next = new Map(current);
      for (const post of list) next.set(post.id, post);
      return next;
    });
  }, []);

  const fetchRange = useCallback(async (targetMonth: string, sync = true) => {
    const { from, to } = monthRange(targetMonth);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (activeAccountId) params.set("accountId", activeAccountId);
    if (!sync) params.set("sync", "0");
    const response = await fetch(`/api/content?${params}`);
    const result = (await response.json().catch(() => null)) as { data?: ContentPost[] } | null;
    if (result?.data) merge(result.data);
  }, [activeAccountId, merge]);

  const fetchList = useCallback(async () => {
    const params = new URLSearchParams({ limit: "120" });
    if (activeAccountId) params.set("accountId", activeAccountId);
    const response = await fetch(`/api/content?${params}`);
    const result = (await response.json().catch(() => null)) as { data?: ContentPost[] } | null;
    if (result?.data) merge(result.data);
  }, [activeAccountId, merge]);

  useEffect(() => {
    if (loadedMonths.current.has(month)) return;
    loadedMonths.current.add(month);
    fetchRange(month, false).catch(() => null);
  }, [month, fetchRange]);

  const all = useMemo(() => Array.from(posts.values()).sort((a, b) => postTime(a) - postTime(b)), [posts]);
  // Enquanto algo está publicando (ou vence nos próximos 2 min), atualiza sozinho a cada 20 s.
  useEffect(() => {
    const soon = Date.now() + 120_000;
    const busy = all.some((post) => post.status === "publishing" || (post.status === "scheduled" && postTime(post) < soon));
    if (!busy) return;
    const timer = window.setInterval(() => { fetchRange(month).catch(() => null); }, 20_000);
    return () => window.clearInterval(timer);
  }, [all, month, fetchRange]);

  const stats = useMemo(() => ({
    scheduled: all.filter((post) => post.status === "scheduled").length,
    publishing: all.filter((post) => post.status === "publishing").length,
    published: all.filter((post) => post.status === "published").length,
    failed: all.filter((post) => post.status === "failed").length,
  }), [all]);

  async function refresh() {
    setLoading(true);
    try {
      await (view === "calendar" ? fetchRange(month) : fetchList());
    } finally {
      setLoading(false);
    }
  }

  function openNew(date?: string) {
    setDetailId(null);
    setComposerKey((key) => key + 1);
    setDraft(emptyDraft(date));
    setNotice(null);
  }

  function openPost(post: ContentPost) {
    setNotice(null);
    if (EDITABLE.has(post.status)) {
      setDetailId(null);
      setComposerKey((key) => key + 1);
      setDraft(draftFromPost(post));
    } else {
      setDraft(null);
      setDetailId(post.id);
    }
  }

  function onSaved(post: ContentPost | null, message: Notice) {
    if (post) merge([post]);
    setNotice(message);
    if (post && !EDITABLE.has(post.status)) {
      setDraft(null);
      setDetailId(post.id);
    } else if (message?.tone === "success") {
      setDraft(null);
    }
  }

  function onRemoved(id: string) {
    setPosts((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    setDraft(null);
    setDetailId(null);
    setNotice({ tone: "success", text: "Post excluído do planner (e a mídia guardada foi apagada)." });
  }

  const detail = detailId ? posts.get(detailId) ?? null : null;

  return (
    <div className="grid gap-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Agendados" value={stats.scheduled} icon={<Clock3 size={16} />} />
        <Metric label="Publicando" value={stats.publishing} icon={<Loader2 size={16} className={stats.publishing ? "animate-spin" : ""} />} />
        <Metric label="Publicados" value={stats.published} icon={<CheckCircle2 size={16} />} />
        <Metric label="Com erro" value={stats.failed} icon={<AlertCircle size={16} />} tone={stats.failed ? "red" : undefined} />
      </section>

      <section className="panel overflow-hidden p-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ms-border)] p-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--ms-border)] p-1" role="tablist" aria-label="Visão">
              <ViewTab active={view === "calendar"} onClick={() => setView("calendar")} icon={<CalendarDays size={15} />} label="Calendário" />
              <ViewTab active={view === "list"} onClick={() => { setView("list"); fetchList().catch(() => null); }} icon={<List size={15} />} label="Lista" />
            </div>
            {view === "calendar" ? (
              <div className="flex items-center gap-1">
                <button className="icon-button" onClick={() => setMonth(shiftMonth(month, -1))} type="button" aria-label="Mês anterior"><ChevronLeft size={16} /></button>
                <span className="min-w-32 text-center text-sm font-bold">{monthLabel(month)}</span>
                <button className="icon-button" onClick={() => setMonth(shiftMonth(month, 1))} type="button" aria-label="Próximo mês"><ChevronRight size={16} /></button>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={refresh} disabled={loading} type="button">
              {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
            </button>
            <button className="btn-primary" onClick={() => openNew()} disabled={!connected} type="button"><Plus size={16} /> Novo post</button>
          </div>
        </header>

        {!connected ? <p className="m-4 status-pill w-fit text-red-500"><AlertCircle size={14} /> Conecte um Instagram para agendar e publicar.</p> : null}
        {notice && !draft && !detail ? <p className={`m-4 ${noticeClass(notice.tone)}`}>{notice.text}</p> : null}

        {view === "calendar"
          ? <MonthGrid month={month} posts={all} onOpenPost={openPost} onNewAt={connected ? openNew : undefined} />
          : <PostList posts={[...all].reverse()} onOpenPost={openPost} />}
      </section>

      {draft ? (
        <Sheet label={draft.id ? "Editar post" : "Novo post"} onClose={() => setDraft(null)} closeOnBackdrop={false}>
          <Composer
            key={composerKey}
            initial={draft}
            accountId={activeAccountId}
            username={username}
            onClose={() => setDraft(null)}
            onSaved={onSaved}
            onRemoved={onRemoved}
          />
        </Sheet>
      ) : null}

      {detail ? (
        <Sheet label="Detalhes do post" onClose={() => setDetailId(null)} narrow>
          <PostDetail post={detail} notice={notice} onClose={() => setDetailId(null)} onSaved={onSaved} onRemoved={onRemoved} />
        </Sheet>
      ) : null}
    </div>
  );
}

/** Painel lateral por cima da página (o calendário continua visível atrás). */
function Sheet({ label, onClose, children, closeOnBackdrop = true, narrow = false }: { label: string; onClose: () => void; children: ReactNode; closeOnBackdrop?: boolean; narrow?: boolean }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && closeOnBackdrop) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, closeOnBackdrop]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(10,14,25,0.45)]" onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        aria-label={label}
        aria-modal="true"
        className={`h-full w-full overflow-y-auto bg-[var(--ms-background)] p-2 shadow-2xl sm:p-4 ${narrow ? "max-w-[640px]" : "max-w-[1040px]"}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------- Calendário ---------------- */

function MonthGrid({ month, posts, onOpenPost, onNewAt }: { month: string; posts: ContentPost[]; onOpenPost: (post: ContentPost) => void; onNewAt?: (date: string) => void }) {
  const days = useMemo(() => monthCells(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, ContentPost[]>();
    for (const post of posts) {
      const key = dayKey(new Date(postTime(post)));
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [posts]);
  const today = dayKey(new Date());
  const [selected, setSelected] = useState(today);
  const selectedPosts = byDay.get(selected) ?? [];

  return (
    <div>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((day) => <div className="border-b border-[var(--ms-border)] px-1 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--ms-muted)] sm:px-3 sm:text-left sm:text-xs" key={day}>{day}</div>)}
        {days.map((day) => {
          const list = byDay.get(day.key) ?? [];
          const past = day.key < today;
          const isSelected = day.key === selected;
          return (
            <div
              className={`group relative min-h-14 border-b border-r border-[var(--ms-border)] p-1 sm:min-h-28 sm:p-2 ${day.inMonth ? "" : "bg-[var(--ms-surface-soft)] opacity-60"} ${isSelected ? "max-sm:bg-[var(--ms-surface-soft)]" : ""}`}
              key={day.key}
              onClick={() => setSelected(day.key)}
            >
              <div className="flex items-center justify-center sm:justify-between">
                <span className={day.key === today ? "grid h-6 w-6 place-items-center rounded-full bg-[var(--ms-primary)] text-xs font-bold text-white" : "text-xs font-semibold text-[var(--ms-muted)]"}>{day.date.getDate()}</span>
                {onNewAt && !past ? (
                  <button className="hidden rounded-md p-1 text-[var(--ms-muted)] opacity-0 transition hover:bg-[var(--ms-surface-soft)] hover:text-[var(--ms-primary)] focus:opacity-100 group-hover:opacity-100 sm:block" onClick={() => onNewAt(day.key)} type="button" aria-label={`Agendar em ${day.key}`}>
                    <Plus size={14} />
                  </button>
                ) : null}
              </div>
              {/* celular: pontinhos coloridos; tela grande: os posts */}
              <div className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden">
                {list.slice(0, 4).map((post) => <span className={`h-1.5 w-1.5 rounded-full ${dotTone(post.status)}`} key={post.id} />)}
              </div>
              <div className="mt-1 hidden gap-1 sm:grid">
                {list.slice(0, 4).map((post) => <PostChip key={post.id} post={post} onClick={() => onOpenPost(post)} />)}
                {list.length > 4 ? <span className="text-[11px] text-[var(--ms-muted)]">+{list.length - 4} posts</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 p-3 sm:hidden">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{dayLabel(selected)}</span>
          {onNewAt && selected >= today ? <button className="btn-secondary" onClick={() => onNewAt(selected)} type="button"><Plus size={15} /> Agendar</button> : null}
        </div>
        {selectedPosts.length
          ? selectedPosts.map((post) => <PostChip key={post.id} post={post} onClick={() => onOpenPost(post)} />)
          : <p className="text-xs text-[var(--ms-muted)]">Nada neste dia.</p>}
      </div>
    </div>
  );
}

function PostChip({ post, onClick }: { post: ContentPost; onClick: () => void }) {
  return (
    <button
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] font-semibold transition hover:-translate-y-px hover:shadow-sm ${chipTone(post.status)}`}
      onClick={onClick}
      title={`${translateStatus(post.status)} · ${post.title || post.caption || translatePublishType(post.publish_type)}`}
      type="button"
    >
      <TypeIcon type={post.publish_type} size={12} />
      <span className="shrink-0 tabular-nums">{timeLabel(new Date(postTime(post)))}</span>
      <span className="truncate">{post.title || post.caption || translatePublishType(post.publish_type)}</span>
    </button>
  );
}

/* ---------------- Lista ---------------- */

function PostList({ posts, onOpenPost }: { posts: ContentPost[]; onOpenPost: (post: ContentPost) => void }) {
  if (!posts.length) return <p className="p-10 text-center text-sm text-[var(--ms-muted)]">Nenhum post ainda. Clique em Novo post ou mande um Reel pronto do Molde.</p>;
  return (
    <div className="grid divide-y divide-[var(--ms-border)]">
      {posts.map((post) => (
        <button className="grid gap-2 p-4 text-left transition hover:bg-[var(--ms-surface-soft)] sm:grid-cols-[1fr_auto] sm:items-center sm:px-6" key={post.id} onClick={() => onOpenPost(post)} type="button">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={statusClass(post.status)}>{translateStatus(post.status)}</span>
              <span className="status-pill"><TypeIcon type={post.publish_type} size={12} /> {translatePublishType(post.publish_type)}</span>
              <span className="status-pill">{dateTimeLabel(new Date(postTime(post)))}</span>
              {post.keyword ? <span className="status-pill"><Zap size={12} /> {post.keyword}</span> : null}
              {post.source === "molde" ? <span className="status-pill"><Sparkles size={12} /> Molde</span> : null}
            </div>
            <p className="mt-2 truncate text-sm font-semibold">{post.title || post.caption || "Sem legenda"}</p>
            {post.last_error && post.status !== "published" ? <p className="mt-1 truncate text-xs text-red-500">{post.last_error}</p> : null}
          </div>
          {post.status === "published" ? <InsightsInline insights={post.insights} /> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Compositor (novo / editar) ---------------- */

function Composer({ initial, accountId, username, onClose, onSaved, onRemoved }: {
  initial: Draft;
  accountId: string | null;
  username: string | null;
  onClose: () => void;
  onSaved: (post: ContentPost | null, notice: Notice) => void;
  onRemoved: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [funnelOpen, setFunnelOpen] = useState(Boolean(initial.keyword || initial.dmText || initial.linkUrl));
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const isCarousel = draft.publishType === "carousel";
  const wantsVideo = draft.publishType === "reel_video" || draft.publishType === "story_video" || draft.publishType === "feed_video";
  const isStory = draft.publishType.startsWith("story");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const scheduledAt = draft.when === "schedule" ? new Date(`${draft.date}T${draft.time}`) : null;
      if (draft.when === "schedule" && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw new Error("Escolha a data e a hora.");
      if (draft.when === "schedule" && scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) throw new Error("Esse horário já passou. Escolha um horário futuro ou use Publicar agora.");
      const payload = {
        accountId,
        publishType: draft.publishType,
        title: draft.title,
        caption: draft.caption,
        firstComment: draft.firstComment,
        mediaUrl: isCarousel ? undefined : draft.mediaUrl.trim(),
        coverUrl: draft.coverUrl.trim() || null,
        mediaItems: isCarousel ? draft.items.filter((item) => item.url.trim()).map((item) => ({ type: item.type, url: item.url.trim(), coverUrl: item.coverUrl.trim() || undefined })) : undefined,
        mediaKeys: [...draft.mediaKeys, ...draft.items.map((item) => item.key).filter(Boolean)],
        keyword: isStory ? "" : draft.keyword,
        dmText: isStory ? "" : draft.dmText,
        linkUrl: isStory ? "" : draft.linkUrl.trim(),
        linkLabel: draft.linkLabel,
        publicReply: draft.publicReply,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
        when: draft.when,
        publishNow: draft.when === "now",
      };
      const response = await fetch(draft.id ? `/api/content/${draft.id}` : "/api/content", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { data?: ContentPost; error?: string; warning?: string } | null;
      if (!result?.data) throw new Error(result?.error || "Não consegui salvar.");
      const post = result.data;
      if (post.status === "failed") onSaved(post, { tone: "error", text: post.last_error || "A Meta recusou a publicação." });
      else if (post.status === "published") onSaved(post, { tone: "success", text: "Publicado! A automação da palavra-chave já está ligada." });
      else if (post.status === "publishing") onSaved(post, { tone: "warn", text: result.warning || "A Meta está processando. O sistema publica sozinho." });
      else if (post.status === "scheduled") onSaved(post, { tone: "success", text: `Agendado para ${dateTimeLabel(new Date(postTime(post)))}.` });
      else onSaved(post, { tone: "success", text: "Rascunho salvo." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel overflow-hidden p-0" aria-label="Post">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--ms-border)] p-5 sm:px-6">
        <div>
          <p className="eyebrow">{draft.id ? "Editar post" : "Novo post"}</p>
          <h2 className="mt-1 text-lg font-bold">{username ? `@${username}` : "Instagram"} · {translatePublishType(draft.publishType)}</h2>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar"><X size={16} /></button>
      </header>

      <div className="grid gap-6 p-5 sm:px-6 lg:grid-cols-[1fr_320px]">
        <fieldset className="grid content-start gap-5" disabled={saving}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo">
            {TYPES.map((type) => (
              <button
                aria-checked={draft.publishType === type.value}
                className={draft.publishType === type.value ? "btn-primary" : "btn-secondary"}
                key={type.value}
                onClick={() => set({ publishType: type.value, items: type.value === "carousel" && draft.items.length < 2 ? [emptyItem(), emptyItem()] : draft.items })}
                role="radio"
                type="button"
              >
                <TypeIcon type={type.value} size={15} /> {type.label}
              </button>
            ))}
          </div>

          {isCarousel ? (
            <div className="grid gap-3">
              {draft.items.map((item, index) => (
                <div className="grid gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3" key={index}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Slide {index + 1}</span>
                    <button className="icon-button" disabled={draft.items.length <= 2} onClick={() => set({ items: draft.items.filter((_, i) => i !== index) })} type="button" aria-label="Remover slide"><Trash2 size={15} /></button>
                  </div>
                  <MediaInput
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                    url={item.url}
                    onUrl={(url) => set({ items: draft.items.map((it, i) => (i === index ? { ...it, url, key: undefined } : it)) })}
                    onUploaded={(url, key, contentType) => set({ items: draft.items.map((it, i) => (i === index ? { ...it, url, key, type: contentType.startsWith("video") ? "video" : "image" } : it)) })}
                  />
                </div>
              ))}
              <button className="btn-secondary w-fit" disabled={draft.items.length >= 10} onClick={() => set({ items: [...draft.items, emptyItem()] })} type="button"><Plus size={15} /> Adicionar slide</button>
            </div>
          ) : (
            <div className="grid gap-3">
              <MediaInput
                accept={wantsVideo ? "video/mp4,video/quicktime" : "image/jpeg,image/png,image/webp"}
                label={wantsVideo ? "Vídeo (MP4, 9:16)" : "Imagem (JPG ou PNG)"}
                url={draft.mediaUrl}
                onUrl={(mediaUrl) => set({ mediaUrl })}
                onUploaded={(mediaUrl, key) => set({ mediaUrl, mediaKeys: [key] })}
              />
              {draft.publishType === "reel_video" ? (
                <MediaInput accept="image/jpeg,image/png" label="Capa (opcional)" url={draft.coverUrl} onUrl={(coverUrl) => set({ coverUrl })} onUploaded={(coverUrl, key) => set({ coverUrl, mediaKeys: [...draft.mediaKeys, key] })} />
              ) : null}
            </div>
          )}

          {!isStory ? (
            <>
              <label className="field">
                <span>Legenda <small className="text-[var(--ms-muted)]">{draft.caption.length}/2200</small></span>
                <textarea className="input min-h-32" maxLength={2200} value={draft.caption} onChange={(event) => set({ caption: event.target.value })} placeholder="Gancho, valor e a chamada: comente a palavra para receber..." />
              </label>
              <label className="field">
                <span>1º comentário (opcional)</span>
                <input className="input" value={draft.firstComment} onChange={(event) => set({ firstComment: event.target.value })} placeholder="Ex.: Comenta GUIA que eu te mando 👇" />
              </label>

              <div className="rounded-lg border border-[var(--ms-border)]">
                <button className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => setFunnelOpen((open) => !open)} type="button" aria-expanded={funnelOpen}>
                  <span className="flex items-center gap-2 text-sm font-bold"><Zap size={15} className="text-[var(--ms-primary)]" /> Funil do comentário → DM</span>
                  <span className="text-xs text-[var(--ms-muted)]">{draft.keyword ? `palavra: ${draft.keyword}` : "opcional"}</span>
                </button>
                {funnelOpen ? (
                  <div className="grid gap-3 border-t border-[var(--ms-border)] p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="field"><span>Palavra-chave</span><input className="input" value={draft.keyword} onChange={(event) => set({ keyword: event.target.value })} placeholder="GUIA" /></label>
                      <label className="field"><span>Resposta pública ao comentário</span><input className="input" value={draft.publicReply} onChange={(event) => set({ publicReply: event.target.value })} placeholder="Te mandei na DM! ✨" /></label>
                    </div>
                    <label className="field"><span>Mensagem da DM</span><textarea className="input min-h-20" value={draft.dmText} onChange={(event) => set({ dmText: event.target.value })} placeholder="Oi! Aqui está o que você pediu 👇" /></label>
                    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                      <label className="field"><span>Link do produto</span><input className="input" type="url" value={draft.linkUrl} onChange={(event) => set({ linkUrl: event.target.value })} placeholder="https://..." /></label>
                      <label className="field"><span>Texto do botão</span><input className="input" maxLength={20} value={draft.linkLabel} onChange={(event) => set({ linkLabel: event.target.value })} placeholder="Quero o meu" /></label>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : <p className="text-xs text-[var(--ms-muted)]">Stories pela API não levam legenda, link, enquete nem música.</p>}
        </fieldset>

        <aside className="grid content-start gap-4">
          <MediaPreview draft={draft} />
          <div className="grid gap-2 rounded-lg border border-[var(--ms-border)] p-3">
            <span className="text-sm font-bold">Quando</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--ms-surface-soft)] p-1" role="radiogroup">
              {(["schedule", "now", "draft"] as When[]).map((when) => (
                <button aria-checked={draft.when === when} className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${draft.when === when ? "bg-[var(--ms-surface)] text-[var(--ms-primary)] shadow-sm" : "text-[var(--ms-muted)]"}`} key={when} onClick={() => set({ when })} role="radio" type="button">
                  {when === "schedule" ? "Agendar" : when === "now" ? "Agora" : "Rascunho"}
                </button>
              ))}
            </div>
            {draft.when === "schedule" ? (
              <div className="grid grid-cols-[1fr_132px] gap-2">
                <input aria-label="Data" className="input" type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />
                <input aria-label="Hora" className="input" type="time" value={draft.time} onChange={(event) => set({ time: event.target.value })} />
              </div>
            ) : null}
            {draft.keyword && !isStory ? (
              <p className="flex gap-2 rounded-md bg-[var(--ms-surface-soft)] p-2 text-xs leading-5 text-[var(--ms-muted)]">
                <MessageCircle className="mt-0.5 shrink-0" size={14} />
                <span>Quem comentar <b className="text-[var(--ms-foreground)]">{draft.keyword}</b> recebe a DM{draft.linkUrl ? " com o botão do link" : ""}. A automação liga sozinha quando o post for publicado.</span>
              </p>
            ) : null}
          </div>
          {error ? <p className="status-pill w-fit text-red-500"><AlertCircle size={14} /> {error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={save} disabled={saving} type="button">
              {saving ? <Loader2 className="animate-spin" size={16} /> : draft.when === "now" ? <Send size={16} /> : <CalendarDays size={16} />}
              {saving ? "Salvando..." : draft.when === "now" ? "Publicar agora" : draft.when === "schedule" ? "Agendar" : "Salvar rascunho"}
            </button>
            {draft.id ? <DeleteButton id={draft.id} onRemoved={onRemoved} onError={setError} /> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Envia o arquivo direto para o armazenamento (R2) por link assinado; ou aceita um link público colado. */
function MediaInput({ accept, label, url, onUrl, onUploaded }: { accept: string; label?: string; url: string; onUrl: (url: string) => void; onUploaded: (url: string, key: string, contentType: string) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const response = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, folder: "conteudo" }),
      });
      const result = (await response.json().catch(() => null)) as { data?: { uploadUrl: string; publicUrl: string; key: string }; error?: string } | null;
      if (!result?.data) throw new Error(result?.error || "Não consegui preparar o envio.");
      await putWithProgress(result.data.uploadUrl, file, setProgress);
      onUploaded(result.data.publicUrl, result.data.key, file.type);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha no envio.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="grid gap-1.5">
      {label ? <span className="text-sm font-semibold">{label}</span> : null}
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1" type="url" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="Envie o arquivo ou cole um link público https://" />
        <label className="btn-secondary shrink-0 cursor-pointer">
          {progress !== null ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
          {progress !== null ? `${progress}%` : "Enviar"}
          <input accept={accept} className="sr-only" disabled={progress !== null} onChange={onFile} type="file" />
        </label>
      </div>
      {progress !== null ? <div className="h-1 overflow-hidden rounded-full bg-[var(--ms-surface-soft)]"><div className="h-full bg-[var(--ms-primary)] transition-all" style={{ width: `${progress}%` }} /></div> : null}
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}

function MediaPreview({ draft }: { draft: Draft }) {
  const first = draft.publishType === "carousel" ? draft.items.find((item) => item.url) : draft.mediaUrl ? { type: draft.publishType.includes("video") ? "video" : "image", url: draft.mediaUrl } : null;
  return (
    <div className="relative grid aspect-[9/16] max-h-[420px] w-full place-items-center overflow-hidden rounded-xl border border-[var(--ms-border)] bg-[var(--ms-surface-soft)]">
      {first?.url && isHttp(first.url) ? (
        first.type === "video"
          ? <video className="h-full w-full object-cover" src={first.url} muted playsInline controls preload="metadata" />
          : <img className="h-full w-full object-cover" src={first.url} alt="Prévia" />
      ) : (
        <span className="grid place-items-center gap-2 text-xs text-[var(--ms-muted)]"><TypeIcon type={draft.publishType} size={22} /> Prévia</span>
      )}
      {draft.publishType === "carousel" && draft.items.length > 1 ? <span className="absolute right-2 top-2 status-pill">{draft.items.filter((item) => item.url).length}/{draft.items.length}</span> : null}
    </div>
  );
}

/* ---------------- Detalhe (publicado / publicando) ---------------- */

function PostDetail({ post, notice, onClose, onSaved, onRemoved }: { post: ContentPost; notice: Notice; onClose: () => void; onSaved: (post: ContentPost | null, notice: Notice) => void; onRemoved: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel overflow-hidden p-0" aria-label="Detalhes do post">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--ms-border)] p-5 sm:px-6">
        <div className="min-w-0">
          <p className="eyebrow">{translatePublishType(post.publish_type)}{post.source === "molde" ? " · veio do Molde" : ""}</p>
          <h2 className="mt-1 truncate text-lg font-bold">{post.title || post.caption || "Post"}</h2>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar"><X size={16} /></button>
      </header>
      <div className="grid gap-4 p-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={statusClass(post.status)}>{translateStatus(post.status)}</span>
          <span className="status-pill">{dateTimeLabel(new Date(postTime(post)))}</span>
          {post.keyword ? <span className="status-pill"><Zap size={12} /> {post.keyword} {post.automation_id ? "· automação ligada" : "· automação pendente"}</span> : null}
          {post.first_comment ? <span className="status-pill"><MessageCircle size={12} /> 1º comentário {post.first_comment_id ? "feito" : "pendente"}</span> : null}
        </div>
        {notice ? <p className={noticeClass(notice.tone)}>{notice.text}</p> : null}
        {post.last_error ? <p className={post.status === "publishing" ? "text-sm text-[var(--ms-muted)]" : "text-sm text-red-500"}>{post.last_error}</p> : null}
        {post.status === "published" ? <InsightsGrid insights={post.insights} at={post.insights_at} /> : null}
        {error ? <p className="status-pill w-fit text-red-500"><AlertCircle size={14} /> {error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {post.permalink ? <a className="btn-secondary" href={post.permalink} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Ver no Instagram</a> : null}
          {post.status === "publishing" ? <span className="status-pill"><Loader2 className="animate-spin" size={14} /> O sistema confere a cada minuto</span> : null}
          {post.status !== "publishing" ? <DeleteButton id={post.id} onRemoved={onRemoved} onError={setError} published={post.status === "published"} /> : null}
          {post.status === "failed" ? <RetryButton id={post.id} onSaved={onSaved} onError={setError} /> : null}
        </div>
      </div>
    </section>
  );
}

function RetryButton({ id, onSaved, onError }: { id: string; onSaved: (post: ContentPost | null, notice: Notice) => void; onError: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    const response = await fetch(`/api/content/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry" }) });
    const result = (await response.json().catch(() => null)) as { data?: ContentPost; error?: string } | null;
    setBusy(false);
    if (!result?.data) return onError(result?.error || "Não deu para tentar de novo.");
    onSaved(result.data, result.data.status === "failed" ? { tone: "error", text: result.data.last_error || "Falhou de novo." } : { tone: "warn", text: "Tentando de novo." });
  }
  return <button className="btn-primary" disabled={busy} onClick={retry} type="button">{busy ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Tentar de novo</button>;
}

/** Exclusão em 2 cliques (evita clique acidental). */
function DeleteButton({ id, onRemoved, onError, published }: { id: string; onRemoved: (id: string) => void; onError: (text: string) => void; published?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  async function remove() {
    if (!armed) return setArmed(true);
    setBusy(true);
    const response = await fetch(`/api/content/${id}`, { method: "DELETE" });
    const result = (await response.json().catch(() => null)) as { data?: unknown; error?: string } | null;
    setBusy(false);
    setArmed(false);
    if (!response.ok) return onError(result?.error || "Não deu para excluir.");
    onRemoved(id);
  }
  return (
    <button className={armed ? "btn-secondary border-red-400 text-red-500" : "btn-secondary"} disabled={busy} onClick={remove} type="button" title={published ? "Tira do planner; o post continua no Instagram" : undefined}>
      {busy ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
      {armed ? "Confirmar exclusão" : "Excluir"}
    </button>
  );
}

/* ---------------- Peças pequenas ---------------- */

function Metric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone?: "red" }) {
  return (
    <article className="panel flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-xs font-semibold text-[var(--ms-muted)]">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === "red" ? "text-red-500" : ""}`}>{value}</p>
      </div>
      <span className="text-[var(--ms-muted)]">{icon}</span>
    </article>
  );
}

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button aria-selected={active} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition ${active ? "bg-[var(--ms-surface-soft)] text-[var(--ms-primary)]" : "text-[var(--ms-muted)]"}`} onClick={onClick} role="tab" type="button">
      {icon} {label}
    </button>
  );
}

function TypeIcon({ type, size }: { type: ContentPublishType; size: number }) {
  if (type === "carousel") return <Layers size={size} />;
  if (type.includes("video")) return <Video size={size} />;
  return <ImageIcon size={size} />;
}

const INSIGHT_LABELS: Array<[string, string]> = [["views", "Views"], ["reach", "Alcance"], ["likes", "Curtidas"], ["comments", "Comentários"], ["shares", "Compart."], ["saved", "Salvos"]];

function InsightsGrid({ insights, at }: { insights?: Record<string, number>; at?: string | null }) {
  const has = insights && Object.keys(insights).length;
  if (!has) return <p className="text-xs text-[var(--ms-muted)]">Os resultados aparecem 1 hora depois de publicado e atualizam a cada 6 horas.</p>;
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {INSIGHT_LABELS.map(([key, label]) => (
          <div className="rounded-lg border border-[var(--ms-border)] p-2" key={key}>
            <p className="text-[11px] text-[var(--ms-muted)]">{label}</p>
            <p className="text-lg font-bold tabular-nums">{formatNumber(insights?.[key])}</p>
          </div>
        ))}
      </div>
      {at ? <p className="text-[11px] text-[var(--ms-muted)]">Atualizado {dateTimeLabel(new Date(at))}</p> : null}
    </div>
  );
}

function InsightsInline({ insights }: { insights?: Record<string, number> }) {
  if (!insights || !Object.keys(insights).length) return null;
  return <span className="text-xs tabular-nums text-[var(--ms-muted)]">{formatNumber(insights.views)} views · {formatNumber(insights.comments)} coment.</span>;
}

/* ---------------- Utilidades ---------------- */

function putWithProgress(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`O armazenamento recusou o envio (${xhr.status}). Confira o CORS do bucket.`)));
    xhr.onerror = () => reject(new Error("Falha de rede no envio. Confira o CORS do bucket R2."));
    xhr.send(file);
  });
}

function emptyItem(): DraftItem {
  return { type: "image", url: "", coverUrl: "" };
}

function emptyDraft(date?: string): Draft {
  const next = new Date(Date.now() + 60 * 60_000);
  return {
    publishType: "reel_video",
    title: "",
    caption: "",
    firstComment: "",
    mediaUrl: "",
    coverUrl: "",
    mediaKeys: [],
    items: [emptyItem(), emptyItem()],
    keyword: "",
    dmText: "",
    linkUrl: "",
    linkLabel: "",
    publicReply: "",
    when: "schedule",
    date: date ?? dayKey(next),
    time: date ? "18:00" : `${String(next.getHours()).padStart(2, "0")}:00`,
  };
}

function draftFromPost(post: ContentPost): Draft {
  const at = post.scheduled_at ? new Date(post.scheduled_at) : new Date(Date.now() + 60 * 60_000);
  const items: DraftItem[] = (post.media_items ?? []).map((item: ContentMediaItem) => ({ type: item.type, url: item.url, coverUrl: item.cover_url ?? "" }));
  return {
    id: post.id,
    publishType: post.publish_type,
    title: post.title ?? "",
    caption: post.caption ?? "",
    firstComment: post.first_comment ?? "",
    mediaUrl: post.media_url ?? "",
    coverUrl: post.cover_url ?? "",
    mediaKeys: post.media_keys ?? [],
    items: items.length >= 2 ? items : [emptyItem(), emptyItem()],
    keyword: post.keyword ?? "",
    dmText: post.dm_text ?? "",
    linkUrl: post.link_url ?? "",
    linkLabel: post.link_label ?? "",
    publicReply: post.public_reply ?? "",
    when: post.status === "draft" || post.status === "canceled" ? "draft" : "schedule",
    date: dayKey(at),
    time: timeLabel(at),
  };
}

function postTime(post: ContentPost) {
  return new Date(post.scheduled_at || post.published_at || post.created_at).getTime();
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeLabel(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function monthLabel(month: string) {
  const [year, index] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, index - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftMonth(month: string, delta: number) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, index - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Intervalo visível do mês (com as semanas de borda). */
function monthRange(month: string) {
  const cells = monthCells(month);
  const from = new Date(cells[0].date);
  const to = new Date(cells[cells.length - 1].date);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function monthCells(month: string) {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(year, index - 1, 1);
  const offset = (first.getDay() + 6) % 7; // semana começa na segunda
  const start = new Date(year, index - 1, 1 - offset);
  const last = new Date(year, index, 0);
  const total = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, key: dayKey(date), inMonth: date.getMonth() === index - 1 };
  });
}

function isHttp(value: string) {
  return /^https?:\/\//i.test(value);
}

function formatNumber(value?: number) {
  if (value === undefined || value === null) return "–";
  return new Intl.NumberFormat("pt-BR", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function noticeClass(tone: NonNullable<Notice>["tone"]) {
  if (tone === "success") return "status-pill status-pill-green w-fit";
  if (tone === "warn") return "status-pill status-pill-amber w-fit";
  return "status-pill w-fit text-red-500";
}

function dotTone(status: ContentPost["status"]) {
  if (status === "published") return "bg-emerald-500";
  if (status === "publishing") return "bg-amber-500";
  if (status === "failed") return "bg-red-500";
  if (status === "scheduled") return "bg-[var(--ms-primary)]";
  return "bg-[var(--ms-border-strong)]";
}

function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(year, month - 1, day));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function chipTone(status: ContentPost["status"]) {
  if (status === "published") return "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200";
  if (status === "publishing") return "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200";
  if (status === "failed") return "border-red-300/60 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200";
  if (status === "scheduled") return "border-[var(--ms-primary-soft)] bg-[var(--ms-surface-soft)] text-[var(--ms-primary)]";
  return "border-dashed border-[var(--ms-border-strong)] bg-transparent text-[var(--ms-muted)]";
}

function statusClass(status: ContentPost["status"]) {
  if (status === "published") return "status-pill status-pill-green";
  if (status === "publishing" || status === "scheduled") return "status-pill status-pill-amber";
  if (status === "failed") return "status-pill text-red-500";
  return "status-pill";
}

function translateStatus(status: ContentPost["status"]) {
  const labels: Record<ContentPost["status"], string> = {
    draft: "Rascunho",
    scheduled: "Agendado",
    publishing: "Publicando",
    published: "Publicado",
    failed: "Erro",
    canceled: "Cancelado",
  };
  return labels[status];
}

function translatePublishType(type: ContentPublishType) {
  const labels: Record<ContentPublishType, string> = {
    feed_image: "Foto no feed",
    feed_video: "Vídeo no feed",
    reel_video: "Reel",
    story_image: "Story foto",
    story_video: "Story vídeo",
    carousel: "Carrossel",
  };
  return labels[type];
}
