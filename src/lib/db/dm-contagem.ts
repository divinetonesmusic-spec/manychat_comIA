import { query } from "@/lib/db/client";
import { contagemSequencias } from "@/lib/db/dm-sequencias";

export type ContagemDm = { ref: string; disparadas: number; botao: number; responderam?: number; clicaram?: number };

/**
 * Para cada post do Molde (o externalRef do post, o mesmo do link que conta cliques): quantas DMs a palavra do comentário
 * disparou (respostas privadas ao comentário que SAÍRAM) e quantas pessoas tocaram no botão da DM (o botão da 1ª mensagem).
 * Com a sequência de DM (0012), também quantas responderam e quantas tocaram no link do passo 3.
 * Post sem automação ainda (não publicado, sem palavra) não aparece. Nenhum dado de quem comentou.
 */
export async function contagemDms(refs: string[]): Promise<ContagemDm[]> {
  if (!refs.length) return [];
  const { rows } = await query<{ ref: string; automation_ids: string[]; desde: Date }>(
    `select external_ref as ref, array_agg(distinct automation_id) as automation_ids, min(coalesce(published_at, created_at)) as desde
     from public.content_posts
     where external_ref = any($1::text[]) and automation_id is not null
     group by external_ref`,
    [refs],
  );
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((row) => row.automation_ids))];
  // Os toques só podem vir depois de o post existir: a busca nos eventos começa aí (não varre o histórico inteiro).
  const desde = new Date(Math.min(...rows.map((row) => new Date(row.desde).getTime())));
  const [enviadas, toques, sequencias] = await Promise.all([
    query<{ automation_id: string; n: string }>(
      `select automation_id, count(*) as n from public.queue
       where automation_id = any($1::uuid[]) and send_type = 'private_reply' and status = 'sent'
       group by automation_id`,
      [ids],
    ),
    // O toque no botão chega como evento com quick_reply.payload = "automation:<id>" (uma pessoa conta uma vez).
    query<{ automation_id: string; n: string }>(
      `select substring(e.payload #>> '{event,message,quick_reply,payload}' from 12) as automation_id,
              count(distinct e.instagram_user_id) as n
       from public.events e
       where e.event_type = 'message' and e.received_at >= $2
         and e.payload #>> '{event,message,quick_reply,payload}' = any($1::text[])
       group by 1`,
      [ids.map((id) => `automation:${id}`), desde],
    ),
    contagemSequencias(ids),
  ]);
  const porId = (list: Array<{ automation_id: string; n: string }>) => new Map(list.map((row) => [row.automation_id, Number(row.n)]));
  const envio = porId(enviadas.rows);
  const toque = porId(toques.rows);
  return rows.map((row) => {
    const soma = (map: Map<string, number>) => row.automation_ids.reduce((total, id) => total + (map.get(id) ?? 0), 0);
    const item: ContagemDm = { ref: row.ref, disparadas: soma(envio), botao: soma(toque) };
    if (sequencias.size) {
      item.responderam = row.automation_ids.reduce((total, id) => total + (sequencias.get(id)?.responderam ?? 0), 0);
      item.clicaram = row.automation_ids.reduce((total, id) => total + (sequencias.get(id)?.clicaram ?? 0), 0);
    }
    return item;
  });
}
