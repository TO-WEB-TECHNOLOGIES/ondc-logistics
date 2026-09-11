import express from "express";
import {
  confirmRouter,
  initRouter,
  onConfirmRouter,
  onInitRouter,
  onSearchRouter,
  onUpdateRouter,
  searchRouter,
  updateRouter,
} from "./ondc.routes.js";

export const router = express.Router();

router.use("/logistics", searchRouter, initRouter, confirmRouter, updateRouter);
router.use(onSearchRouter, onInitRouter, onConfirmRouter, onUpdateRouter);
