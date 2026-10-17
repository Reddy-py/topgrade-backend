import { supabaseAdmin } from "../supabase.js";

export interface LocationRecord {
  id: string;
  name: string;
  type: "CENTER" | "SCHOOL";
  address: string;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_LOCATIONS: LocationRecord[] = [
  {
    id: "loc-center-main",
    name: "Main Academic Center",
    type: "CENTER",
    address: "123 Education Blvd, Suite 100, Edison, NJ 08817",
    created_at: "2026-08-01T00:00:00Z"
  },
  {
    id: "loc-center-west",
    name: "West Campus Center",
    type: "CENTER",
    address: "450 Campus Way, Princeton, NJ 08540",
    created_at: "2026-08-01T00:00:00Z"
  },
  {
    id: "loc-school-bhashyam",
    name: "Bhashyam High School",
    type: "SCHOOL",
    address: "78 School Lane, South Brunswick, NJ 08852",
    created_at: "2026-08-01T00:00:00Z"
  },
  {
    id: "loc-school-oakridge",
    name: "Oakridge International School",
    type: "SCHOOL",
    address: "102 Oakridge Ave, Plainsboro, NJ 08536",
    created_at: "2026-08-01T00:00:00Z"
  },
  {
    id: "loc-school-dps",
    name: "Delhi Public School",
    type: "SCHOOL",
    address: "200 DPS Way, North Brunswick, NJ 08902",
    created_at: "2026-08-01T00:00:00Z"
  }
];

let inMemoryLocations: LocationRecord[] = [...DEFAULT_LOCATIONS];
let lastLocationsSync = 0;
const CACHE_TTL_MS = 30_000;

export async function listLocations(forceRefresh = false): Promise<LocationRecord[]> {
  const now = Date.now();
  if (!forceRefresh && (now - lastLocationsSync < CACHE_TTL_MS) && inMemoryLocations.length > 0) {
    return inMemoryLocations;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("locations")
      .select("*")
      .order("name", { ascending: true });

    if (!error && data && data.length > 0) {
      inMemoryLocations = data;
      lastLocationsSync = now;
      return inMemoryLocations;
    }
  } catch (err: any) {
    console.warn("[LOCATIONS] Note reading locations from Supabase:", err?.message);
  }

  lastLocationsSync = now;
  return inMemoryLocations;
}

export async function getLocationById(idOrName: string): Promise<LocationRecord | null> {
  const all = await listLocations();
  const clean = (idOrName || "").trim().toLowerCase();
  return all.find(l => l.id.toLowerCase() === clean || l.name.toLowerCase() === clean) || null;
}

export async function createLocation(payload: {
  name: string;
  type: "CENTER" | "SCHOOL";
  address: string;
}): Promise<LocationRecord> {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Location name is required.");

  const type = String(payload.type || "").toUpperCase() as "CENTER" | "SCHOOL";
  if (type !== "CENTER" && type !== "SCHOOL") {
    throw new Error("Location type must be either 'CENTER' or 'SCHOOL'.");
  }

  const address = String(payload.address || "").trim();
  const id = `loc-${type.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const newRecord: LocationRecord = {
    id,
    name,
    type,
    address,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabaseAdmin
      .from("locations")
      .insert([newRecord])
      .select()
      .single();

    if (!error && data) {
      inMemoryLocations.push(data);
      inMemoryLocations.sort((a, b) => a.name.localeCompare(b.name));
      return data;
    }
  } catch (err: any) {
    console.warn("[LOCATIONS] Supabase insert note, storing in local state:", err?.message);
  }

  inMemoryLocations.push(newRecord);
  inMemoryLocations.sort((a, b) => a.name.localeCompare(b.name));
  return newRecord;
}

export async function updateLocation(
  id: string,
  payload: Partial<LocationRecord>
): Promise<LocationRecord> {
  const existing = await getLocationById(id);
  if (!existing) {
    throw new Error(`Location '${id}' not found.`);
  }

  const updates: Partial<LocationRecord> = {
    ...payload,
    updated_at: new Date().toISOString()
  };

  if (updates.type && updates.type !== "CENTER" && updates.type !== "SCHOOL") {
    throw new Error("Location type must be 'CENTER' or 'SCHOOL'.");
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("locations")
      .update(updates)
      .eq("id", existing.id)
      .select()
      .single();

    if (!error && data) {
      const idx = inMemoryLocations.findIndex(l => l.id === existing.id);
      if (idx >= 0) inMemoryLocations[idx] = data;
      return data;
    }
  } catch (err: any) {
    console.warn("[LOCATIONS] Supabase update note, updating in local state:", err?.message);
  }

  const updated: LocationRecord = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString()
  };
  const idx = inMemoryLocations.findIndex(l => l.id === existing.id);
  if (idx >= 0) inMemoryLocations[idx] = updated;
  return updated;
}

export async function deleteLocation(id: string): Promise<boolean> {
  const existing = await getLocationById(id);
  if (!existing) return false;

  try {
    await supabaseAdmin.from("locations").delete().eq("id", existing.id);
  } catch (err: any) {
    console.warn("[LOCATIONS] Supabase delete note:", err?.message);
  }

  inMemoryLocations = inMemoryLocations.filter(l => l.id !== existing.id);
  return true;
}

// Reset cache helper for tests
export function resetLocationsForTesting(): void {
  inMemoryLocations = [...DEFAULT_LOCATIONS];
  lastLocationsSync = 0;
}
