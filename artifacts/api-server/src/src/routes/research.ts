// Thin router — mounts research sub-modules split by concern.
// Each sub-module handles its own route definitions.
import { Router, type IRouter } from "express";
import mctsRouter     from "./research/mcts";
import sessionsRouter  from "./research/sessions";
import bulkRouter      from "./research/bulk";
import deepResearchRouter from "./research/deep-research";
import casesRouter     from "./research/cases";

const router: IRouter = Router();

router.use(mctsRouter);
router.use(sessionsRouter);
router.use(bulkRouter);
router.use(deepResearchRouter);
router.use(casesRouter);

export default router;
