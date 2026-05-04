import { Router, type IRouter } from "express";
import healthRouter from "./health";
import researchRouter from "./research";
import monitorsRouter from "./monitors";
import alertsRouter from "./alerts";
import spreadsheetRouter from "./spreadsheet";
import ebayOAuthRouter from "./ebayOAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(researchRouter);
router.use(monitorsRouter);
router.use(alertsRouter);
router.use(spreadsheetRouter);
router.use(ebayOAuthRouter);

export default router;
