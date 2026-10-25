import { hasAppsTable, pegarLembretes } from "@/lib/db/apps";
import { lerApp } from "@/lib/app/pacote";
import { noiteDe } from "@/lib/app/rotina";
import { emailLembrete } from "@/lib/app/web";
import { linkBase } from "@/lib/vendas/relogio";
import { emailConfig, enviarEmail, type EmailConfig, type EmailMensagem } from "@/lib/vendas/email";

/**
 * O lembrete diário do app por assinatura (0018), dentro do relógio de sempre (/api/queue/drain, a cada minuto). Só para quem ligou
 * o lembrete no app, tem a assinatura ativa e ainda não tocou hoje, depois da hora que a pessoa escolheu (no fuso dela). Um por dia:
 * o dia é marcado antes de mandar (um envio que falha não repete no mesmo dia, e dois relógios nunca mandam o mesmo). Até 10 por
 * minuto. Sem a 0018 ou sem o e-mail configurado, não faz nada. Nunca lança erro.
 */
export type AppClockResult = { enviados: number; erros: number; motivo?: "sem_tempo" | "sem_migracao" | "sem_email" | "erro" };

export async function runAppClock(options: {
  deadline: number;
  origin?: string | null;
  /** Só os testes trocam (para não falar com a internet). */
  enviar?: (config: EmailConfig, mensagem: EmailMensagem) => Promise<unknown>;
}): Promise<AppClockResult> {
  const out: AppClockResult = { enviados: 0, erros: 0 };
  try {
    if (options.deadline - Date.now() < 1500) return { ...out, motivo: "sem_tempo" };
    const config = emailConfig();
    if (!config) return { ...out, motivo: "sem_email" };
    if (!(await hasAppsTable())) return { ...out, motivo: "sem_migracao" };
    const base = linkBase(options.origin);
    const enviar = options.enviar ?? ((c: EmailConfig, m: EmailMensagem) => enviarEmail(c, m, Math.min(6000, Math.max(1000, options.deadline - Date.now() - 500))));
    for (const l of await pegarLembretes(10)) {
      if (options.deadline - Date.now() < 1000) break; // os que sobraram já ficaram marcados no dia: amanhã eles saem
      const lido = lerApp({ app: l.pacote as Record<string, unknown> });
      if (!lido.ok) continue;
      const sairUrl = `${base}/a/${l.slug}/lembrete/sair/${l.sairCodigo}`;
      const mensagem = emailLembrete(lido.app, { noite: noiteDe(l.feitos, false).noite, appUrl: `${base}/a/${l.slug}?de=lembrete`, sairUrl, enderecoPostal: config.enderecoPostal });
      try {
        await enviar(config, { para: l.email, ...mensagem, descadastrarUrl: `${sairUrl}/ok` });
        out.enviados += 1;
      } catch (error) {
        out.erros += 1;
        console.error("[app] lembrete não saiu:", error instanceof Error ? error.message : error);
      }
    }
    return out;
  } catch (error) {
    console.error("[app] relógio do lembrete:", error instanceof Error ? error.message : error);
    return { ...out, motivo: "erro" };
  }
}
