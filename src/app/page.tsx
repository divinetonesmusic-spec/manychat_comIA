import Link from "next/link";
import { ArrowRight, Check, MessageCircle, PlayCircle, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[var(--ms-background)] text-[var(--ms-foreground)]">
      <header className="sticky top-0 z-40 border-b border-[var(--ms-border)] bg-[var(--ms-surface)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link className="flex items-center gap-3" href="/">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-[var(--ms-surface)] shadow-sm ring-1 ring-[var(--ms-border)]">
              <BrandMark className="size-9 object-cover" priority size={36} />
            </div>
            <span className="text-lg font-black">UaiFlow</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-[var(--ms-muted)] md:flex">
            <a className="hover:text-[var(--ms-foreground)]" href="#recursos">Recursos</a>
            <a className="hover:text-[var(--ms-foreground)]" href="#como-funciona">Como funciona</a>
            <a className="hover:text-[var(--ms-foreground)]" href="#precos">Preços</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link className="btn-secondary hidden sm:inline-flex" href="/login">Entrar</Link>
            <Link className="btn-primary" href="/cadastro">Cadastrar</Link>
          </div>
        </div>
      </header>

      <section
        className="relative min-h-[calc(100svh-64px)] overflow-hidden bg-cover bg-center px-4 py-16 sm:px-6 lg:px-8"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(16,21,34,0.92) 0%, rgba(16,21,34,0.76) 48%, rgba(16,21,34,0.30) 100%), url('/prototype-assets/stitch-15.jpg')",
        }}
      >
        <div className="mx-auto flex min-h-[calc(100svh-180px)] max-w-7xl flex-col justify-center">
          <div className="max-w-3xl text-white">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/15 px-3 py-1 text-xs font-bold text-emerald-100">
              <Sparkles size={14} />
              Automação de Instagram em português
            </div>
            <h1 className="mt-6 text-4xl font-black leading-tight tracking-normal sm:text-5xl lg:text-6xl">UaiFlow</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/78">
              Crie automações que respondem comentários, mandam mensagens no direct, entregam links e organizam seus contatos, sem ferramentas confusas e tudo em português.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link className="btn-primary h-12 px-5" href="/cadastro">
                Começar grátis
                <ArrowRight size={17} />
              </Link>
              <Link className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/10 px-5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/16" href="/login">
                <PlayCircle size={17} />
                Ver painel
              </Link>
            </div>
            <div className="mt-8 grid gap-3 text-sm text-white/78 sm:grid-cols-3">
              <TrustItem label="Dentro das regras do Instagram" />
              <TrustItem label="Supabase + Vercel" />
              <TrustItem label="Tema claro/escuro" />
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[var(--ms-background)] to-transparent" />
      </section>

      <section className="mx-auto -mt-10 grid max-w-7xl gap-4 px-4 pb-12 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div className="panel p-5">
          <p className="text-sm text-[var(--ms-muted)]">Comentários e mensagens hoje</p>
          <p className="mt-2 text-2xl font-bold">124</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-[var(--ms-muted)]">Automação ativa</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <FlowPill tone="emerald" label="Comentário" />
            <FlowPill tone="blue" label="Mensagem" />
            <FlowPill tone="violet" label="Botão" />
          </div>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-[var(--ms-muted)]">Mensagens esperando para sair</p>
          <p className="mt-2 text-2xl font-bold">nenhuma</p>
        </div>
      </section>

      <section className="border-y border-[var(--ms-border)] bg-[var(--ms-surface)]" id="recursos">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:px-8">
          <FeatureCard icon={<MessageCircle size={22} />} title="Comentários viram conversa" text="Mande uma resposta privada quando alguém comentar uma palavra-chave em um post ou Reel." />
          <FeatureCard icon={<Workflow size={22} />} title="Tudo claro" text="Organize mensagens, botões, links e lembretes em uma tela visual." />
          <FeatureCard icon={<ShieldCheck size={22} />} title="Dentro das regras" text="A automação respeita as regras do Instagram: só responde a quem falou com você e dentro do prazo permitido." />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8" id="como-funciona">
        <div className="mb-8 max-w-2xl">
          <p className="eyebrow">Como funciona</p>
          <h2 className="mt-2 text-3xl font-bold">Do comentário ao link em poucos passos</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Step number="1" title="Conecte" text="Autorize sua conta profissional do Instagram." />
          <Step number="2" title="Escolha" text="Escolha posts, Reels e palavras-chave." />
          <Step number="3" title="Responda" text="Monte a mensagem, o botão e o link de entrega." />
          <Step number="4" title="Acompanhe" text="Veja comentários, mensagens e contatos em tempo real." />
        </div>
      </section>

      <section className="bg-[var(--ms-surface)]" id="precos">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="eyebrow">Preços</p>
            <h2 className="mt-2 text-3xl font-bold">Comece simples, evolua depois</h2>
            <p className="mt-4 text-sm leading-6 text-[var(--ms-muted)]">
              A cobrança real ainda pode ser definida depois. Por enquanto, esta página prepara a estrutura básica do serviço.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <PriceCard title="Início" price="R$ 0" items={["1 conta conectada", "Automações essenciais", "Painel básico"]} />
            <PriceCard title="Pro" price="Em breve" highlighted items={["Várias contas", "Editor visual", "Caixa de entrada", "Relatórios"]} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="panel flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Pronto para montar sua primeira automação?</h2>
            <p className="mt-2 text-sm text-[var(--ms-muted)]">Entre no painel e conecte seu Instagram profissional.</p>
          </div>
          <Link className="btn-primary h-12 px-5" href="/cadastro">
            Criar conta
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--ms-border)] bg-[var(--ms-surface)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-[var(--ms-muted)] sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>© 2026 UaiFlow. Todos os direitos reservados.</p>
          <div className="flex gap-4">
            <Link href="/privacy-policy">Privacidade</Link>
            <Link href="/data-deletion">Exclusão de dados</Link>
            <Link href="/login">Entrar</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function TrustItem({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-2"><Check size={15} className="text-emerald-500" />{label}</span>;
}

function FlowPill({ tone, label }: { tone: "emerald" | "blue" | "violet" | "amber"; label: string }) {
  const colors = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };

  return <span className={`rounded-lg px-3 py-2 text-sm font-bold ${colors[tone]}`}>{label}</span>;
}

function FeatureCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className="panel p-5">
      <div className="metric-icon metric-blue">{icon}</div>
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-[var(--ms-muted)]">{text}</p>
    </article>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ms-primary)] text-sm font-black text-white dark:text-[#101522]">{number}</span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">{text}</p>
    </article>
  );
}

function PriceCard({ title, price, items, highlighted = false }: { title: string; price: string; items: string[]; highlighted?: boolean }) {
  return (
    <article className={highlighted ? "panel border-[var(--ms-primary-soft)] p-5" : "panel p-5"}>
      <p className="text-sm font-semibold text-[var(--ms-muted)]">{title}</p>
      <p className="mt-3 text-3xl font-black">{price}</p>
      <div className="mt-5 grid gap-3 text-sm text-[var(--ms-muted)]">
        {items.map((item) => <TrustItem label={item} key={item} />)}
      </div>
    </article>
  );
}
