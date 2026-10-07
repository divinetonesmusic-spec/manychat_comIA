"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Workflow,
} from "lucide-react";
import type { Automation } from "@/lib/db/repositories";
import { matchLabel, mediaTypeLabel, triggerLabel } from "@/lib/rotulos";

type Props = {
  initialAutomations: Automation[];
  isInstagramConnected: boolean;
  metaAppConfigured: boolean;
  showFlowList?: boolean;
  showTemplates?: boolean;
  initialTemplateId?: string;
  editorTitle?: string;
  accountId?: string | null;
};

type InstagramMedia = {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  permalink?: string;
};

type AutomationFilter = "all" | "active" | "paused";
type TemplateStatus = "ready" | "planned";
type TemplateTrigger = "comments" | "story" | "dm";

type AutomationTemplate = {
  id: string;
  title: string;
  category: string;
  description: string;
  status: TemplateStatus;
  flow: string[];
  values: {
    name: string;
    triggers: TemplateTrigger[];
    keywords: string;
    match_type: "contains" | "exact" | "any";
    public_replies: string;
    welcome_dm: string;
    quick_reply_label: string;
    link_text: string;
    link_button_label: string;
    reminder_text: string;
    reminder_delay_minutes: string;
    require_follower: boolean;
    non_follower_dm: string;
    non_follower_button_label: string;
    follower_confirmation_text: string;
  };
};

const editorSteps = [
  { id: "post", label: "Post/Reel", description: "Escolha onde a automação vai ficar de olho nos comentários." },
  { id: "trigger", label: "Quando acontece", description: "Defina as palavras-chave, onde vale e como comparar." },
  { id: "public", label: "Resposta pública", description: "Avise no comentário que a mensagem foi enviada." },
  { id: "dm", label: "Mensagem e link", description: "Monte a conversa privada com botão e destino." },
  { id: "reminder", label: "Lembrete", description: "Crie uma segunda mensagem, dentro do prazo de 24 horas." },
] as const;

