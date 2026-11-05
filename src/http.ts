export function corsHeaders(): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "POST");
  return headers;
}

export function secretValues(): string[] {
  const values: string[] = [];
  const key = process.env.SYNCER_PRIVATE_KEY;
  if (key) values.push(key);
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
