import { NextRequest, NextResponse } from "next/server";
import { getManualMessageTarget, recordManualOutboundMessage, setContactHumanPause } from "@/lib/db/repositories";
import { sendDirectMessage } from "@/lib/instagram/client";

export const runtime = "nodejs";

const MAX_MANUAL_MESSAGE_LENGTH = 1000;
const HUMAN_PAUSE_HOURS = 24;

type Props = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Digite uma mensagem para enviar." }, { status: 400 });
  }

  if (text.length > MAX_MANUAL_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `A mensagem deve ter até ${MAX_MANUAL_MESSAGE_LENGTH} caracteres.` }, { status: 400 });
  }

  const target = await getManualMessageTarget(id);

  if (!target) {
    return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
  }

  if (!target.recipient_id || !target.sender_id || !target.access_token) {
    return NextResponse.json({ error: "Conta do Instagram sem dados suficientes para envio." }, { status: 409 });
  }

  try {
    const graphResponse = await sendDirectMessage({
      instagramUserId: target.sender_id,
      recipientId: target.recipient_id,
      accessToken: target.access_token,
      text,
    });
    const pausedUntil = new Date(Date.now() + HUMAN_PAUSE_HOURS * 60 * 60 * 1000);
    const queueId = await recordManualOutboundMessage({
      accountId: target.account_id,
      contactId: target.contact_id,
      instagramRecipientId: target.recipient_id,
      text,
      graphResponse,
    });

    await setContactHumanPause({
      contactId: target.contact_id,
      paused: true,
      until: pausedUntil,
      reason: "Resposta manual",
    });

    return NextResponse.json({ ok: true, queueId, pausedUntil: pausedUntil.toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar mensagem.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}