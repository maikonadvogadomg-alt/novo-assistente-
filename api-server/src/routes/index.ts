import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import aiRouter from "./ai.js";
import uploadRouter from "./upload.js";
import crudRouter from "./crud.js";
import settingsRouter from "./settings.js";
import jurisprudenciaRouter from "./jurisprudencia.js";
import extraRouter from "./extra.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(uploadRouter);
router.use(crudRouter);
router.use(settingsRouter);
router.use(jurisprudenciaRouter);
router.use(extraRouter);

export default router;
