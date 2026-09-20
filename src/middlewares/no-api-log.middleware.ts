import type { Request, Response, NextFunction } from "express";
import { pushTransactionLogFromRequest } from "../services/network-observability.service.js";

/**
 * Fire-and-forget NO API log push for every inbound ONDC webhook (BPP→BAP).
 * Ported from ondc-api's src/middleware/no-api-log.middleware.ts.
 */
export function noApiLogMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  // pushTransactionLogFromRequest is async but we don't await — fire and forget
  pushTransactionLogFromRequest(req.body as Record<string, unknown>);
  next();
}
