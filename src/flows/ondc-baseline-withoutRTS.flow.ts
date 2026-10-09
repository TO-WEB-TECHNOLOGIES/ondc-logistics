/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm -> on_status x4
 * (no update / track; workbench pushes the statuses)
 * Run: npm run flow:baseline-no-rts
 */
import { runFlow, runSearchInitConfirm, waitForCount } from "./flow-kit.js";

void runFlow("ondc-baseline-withoutRTS", async () => {
  // No /update step in this flow, so the order is ready to ship at /confirm.
  await runSearchInitConfirm({ readyToShip: "yes" });
  await waitForCount("7-10 on_status", "order_status", 4);
});
