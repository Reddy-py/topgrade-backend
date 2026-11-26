import { supabaseAdmin } from "../supabase.js";

/**
 * Generates the next sequential ID code for a given table/column and prefix
 * (e.g., TGST001, TGT001, TGC001, TGSC001).
 */
export async function generateSequentialCode(
  tableName: string,
  columnName: string,
  prefix: string,
  minDigits = 3,
  inMemoryValues: string[] = []
): Promise<string> {
  const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
  let maxNum = 0;

  for (const val of inMemoryValues) {
    if (typeof val === "string") {
      const m = val.trim().match(regex);
      if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .select(columnName);

    if (!error && Array.isArray(data)) {
      for (const row of data as Record<string, any>[]) {
        const val = row?.[columnName];
        if (typeof val === "string") {
          const m = val.trim().match(regex);
          if (m && m[1]) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        }
      }
    }
  } catch {
    // Fallback to in-memory maxNum if DB is unavailable
  }

  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(minDigits, "0")}`;
}
