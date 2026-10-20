import { AppFrame, PageHeader } from "../app-frame";
import { getConfig, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, type AccountRouteSearchParams } from "@/lib/account-routing";
import { hasFunilTables, listarCompradores, listarDepoimentos, listarProdutos, metricasProdutos, MIGRATION_0011_MISSING } from "@/lib/db/funil";
import { avisosEscada } from "@/lib/vendas/escada";
import { depoimentoTexto } from "@/lib/vendas/exportar";
import { emailConfig } from "@/lib/vendas/email";
import { getR2Config, r2DownloadUrl } from "@/lib/content/r2";
import { VendasClient } from "./vendas-client";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<AccountRouteSearchParams> };

/** Vendas: produtos (página, escada, obrigado, pré-venda), valor médio por comprador, lista própria e depoimentos. */
export default async function VendasPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const config = await getConfig(activeAccountId);
  const pronto = await hasFunilTables();

  let dados: React.ComponentProps<typeof VendasClient>["inicial"] | null = null;
  if (pronto) {
    const produtos = await listarProdutos();
    const [metricas, compradores, depoimentos] = await Promise.all([metricasProdutos(produtos, 30), listarCompradores(), listarDepoimentos()]);
    const r2 = getR2Config();
    dados = {
      produtos: produtos.map((produto) => ({ ...produto, metricas: metricas.get(produto.id) ?? null, avisos: avisosEscada(produto.escada) })),
      compradores: compradores.slice(0, 500),
      depoimentos: depoimentos.map((item) => ({ ...item, texto: depoimentoTexto(item), printUrl: item.printKey && r2 ? r2DownloadUrl(item.printKey, 3600, r2) : null })),
    };
  }

  return (
    <AppFrame active="vendas" connected={Boolean(config.instagram_user_id)} username={config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Vendas"
        title="Escada de vendas"
        description="Cada produto ganha uma página de uma tela, a oferta depois da compra (upsell, downsell, assinatura), a página de obrigado com o próximo passo e o pedido de depoimento. O pagamento continua na sua plataforma (Stripe, Whop, Gumroad, Payhip ou Cakto)."
      />
      {dados ? (
        <VendasClient baseUrl={(process.env.APP_BASE_URL || "").replace(/\/+$/, "")} emailConfigurado={Boolean(emailConfig())} inicial={dados} />
      ) : (
        <section className="panel p-6 text-sm">{MIGRATION_0011_MISSING} O arquivo é supabase/migrations/0011_vendas_funil.sql.</section>
      )}
    </AppFrame>
  );
}
