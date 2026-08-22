import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  logisticsSearchHolidays,
  logisticsSearchLocations,
  logisticsSearchPayments,
  logisticsSearchPayloads,
  logisticsSearchProviderSchedules,
  logisticsSearches,
  ondcTransactions,
} from "../db/schema/index.js";
import type { SearchRequest } from "../types/search/internal.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";

export type SearchRepository = {
  createSearch(input: { request: SearchRequest; payload: OndcSearchRequest }): Promise<{ searchId: string }>;
  updateTransactionStatus(transactionId: string, status: string, error?: { code?: string; message?: string }): Promise<void>;
};

const numeric = (value: string | number) => String(value);

export class DrizzleSearchRepository implements SearchRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async createSearch({ request, payload }: Parameters<SearchRepository["createSearch"]>[0]) {
    return this.database.transaction(async (tx) => {
      const [transaction] = await tx.insert(ondcTransactions).values({
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        action: "search",
        status: "pending",
        domain: payload.context.domain,
        country: payload.context.country,
        city: payload.context.city,
        coreVersion: payload.context.core_version,
        bapId: payload.context.bap_id,
        bapUri: payload.context.bap_uri,
        timestamp: new Date(payload.context.timestamp),
        ttl: payload.context.ttl,
        requestPayload: payload,
      }).returning({ id: ondcTransactions.id });

      const [search] = await tx.insert(logisticsSearches).values({
        transactionDbId: transaction.id,
        categoryId: request.categoryId,
        fulfillmentType: request.fulfillmentType,
        authorizationStartType: request.authorization.startType,
        authorizationEndType: request.authorization.endType,
      }).returning({ id: logisticsSearches.id });

      await tx.insert(logisticsSearchLocations).values([
        { searchId: search.id, locationType: "start", gps: request.start.gps, ...request.start.address, areaCode: request.start.address.areaCode },
        { searchId: search.id, locationType: "end", gps: request.end.gps, ...request.end.address, areaCode: request.end.address.areaCode },
      ]);

      if (request.schedule) {
        const [schedule] = await tx.insert(logisticsSearchProviderSchedules).values({
          searchId: search.id, days: request.schedule.days, duration: request.schedule.duration,
          rangeStart: request.schedule.rangeStart, rangeEnd: request.schedule.rangeEnd,
        }).returning({ id: logisticsSearchProviderSchedules.id });
        if (request.schedule.holidays?.length) {
          await tx.insert(logisticsSearchHolidays).values(request.schedule.holidays.map((holidayDate) => ({ scheduleId: schedule.id, holidayDate })));
        }
      }

      if (request.payload) {
        await tx.insert(logisticsSearchPayloads).values({
          searchId: search.id, weightValue: numeric(request.payload.weight.value), weightUnit: request.payload.weight.unit,
          lengthValue: numeric(request.payload.dimensions.length.value), lengthUnit: request.payload.dimensions.length.unit,
          breadthValue: numeric(request.payload.dimensions.breadth.value), breadthUnit: request.payload.dimensions.breadth.unit,
          heightValue: numeric(request.payload.dimensions.height.value), heightUnit: request.payload.dimensions.height.unit,
          category: request.payload.category, valueAmount: numeric(request.payload.value.amount), valueCurrency: request.payload.value.currency,
          dangerousGoods: request.payload.dangerousGoods,
        });
      }
      if (request.payment) {
        await tx.insert(logisticsSearchPayments).values({
          searchId: search.id, type: request.payment.type,
          collectionAmount: request.payment.collectionAmount === undefined ? undefined : numeric(request.payment.collectionAmount),
          currency: request.payment.currency,
        });
      }
      return { searchId: search.id };
    });
  }

  async updateTransactionStatus(transactionId: string, status: string, error?: { code?: string; message?: string }) {
    await this.database.update(ondcTransactions).set({
      status, errorCode: error?.code, errorMessage: error?.message, updatedAt: new Date(),
    }).where(and(eq(ondcTransactions.transactionId, transactionId), eq(ondcTransactions.action, "search")));
  }
}

