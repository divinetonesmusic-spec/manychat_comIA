import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getAppPublico } from "@/lib/db/apps";
import { varsDaMarca } from "@/lib/funil/marca";
import { textosApp } from "@/lib/app/textos";
import "../../../../../funil.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lembrete", robots: { index: false } };

type Props = { params: Promise<{ slug: string; codigo: string }>; searchParams: Promise<{ ok?: string }> };

/** O «não quero mais o lembrete» do e-mail: o botão (POST) desliga. O app continua igual. */
export default async function SairLembretePage({ params, searchParams }: Props) {
  const { slug, codigo } = await params;
  const { ok } = await searchParams;
  const a = await getAppPublico(slug);
  if (!a) notFound();
  const T = textosApp(a.app.idioma);
  return (
    <main className="fu" lang={a.app.idioma} style={varsDaMarca(a.app.marca) as CSSProperties}>
      <div className="fu-col fu-tela">
        <section className="fu-cartao">
          <h1>{T.sairLembreteTitulo}</h1>
          {ok === "1" ? (
            <p className="fu-ok" role="status">{T.sairLembreteOk}</p>
          ) : (
            <>
              <p>{T.sairLembreteTexto}</p>
              <form action={`/a/${a.slug}/lembrete/sair/${encodeURIComponent(codigo)}/ok`} className="fu-form" method="post">
                <button className="fu-btn" type="submit">{T.sairLembreteBotao}</button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
