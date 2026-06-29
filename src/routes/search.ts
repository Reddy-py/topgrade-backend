import { Router } from "express";
import { supabaseAdmin } from "../index.js";

const router = Router();

// Endpoint for global multi-entity scanning
router.get("/global", async (req, res): Promise<any> => {
  const { query } = req.query;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ success: false, error: "Search term query param is required." });
  }

  // Formatting a text-match search parameter for PostgreSQL ilike matching syntax
  const matchString = `%${query}%`;

  try {
    // 1. Concurrent Database Scans across collections
    const [studentsSearch, parentsSearch, invoicesSearch] = await Promise.all([
      supabaseAdmin
        .from("students")
        .select("id, student_id_code, name, email:parent_id(email), status")
        .or(`name.ilike.${matchString},student_id_code.ilike.${matchString}`),
      
      supabaseAdmin
        .from("parents")
        .select("id, father_name, mother_name, phone, email")
        .or(`father_name.ilike.${matchString},mother_name.ilike.${matchString},phone.ilike.${matchString},email.ilike.${matchString}`),
      
      supabaseAdmin
        .from("invoices")
        .select("id, invoice_number, amount, status, student_id(name)")
        .ilike("invoice_number", matchString)
    ]);

    // 2. Structuring response payloads into unified segments
    const results = {
      students: studentsSearch.data || [],
      parents: parentsSearch.data || [],
      invoices: invoicesSearch.data || []
    };

    const totalCount = results.students.length + results.parents.length + results.invoices.length;

    res.status(200).json({
      success: true,
      totalCount,
      data: results
    });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;