import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { initOrderFulfillments, initOrders, ondcTransactions } from "../db/schema/index.js";

export interface OrderRoutePoints {
  startGps?: string;
  endGps?: string;
}

/**
 * Store (start) and home (end) GPS for an order, read from the /init snapshot
 * we sent (init_order_fulfillments, snapshot 'init') for the order's
 * transaction. Prefers the fulfillment matching `fulfillmentId`, else the
 * first. Read-only; returns {} when unknown.
 */
export async function loadOrderRoutePoints(
  database: typeof db1,
  transactionId: string,
  fulfillmentId?: string | null,
): Promise<OrderRoutePoints> {
  const rows = await database
    .select({
      fulfillmentId: initOrderFulfillments.fulfillmentId,
      startGps: initOrderFulfillments.startGps,
      endGps: initOrderFulfillments.endGps,
    })
    .from(ondcTransactions)
    .innerJoin(initOrders, eq(initOrders.transactionDbId, ondcTransactions.id))
    .innerJoin(initOrderFulfillments, eq(initOrderFulfillments.initOrderId, initOrders.id))
    .where(
      and(
        eq(ondcTransactions.transactionId, transactionId),
        eq(ondcTransactions.action, "init"),
        eq(initOrders.snapshotType, "init"),
      ),
    );
  const match =
    (fulfillmentId && rows.find((r) => r.fulfillmentId === fulfillmentId)) || rows[0];
  return {
    startGps: match?.startGps ?? undefined,
    endGps: match?.endGps ?? undefined,
  };
}
