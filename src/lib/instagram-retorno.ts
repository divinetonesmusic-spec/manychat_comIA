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
  const conhecida = FRASES_CONHECIDAS.find((regra) => regra.quando.test(motivo));
  if (conhecida) return { tom: "erro", texto: conhecida.texto };
  return { tom: "erro", texto: "Não consegui conectar o Instagram.", detalhe: motivo.slice(0, MAX_DETALHE) };
}

/**
 * Motivos que a rota de volta (e a Meta) costumam devolver, em inglês, e a frase simples de cada um.
 * A ordem importa: vale a primeira que combinar. O que não está aqui mostra a frase geral com o motivo original embaixo.
 */
const FRASES_CONHECIDAS: Array<{ quando: RegExp; texto: string }> = [
  // O Instagram devolve access_denied / user_denied quando a pessoa toca em "Cancelar". "denied" solto não vale
  // (ex.: "permission denied by server" não é a pessoa recusando).
  {
    quando: /\b(access_denied|user_denied)\b|\buser denied\b/i,
    texto: "Você não autorizou o Instagram. Nada mudou; tente de novo quando quiser.",
  },
  { quando: /^missing_code$/i, texto: "O Instagram não devolveu a autorização. Tente conectar de novo." },
  // A troca da autorização por uma conexão falhou por causa dos dados do aplicativo na Meta.
  {
    quando: /redirect[_ ]uri|client[_ ]secret|invalid client|app secret|Missing INSTAGRAM_\w+ environment variable/i,
    texto: "O Instagram recusou a conexão. Confira o ID, a chave e o endereço de retorno do aplicativo no painel da Meta (avançado) e tente de novo.",
  },
  // Autorização já usada ou vencida: a pessoa só precisa começar a conexão de novo.
  {
    quando: /authorization code|verification code|code (has )?(expired|been used|was not found)|matching code/i,
    texto: "A autorização do Instagram venceu ou já foi usada. Comece a conexão de novo.",
  },
  // A conta não é profissional (comercial ou criador de conteúdo).
  {
    quando: /professional|business or creator|creator or business|business account|creator account/i,
    texto: "Esta conta precisa ser profissional (comercial ou de criador de conteúdo). Mude isso no app do Instagram e conecte de novo.",
  },
  {
    quando: /does not have permission|insufficient|permissions? (error|missing|required)|missing permission|not authorized|\bscopes?\b|\(#(10|200|299)\)/i,
    texto: "Faltou alguma permissão. Conecte de novo e aceite tudo o que o Instagram pedir.",
  },
  // Token inválido ou a troca pela conexão longa falhou.
  {
    quando: /access token|invalid token|ig_exchange_token|exchange/i,
    texto: "Não consegui trocar a autorização por uma conexão duradoura. Tente conectar de novo.",
  },
  // Internet ou Instagram fora do ar.
  {
    quando: /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|socket hang up|network|timed? ?out/i,
    texto: "Não consegui falar com o Instagram agora. Veja a internet e tente de novo daqui a pouco.",
  },
];
