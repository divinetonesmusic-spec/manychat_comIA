import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { getLeadPorCodigo } from "@/lib/db/funil-molde";
import { MARCA_PADRAO, varsDaMarca } from "@/lib/funil/marca";
import { TEXTOS } from "@/lib/funil/textos";
import "../../../funil.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmar o e-mail", robots: { index: false } };

type Props = { params: Promise<{ codigo: string }>; searchParams: Promise<{ ok?: string }> };

/**
 * A confirmação dupla (opcional, 0013): o link do e-mail abre esta página e o botão (POST) confirma. Um botão, e não o
 * simples abrir do link, para o robô que abre links no e-mail não confirmar por ninguém.
 */
export default async function ConfirmarPage({ params, searchParams }: Props) {
  const { codigo } = await params;
  const { ok } = await searchParams;
  const lead = await getLeadPorCodigo(codigo).catch(() => null);
  const pt = TEXTOS["pt-BR"], en = TEXTOS["en-US"];
  return (
    <main className="fu" style={varsDaMarca(MARCA_PADRAO) as CSSProperties}>
      <div className="fu-col fu-tela">
        <section className="fu-cartao">
          <h1>{pt.confirmarTitulo} · {en.confirmarTitulo}</h1>
          {!lead || lead.descadastrado_em ? (
            <p>{pt.naoAchado} · {en.naoAchado}</p>
          ) : ok === "1" ? (
            <p className="fu-ok" role="status">{pt.confirmado} · {en.confirmado}</p>
          ) : (
            <form action={`/lista/confirmar/${codigo}/ok`} className="fu-form" method="post">
              <button className="fu-btn" type="submit">{pt.confirmarBotao} · {en.confirmarBotao}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
