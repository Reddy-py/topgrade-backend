import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  getInstituteSettings,
  updateInstituteSettings,
  formatPostalAddress,
  type InstituteSettings,
} from "../services/instituteSettingsService.js";

const router = Router();

// 50 US States + DC and territories
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico", VI: "Virgin Islands", GU: "Guam"
};

/**
 * Validates US State (2-letter abbreviation or recognized full name)
 */
export function validateUsState(input: string): { valid: boolean; normalized?: string; error?: string } {
  if (!input || !input.trim()) return { valid: false, error: "US State is required." };
  const trimmed = input.trim().toUpperCase();
  if (US_STATES[trimmed]) {
    return { valid: true, normalized: trimmed };
  }
  // Try matching full name
  const match = Object.entries(US_STATES).find(
    ([code, name]) => name.toLowerCase() === input.trim().toLowerCase()
  );
  if (match) {
    return { valid: true, normalized: match[0] };
  }
  return { valid: false, error: "Invalid US State. Please provide a valid 2-letter state code (e.g., NJ, NY, TX)." };
}

/**
 * Validates US ZIP Code (5 digits or ZIP+4)
 */
export function validateUsZip(zip: string): { valid: boolean; normalized?: string; error?: string } {
  if (!zip || !zip.trim()) return { valid: false, error: "ZIP code is required." };
  const clean = zip.trim();
  const zipRegex = /^\d{5}(-\d{4})?$/;
  if (!zipRegex.test(clean)) {
    return { valid: false, error: "Invalid US ZIP code format. Use 5-digit ZIP (e.g. 08817) or ZIP+4 (e.g. 08817-1234)." };
  }
  return { valid: true, normalized: clean };
}

/**
 * Validates and normalizes US Phone number (+1 format)
 */
