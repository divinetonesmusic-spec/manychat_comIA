import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { cleanProjeto, listBackups, parseBody, saveBackup } from "@/lib/molde/backup";
import { backupFailure, readBytes } from "@/lib/molde/backup-http";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/molde/backup?projeto=birdie-lanier — as cópias guardadas (mais novas primeiro), com data e tamanho.
 * Sem projeto: as de todos os projetos (e as de «tudo»).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  try {
    const projeto = request.nextUrl.searchParams.get("projeto");
    const data = await listBackups(projeto ? cleanProjeto(projeto) : null);
    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    return backupFailure(error, "não consegui listar as cópias");
  }
}

/**
 * PUT (ou POST) /api/molde/backup?projeto=birdie-lanier — guarda uma cópia. Corpo: o JSON da cópia, o gzip dele, ou
 * { "projeto"?, "gz64": "<gzip em base64>" } (o jeito da ponte do robô). Até 5,5 MB por pedido; maior, use /partes.
 */
export async function PUT(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  try {
    const bytes = await readBytes(request);
    const { projeto, gz, removidos } = parseBody(bytes, request.nextUrl.searchParams.get("projeto"));
    const { item, apagadas } = await saveBackup(projeto, gz);
    return NextResponse.json({ data: item, apagadas, removidos }, { status: 201 });
  } catch (error) {
    return backupFailure(error, "não consegui guardar a cópia");
  }
}

/** Igual ao PUT: a ponte do robô (uaiflow {op:'chamar'}) só tem GET, POST, PATCH e DELETE. */
export const POST = PUT;
