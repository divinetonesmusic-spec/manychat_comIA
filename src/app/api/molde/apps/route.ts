import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { getR2Config, PASTA_APPS_R2, r2UploadPrivado } from "@/lib/content/r2";
import { guardarPendentesApp, isMissing0018, listarAppsMolde, MIGRATION_0018, novoCodigoApp, salvarApp } from "@/lib/db/apps";
import { extensaoAudio, lerApp } from "@/lib/app/pacote";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function falta0018() {
  return NextResponse.json({ error: MIGRATION_0018, codigo: "falta_0018" }, { status: 503 });
}
function moldeDe(value: unknown) {
  const t = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(t) ? t : "";
}

/** Os endereços que a página do Molde mostra para o dono pôr na plataforma (o acesso depois da compra e o aviso de venda). */
function enderecos(base: string, slug: string) {
  return {
    app: `${base}/a/${slug}`,
    webhooks: { hotmart: `${base}/api/webhooks/hotmart`, kiwify: `${base}/api/webhooks/kiwify`, stripe: `${base}/api/webhooks/stripe` },
  };
}

/**
 * POST /api/molde/apps  { molde, accountId?, id?, slug?, app: {titulo, nomeCurto, promessa, idioma, marca, dias[30], audios[2..8],
 *   preco:{valor, moeda, porque}, checkout, convite, lembrete:{assunto, texto, hora}, aviso}, produtoRefs?, carenciaDias?,
 *   audios: [{id, contentType, size}] }
 * Cria (ou atualiza) o app por assinatura e devolve um link de envio (PUT, 1 h) para cada áudio, numa pasta PRIVADA do R2.
 * O robô do Mac manda cada áudio ({acao:'enviar', path, url, headers}); depois a página chama POST /api/molde/apps/<id>/publicar,
 * que confere os áudios e abre /a/<slug>. Sem áudios no pedido (só mudou o texto, o preço ou o produto da plataforma): o app
 * continua com os áudios de antes.
 * Resposta: { id, slug, url, ativo, versao, envios: [{id, uploadUrl, headers}], avisos, enderecos }.
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const molde = moldeDe(body.molde);
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });
  const lido = lerApp(body);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  if (lido.audios.length && !getR2Config()) return NextResponse.json({ error: "O armazenamento (Cloudflare R2) do UaiFlow ainda não foi configurado." }, { status: 503 });
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  try {
    const a = await salvarApp({ id, accountId, molde, slug: lido.slug || "app", app: lido.app, produtoRefs: lido.produtoRefs, carenciaDias: lido.carenciaDias });
    const pendentes: Record<string, { key: string; size: number; contentType: string }> = {};
    const envios = lido.audios.map((x) => {
      const key = `${PASTA_APPS_R2}/${a.id}/${x.id}-${novoCodigoApp(8)}.${extensaoAudio(x.contentType)}`;
      pendentes[x.id] = { key, size: x.size, contentType: x.contentType };
      return { id: x.id, ...r2UploadPrivado(key, x.size, x.contentType) };
    });
    if (envios.length) await guardarPendentesApp(a.id, pendentes);
    const base = getAppBaseUrl(request.url);
    return NextResponse.json({ data: { id: a.id, slug: a.slug, url: `${base}/a/${a.slug}`, ativo: a.ativo, versao: a.versao, envios, avisos: lido.avisos, enderecos: enderecos(base, a.slug) } });
  } catch (error) {
    if (isMissing0018(error)) return falta0018();
    console.error("[app] não consegui guardar:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error && /Outro projeto/.test(error.message) ? error.message : "Não consegui preparar o app agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/**
 * GET /api/molde/apps?molde=<projeto> → os apps do projeto com os números do teste: assinantes ativos, em carência, novos e
 * cancelamentos (30 dias), retenção no 2º mês, uso (tocaram hoje, uso da semana, dias seguidos, 4+ dias na semana), receita dos
 * 30 dias e receita mensal das assinaturas ativas (por moeda) e os dias desde a 1ª publicação. Nenhum e-mail sai daqui.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const molde = moldeDe(request.nextUrl.searchParams.get("molde"));
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  try {
    const base = getAppBaseUrl(request.url);
    return NextResponse.json({ data: (await listarAppsMolde(molde)).map((a) => ({ ...a, url: `${base}/a/${a.slug}` })) });
  } catch (error) {
    if (isMissing0018(error)) return falta0018();
    console.error("[app] não consegui ler:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler os apps agora. Tente de novo em instantes." }, { status: 500 });
  }
}
