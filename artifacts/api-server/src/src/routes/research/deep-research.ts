import { Router } from "express";
const router = Router();
// Gemini web/deep-research is permanently disabled. Gemini is reserved for
// text-only Boss planning and review in case-bureau.ts.
router.post("/research/deep-research", async (req, res): Promise<void> => {
  res.status(410).json({
    error: "Gemini web and Deep Research are disabled. Gemini is text-only for Boss planning and review.",
  });
});

export default router;