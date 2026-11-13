import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "../supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function testBooking() {
  console.log("Testing book_slot RPC...");
  const dummyStuId = "00000000-0000-0000-0000-000000000000";
  const dummySlotId = "00000000-0000-0000-0000-000000000000";

  const { data: bData, error: bErr } = await supabaseAdmin.rpc("book_slot", {
    p_student_id: dummyStuId,
    p_slot_id: dummySlotId
  });
  console.log("book_slot result:", { bData, error: bErr?.message });

  const { data: cData, error: cErr } = await supabaseAdmin.rpc("cancel_booking", {
    p_booking_id: dummyStuId
  });
  console.log("cancel_booking result:", { cData, error: cErr?.message });

  const { data: sData, error: sErr } = await supabaseAdmin.rpc("cancel_schedule_slot", {
    p_slot_id: dummySlotId
  });
  console.log("cancel_schedule_slot result:", { sData, error: sErr?.message });
}

testBooking();
