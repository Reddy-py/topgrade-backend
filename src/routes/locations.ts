import express from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocationById
} from "../services/locationService.js";

const router = express.Router();

/**
 * GET /api/locations
 * Returns all managed centers and schools with addresses.
 */
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const forceRefresh = req.query.refresh === "true";
    const locations = await listLocations(forceRefresh);
    return res.status(200).json({
      success: true,
      count: locations.length,
      data: locations
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to fetch locations." });
  }
});

/**
 * GET /api/locations/:id
 */
router.get("/:id", async (req: Request, res: Response): Promise<any> => {
  try {
    const locId = String(req.params.id);
    const loc = await getLocationById(locId);
    if (!loc) {
      return res.status(404).json({ success: false, message: `Location '${locId}' not found.` });
    }
    return res.status(200).json({ success: true, data: loc });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || "Failed to get location." });
  }
});

/**
 * POST /api/locations
 * Admin only: Create a new managed location (CENTER or SCHOOL).
 */
router.post("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const { name, type, address } = req.body || {};
    const created = await createLocation({ name, type, address });
    return res.status(201).json({
      success: true,
      message: `Location '${created.name}' (${created.type}) created successfully.`,
      data: created
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to create location." });
  }
});

/**
 * PUT /api/locations/:id
 * Admin only: Update location name, type, or address.
 */
router.put("/:id", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const locId = String(req.params.id);
    const updated = await updateLocation(locId, req.body || {});
    return res.status(200).json({
      success: true,
      message: `Location '${updated.name}' updated successfully.`,
      data: updated
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to update location." });
  }
});

/**
 * DELETE /api/locations/:id
 * Admin only: Delete location.
 */
router.delete("/:id", async (req: Request, res: Response): Promise<any> => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
    }

    const locId = String(req.params.id);
    const deleted = await deleteLocation(locId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: `Location '${locId}' not found.` });
    }

    return res.status(200).json({
      success: true,
      message: "Location removed successfully."
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err?.message || "Failed to delete location." });
  }
});

export default router;
