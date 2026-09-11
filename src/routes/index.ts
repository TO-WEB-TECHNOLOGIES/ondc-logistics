import express from "express";
import {
  confirmRouter,
  initRouter,
  onConfirmRouter,
  onInitRouter,
  onSearchRouter,
  onStatusRouter,
  onTrackRouter,
  onUpdateRouter,
  searchRouter,
  statusRouter,
  trackRouter,
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
  trackRouter,
);
router.use(
  onSearchRouter,
  onInitRouter,
  onConfirmRouter,
  onUpdateRouter,
  onStatusRouter,
  onTrackRouter,
);
