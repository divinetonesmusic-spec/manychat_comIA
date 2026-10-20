import { hasFunilTables, marcarPedidoEnviado, marcarPedidoErro, pegarPedidosVencidos, soltarPedido } from "@/lib/db/funil";
import { emailConfig, emailPedidoDepoimento, EmailError, enviarEmail, type EmailConfig, type EmailMensagem } from "@/lib/vendas/email";
import { proximaTentativaDepoimento } from "@/lib/vendas/escada";

/**
 * Pedido de depoimento automático, dentro do relógio (/api/queue/drain, a cada minuto pelo pg_cron do Supabase):
 * quem deixou o e-mail na página de obrigado recebe, `depoimento_dias` depois (padrão 7), um e-mail com o link do
 * formulário. Só roda com a 0011 e com o e-mail configurado (RESEND_API_KEY + EMAIL_REMETENTE); sem e-mail, os pedidos
 * ficam esperando e o painel mostra o link de cada um para mandar à mão. Erro no envio: tenta de novo em 1 h e 6 h.
 * Nunca lança erro.
 */
export type VendasClockResult = { enviados: number; erros: number; motivo?: "sem_tempo" | "sem_migracao" | "sem_email" | "erro" };

export function linkBase(origin?: string | null) {
  return (process.env.APP_BASE_URL || origin || "").replace(/\/+$/, "");
}

export async function runVendasClock(options: {
  deadline: number;
  origin?: string | null;
  now?: Date;
  /** Só os testes trocam (para não falar com a internet). */
  enviar?: (config: EmailConfig, mensagem: EmailMensagem) => Promise<unknown>;
}): Promise<VendasClockResult> {
  const out: VendasClockResult = { enviados: 0, erros: 0 };
  try {
    if (options.deadline - Date.now() < 1500) return { ...out, motivo: "sem_tempo" };
    const config = emailConfig();
    if (!config) return { ...out, motivo: "sem_email" };
    if (!(await hasFunilTables())) return { ...out, motivo: "sem_migracao" };
    const base = linkBase(options.origin);
    const enviar = options.enviar ?? ((c: EmailConfig, m: EmailMensagem) => enviarEmail(c, m, Math.min(6000, Math.max(1000, options.deadline - Date.now() - 500))));
    const pedidos = await pegarPedidosVencidos(5, options.now ?? new Date());
    for (const pedido of pedidos) {
      if (options.deadline - Date.now() < 1200) {
        // sem tempo: os que sobraram voltam já no próximo minuto (sem gastar tentativa)
        await soltarPedido(pedido.id).catch(() => undefined);
        continue;
      }
      const formularioUrl = `${base}/depoimento/${pedido.depoimentoToken}`;
      const descadastrarUrl = `${base}/depoimento/${pedido.depoimentoToken}/sair`;
      const mensagem = emailPedidoDepoimento({ nome: pedido.nome, produtoNome: pedido.produtoNome, formularioUrl, descadastrarUrl, enderecoPostal: config.enderecoPostal });
      try {
        await enviar(config, { para: pedido.email, ...mensagem, descadastrarUrl });
        await marcarPedidoEnviado(pedido.id, "email");
        out.enviados += 1;
      } catch (error) {
        out.erros += 1;
        const motivo = error instanceof EmailError ? error.message : "Erro ao mandar o e-mail.";
        await marcarPedidoErro(pedido.id, motivo, proximaTentativaDepoimento(pedido.tentativas + 1)).catch(() => undefined);
      }
    }
    return out;
  } catch (error) {
    console.error("[vendas] relógio do pedido de depoimento:", error instanceof Error ? error.message : error);
    return { ...out, motivo: "erro" };
  }
}
