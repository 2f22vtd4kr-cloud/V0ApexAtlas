// Thin router — mounts research sub-modules split by concern.
// Each sub-module handles its own route definitions.
import { Router, type IRouter } from "express";
import mctsRouter     from "./research/mcts";
import sessionsRouter  from "./research/sessions";
import pitchesRouter   from "./research/pitches";
import bulkRouter      from "./research/bulk";

const router: IRouter = Router();

router.use(mctsRouter);
router.use(sessionsRouter);
router.use(pitchesRouter);
router.use(bulkRouter);

export default router;
