import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade | UaiFlow",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 text-zinc-950">
      <article className="mx-auto max-w-3xl leading-7">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">UaiFlow</p>
        <h1 className="mt-3 text-3xl font-semibold">Política de Privacidade</h1>
        <p className="mt-6">
          Este aplicativo automatiza respostas no Instagram a partir de interações iniciadas pelo próprio usuário, como comentários, respostas a stories e mensagens diretas.
        </p>
        <p className="mt-4">
          Armazenamos apenas dados operacionais necessários: identificador do Instagram, nome de usuário quando fornecido pela API, eventos recebidos, automações acionadas e status da fila de envio.
        </p>
        <p className="mt-4">
          Não vendemos dados, não fazemos disparo em massa para base fria e não compartilhamos informações com terceiros fora dos provedores usados para operar o sistema, como Supabase, Vercel e APIs da Meta.
        </p>
        <p className="mt-4">
          Tokens e credenciais são armazenados em variáveis de ambiente ou banco com acesso restrito ao servidor. O navegador não recebe credenciais administrativas do Supabase.
        </p>
        <p className="mt-4">
          Para solicitar remoção de dados, use a página de exclusão de dados deste mesmo aplicativo.
        </p>
      </article>
    </main>
  );
}
