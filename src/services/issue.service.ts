import { contextBaseFromProtocol } from "../utils/ondc-context.js";
import type { TransactionContextLoader } from "../repositories/transaction-context.js";
import { randomUUID } from "node:crypto";
import { generateIssueId } from "../utils/order-id.js";
import {
  buildIssuePayload,
  buildIssueStatusPayload,
  buildIssueUpdatePayload,
  complainantHistory,
} from "../mappers/issue.mapper.js";
import type { IssueRepository } from "../repositories/issue.repository.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import { ISSUE_CATEGORIES } from "../constants/issueCategories.js";
import {
  IssueValidationError,
  type CheckIssueStatusInput,
  type CreateIssueInput,
  type OndcOnIssueResponse,
  type OndcOnIssueStatusResponse,
  type UpdateIssueInput,
} from "../schemas/issue.schema.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

export interface IssueProtocol {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
}

export interface IssueSendResult {
  issueId: string;
  transactionId: string;
  messageId: string;
  status: "ISSUE_SENT";
}

export interface IssueStatusSendResult {
  issueId: string;
  transactionId: string;
  messageId: string;
  status: "ISSUE_STATUS_SENT";
}

export class IssueService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: IssueRepository;
      protocol: IssueProtocol;
      loadTransactionContext: TransactionContextLoader;
    },
  ) {}

  /**
   * IGM keeps its own configured domain/core_version; only city/country
   * follow the order's transaction so they match what the LSP saw on /search.
   */
  private async transactionProtocol(transactionId: string) {
    const { protocol, loadTransactionContext } = this.dependencies;
    const stored = await loadTransactionContext(transactionId);
    return {
      ...protocol,
      country: stored?.country || protocol.country,
      city: stored?.city || protocol.city,
    };
  }

  async createIssue(input: CreateIssueInput): Promise<IssueSendResult> {
    console.log("[issue.service] createIssue invoked", {
      orderId: input.orderId,
      categoryCode: input.categoryCode,
    });
    const row = await this.dependencies.repository.loadOrder(input.orderId);
    if (!row) throw new IssueValidationError("order not found", "orderId");
    if (!row.bppId || !row.bppUri)
      throw new IssueValidationError(
        "order is missing bpp routing information",
        "orderId",
      );

    const category = ISSUE_CATEGORIES[input.categoryCode];
    if (!category)
      throw new IssueValidationError("unknown category_code", "categoryCode");
    const subCategoryV1 = category.subCategoryV1;
    if (!subCategoryV1)
      throw new IssueValidationError(
        "category is not supported in IGM 1.0.0 yet",
        "categoryCode",
      );

    const transactionId = input.context?.transaction_id ?? row.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const issueId = generateIssueId();
    const now = new Date().toISOString();
    const protocol = await this.transactionProtocol(transactionId);

    const { payload, initialAction } = buildIssuePayload({
      issueId,
      orderId: input.orderId,
      category: { ...category, subCategoryV1 },
      descriptorLongDesc: input.descriptorLongDesc,
      descriptorAdditionalDescUrl: input.descriptorAdditionalDescUrl,
      images: input.images,
      items: input.items,
      context: contextBaseFromProtocol(protocol),
      bppId: row.bppId,
      bppUri: row.bppUri,
      providerId: row.providerId ?? undefined,
      orderState: row.state ?? undefined,
      fulfillmentId: row.fulfillmentId ?? undefined,
      fulfillmentState: row.fulfillmentStateCode ?? undefined,
      billingName: row.billingName ?? undefined,
      billingEmail: row.billingEmail ?? undefined,
      billingPhone: row.billingPhone ?? undefined,
      transactionId,
      messageId,
      now,
    });

    const { created } = await this.dependencies.repository.createIssue({
      payload,
      orderId: input.orderId,
      categoryCode: input.categoryCode,
      initialAction,
    });

    if (!created) {
      console.log("[issue.service] idempotent /issue (create) retry", {
        issueId,
        transactionId,
        messageId,
      });
      return { issueId, transactionId, messageId, status: "ISSUE_SENT" };
    }

    try {
      await this.dependencies.transport.sendIssue(payload);
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        "issue",
        "sent",
      );
    } catch (error) {
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        "issue",
        "failed",
        {
          code: "ONDC_SUBMISSION_FAILED",
          message:
            error instanceof Error ? error.message : "ONDC submission failed",
        },
      );
      throw error;
    }

    return { issueId, transactionId, messageId, status: "ISSUE_SENT" };
  }

  async updateIssue(input: UpdateIssueInput): Promise<IssueSendResult> {
    console.log("[issue.service] updateIssue invoked", {
      issueId: input.issueId,
      actionCode: input.actionCode,
    });
    const existing = await this.dependencies.repository.findByIssueId(input.issueId);
    if (!existing) throw new IssueValidationError("issue not found", "issueId");
    if (!existing.bppId || !existing.bppUri)
      throw new IssueValidationError(
        "issue is missing bpp routing information",
        "issueId",
      );

    if (existing.status === "CLOSED")
      throw new IssueValidationError("issue is already closed", "issueId");
    // Issues raised before the IGM 1.0.0 switch have no complainant-side
    // history to resend in issue_actions.complainant_actions.
    if (complainantHistory(existing).length === 0)
      throw new IssueValidationError(
        "issue was created with an older IGM format and cannot be updated",
        "issueId",
      );

    // CLOSE is allowed at any time (the contract lets the complainant close
    // without a RESOLVED action). ESCALATE follows a respondent resolution.
    if (input.actionCode === "ESCALATE") {
      if (existing.level !== "ISSUE")
        throw new IssueValidationError(
          "issue is already at GRIEVANCE level or higher",
          "actionCode",
        );
      const resolved = existing.actions.some(
        (a) => a.side === "respondent" && a.descriptorCode === "RESOLVED",
      );
      if (!resolved)
        throw new IssueValidationError(
          "escalation is only allowed after the respondent has resolved the issue",
          "actionCode",
        );
    }

    const transactionId = input.context?.transaction_id ?? existing.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const protocol = await this.transactionProtocol(transactionId);

    const { payload, nextStatus, nextIssueType, newAction } =
      buildIssueUpdatePayload({
        existing,
        actionCode: input.actionCode,
        rating: input.rating,
        shortDesc: input.shortDesc,
        context: contextBaseFromProtocol(protocol),
        transactionId,
        messageId,
        now,
      });

    const { created } = await this.dependencies.repository.appendIssueAction({
      issueRowId: existing.id,
      payload,
      orderId: existing.orderId,
      action: newAction,
      nextStatus,
      nextIssueType,
      rating: input.rating,
    });

    if (!created) {
      console.log("[issue.service] idempotent /issue (update) retry", {
        issueId: input.issueId,
        transactionId,
        messageId,
      });
      return { issueId: input.issueId, transactionId, messageId, status: "ISSUE_SENT" };
    }

    try {
      await this.dependencies.transport.sendIssue(payload);
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        "issue",
        "sent",
      );
    } catch (error) {
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        "issue",
        "failed",
        {
          code: "ONDC_SUBMISSION_FAILED",
          message:
            error instanceof Error ? error.message : "ONDC submission failed",
        },
      );
      throw error;
    }

    return { issueId: input.issueId, transactionId, messageId, status: "ISSUE_SENT" };
  }

  async checkIssueStatus(input: CheckIssueStatusInput): Promise<IssueStatusSendResult> {
    console.log("[issue.service] checkIssueStatus invoked", {
      issueId: input.issueId,
    });
    const existing = await this.dependencies.repository.findByIssueId(input.issueId);
    if (!existing) throw new IssueValidationError("issue not found", "issueId");
    if (!existing.bppId || !existing.bppUri)
      throw new IssueValidationError(
        "issue is missing bpp routing information",
        "issueId",
      );

    const transactionId = input.context?.transaction_id ?? existing.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const protocol = await this.transactionProtocol(transactionId);

    const payload = buildIssueStatusPayload({
      issueId: input.issueId,
      context: contextBaseFromProtocol(protocol),
      bppId: existing.bppId,
      bppUri: existing.bppUri,
      transactionId,
      messageId,
      now,
    });

    const { created } = await this.dependencies.repository.createIssueStatusCheck(
      payload,
      existing.orderId,
    );

    if (created) {
      try {
        await this.dependencies.transport.sendIssueStatus(payload);
        await this.dependencies.repository.updateStatus(
          transactionId,
          messageId,
          "issue_status",
          "sent",
        );
      } catch (error) {
        await this.dependencies.repository.updateStatus(
          transactionId,
          messageId,
          "issue_status",
          "failed",
          {
            code: "ONDC_SUBMISSION_FAILED",
            message:
              error instanceof Error ? error.message : "ONDC submission failed",
          },
        );
        throw error;
      }
    } else {
      console.log("[issue.service] idempotent /issue_status retry", {
        issueId: input.issueId,
        transactionId,
        messageId,
      });
    }

    return {
      issueId: input.issueId,
      transactionId,
      messageId,
      status: "ISSUE_STATUS_SENT",
    };
  }

  async handleOnIssue(response: OndcOnIssueResponse, stream?: CallbackStream) {
    console.log("[issue.service] handling /on_issue", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
      issueId: response.message?.issue?.id,
      hasError: Boolean(response.error),
    });
    return this.dependencies.repository.handleOnIssue(response, stream);
  }

  async handleOnIssueStatus(response: OndcOnIssueStatusResponse, stream?: CallbackStream) {
    console.log("[issue.service] handling /on_issue_status", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
      issueId: response.message?.issue?.id,
      hasError: Boolean(response.error),
    });
    return this.dependencies.repository.handleOnIssueStatus(response, stream);
  }
}
