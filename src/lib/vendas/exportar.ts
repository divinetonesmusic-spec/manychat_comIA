import type { Comprador, Depoimento } from "@/lib/db/funil";

/** Exportações do painel de vendas: CSV (planilha) e texto pronto para colar no Banco de provas da página. */

export function csv(linhas: Array<Array<string | number | boolean | null | undefined>>) {
  const celula = (valor: string | number | boolean | null | undefined) => {
    let texto = valor === null || valor === undefined ? "" : String(valor);
    // planilha não pode executar fórmula vinda de quem preencheu o formulário
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
    return /[",\r\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return `﻿${linhas.map((linha) => linha.map(celula).join(",")).join("\r\n")}\r\n`;
}

export function compradoresCsv(lista: Comprador[]) {
  return csv([
    ["email", "nome", "produto", "pre_venda", "aceita_novidades", "avisado_entrega_em", "pedido_depoimento_em", "saiu_da_lista_em", "criado_em"],
    ...lista.map((c) => [c.email, c.nome, c.produtoNome, c.prevenda, c.aceitaNovidades, c.avisadoEntregaEm, c.depoimentoPedidoEm, c.descadastradoEm, c.criadoEm]),
  ]);
}

export function depoimentosCsv(lista: Depoimento[]) {
  return csv([
    ["data", "produto", "nome_exibicao", "o_que_funcionou", "depoimento", "autoriza_uso", "autorizado_em", "tem_print"],
    ...lista.map((d) => [d.criadoEm, d.produtoNome, d.nomeExibicao, d.oQueFuncionou, d.depoimento, d.autorizaUso, d.autorizadoEm, Boolean(d.printKey)]),
  ]);
}

/** Um depoimento como texto para colar no Banco de provas (só os autorizados devem ir para a página). */
export function depoimentoTexto(d: Pick<Depoimento, "nomeExibicao" | "oQueFuncionou" | "depoimento" | "produtoNome" | "criadoEm">) {
  const corpo = d.depoimento || d.oQueFuncionou;
  const quem = d.nomeExibicao || "Cliente";
  const data = new Date(d.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `“${corpo.trim()}” — ${quem}${d.produtoNome ? ` (${d.produtoNome})` : ""}, ${data}`;
}

export function depoimentosTexto(lista: Depoimento[]) {
  return lista.filter((d) => d.autorizaUso).map(depoimentoTexto).join("\n\n");
}
