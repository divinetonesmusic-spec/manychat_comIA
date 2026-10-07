import { NextRequest, NextResponse } from "next/server";
import {
  deleteAutomation,
  updateAutomation,
  type AutomationTrigger,
  type FlowEdgeDefinition,
  type FlowNodeDefinition,
  type DelayMode,
  type MatchType,
  type ReplyMode,
} from "@/lib/db/repositories";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const automation = await updateAutomation(id, {
    name: optionalString(body.name),
    active: typeof body.active === "boolean" ? body.active : undefined,
    triggers: optionalTriggerArray(body.triggers),
    keywords: optionalArray(body.keywords),
    match_type: optionalMatchType(body.match_type),
    post_id: body.post_id === null ? null : optionalString(body.post_id),
    public_replies: optionalArray(body.public_replies),
    public_reply_mode: optionalReplyMode(body.public_reply_mode),
    welcome_dm: optionalString(body.welcome_dm),
    quick_reply_label: optionalString(body.quick_reply_label),
    quick_replies: optionalQuickReplies(body.quick_replies),
    link_text: optionalString(body.link_text),
    link_button_label: optionalString(body.link_button_label),
    link_url: optionalString(body.link_url),
    reply_delay_seconds: optionalNumber(body.reply_delay_seconds),
    reply_delay_mode: optionalDelayMode(body.reply_delay_mode),
    reply_delay_min_seconds: optionalNumber(body.reply_delay_min_seconds),
    reply_delay_max_seconds: optionalNumber(body.reply_delay_max_seconds),
    reminder_text: optionalString(body.reminder_text),
    reminder_delay_minutes: optionalNumber(body.reminder_delay_minutes),
    reminder_delay_seconds: optionalNumber(body.reminder_delay_seconds),
    reminder_delay_mode: optionalDelayMode(body.reminder_delay_mode),
    reminder_delay_min_seconds: optionalNumber(body.reminder_delay_min_seconds),
    reminder_delay_max_seconds: optionalNumber(body.reminder_delay_max_seconds),
    require_follower: typeof body.require_follower === "boolean" ? body.require_follower : undefined,
    non_follower_dm: optionalString(body.non_follower_dm),
    non_follower_button_label: optionalString(body.non_follower_button_label),
    follower_confirmation_text: optionalString(body.follower_confirmation_text),
    follower_confirmation_greetings: optionalArray(body.follower_confirmation_greetings),
    flow_nodes: optionalFlowNodes(body.flow_nodes),
    flow_edges: optionalFlowEdges(body.flow_edges),
  });

  if (!automation) return NextResponse.json({ error: "Automação não encontrada." }, { status: 404 });
  return NextResponse.json({ data: automation });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await deleteAutomation(id);
  return NextResponse.json({ ok: true });
}

function optionalArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : undefined;
}

function optionalTriggerArray(value: unknown) {
  const allowed = new Set<AutomationTrigger>(["comments", "story", "dm"]);
  const triggers = optionalArray(value)?.filter((item): item is AutomationTrigger => allowed.has(item as AutomationTrigger));
  return triggers?.length ? triggers : undefined;
}

function optionalMatchType(value: unknown): MatchType | undefined {
  return value === "contains" || value === "exact" || value === "any" ? value : undefined;
}

function optionalDelayMode(value: unknown): DelayMode | undefined {
  return value === "fixed" || value === "random" ? value : undefined;
}

function optionalReplyMode(value: unknown): ReplyMode | undefined {
  return value === "fixed" || value === "random" ? value : undefined;
}
function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function optionalQuickReplies(value: unknown) {
  if (!Array.isArray(value)) return undefined;
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
function optionalFlowNodes(value: unknown): FlowNodeDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nodes = value
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

  return nodes;
}

function optionalFlowEdges(value: unknown): FlowEdgeDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
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
