import express from "express";
import {
  confirmRouter,
  initRouter,
  onConfirmRouter,
  onInitRouter,
  onSearchRouter,
  onStatusRouter,
  onUpdateRouter,
  searchRouter,
  statusRouter,
  updateRouter,
} from "./ondc.routes.js";

export const router = express.Router();

router.use(
  "/logistics",
  searchRouter,
  initRouter,
  confirmRouter,
  updateRouter,
  statusRouter,
);
router.use(onSearchRouter, onInitRouter, onConfirmRouter, onUpdateRouter, onStatusRouter);
