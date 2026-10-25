import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getAppPublico } from "@/lib/db/apps";
import { varsDaMarca } from "@/lib/funil/marca";
import { textosApp } from "@/lib/app/textos";
import "../../../../funil.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

type Props = { params: Promise<{ slug: string; token: string }> };

/**
 * O link do e-mail abre esta página e o botão (POST) entra: um botão, e não o simples abrir do link, para o robô que abre os links
 * do e-mail (antivírus, prévia) não gastar o link de ninguém.
 */
export default async function LinkPage({ params }: Props) {
  const { slug, token } = await params;
  const a = await getAppPublico(slug);
  if (!a) notFound();
  const T = textosApp(a.app.idioma);
  return (
    <main className="fu" lang={a.app.idioma} style={varsDaMarca(a.app.marca) as CSSProperties}>
      <div className="fu-col fu-tela">
        <section className="fu-cartao">
          <h1>{a.app.titulo}</h1>
          <p>{T.confirmarEntrada}</p>
          <form action={`/a/${a.slug}/link/${encodeURIComponent(token)}/ok`} className="fu-form" method="post">
            <button className="fu-btn" type="submit">{T.entrar}</button>
          </form>
        </section>
      </div>
    </main>
  );
}
