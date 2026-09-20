/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm
 *   -> on_status x3 -> on_cancel (workbench-initiated) -> on_status x1
 * Run: npm run flow:rto
 */
import { runFlow, runSearchInitConfirm, waitFor, waitForCount } from "./flow-kit.js";

void runFlow("ondc-rto", async () => {
  await runSearchInitConfirm();
  await waitForCount("7-9 on_status", "order_status", 3);
  await waitFor("10 on_cancel", "order_cancelled");
  await waitFor("11 on_status", "order_status");
});
