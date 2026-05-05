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
    let appId: string | null | undefined;
    try {
      const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
      appId = config?.ebayAppId ?? undefined;
    } catch (dbErr) {
      req.log.warn({ err: dbErr }, "research: DB unavailable or schema missing; using env EBAY_APP_ID only");
      appId = undefined;
    }
    const result = await researchEbayItem(url, { appId });
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
