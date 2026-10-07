import { NextRequest, NextResponse } from "next/server";
import {
  createAutomation,
  listAutomations,
  type AutomationTrigger,
  type FlowEdgeDefinition,
  type FlowNodeDefinition,
  type DelayMode,
  type MatchType,
  type ReplyMode,
} from "@/lib/db/repositories";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const automations = await listAutomations(request.nextUrl.searchParams.get("accountId"));
  return NextResponse.json({ data: automations });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const automation = await createAutomation({
    account_id: optionalString(body.account_id),
    name: stringOr(body.name, "Nova automação"),
    active: body.active !== false,
    triggers: triggerArrayOr(body.triggers, ["comments"]),
    keywords: arrayOr(body.keywords, []),
    match_type: matchTypeOr(body.match_type, "contains"),
    post_id: stringOr(body.post_id, "") || null,
    public_replies: arrayOr(body.public_replies, []),
    public_reply_mode: replyModeOr(body.public_reply_mode, 'random'),
    welcome_dm: stringOr(body.welcome_dm, "Oi! Toque no botão abaixo para receber o link."),
    quick_reply_label: stringOr(body.quick_reply_label, "Quero receber"),
    quick_replies: quickRepliesOr(body.quick_replies),
    link_text: stringOr(body.link_text, "Aqui está o link que você pediu:"),
    link_button_label: stringOr(body.link_button_label, "Abrir link"),
    link_url: stringOr(body.link_url, ""),
    reply_delay_seconds: numberOr(body.reply_delay_seconds, 0),
    reply_delay_mode: delayModeOr(body.reply_delay_mode, 'fixed'),
    reply_delay_min_seconds: numberOr(body.reply_delay_min_seconds, numberOr(body.reply_delay_seconds, 0)),
    reply_delay_max_seconds: numberOr(body.reply_delay_max_seconds, numberOr(body.reply_delay_seconds, 0)),
    reminder_text: stringOr(body.reminder_text, ""),
    reminder_delay_minutes: numberOr(body.reminder_delay_minutes, 1440),
    reminder_delay_seconds: numberOr(body.reminder_delay_seconds, numberOr(body.reminder_delay_minutes, 1440) * 60),
    reminder_delay_mode: delayModeOr(body.reminder_delay_mode, 'fixed'),
    reminder_delay_min_seconds: numberOr(body.reminder_delay_min_seconds, numberOr(body.reminder_delay_seconds, numberOr(body.reminder_delay_minutes, 1440) * 60)),
    reminder_delay_max_seconds: numberOr(body.reminder_delay_max_seconds, numberOr(body.reminder_delay_seconds, numberOr(body.reminder_delay_minutes, 1440) * 60)),
    require_follower: body.require_follower === true,
    non_follower_dm: stringOr(body.non_follower_dm, "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima."),
    non_follower_button_label: stringOr(body.non_follower_button_label, "Seguir no Insta"),
    follower_confirmation_text: stringOr(body.follower_confirmation_text, "Digite Eu Quero aqui em baixo para liberar."),
    follower_confirmation_greetings: arrayOr(body.follower_confirmation_greetings, ["Oii", "Olá", "Eii", "Eae", "Opa"]),
    flow_nodes: flowNodesOr(body.flow_nodes),
    flow_edges: flowEdgesOr(body.flow_edges),
  });

  return NextResponse.json({ data: automation }, { status: 201 });
}

function arrayOr(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : fallback;
}

function triggerArrayOr(value: unknown, fallback: AutomationTrigger[]) {
  const allowed = new Set<AutomationTrigger>(["comments", "story", "dm"]);
  const triggers = arrayOr(value, []).filter((item): item is AutomationTrigger =>
    allowed.has(item as AutomationTrigger),
  );

  return triggers.length ? triggers : fallback;
}

function matchTypeOr(value: unknown, fallback: MatchType): MatchType {
  return value === "contains" || value === "exact" || value === "any" ? value : fallback;
}

function delayModeOr(value: unknown, fallback: DelayMode): DelayMode {
  return value === "fixed" || value === "random" ? value : fallback;
}

function replyModeOr(value: unknown, fallback: ReplyMode): ReplyMode {
  return value === "fixed" || value === "random" ? value : fallback;
}

function numberOr(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function quickRepliesOr(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "object" && item ? item as Record<string, unknown> : null))
    .filter(Boolean)
    .map((item) => ({
      title: String(item?.title || "").trim(),
      payload: String(item?.payload || "").trim(),
    }))
    .filter((item) => item.title && item.payload)
    .slice(0, 13);
}

function flowNodesOr(value: unknown): FlowNodeDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "object" && item ? item as Record<string, unknown> : null))
    .filter(Boolean)
    .map((item) => {
      const position = typeof item?.position === "object" && item.position ? item.position as Record<string, unknown> : {};
      const x = Number(position.x);
      const y = Number(position.y);
      return {
        id: String(item?.id || "").trim(),
        kind: String(item?.kind || "").trim(),
        position: {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
        },
        config: recordOrUndefined(item?.config),
      } satisfies FlowNodeDefinition;
    })
    .filter((item) => item.id && item.kind)
    .slice(0, 100);
}

function flowEdgesOr(value: unknown): FlowEdgeDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "object" && item ? item as Record<string, unknown> : null))
    .filter(Boolean)
    .map((item) => ({
      id: String(item?.id || `${String(item?.source || "")}-${String(item?.target || "")}`).trim(),
      source: String(item?.source || "").trim(),
      target: String(item?.target || "").trim(),
      sourceHandle: typeof item?.sourceHandle === "string" && item.sourceHandle.trim() ? item.sourceHandle.trim() : undefined,
      targetHandle: typeof item?.targetHandle === "string" && item.targetHandle.trim() ? item.targetHandle.trim() : undefined,
      label: typeof item?.label === "string" && item.label.trim() ? item.label.trim() : undefined,
    }) satisfies FlowEdgeDefinition)
    .filter((item) => item.id && item.source && item.target)
    .slice(0, 160);
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
