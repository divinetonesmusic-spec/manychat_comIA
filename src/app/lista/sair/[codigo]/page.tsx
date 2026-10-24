import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { getLeadPorCodigo } from "@/lib/db/funil-molde";
import { MARCA_PADRAO, varsDaMarca } from "@/lib/funil/marca";
import { TEXTOS } from "@/lib/funil/textos";
import "../../../funil.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sair da lista", robots: { index: false } };

type Props = { params: Promise<{ codigo: string }>; searchParams: Promise<{ ok?: string }> };

/**
 * Sair da Lista própria (o link que vai em todo e-mail, quando o envio existir): um botão (POST), para um robô que abre
 * links não tirar ninguém da lista sem querer. Os textos vão em português e em inglês.
 */
export default async function SairPage({ params, searchParams }: Props) {
  const { codigo } = await params;
  const { ok } = await searchParams;
  const lead = await getLeadPorCodigo(codigo).catch(() => null);
  const pt = TEXTOS["pt-BR"], en = TEXTOS["en-US"];
  const saiu = ok === "1" || Boolean(lead?.descadastrado_em);
  return (
    <main className="fu" style={varsDaMarca(MARCA_PADRAO) as CSSProperties}>
      <div className="fu-col fu-tela">
        <section className="fu-cartao">
          <h1>{pt.sairTitulo} · {en.sairTitulo}</h1>
          {!lead ? (
            <p>{pt.naoAchado} · {en.naoAchado}</p>
          ) : saiu ? (
            <p className="fu-ok" role="status">{pt.sairPronto} · {en.sairPronto}</p>
          ) : (
            <form action={`/lista/sair/${codigo}/confirmar`} className="fu-form" method="post">
              <p>{pt.sairTexto}</p>
              <p className="fu-suave">{en.sairTexto}</p>
              <button className="fu-btn" type="submit">{pt.sairBotao} · {en.sairBotao}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