const automationTemplates: AutomationTemplate[] = [
  {
    id: "comment-follower-gate",
    title: "Comentário + verifica seguidor",
    category: "Seguidores",
    description: "Responde o comentário, verifica se a pessoa segue o perfil e só libera o acesso para seguidores.",
    status: "ready",
    flow: ["Comentário", "Verifica seguidor", "Segue?", "Mensagem condicional"],
    values: {
      name: "Comentário com acesso para seguidores",
      triggers: ["comments"],
      keywords: "eu quero\nquero\nacesso\nliberar",
      match_type: "contains",
      public_replies: "Te mandei as instruções no direct.\nDá uma olhada no seu direct.",
      welcome_dm: "Digite Eu Quero aqui em baixo para liberar.",
      quick_reply_label: "Eu Quero",
      link_text: "Clique no botão para receber o acesso:",
      link_button_label: "Acessar agora",
      reminder_text: "Passando para lembrar do acesso que liberei para você.",
      reminder_delay_minutes: "720",
      require_follower: true,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
  {
    id: "comment-dm-button",
    title: "Comentário + mensagem com botão",
    category: "Mais usado",
    description: "Percebe a palavra-chave no comentário, responde no comentário e envia a primeira mensagem no direct com botão.",
    status: "ready",
    flow: ["Palavra-chave", "Comentário", "Mensagem", "Botão"],
    values: {
      name: "Comentário para mensagem com link",
      triggers: ["comments"],
      keywords: "quero\naula\nebook\nlink",
      match_type: "contains",
      public_replies: "Te mandei no direct.\nAcabei de enviar para você.",
      welcome_dm: "Oi! Vi seu comentário. Toque no botão abaixo para receber o link.",
      quick_reply_label: "Quero receber",
      link_text: "Aqui está o link que você pediu:",
      link_button_label: "Acessar agora",
      reminder_text: "Passando para lembrar do link que te enviei.",
      reminder_delay_minutes: "1440",
      require_follower: false,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
  {
    id: "dm-keyword",
    title: "Palavra-chave no Direct",
    category: "Direct",
    description: "Quando a pessoa escreve uma palavra-chave no direct, o fluxo responde com botão e link.",
    status: "ready",
    flow: ["Direct", "Palavra-chave", "Resposta", "Botão"],
    values: {
      name: "Palavra-chave no direct",
      triggers: ["dm"],
      keywords: "preço\nvalor\nmentoria\ncatálogo",
      match_type: "contains",
      public_replies: "",
      welcome_dm: "Oi! Vi sua mensagem. Toque no botão para continuar.",
      quick_reply_label: "Ver detalhes",
      link_text: "Aqui está a página com as informações:",
      link_button_label: "Abrir página",
      reminder_text: "Conseguiu ver as informações? Posso te ajudar por aqui.",
      reminder_delay_minutes: "720",
      require_follower: false,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
  {
    id: "story-reply",
    title: "Resposta de story",
    category: "Stories",
    description: "Transforma as respostas aos stories em uma conversa guiada no direct.",
    status: "ready",
    flow: ["Story", "Resposta", "Mensagem", "Botão"],
    values: {
      name: "Resposta de story para direct",
      triggers: ["story"],
      keywords: "quero\nsim\nmanda\nlink",
      match_type: "contains",
      public_replies: "",
      welcome_dm: "Que bom que você respondeu o story. Toque no botão para receber o material.",
      quick_reply_label: "Receber material",
      link_text: "Perfeito. Aqui está o material:",
      link_button_label: "Acessar material",
      reminder_text: "Ainda dá tempo de ver o material que te mandei.",
      reminder_delay_minutes: "1440",
      require_follower: false,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
  {
    id: "public-private-reply",
    title: "Comentário público + resposta privada",
    category: "Comentários",
    description: "Responde no post e leva a conversa para o direct, sem mandar mensagem para quem não conhece você.",
    status: "ready",
    flow: ["Comentário", "Resposta pública", "Resposta privada"],
    values: {
      name: "Comentário público e resposta privada",
      triggers: ["comments"],
      keywords: "info\ninteresse\nquero",
      match_type: "contains",
      public_replies: "Te respondi no direct.\nEnviei as informações no seu direct.",
      welcome_dm: "Oi! Passei aqui para te enviar as informações que você pediu no comentário.",
      quick_reply_label: "Continuar",
      link_text: "Aqui está o próximo passo:",
      link_button_label: "Abrir",
      reminder_text: "",
      reminder_delay_minutes: "1440",
      require_follower: false,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
  {
    id: "follow-up-direct",
    title: "Lembrete no direct",
    category: "Recuperação",
    description: "Depois do primeiro contato, agenda um lembrete dentro do prazo permitido pelo Instagram.",
    status: "ready",
    flow: ["Quando acontece", "Mensagem", "Espera", "Lembrete"],
    values: {
      name: "Lembrete para contato no direct",
      triggers: ["dm"],
      keywords: "quero\ninteressei\nmais informações",
      match_type: "contains",
      public_replies: "",
      welcome_dm: "Oi! Vou te mandar as informações agora. Se preferir, toque no botão abaixo.",
      quick_reply_label: "Receber",
      link_text: "Aqui está o link combinado:",
      link_button_label: "Ver agora",
      reminder_text: "Passando para saber se você conseguiu acessar o link.",
      reminder_delay_minutes: "360",
      require_follower: false,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
  {
    id: "outbound-webhook",
    title: "Enviar para outro sistema",
    category: "Em breve",
    description: "Enviar o contato, a etiqueta ou o aviso para outro sistema (CRM, Zapier ou n8n). Ainda precisa de uma etapa técnica.",
    status: "planned",
    flow: ["Aviso", "Filtro", "Outro sistema"],
    values: {
      name: "Enviar para outro sistema",
      triggers: ["comments"],
      keywords: "contato",
      match_type: "contains",
      public_replies: "",
      welcome_dm: "Recebi seu contato e vou te responder por aqui.",
      quick_reply_label: "Continuar",
      link_text: "Próximo passo:",
      link_button_label: "Abrir",
      reminder_text: "",
      reminder_delay_minutes: "1440",
      require_follower: false,
      non_follower_dm: "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      non_follower_button_label: "Seguir no Insta",
      follower_confirmation_text: "Digite Eu Quero aqui em baixo para liberar.",
    },
  },
];

export function DashboardClient({
  initialAutomations,
  isInstagramConnected,
  metaAppConfigured,
  showFlowList = true,
  showTemplates = true,
  initialTemplateId,
  editorTitle = "Nova automação",
  accountId = null,
}: Props) {
  const [automations, setAutomations] = useState(initialAutomations);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [mediaStatus, setMediaStatus] = useState<"idle" | "loading" | "ready" | "error">(isInstagramConnected ? "loading" : "idle");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const initialTemplateAppliedRef = useRef(false);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId || automationTemplates[0].id);

  const filteredAutomations = useMemo(() => {
    if (filter === "active") return automations.filter((automation) => automation.active);
    if (filter === "paused") return automations.filter((automation) => !automation.active);
    return automations;
  }, [automations, filter]);

  useEffect(() => {
    if (!isInstagramConnected) return;

    let active = true;

    fetch(`/api/media${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`, { credentials: "same-origin" })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? ((await response.json()) as { data?: InstagramMedia[]; error?: string })
          : { error: "Sua sessão expirou. Entre de novo para carregar os posts e Reels." };

        if (!response.ok) throw new Error(payload.error || "Não consegui carregar os posts.");
        return payload.data ?? [];
      })
      .then((items) => {
        if (!active) return;
        setMedia(items);
        setMediaStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        setMediaError(error instanceof Error ? error.message : "Não consegui carregar os posts e Reels agora. Atualize a página daqui a pouco.");
        setMediaStatus("error");
      });

    return () => {
      active = false;
    };
  }, [accountId, isInstagramConnected]);
  useEffect(() => {
    if (!initialTemplateId || initialTemplateAppliedRef.current) return;
    const template = automationTemplates.find((item) => item.id === initialTemplateId);
    if (!template || template.status === "planned") return;

    initialTemplateAppliedRef.current = true;
    window.requestAnimationFrame(() => applyTemplate(template, { silent: true, scroll: false }));
  }, [initialTemplateId]);

  function applyTemplate(template: AutomationTemplate, options?: { silent?: boolean; scroll?: boolean }) {
    if (template.status === "planned") {
      setSelectedTemplateId(template.id);
      setNotice({ tone: "error", text: "Este modelo ainda não está pronto para virar um fluxo." });
      return;
    }

    const form = formRef.current;
    if (!form) return;

    setSelectedTemplateId(template.id);
    setFormValue(form, "name", template.values.name);
    setFormValue(form, "keywords", template.values.keywords);
    setFormValue(form, "match_type", template.values.match_type);
    setFormValue(form, "public_replies", template.values.public_replies);
    setFormValue(form, "welcome_dm", template.values.welcome_dm);
    setFormValue(form, "quick_reply_label", template.values.quick_reply_label);
    setFormValue(form, "link_text", template.values.link_text);
    setFormValue(form, "link_button_label", template.values.link_button_label);
    setFormValue(form, "reminder_text", template.values.reminder_text);
    setFormValue(form, "reminder_delay_minutes", template.values.reminder_delay_minutes);
    setFormValue(form, "non_follower_dm", template.values.non_follower_dm);
    setFormValue(form, "non_follower_button_label", template.values.non_follower_button_label);
    setFormValue(form, "follower_confirmation_text", template.values.follower_confirmation_text);

    const requireFollowerField = form.elements.namedItem("require_follower");
    if (requireFollowerField instanceof HTMLInputElement) requireFollowerField.checked = template.values.require_follower;

    const activeField = form.elements.namedItem("active");
    if (activeField instanceof HTMLInputElement) activeField.checked = true;

    form.querySelectorAll<HTMLInputElement>('input[name="triggers"]').forEach((input) => {
      input.checked = template.values.triggers.includes(input.value as TemplateTrigger);
    });

    if (!template.values.triggers.includes("comments")) setSelectedPostId("");

    if (!options?.silent) setNotice({ tone: "success", text: `Modelo "${template.title}" aplicado. Complete o link e revise as mensagens.` });
    if (options?.scroll !== false) {
      window.requestAnimationFrame(() => {
        document.getElementById("step-trigger")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setNotice(null);

    const form = new FormData(formElement);
    const payload = {
      account_id: accountId,
      name: String(form.get("name") || "Nova automação"),
      active: form.get("active") === "on",
      triggers: form.getAll("triggers").map(String),
      keywords: splitLines(String(form.get("keywords") || "")),
      match_type: String(form.get("match_type") || "contains"),
      post_id: selectedPostId,
      public_replies: splitLines(String(form.get("public_replies") || "")),
      welcome_dm: String(form.get("welcome_dm") || ""),
      quick_reply_label: String(form.get("quick_reply_label") || "Quero receber"),
      link_text: String(form.get("link_text") || ""),
      link_button_label: String(form.get("link_button_label") || "Abrir link"),
      link_url: String(form.get("link_url") || ""),
      reply_delay_seconds: Number(form.get("reply_delay_seconds") || 0),
      reminder_text: String(form.get("reminder_text") || ""),
      reminder_delay_minutes: Number(form.get("reminder_delay_minutes") || 1440),
      require_follower: form.get("require_follower") === "on",
      non_follower_dm: String(form.get("non_follower_dm") || ""),
      non_follower_button_label: String(form.get("non_follower_button_label") || "Seguir no Insta"),
      follower_confirmation_text: String(form.get("follower_confirmation_text") || "Digite Eu Quero aqui em baixo para liberar."),
    };

    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { data?: Automation; error?: string } | null;

      if (!response.ok || !result?.data) {
        setNotice({ tone: "error", text: result?.error || "Não consegui salvar. Confira os campos e tente de novo." });
        return;
      }

      setAutomations((current) => [result.data as Automation, ...current]);
      setFilter("all");
      setNotice({ tone: "success", text: "Automação criada. Ela já aparece na lista." });
      setSelectedPostId("");
      formElement.reset();
    } catch {
      setNotice({ tone: "error", text: "A internet falhou ao salvar. Tente de novo em alguns segundos." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={showFlowList ? "grid gap-6 xl:grid-cols-[360px_1fr]" : "grid gap-6"} id="automacoes">
      {showTemplates ? (<section className="panel p-5 sm:p-6 xl:col-span-2" id="modelos">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Modelos de automação</p>
            <h2 className="mt-2 text-xl font-semibold">Comece por um fluxo pronto</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ms-muted)]">
              Escolha um modelo para preencher o editor. Os modelos marcados como &ldquo;Em breve&rdquo; ainda não funcionam.
            </p>
          </div>
          <span className="status-pill">{automationTemplates.filter((template) => template.status === "ready").length} prontos</span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {automationTemplates.map((template) => (
            <TemplateCard
              active={selectedTemplateId === template.id}
              key={template.id}
              onApply={() => applyTemplate(template)}
              template={template}
            />
          ))}
        </div>
      </section>) : null}

      {showFlowList ? (<aside className="grid content-start gap-6">
        <section className="panel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Biblioteca</p>
              <h2 className="mt-2 text-xl font-semibold">Fluxos</h2>
            </div>
            <span className="rounded-lg bg-[var(--ms-surface-soft)] px-3 py-2 text-sm font-semibold text-[var(--ms-muted)]">
              {automations.length} total
            </span>
          </div>

          <div className="mt-5 flex gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-1">
            <FilterButton active={filter === "all"} label="Todas" onClick={() => setFilter("all")} />
            <FilterButton active={filter === "active"} label="Ativas" onClick={() => setFilter("active")} />
            <FilterButton active={filter === "paused"} label="Pausadas" onClick={() => setFilter("paused")} />
          </div>

          <div className="mt-5 grid gap-3">
            {filteredAutomations.length ? (
              filteredAutomations.map((automation) => <AutomationCard automation={automation} key={automation.id} />)
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--ms-border-strong)] bg-[var(--ms-surface-soft)] p-8 text-center">
                <Workflow className="mx-auto text-[var(--ms-muted)]" size={28} />
                <p className="mt-3 text-sm text-[var(--ms-muted)]">Nenhuma automação neste filtro.</p>
              </div>
            )}
          </div>
        </section>

        {!metaAppConfigured ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <h2 className="font-semibold">Falta a Meta</h2>
            <p className="mt-2 text-sm leading-6">
              Configure o aplicativo no painel da Meta para liberar a conexão com o Instagram.
            </p>
          </section>
        ) : null}
      </aside>) : null}

      <section className="panel overflow-hidden p-0" id="nova">
        <div className="border-b border-[var(--ms-border)] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Editor de fluxo</p>
              <h2 className="mt-2 text-2xl font-semibold">{editorTitle}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ms-muted)]">
                Monte um fluxo com comentário, mensagem, botão e link, respeitando o prazo de 24 horas do Instagram.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              <ShieldCheck size={16} />
              Dentro das regras do Instagram
            </span>
          </div>

          <div className="mt-5 grid gap-2 lg:grid-cols-5">
            {editorSteps.map((step, index) => (
              <a
                className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 transition hover:border-[var(--ms-primary-soft)] hover:bg-[var(--ms-surface)]"
                href={`#step-${step.id}`}
                key={step.id}
              >
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ms-muted)]">Etapa {index + 1}</span>
                <strong className="mt-1 block text-sm">{step.label}</strong>
              </a>
            ))}
          </div>
        </div>

        <form className="relative" ref={formRef} onSubmit={submit} aria-busy={saving}>
          {saving ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--ms-surface)]/80 p-6 backdrop-blur-sm">
              <div className="grid max-w-xs place-items-center gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] px-5 py-4 text-center shadow-lg">
                <Loader2 className="size-6 animate-spin text-[var(--ms-primary)]" />
                <div>
                  <p className="text-sm font-bold">Criando a automação</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ms-muted)]">Salvando as regras, as mensagens e o post escolhido.</p>
                </div>
              </div>
            </div>
          ) : null}

          <fieldset className="contents" disabled={saving}>
            <EditorStep
              description="Escolha um post ou Reel específico, ou deixe o fluxo valendo para todos."
              id="post"
              number={1}
              title="Post ou Reel"
            >
              <input name="post_id" type="hidden" value={selectedPostId} readOnly />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
                <span className="text-sm text-[var(--ms-muted)]">
                  {selectedPostId ? `Post selecionado: ${selectedPostId}` : "Todos os posts e Reels"}
                </span>
                <button className="btn-secondary h-9" onClick={() => setSelectedPostId("")} type="button">
                  Usar todos
                </button>
              </div>
              <MediaPicker
                media={media}
                mediaError={mediaError}
                mediaStatus={mediaStatus}
                selectedPostId={selectedPostId}
                setSelectedPostId={setSelectedPostId}
              />
            </EditorStep>

            <EditorStep
              description="Deixe ligada, escolha onde vale e defina as palavras que ligam a automação."
              id="trigger"
              number={2}
              title="Quando acontece"
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <label className="field">
                  <span>Nome</span>
                  <input className="input" name="name" placeholder="Link da aula" required />
                </label>

                <label className="mt-6 flex h-11 items-center gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] px-3 text-sm font-semibold">
                  <input name="active" type="checkbox" defaultChecked />
                  Ativa
                </label>
              </div>

              <div className="field">
                <span>Onde vale</span>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <label className="check"><input name="triggers" type="checkbox" value="comments" defaultChecked /> Comentário</label>
                  <label className="check"><input name="triggers" type="checkbox" value="story" /> Story</label>
                  <label className="check"><input name="triggers" type="checkbox" value="dm" /> Mensagem no direct</label>
                </div>
              </div>

              <div className="grid gap-4 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input name="require_follower" type="checkbox" />
                  Exigir que siga o perfil antes de liberar
                </label>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="field">
                    <span>Mensagem para quem não segue</span>
                    <textarea className="input min-h-24" name="non_follower_dm" defaultValue="Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima." />
                  </label>
                  <label className="field">
                    <span>Texto para quem já segue</span>
                    <textarea className="input min-h-24" name="follower_confirmation_text" defaultValue="Digite Eu Quero aqui em baixo para liberar." />
                  </label>
                </div>

                <label className="field max-w-sm">
                  <span>Texto do botão de seguir</span>
                  <input className="input" name="non_follower_button_label" defaultValue="Seguir no Insta" />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                <label className="field">
                  <span>Palavras-chave</span>
                  <textarea className="input min-h-24" name="keywords" placeholder="aula&#10;ebook&#10;quero" />
                </label>

                <div className="grid gap-4">
                  <label className="field">
                    <span>Como comparar</span>
                    <select className="input" name="match_type" defaultValue="contains">
                      <option value="contains">Contém a palavra</option>
                      <option value="exact">Palavra exata</option>
                      <option value="any">Qualquer mensagem</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Esperar antes de responder (segundos)</span>
                    <input className="input" name="reply_delay_seconds" type="number" min="0" defaultValue="0" />
                  </label>
                </div>
              </div>
            </EditorStep>

            <EditorStep
              description="Uma resposta curta no comentário evita confusão e leva a conversa para o direct."
              id="public"
              number={3}
              title="Resposta pública"
            >
              <label className="field">
                <span>Respostas, uma por linha</span>
                <textarea className="input min-h-24" name="public_replies" placeholder={`Te mandei no direct ${String.fromCodePoint(0x1f4e5)}\nOlha seu direct, {{first_name}} ${String.fromCodePoint(0x1f389)}\nMe chama no direct ${String.fromCodePoint(0x1f609)}`} />
              </label>
            </EditorStep>

            <EditorStep
              description="A primeira mensagem dá o contexto, o botão confirma o interesse e a segunda mensagem envia o link."
              id="dm"
              number={4}
              title="Mensagem e link"
            >
              <FlowPreview />

              <TemplateAssist />

              <label className="field">
                <span>Mensagem de boas-vindas</span>
                <textarea className="input min-h-24" name="welcome_dm" defaultValue={`Oi {{first_name}}! Vi seu comentário. Toque no botão abaixo para receber o link ${String.fromCodePoint(0x1f381)}`} required />
              </label>

              <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                <label className="field">
                  <span>Botão de resposta rápida</span>
                  <input className="input" name="quick_reply_label" defaultValue={`Eu Quero ${String.fromCodePoint(0x2705)}`} required />
                </label>
                <label className="field">
                  <span>Texto da mensagem com o link</span>
                  <input className="input" name="link_text" defaultValue="Aqui está o link que você pediu:" required />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-[0.7fr_1.3fr]">
                <label className="field">
                  <span>Texto do botão</span>
                  <input className="input" name="link_button_label" defaultValue={`Acessar agora ${String.fromCodePoint(0x1f7e2)}`} required />
                </label>
                <label className="field">
                  <span>Endereço do link</span>
                  <input className="input" name="link_url" placeholder="https://..." type="url" required />
                </label>
              </div>
            </EditorStep>

            <EditorStep
              description="Opcional. Use para lembrar quem clicou no botão, ainda dentro do prazo permitido."
              id="reminder"
              number={5}
              title="Lembrete"
            >
              <div className="grid gap-4 sm:grid-cols-[1.4fr_0.6fr]">
                <label className="field">
                  <span>Mensagem</span>
                  <input className="input" name="reminder_text" placeholder="Passando para lembrar do link." />
                </label>
                <label className="field">
                  <span>Esperar quantos minutos</span>
                  <input className="input" name="reminder_delay_minutes" type="number" min="0" defaultValue="1440" />
                </label>
              </div>
            </EditorStep>

            <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <p className="text-sm leading-6 text-[var(--ms-muted)]">
                Ao criar, a automação entra na lista e passa a responder os comentários e mensagens que chegarem.
              </p>
              <button className="btn-primary h-11 justify-center" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                {saving ? "Salvando..." : "Criar automação"}
              </button>
            </div>
          </fieldset>

          {notice ? (
            <div className="px-5 pb-5 sm:px-6">
              <p
                className={
                  notice.tone === "success"
                    ? "inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
                    : "inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-300"
                }
                aria-live="polite"
              >
                {notice.tone === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                {notice.text}
              </p>
            </div>
          ) : null}
        </form>
      </section>
    </section>
  );
}

function TemplateCard({
  active,
  onApply,
  template,
}: {
  active: boolean;
  onApply: () => void;
  template: AutomationTemplate;
}) {
  const ready = template.status === "ready";

  return (
    <button
      className={
        active
          ? "grid gap-4 rounded-lg border border-[var(--ms-primary)] bg-[var(--ms-surface-soft)] p-4 text-left shadow-sm transition hover:border-[var(--ms-primary)]"
          : "grid gap-4 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-4 text-left transition hover:border-[var(--ms-primary-soft)] hover:bg-[var(--ms-surface-soft)]"
      }
      onClick={onApply}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={ready ? "metric-icon metric-blue shrink-0" : "metric-icon metric-amber shrink-0"}>
            {ready ? <Workflow size={18} /> : <Timer size={18} />}
          </span>
          <div className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ms-muted)]">{template.category}</span>
            <h3 className="mt-1 text-base font-bold leading-5">{template.title}</h3>
          </div>
        </div>
        <span className={ready ? "status-pill status-pill-green shrink-0" : "status-pill shrink-0"}>
          {ready ? "Pronto" : "Em breve"}
        </span>
      </div>

      <p className="text-sm leading-6 text-[var(--ms-muted)]">{template.description}</p>

      <div className="flex flex-wrap items-center gap-2">
        {template.flow.map((step, index) => (
          <span className="inline-flex items-center gap-2 text-xs font-bold text-[var(--ms-muted)]" key={`${template.id}-${step}`}>
            <span className="rounded-md border border-[var(--ms-border)] bg-[var(--ms-surface)] px-2 py-1">{step}</span>
            {index < template.flow.length - 1 ? <ChevronRight size={13} /> : null}
          </span>
        ))}
      </div>
    </button>
  );
}

