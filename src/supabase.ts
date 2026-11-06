import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ws from "ws";

dotenv.config();

// Server-side admin Supabase client.
// Node.js 20 has no native WebSocket; @supabase/realtime-js requires
// the 'ws' package to be provided as a transport for Node < 22.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: {
      // @ts-expect-error - ws is the correct type for Node.js transport
      transport: ws
    }
  }
);
