import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Instruções de exclusão de dados | UaiFlow",
};

export default function DataDeletionInstructionsPage() {
  return (
    <main className="min-h-screen bg-[var(--ms-background)] px-6 py-12 text-[var(--ms-foreground)]">
      <article className="panel mx-auto max-w-3xl p-6 leading-7 sm:p-8">
        <p className="eyebrow">UaiFlow</p>
        <h1 className="mt-3 text-3xl font-semibold">Instruções de exclusão de dados</h1>
        <p className="mt-6">
          Este app armazena apenas dados operacionais de automação do Instagram, como ID do usuário, nome de usuário quando fornecido pela API, eventos recebidos, automações acionadas e status da fila de mensagens.
        </p>
        <p className="mt-4">
          Para solicitar a exclusão dos seus dados, entre em contato com o responsável pela conta do Instagram conectada e envie seu @usuario com o pedido de exclusão.
        </p>
        <p className="mt-4">
          Depois da confirmação, registros de contato, logs de eventos e itens pendentes da fila relacionados ao usuário serão removidos do banco de dados.
        </p>
      </article>
    </main>
  );
}
