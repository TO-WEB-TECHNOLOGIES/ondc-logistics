/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm -> update -> on_update
 *   -> on_status x2 -> track -> on_track -> on_status x2
 *   -> issue -> on_issue -> on_issue_status (pushed) -> issue (close, no callback awaited)
 * IGM payloads follow IGM MVP v1.0.0 Scenario 1 (item complaint, ITM04).
 * Run: npm run flow:baseline-igm
 * Request bodies mirror postman/Ustart.postman_collection.json.
 */
import { post, PUSH_WAIT_MS, runFlow, runSearchInitConfirm, waitFor, waitForCount } from "./flow-kit.js";

void runFlow("ondc-baseline-igm", async () => {
  const { orderId, fulfillmentId: confirmedFulfillmentId, itemId } = await runSearchInitConfirm();

  // 7-8. UPDATE -> ON_UPDATE
  await post("7 update", "/logistics/update", {
    orderId,
    fulfillmentId: confirmedFulfillmentId,
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

  // 15-16. ISSUE -> ON_ISSUE
  const issue = await post("15 issue", "/logistics/issue", {
    order_id: orderId,
    category_code: "ITEM_QUALITY",
    descriptor_long_desc: "The biryani was cold and salty.",
    descriptor_additional_desc_url: "https://buyerapp.com/additional-details/desc.txt",
    images: ["https://buyerapp.com/images/img1.png"],
    items: [{ id: itemId, quantity: 1 }],
  });
  await waitFor("16 on_issue", "issue_updated");
  const issueId: string = issue.issueId;

  // 17. ON_ISSUE_STATUS (pushed by workbench, no /issue_status of ours)
  await waitFor("17 on_issue_status", "issue_status_updated", { timeoutMs: PUSH_WAIT_MS });

  // 18. ISSUE (close, Scenario 1 step 5a) — flow ends without waiting for the on_issue callback
  await post("18 issue", "/logistics/issue", {
    issue_id: issueId,
    action_code: "CLOSE",
    rating: "THUMBS-UP",
  });
});
