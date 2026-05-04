import { Router } from "express";
import { db } from "@workspace/db";
import { spreadsheetConfigTable } from "@workspace/db/schema";
import { researchEbayItem } from "../lib/ebay";

const router = Router();

router.post("/research", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  try {
    const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
    const result = await researchEbayItem(url, { appId: config?.ebayAppId });
    res.json({
      ...result,
      searchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    req.log.error({ err }, "research failed");
    res.status(500).json({ error: "research_failed", message: err.message });
  }
});

export default router;
