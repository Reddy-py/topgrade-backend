import express from "express";
import { DemoDataService } from "../services/demoDataService.js";

const router = express.Router();

// 1. SEED BULK 50+ DEMO DATASET (POST /api/demo/seed-dataset)
router.post("/seed-dataset", async (req, res) => {
  try {
    const result = await DemoDataService.seedBulkDemoDataset();
    res.status(200).json({
      success: true,
      message: result.message,
      data: result.stats
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to seed demo dataset.",
      error: err.message
    });
  }
});

// 2. 1-CLICK PURGE DEMO DATASET (POST /api/demo/purge-dataset)
router.post("/purge-dataset", (req, res) => {
  try {
    const result = DemoDataService.purgeDemoDataset();
    res.status(200).json({
      success: true,
      message: result.message,
      data: result.purgedStats
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Failed to purge demo dataset.",
      error: err.message
    });
  }
});

// 3. GET DEMO DATA STATS (GET /api/demo/stats)
router.get("/stats", (req, res) => {
  try {
    const stats = DemoDataService.getDemoDataStats();
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
