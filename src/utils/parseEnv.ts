/**
 * Environment Variable Parser & Hardener
 * Rule: Treat an empty environment variable (e.g. KEY="") as unset everywhere.
 */

export function parseEnv(key: string, defaultValue?: string): string | undefined {
  const val = process.env[key];
  if (val === undefined || val === null) {
    return defaultValue;
  }
  const trimmed = val.trim();
  if (trimmed === "") {
    return defaultValue;
  }
  return trimmed;
}

export function parseEnvNumber(key: string, defaultValue: number): number {
  const raw = parseEnv(key);
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

export function parseEnvBoolean(key: string, defaultValue: boolean): boolean {
  const raw = parseEnv(key);
  if (raw === undefined) {
    return defaultValue;
  }
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") {
    return true;
  }
  if (lower === "false" || lower === "0" || lower === "no") {
    return false;
  }
  return defaultValue;
}
