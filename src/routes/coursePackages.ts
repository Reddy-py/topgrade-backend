import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../supabase.js";

const router = Router();

/**
 * GET /api/course-packages
 * Lists all course packages with course details joined
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("course_packages")
      .select(`
        id,
        course_id,
        name,
        hours,
        validity_days,
        price,
        created_at,
        courses (
          id,
          name,
          course_code,
          status
        )
      `)
      .order("hours", { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, packages: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch packages" });
  }
});

/**
 * GET /api/course-packages/course/:courseId
 * Lists packages specifically for a single course
 */
router.get("/course/:courseId", async (req: Request, res: Response) => {
  const { courseId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from("course_packages")
      .select("*")
      .eq("course_id", courseId)
      .order("hours", { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, packages: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch packages" });
  }
});

/**
 * POST /api/course-packages
 * Admin adds a new package for a course
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { course_id, name, hours, validity_days, price } = req.body || {};

    if (!course_id) {
      return res.status(400).json({ success: false, message: "Course ID is required." });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "Package name is required." });
    }
    const numHours = Number(hours);
    if (isNaN(numHours) || numHours <= 0) {
      return res.status(400).json({ success: false, message: "Hours must be a positive number." });
    }

    const validityDays = validity_days ? Math.max(1, parseInt(validity_days, 10)) : null;
    const pkgPrice = price !== undefined && price !== null && price !== "" ? Math.max(0, parseFloat(price)) : null;

    const { data, error } = await supabaseAdmin
      .from("course_packages")
      .insert({
        course_id,
        name: name.trim(),
        hours: numHours,
        validity_days: validityDays,
        price: pkgPrice
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(201).json({
      success: true,
      message: `Package '${data.name}' (${data.hours} hrs) created successfully.`,
      package: data
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to create package." });
  }
});

/**
 * PUT /api/course-packages/:id
 * Updates an existing package
 */
router.put("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { name, hours, validity_days, price } = req.body || {};
    const updates: Record<string, any> = {};

    if (name !== undefined) {
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ success: false, message: "Package name cannot be empty." });
      }
      updates.name = name.trim();
    }

    if (hours !== undefined) {
      const numHours = Number(hours);
      if (isNaN(numHours) || numHours <= 0) {
        return res.status(400).json({ success: false, message: "Hours must be a positive number." });
      }
      updates.hours = numHours;
    }

    if (validity_days !== undefined) {
      updates.validity_days = validity_days ? Math.max(1, parseInt(validity_days, 10)) : null;
    }

    if (price !== undefined) {
      updates.price = price !== null && price !== "" ? Math.max(0, parseFloat(price)) : null;
    }

    const { data, error } = await supabaseAdmin
      .from("course_packages")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({
      success: true,
      message: "Package updated successfully.",
      package: data
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to update package." });
  }
});

/**
 * DELETE /api/course-packages/:id
 * Deletes a package
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { error } = await supabaseAdmin
      .from("course_packages")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, message: "Package deleted successfully." });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to delete package." });
  }
});

export default router;

