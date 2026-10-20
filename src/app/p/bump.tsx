"use client";

import { useState } from "react";

/** Botão de compra com o order bump: marcar a caixa troca o link (entrada sozinha ou entrada + bump). */
export function BotaoComprar({ slug, rotulo, bump }: { slug: string; rotulo: string; bump: { nome: string; precoTexto: string; texto: string } | null }) {
  const [comBump, setComBump] = useState(false);
  return (
    <div className="grid gap-3">
      {bump ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
          <input checked={comBump} className="mt-1 h-5 w-5 shrink-0" onChange={(event) => setComBump(event.target.checked)} type="checkbox" />
          <span>
            <strong>Sim, adicionar {bump.nome} por {bump.precoTexto}.</strong>
            {bump.texto ? <span className="mt-1 block">{bump.texto}</span> : null}
          </span>
        </label>
      ) : null}
      <a className="btn-primary min-h-12 text-base" href={`/p/${slug}/comprar${comBump ? "?bump=1" : ""}`}>{rotulo}</a>
    </div>
  );
}
