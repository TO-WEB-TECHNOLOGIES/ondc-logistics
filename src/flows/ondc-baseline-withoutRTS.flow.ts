/**
 * search -> on_search -> init -> on_init -> confirm -> on_confirm -> on_status x4
 * (no update / track; workbench pushes the statuses)
 * Run: npm run flow:baseline-no-rts
 */
import { runFlow, runSearchInitConfirm, waitForCount } from "./flow-kit.js";

void runFlow("ondc-baseline-withoutRTS", async () => {
  await runSearchInitConfirm();
  await waitForCount("7-10 on_status", "order_status", 4);
});
