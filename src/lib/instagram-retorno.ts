/**
 * Volta do login do Instagram: /api/oauth/callback manda a pessoa de volta com `?instagram_connected=1`
 * ou `?instagram_error=<motivo>`. Aqui o motivo vira uma frase simples para o aviso no topo das telas.
 */

export const INVALID_STATE_MESSAGE = "O link de conexão com o Instagram venceu ou não é válido. Abra a conexão de novo pela tela Perfis.";

/** Parâmetros do endereço que o aviso usa (o "Fechar" tira só estes). */
export const PARAMETROS_RETORNO_INSTAGRAM = ["instagram_connected", "instagram_error"] as const;

export type RetornoInstagram = {
  tom: "sucesso" | "erro";
  texto: string;
  /** Motivo técnico, numa linha menor (só quando não há uma frase pronta). */
  detalhe?: string;
};

type Parametros = { get(nome: string): string | null } | null | undefined;

const MAX_DETALHE = 200;

export function mensagemRetornoInstagram(params: Parametros): RetornoInstagram | null {
  if (!params) return null;

  if (params.get("instagram_connected") === "1") {
    return { tom: "sucesso", texto: "Pronto! O Instagram foi conectado." };
  }

  const motivo = (params.get("instagram_error") ?? "").trim();
  if (!motivo) return null;

  if (motivo === INVALID_STATE_MESSAGE) return { tom: "erro", texto: INVALID_STATE_MESSAGE };
  if (/denied/i.test(motivo)) {
    return { tom: "erro", texto: "Você não autorizou o Instagram. Nada mudou; tente de novo quando quiser." };
  }
  if (motivo === "missing_code") {
    return { tom: "erro", texto: "O Instagram não devolveu a autorização. Tente conectar de novo." };
  }
  return { tom: "erro", texto: "Não consegui conectar o Instagram.", detalhe: motivo.slice(0, MAX_DETALHE) };
}
