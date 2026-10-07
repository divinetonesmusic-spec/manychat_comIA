import { NextRequest } from "next/server";

export const BASE_URL = "https://uaiflow.teste";

/** Monta uma requisição como a que o Next entrega para as rotas (route handlers). */
export function request(path: string, init: { method?: string; json?: unknown; form?: Record<string, string>; headers?: Record<string, string>; cookies?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  }
  if (init.cookies) headers.cookie = Object.entries(init.cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  return new NextRequest(new URL(path, BASE_URL), { method: init.method ?? (body ? "POST" : "GET"), body, headers });
}

/** Segundo argumento das rotas com [id]: { params: Promise<{ id }> }. */
export function routeParams<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}
