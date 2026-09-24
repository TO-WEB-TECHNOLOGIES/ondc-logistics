/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm -> update -> on_update
 *   -> on_status x2 -> track -> on_track -> on_status x2
 *   -> issue -> on_issue -> issue_status -> on_issue_status -> issue (info) -> issue (close)
 * Run: npm run flow:baseline-igm
 * Request bodies mirror postman/Ustart.postman_collection.json.
 */
import { post, runFlow, runSearchInitConfirm, waitFor, waitForCount } from "./flow-kit.js";

void runFlow("ondc-baseline-igm", async () => {
  const { orderId, fulfillmentId: confirmedFulfillmentId } = await runSearchInitConfirm();

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
    images: [{ url: "https://buyerapp.com/images/img1.png", size_type: "xs" }],
    media: [{ url: "https://buyerapp.com/media/video1.mp4" }],
    items: [{ id: "I1", quantity: 2 }],
  });
  await waitFor("16 on_issue", "issue_updated");
  const issueId: string = issue.issueId;

  // 17. ISSUE_STATUS -> ON_ISSUE_STATUS
  await post("17 issue_status", "/logistics/issue_status", { issue_id: issueId });
  await waitFor("17 on_issue_status", "issue_status_updated");

  // 18. ISSUE (update) -> ON_ISSUE
  await post("18 issue", "/logistics/issue", {
    issue_id: issueId,
    action_code: "INFO_PROVIDED",
    descriptor_long_desc: "Attached the invoice and photos as requested.",
  });
  await waitFor("18 on_issue", "issue_updated");

  // 19. ISSUE (close) -> ON_ISSUE
  await post("19 issue", "/logistics/issue", {
    issue_id: issueId,
    action_code: "CLOSED",
    descriptor_long_desc: "Issue resolved, closing the complaint.",
  });
  await waitFor("19 on_issue", "issue_updated");
});
