import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entitiesRouter from "./entities";
import assetsRouter from "./assets";
import relationshipsRouter from "./relationships";
import researchRouter from "./research";
import dashboardRouter from "./dashboard";
import graphRouter from "./graph";
import ingestRouter from "./ingest";
import searchRouter from "./search";
import improveRouter from "./improve";
import osintToolsRouter from "./osint-tools";
import identityRouter from "./identity";
import phaseJRouter from "./phase-j";
import extendedOsintRouter from "./extended-osint";
import atlasRouter from "./atlas";
import systemStatusRouter from "./system-status";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entitiesRouter);
router.use(assetsRouter);
router.use(relationshipsRouter);
router.use(researchRouter);
router.use(dashboardRouter);
router.use(graphRouter);
router.use(ingestRouter);
router.use(searchRouter);
router.use(improveRouter);
router.use(osintToolsRouter);
router.use(identityRouter);
router.use(phaseJRouter);
router.use(extendedOsintRouter);
router.use(atlasRouter);
router.use(systemStatusRouter);

export default router;