function setFormValue(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = value;
  }
}
function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? "inline-flex h-9 flex-1 items-center justify-center rounded-md bg-[var(--ms-primary)] px-3 text-sm font-bold text-black shadow-sm"
          : "inline-flex h-9 flex-1 items-center justify-center rounded-md px-3 text-sm font-semibold text-[var(--ms-muted)] transition hover:bg-[var(--ms-surface)] hover:text-[var(--ms-text)]"
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EditorStep({
  children,
  description,
  id,
  number,
  title,
}: {
  children: ReactNode;
  description: string;
  id: string;
  number: number;
  title: string;
}) {
  return (
    <section className="grid gap-5 border-b border-[var(--ms-border)] p-5 sm:p-6 lg:grid-cols-[230px_1fr]" id={`step-${id}`}>
      <div>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-[var(--ms-primary)] text-sm font-black text-black">{number}</span>
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--ms-muted)]">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function FlowPreview() {
  const steps = [
    { icon: <MessageCircle size={16} />, label: "Comentário", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    { icon: <Send size={16} />, label: "Mensagem privada", tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
    { icon: <MousePointerClick size={16} />, label: "Botão", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
    { icon: <LinkIcon size={16} />, label: "Link", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  ];

  return (
    <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <div className="flex items-center gap-2" key={step.label}>
            <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${step.tone}`}>
              {step.icon}
              {step.label}
            </div>
            {index < steps.length - 1 ? <ChevronRight size={16} className="text-[var(--ms-muted)]" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}


function TemplateAssist() {
  const variables = ["{{username}}", "{{first_name}}", "{{name}}", "{{profile_url}}", "{{automation_name}}"];
  const examples = [`${String.fromCodePoint(0x1f4e5)} Olha seu direct`, `${String.fromCodePoint(0x1f381)} Acesso liberado`, `${String.fromCodePoint(0x1f7e2)} Acessar agora`, `${String.fromCodePoint(0x2705)} Eu Quero`, `${String.fromCodePoint(0x1f609)} Me chama no direct`];

  return (
    <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4 md:grid-cols-2">
      <div>
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ms-muted)]">Variáveis</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {variables.map((variable) => (
            <code className="rounded-md border border-[var(--ms-border)] bg-[var(--ms-surface)] px-2 py-1 text-xs" key={variable}>{variable}</code>
          ))}
        </div>
      </div>
      <div>
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ms-muted)]">Emojis prontos</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((example) => (
            <span className="rounded-md border border-[var(--ms-border)] bg-[var(--ms-surface)] px-2 py-1 text-xs font-semibold" key={example}>{example}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
function AutomationCard({ automation }: { automation: Automation }) {
  return (
    <article className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4 transition hover:border-[var(--ms-primary-soft)] hover:bg-[var(--ms-surface)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={automation.active ? "h-2.5 w-2.5 rounded-full bg-emerald-500" : "h-2.5 w-2.5 rounded-full bg-[var(--ms-border-strong)]"} />
            <h3 className="truncate font-semibold">{automation.name}</h3>
          </div>
          <p className="mt-2 text-sm text-[var(--ms-muted)]">
            {automation.triggers.map(triggerLabel).join(", ") || "sem aviso"} | {matchLabel(automation.match_type)} | {automation.keywords.join(", ") || "sem palavras"}
          </p>
        </div>
        <span className="rounded-md bg-[var(--ms-surface)] px-2 py-1 text-xs font-semibold text-[var(--ms-muted)]">
          {automation.active ? "Ativa" : "Pausada"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-[var(--ms-muted)]">
        <div className="flex items-center gap-2">
          <ImageIcon size={15} />
          <span className="truncate">{automation.post_id ? `Post: ${automation.post_id}` : "Todos os posts e Reels"}</span>
        </div>
        {automation.require_follower ? (
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck size={15} />
            <span className="truncate">Exige seguidor</span>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <ExternalLink size={15} />
          <span className="truncate">{automation.link_url || "Sem link"}</span>
        </div>
        {automation.reminder_text ? (
          <div className="flex items-center gap-2">
            <Timer size={15} />
            <span className="truncate">Lembrete em {automation.reminder_delay_minutes} min.</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MediaPicker({
  media,
  mediaError,
  mediaStatus,
  selectedPostId,
  setSelectedPostId,
}: {
  media: InstagramMedia[];
  mediaError: string | null;
  mediaStatus: "idle" | "loading" | "ready" | "error";
  selectedPostId: string;
  setSelectedPostId: (value: string) => void;
}) {
  if (mediaStatus === "idle") {
    return <p className="text-sm text-[var(--ms-muted)]">Conecte o Instagram para listar os posts e Reels.</p>;
  }

  if (mediaStatus === "loading") {
    return (
      <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3" aria-live="polite" aria-busy="true">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ms-muted)]">
          <Loader2 className="animate-spin" size={15} />
          Carregando posts e Reels...
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="media-card" key={index}>
              <div className="aspect-square w-full animate-pulse rounded-lg bg-[var(--ms-surface)]" />
              <div className="grid gap-2">
                <div className="h-3 w-20 animate-pulse rounded bg-[var(--ms-surface)]" />
                <div className="h-3 w-full animate-pulse rounded bg-[var(--ms-surface)]" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--ms-surface)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mediaStatus === "error") {
    return <p className="text-sm text-red-500">{mediaError}</p>;
  }

  if (!media.length) {
    return <p className="text-sm text-[var(--ms-muted)]">O Instagram ainda não mostrou posts nem Reels deste perfil.</p>;
  }

  return (
    <div className="grid max-h-[420px] gap-3 overflow-y-auto rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 md:grid-cols-2">
      {media.map((item) => {
        const imageUrl = item.thumbnail_url || item.media_url;
        const selected = selectedPostId === item.id;

        return (
          <button
            className={selected ? "media-card media-card-selected" : "media-card"}
            key={item.id}
            onClick={() => setSelectedPostId(item.id)}
            type="button"
          >
            {imageUrl ? (
              <img
                alt="Prévia do post"
                className="aspect-square w-full rounded-lg object-cover"
                src={imageUrl}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-lg bg-[var(--ms-surface)] text-sm text-[var(--ms-muted)]">
                Sem imagem
              </div>
            )}
            <div className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <span>{mediaTypeLabel(item.media_type)}</span>
                <span className="inline-flex items-center gap-1">{selected ? <Check size={13} /> : null}{selected ? "Selecionado" : "Selecionar"}</span>
              </div>
              <p className="line-clamp-3 text-left text-sm text-[var(--ms-muted)]">{item.caption || "Sem legenda"}</p>
              <code className="break-all text-left text-xs text-[var(--ms-muted)]">{item.id}</code>
              {item.permalink ? (
                <a
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ms-primary)]"
                  href={item.permalink}
                  onClick={(event) => event.stopPropagation()}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir no Instagram
                  <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function splitLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}
