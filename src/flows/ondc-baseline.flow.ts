/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm -> update -> on_update
 *   -> on_status x2 -> track -> on_track -> on_status x2
 * Run: npm run flow:baseline
 */
import { post, runFlow, runSearchInitConfirm, waitFor, waitForCount } from "./flow-kit.js";

void runFlow("ondc-baseline", async () => {
  const { orderId, fulfillmentId } = await runSearchInitConfirm();

  // 7-8. UPDATE -> ON_UPDATE
  await post("7 update", "/logistics/update", {
    orderId,
    fulfillmentId,
    updateType: "LINKED_ORDER_DETAILS",
    linkedOrder: {
      retailOrderId: "O1",
      productName: "Atta",
      quantityCount: 2,
      weight: { unit: "kilogram", value: 1 },
      dimensions: { length: { unit: "centimeter", value: 1 }, breadth: { unit: "centimeter", value: 1 }, height: { unit: "centimeter", value: 1 } },
      providerName: "Aadishwar Store",
    },
  });
  await waitFor("8 on_update", "order_updated");

  // 9-10. ON_STATUS x2 (pushed by workbench)
  await waitForCount("9-10 on_status", "order_status", 2);

  // 11-12. TRACK -> ON_TRACK
  await post("11 track", "/logistics/track", { orderId });
  await waitFor("12 on_track", "order_tracking");

  // 13-14. ON_STATUS x2
  await waitForCount("13-14 on_status", "order_status", 2);
});
