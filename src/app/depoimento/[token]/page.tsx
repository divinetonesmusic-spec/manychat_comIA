import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCompradorPorToken } from "@/lib/db/funil";
import { Aviso, Cartao, PaginaPublica } from "../../p/publico";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conte como foi", robots: { index: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ enviado?: string; saiu?: string; erro?: string }> };

/** Formulário público do depoimento (link do e-mail): o que funcionou, depoimento, print e a permissão explícita. */
export default async function DepoimentoPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { enviado, saiu, erro } = await searchParams;
  const comprador = await getCompradorPorToken(token);
  if (!comprador) notFound();

  if (saiu) {
    return (
      <PaginaPublica>
        <Cartao>
          <h1 className="text-2xl font-bold">Pronto, você saiu da lista</h1>
          <p>Não vamos mandar mais e-mails para {comprador.email}.</p>
        </Cartao>
      </PaginaPublica>
    );
  }

  if (enviado) {
    return (
      <PaginaPublica>
        <Cartao>
          <h1 className="text-2xl font-bold">Muito obrigado!</h1>
          <p>Recebemos a sua resposta. Ela ajuda muito.</p>
        </Cartao>
      </PaginaPublica>
    );
  }

  return (
    <PaginaPublica>
      <Cartao>
        <h1 className="text-2xl font-bold">Como está sendo{comprador.produtoNome ? ` com ${comprador.produtoNome}` : ""}?</h1>
        <p className="text-[var(--ms-muted)]">Leva 1 minuto. Responda do seu jeito.</p>
        {erro ? <Aviso tom="erro">{erro === "print" ? "O print precisa ser uma imagem JPG, PNG ou WEBP de até 4 MB." : "Conte pelo menos o que funcionou para você."}</Aviso> : null}
        <form action={`/depoimento/${token}/enviar`} className="grid gap-4" encType="multipart/form-data" method="post">
          <label className="field"><span>O que funcionou para você?</span><textarea className="input min-h-28" maxLength={2000} name="o_que_funcionou" required /></label>
          <label className="field"><span>Quer deixar um depoimento? (opcional)</span><textarea className="input min-h-24" maxLength={2000} name="depoimento" placeholder="Antes eu..., depois de..., hoje eu..." /></label>
          <label className="field"><span>Print de um resultado (opcional)</span><input accept="image/jpeg,image/png,image/webp" className="input" name="print" type="file" /></label>
          <label className="field"><span>Como quer aparecer (opcional)</span><input className="input" maxLength={80} name="nome_exibicao" placeholder="Ex.: Ana, mãe de 2" /></label>
          <input aria-hidden="true" autoComplete="off" className="hidden" name="site" tabIndex={-1} />
          <label className="flex items-start gap-3 rounded-lg border border-[var(--ms-border)] p-4 text-sm">
            <input className="mt-1 h-5 w-5 shrink-0" name="autorizo" type="checkbox" value="on" />
            <span><strong>Autorizo usar</strong> o que escrevi (e o print, se mandei) em páginas e posts, com o nome que escolhi acima. Sem esta caixa marcada, a resposta fica só para nós.</span>
          </label>
          <button className="btn-primary min-h-11" type="submit">Enviar</button>
        </form>
      </Cartao>
    </PaginaPublica>
  );
}
