import express from "express";
import { onSearchRouter, searchRouter } from "./search.routes.js";

export const router = express.Router();

router.use("/logistics", searchRouter);
router.use(onSearchRouter);
