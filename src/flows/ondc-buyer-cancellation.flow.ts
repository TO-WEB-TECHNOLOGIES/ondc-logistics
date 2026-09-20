/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm -> cancel -> on_cancel
 * Run: npm run flow:cancellation
 */
import { post, runFlow, runSearchInitConfirm, waitFor } from "./flow-kit.js";

void runFlow("ondc-buyer-cancellation", async () => {
  const { orderId, initTransactionId } = await runSearchInitConfirm();

  // 7-8. CANCEL -> ON_CANCEL
  await post("7 cancel", "/logistics/cancel", {
    orderId,
    cancellationReasonId: "051",
    context: { transaction_id: initTransactionId },
  });
  await waitFor("8 on_cancel", "order_cancelled");
});
