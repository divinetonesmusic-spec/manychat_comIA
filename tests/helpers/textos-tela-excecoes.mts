/**
 * Exceções do teste `textos-tela.test.mts`: trechos que parecem texto sem acento, mas não aparecem como
 * texto para a pessoa (ou não podem mudar). Cada uma precisa de um motivo; não adicione "só para passar".
 * `trecho` é o texto exato do texto/literal (comparado inteiro, sem espaços nas pontas).
 */
export type ExcecaoTexto = { arquivo: string; trecho: string; motivo: string };

export const excecoesTextosTela: ExcecaoTexto[] = [
  {
    arquivo: "src/app/api/webhook/route.ts",
    trecho: "cancelar inscricao",
    motivo: "Palavra que o seguidor digita para sair da lista (comparada sem acento). É dado de comparação, não texto mostrado.",
  },
  {
    arquivo: "src/lib/db/repositories.ts",
    trecho: "nao",
    motivo: "Valor 'sim' | 'nao' | 'desconhecido' usado na variável is_follower dos modelos de mensagem; valor guardado, não pode mudar.",
  },
];
