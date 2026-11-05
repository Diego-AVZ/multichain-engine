import { timingSafeEqual } from "node:crypto";

const BEARER = "Bearer ";

export function bearerAuthorized(authorization: string | null, expected: string | undefined): boolean {
  if (!expected || !authorization?.startsWith(BEARER)) return false;
  const presented = Buffer.from(authorization.slice(BEARER.length));
  const actual = Buffer.from(expected);
  if (presented.length === 0 || presented.length !== actual.length) return false;
  return timingSafeEqual(presented, actual);
}

export function corsHeaders(requestOrigin: string | null, allowedOrigin: string | undefined): Headers {
  const headers = new Headers();
  if (!allowedOrigin || allowedOrigin === "*" || requestOrigin !== allowedOrigin) return headers;
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "POST");
  headers.set("Vary", "Origin");
  return headers;
}

export function secretValues(): string[] {
  const values: string[] = [];
  const key = process.env.SYNCER_PRIVATE_KEY;
  const token = process.env.SYNC_API_TOKEN;
  if (key) values.push(key);
  if (token) values.push(token);
  for (const [name, value] of Object.entries(process.env)) {
    if (value && name.startsWith("RPC_")) values.push(value);
  }
  return values;
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 8))];
  unique.sort((left, right) => right.length - left.length);
  for (const secret of unique) out = out.split(secret).join("[redacted]");
  out = out.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted]");
  return out
    .split(/\r?\n/)
    .filter((line) => !/^\s+at /.test(line))
    .join("\n")
    .trim();
}
