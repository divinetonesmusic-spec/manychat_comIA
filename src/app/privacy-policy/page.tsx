import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidade | UaiFlow",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--ms-background)] px-6 py-12 text-[var(--ms-foreground)]">
      <article className="panel mx-auto max-w-3xl p-6 leading-7 sm:p-8">
        <p className="eyebrow">UaiFlow</p>
        <h1 className="mt-3 text-3xl font-semibold">Política de privacidade</h1>
        <p className="mt-6">
          Este app automatiza respostas no Instagram apenas depois de interações iniciadas pelo usuário, como comentários, respostas a stories ou mensagens diretas.
        </p>
        <p className="mt-4">
          Armazenamos somente os dados operacionais necessários para processar automações: identificadores do Instagram, nomes de usuário quando disponíveis, eventos recebidos, automações acionadas e status da fila de mensagens.
        </p>
        <p className="mt-4">
          Não vendemos dados, não fazemos disparos em massa para bases frias e não compartilhamos informações fora dos provedores necessários para operar o serviço.
        </p>
      </article>
    </main>
  );
}
