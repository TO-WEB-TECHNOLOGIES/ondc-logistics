import express from "express";
import {
  confirmRouter,
  initRouter,
  onConfirmRouter,
  onInitRouter,
  onSearchRouter,
  searchRouter,
} from "./ondc.routes.js";

export const router = express.Router();

router.use("/logistics", searchRouter, initRouter, confirmRouter);
router.use(onSearchRouter, onInitRouter, onConfirmRouter);
