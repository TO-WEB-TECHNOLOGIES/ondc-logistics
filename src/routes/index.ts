import express from "express";
import {
  cancelRouter,
  confirmRouter,
  initRouter,
  onCancelRouter,
  onConfirmRouter,
  onInitRouter,
  onSearchRouter,
  onStatusRouter,
  onTrackRouter,
  onUpdateRouter,
  searchRouter,
  statusRouter,
  streamRouter,
  trackRouter,
  updateRouter,
} from "./ondc.routes.js";

export const router = express.Router();

router.use(
  "/logistics",
  streamRouter,
  searchRouter,
  initRouter,
  confirmRouter,
  updateRouter,
  statusRouter,
  trackRouter,
  cancelRouter,
);
router.use(
  onSearchRouter,
  onInitRouter,
  onConfirmRouter,
  onUpdateRouter,
  onStatusRouter,
  onTrackRouter,
  onCancelRouter,
);
