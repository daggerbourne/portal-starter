import { createHmac, timingSafeEqual } from "node:crypto";

export type Envelope = { readonly [key: string]: unknown };

const COOKIE_PATH = "/portal-starter";

export function sealCookie(name: string, payload: Envelope & { readonly exp: number }, key: string, now: Date): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  const age = Math.max(0, Math.ceil((payload.exp - now.getTime()) / 1000));
  return `${name}=${body}.${mac}; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${age}`;
}

export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=0`;
}

export function unsealCookie(value: string | undefined, key: string, now: Date): (Envelope & { readonly exp: number }) | undefined {
  if (value === undefined) return undefined;
  const dot = value.indexOf(".");
  if (dot <= 0) return undefined;
  const body = value.slice(0, dot);
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  if (!sameText(value.slice(dot + 1), expected)) return undefined;
  const parsed = jsonRecord(Buffer.from(body, "base64url").toString("utf8"));
  if (parsed === undefined || typeof parsed.exp !== "number" || parsed.exp <= now.getTime()) return undefined;
  return { ...parsed, exp: parsed.exp };
}

export function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

export function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function jsonRecord(text: string): Envelope | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record: { [key: string]: unknown } = {};
    for (const key of Object.keys(parsed)) record[key] = Reflect.get(parsed, key);
    return record;
  } catch {
    return undefined;
  }
}

export function plainText(status: number, body: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  for (const item of cookies) headers.append("set-cookie", item);
  return new Response(body, { status, headers });
}

export function redirectTo(location: string, cookies: readonly string[]): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const item of cookies) headers.append("set-cookie", item);
  return new Response(null, { status: 302, headers });
}
