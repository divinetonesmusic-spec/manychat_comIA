import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getQuizPublico } from "@/lib/db/funil-molde";
import { deValido, origemValida } from "@/lib/funil/quiz";
import { googleFontsUrl, varsDaMarca } from "@/lib/funil/marca";
import { QuizApp } from "./quiz-app";
import "../../funil.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const q = await getQuizPublico(slug).catch(() => null);
  return { title: q ? q.quiz.titulo : "Quiz", description: q?.quiz.subtitulo || undefined, robots: { index: false } };
}

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * O quiz público (/q/<slug>): uma pergunta por tela, barra de progresso, a tela de prova (só número real; sem número,
 * «como funciona»), «analisando», o e-mail antes do resultado e o resultado com o perfil, a projeção e a oferta.
 * ?perfil=<id> = o perfil que a pessoa escolheu na pergunta da DM; ?o=<código do post>&de=dm|bio|story = de onde veio.
 */
export default async function QuizPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = await getQuizPublico(slug);
  if (!q) notFound();
  const fontes = googleFontsUrl(q.quiz.marca);
  const perfil = um(sp.perfil);
  // o checkout fica no servidor (/q/<slug>/ir): a página só precisa saber se o perfil tem oferta
  const publico = { ...q.quiz, perfis: q.quiz.perfis.map((p) => ({ ...p, oferta: { ...p.oferta, checkout: p.oferta.checkout ? "sim" : null } })) };
  return (
    <main className="fu" lang={q.quiz.idioma} style={varsDaMarca(q.quiz.marca) as CSSProperties}>
      {fontes ? <link href={fontes} rel="stylesheet" /> : null}
      <QuizApp
        slug={q.slug}
        quiz={publico}
        perfilDm={q.quiz.perfis.some((p) => p.id === perfil) ? perfil : null}
        origem={origemValida(um(sp.o))}
        de={deValido(um(sp.de))}
      />
    </main>
  );
}