export function validateUsPhone(phone: string): { valid: boolean; normalized?: string; error?: string } {
  if (!phone || !phone.trim()) return { valid: false, error: "Phone number is required." };
  // Extract all digits
  const digits = phone.replace(/\D/g, "");
  let tenDigits = "";
  if (digits.length === 10) {
    tenDigits = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    tenDigits = digits.slice(1);
  } else {
    return { valid: false, error: "Invalid US phone number. Must be a 10-digit US number (e.g. (555) 019-9999 or +1 555-019-9999)." };
  }

  // US area codes cannot start with 0 or 1
  if (tenDigits[0] === "0" || tenDigits[0] === "1") {
    return { valid: false, error: "Invalid US area code. Area code cannot start with 0 or 1." };
  }

  const formatted = `+1 (${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
  return { valid: true, normalized: formatted };
}

/**
 * Validates IANA Time Zone string
 */
export function validateIanaTimezone(tz: string): { valid: boolean; normalized?: string; error?: string } {
  if (!tz || !tz.trim()) return { valid: false, error: "Timezone is required." };
  const clean = tz.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: clean });
    return { valid: true, normalized: clean };
  } catch {
    return { valid: false, error: `Invalid IANA timezone "${clean}". Example: America/New_York, America/Chicago, America/Los_Angeles.` };
  }
}

/**
 * GET /api/settings/public-contact
 * Public endpoint returning ONLY business contact fields (phone, support_email, address, institute_name)
 * for public pages, with zero internal or sensitive settings.
 */
router.get("/public-contact", async (_req: Request, res: Response): Promise<any> => {
  try {
    const s = await getInstituteSettings();
    const address = formatPostalAddress(s);
    return res.json({
      success: true,
      contact: {
        institute_name: s.institute_name?.trim() || "Top Grade Learning",
        phone: s.phone?.trim() || null,
        support_email: s.support_email?.trim() || null,
        address: address || null,
        address_line1: s.address_line1?.trim() || null,
        city: s.city?.trim() || null,
        state: s.state?.trim() || null,
        zip: s.zip?.trim() || null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Failed to load public contact info." });
  }
});

/**
 * GET /api/settings/institute
 * Admin gets full settings; other authenticated logins get only the institute name.
 */
router.get("/institute", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const settings = await getInstituteSettings();

    if (authReq.user?.role === "ADMIN") {
      return res.json({
        success: true,
        settings,
      });
    }

    // Non-admin logins receive institute name and catalog classifications
    return res.json({
      success: true,
      settings: {
        institute_name: settings.institute_name,
        currency: settings.currency,
        timezone: settings.timezone,
        program_types: settings.program_types || [],
        course_categories: settings.course_categories || [],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to load institute settings." });
  }
});

/**
 * PUT /api/settings/institute
 * Admin-only: validates US state, ZIP, phone, and timezone, updates database,
 * and immediately refreshes the in-memory 60-second cache.
 */
router.put("/institute", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const body = req.body || {};
    const updates: Partial<InstituteSettings> = {};

    // 1. Institute Name
    if (body.institute_name !== undefined) {
      const name = String(body.institute_name).trim();
      if (!name) return res.status(400).json({ success: false, message: "Institute name cannot be empty." });
      updates.institute_name = name;
    }

    // 2. Timezone
    if (body.timezone !== undefined) {
      const tzCheck = validateIanaTimezone(String(body.timezone));
      if (!tzCheck.valid) return res.status(400).json({ success: false, message: tzCheck.error });
      updates.timezone = tzCheck.normalized!;
    }

    // 3. Address Line 1 & 2
    if (body.address_line1 !== undefined) {
      updates.address_line1 = String(body.address_line1).trim();
    }
    if (body.address_line2 !== undefined) {
      updates.address_line2 = String(body.address_line2).trim();
    }

    // 4. City
    if (body.city !== undefined) {
      updates.city = String(body.city).trim();
    }

    // 5. State (Validate US state if provided)
    if (body.state !== undefined) {
      const stateStr = String(body.state).trim();
      if (stateStr) {
        const stateCheck = validateUsState(stateStr);
        if (!stateCheck.valid) return res.status(400).json({ success: false, message: stateCheck.error });
        updates.state = stateCheck.normalized!;
      } else {
        updates.state = "";
      }
    }

    // 6. ZIP (Validate US ZIP if provided)
    if (body.zip !== undefined) {
      const zipStr = String(body.zip).trim();
      if (zipStr) {
        const zipCheck = validateUsZip(zipStr);
        if (!zipCheck.valid) return res.status(400).json({ success: false, message: zipCheck.error });
        updates.zip = zipCheck.normalized!;
      } else {
        updates.zip = "";
      }
    }

    // 7. Phone (Validate US phone if provided)
    if (body.phone !== undefined) {
      const phoneStr = String(body.phone).trim();
      if (phoneStr) {
        const phoneCheck = validateUsPhone(phoneStr);
        if (!phoneCheck.valid) return res.status(400).json({ success: false, message: phoneCheck.error });
        updates.phone = phoneCheck.normalized!;
      } else {
        updates.phone = "";
      }
    }

    // 8. Support Email
    if (body.support_email !== undefined) {
      updates.support_email = String(body.support_email).trim().toLowerCase();
    }

    // 9. Currency (Strictly USD)
    if (body.currency !== undefined) {
      const cur = String(body.currency).trim().toLowerCase();
      if (cur !== "usd") {
        return res.status(400).json({ success: false, message: "Currency must be USD." });
      }
      updates.currency = "usd";
    }

    // 10. Logo URL
    if (body.logo_url !== undefined) {
      updates.logo_url = String(body.logo_url).trim();
    }

    // 11. Program Types
    if (body.program_types !== undefined) {
      if (!Array.isArray(body.program_types)) {
        return res.status(400).json({ success: false, message: "Program types must be an array of strings." });
      }
      const cleanTypes: string[] = Array.from(
        new Set(body.program_types.map((p: any) => String(p).trim().toUpperCase()).filter(Boolean))
      );
      if (cleanTypes.length === 0) {
        return res.status(400).json({ success: false, message: "At least one program type is required." });
      }
      updates.program_types = cleanTypes;
    }

    // 12. Course Categories
    if (body.course_categories !== undefined) {
      if (!Array.isArray(body.course_categories)) {
        return res.status(400).json({ success: false, message: "Course categories must be an array of strings." });
      }
      const cleanCats: string[] = Array.from(
        new Set(body.course_categories.map((c: any) => String(c).trim()).filter(Boolean))
      );
      if (cleanCats.length === 0) {
        return res.status(400).json({ success: false, message: "At least one course category is required." });
      }
      updates.course_categories = cleanCats;
    }

    const updated = await updateInstituteSettings(updates);
    return res.json({
      success: true,
      message: "Institute settings updated successfully.",
      settings: updated,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to update institute settings." });
  }
});

/**
 * GET /api/settings/course-categories
 * Returns the current list of course categories (accessible to all authenticated users).
 */
router.get("/course-categories", async (_req: Request, res: Response): Promise<any> => {
  try {
    const settings = await getInstituteSettings();
    return res.json({
      success: true,
      categories: settings.course_categories || [],
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to load categories." });
  }
});

/**
 * POST /api/settings/course-categories
 * Admin-only: adds a new course category or appends new categories.
 */
router.post("/course-categories", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const { category, categories } = req.body || {};
    const settings = await getInstituteSettings();
    const existing = new Set(settings.course_categories || []);

    if (category && String(category).trim()) {
      existing.add(String(category).trim());
    }
    if (Array.isArray(categories)) {
      for (const c of categories) {
        if (c && String(c).trim()) existing.add(String(c).trim());
      }
    }

    const updatedList = Array.from(existing);
    const updated = await updateInstituteSettings({ course_categories: updatedList });

    return res.json({
      success: true,
      message: "Course categories updated successfully.",
      categories: updated.course_categories,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to update categories." });
  }
});

/**
 * GET /api/settings/program-types
 * Returns current list of program types (e.g. TUTORING, AFTERSCHOOL, etc.)
 */
router.get("/program-types", async (_req: Request, res: Response): Promise<any> => {
  try {
    const settings = await getInstituteSettings();
    const list = settings.program_types || ["TUTORING", "AFTERSCHOOL"];
    return res.json({
      success: true,
      program_types: list,
      programTypes: list,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to load program types." });
  }
});

/**
 * POST /api/settings/program-types
 * Admin-only: adds a new program type or appends program types.
 */
router.post("/program-types", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const { programType, programTypes, program_type, program_types } = req.body || {};
    const single = programType || program_type;
    const multi = programTypes || program_types;
    const settings = await getInstituteSettings();
    const existing = new Set((settings.program_types || ["TUTORING", "AFTERSCHOOL"]).map(p => p.toUpperCase()));

    if (single && String(single).trim()) {
      existing.add(String(single).trim().toUpperCase());
    }
    if (Array.isArray(multi)) {
      for (const p of multi) {
        if (p && String(p).trim()) existing.add(String(p).trim().toUpperCase());
      }
    }

    const updatedList = Array.from(existing);
    const updated = await updateInstituteSettings({ program_types: updatedList });

    return res.json({
      success: true,
      message: "Program types updated successfully.",
      program_types: updated.program_types,
      programTypes: updated.program_types,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to update program types." });
  }
});

export default router;
