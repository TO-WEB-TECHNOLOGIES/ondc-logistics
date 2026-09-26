import { and, asc, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { ondcTransactions } from "../db/schema/index.js";

/** Context fields that must stay constant for every call on one transaction. */
export interface StoredTransactionContext {
  domain: string | null;
  country: string | null;
  city: string | null;
  coreVersion: string | null;
}

export type TransactionContextLoader = (
  transactionId: string,
) => Promise<StoredTransactionContext | undefined>;

/**
 * Loads the context the transaction was opened with (its /search row), so
 * /init and every post-order call send the same city/domain/core_version the
 * LSP saw on /search instead of the ONDC_CITY env default.
 */
export const loadTransactionContext: TransactionContextLoader = async (
  transactionId,
) => {
  const [row] = await db1
    .select({
      domain: ondcTransactions.domain,
      country: ondcTransactions.country,
      city: ondcTransactions.city,
      coreVersion: ondcTransactions.coreVersion,
    })
    .from(ondcTransactions)
    .where(
      and(
        eq(ondcTransactions.transactionId, transactionId),
        eq(ondcTransactions.action, "search"),
      ),
    )
    .orderBy(asc(ondcTransactions.createdAt))
    .limit(1);
  return row;
};

/**
 * Stored transaction values win; `fallback` (the static protocol) fills any
 * gap, e.g. a transaction whose /search row predates these columns.
 */
export const resolveTransactionProtocol = async <
  T extends { domain: string; country: string; city: string; coreVersion: string },
>(
  load: TransactionContextLoader,
  transactionId: string,
  fallback: T,
): Promise<T> => {
  const stored = await load(transactionId);
  return {
    ...fallback,
    domain: stored?.domain || fallback.domain,
    country: stored?.country || fallback.country,
    city: stored?.city || fallback.city,
    coreVersion: stored?.coreVersion || fallback.coreVersion,
  };
};
