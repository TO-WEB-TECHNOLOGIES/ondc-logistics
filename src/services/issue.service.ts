import { randomUUID } from "node:crypto";
import { generateIssueId } from "../utils/order-id.js";
import {
  buildIssuePayload,
  buildIssueStatusPayload,
  buildIssueUpdatePayload,
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
    },
  ) {}

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

    const transactionId = input.context?.transaction_id ?? row.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const issueId = generateIssueId();
    const now = new Date().toISOString();
    const { protocol } = this.dependencies;

    const payload = buildIssuePayload({
      issueId,
      orderId: input.orderId,
      category,
      descriptorLongDesc: input.descriptorLongDesc,
      descriptorAdditionalDescUrl: input.descriptorAdditionalDescUrl,
      images: input.images,
      media: input.media,
      items: input.items,
      context: {
        domain: protocol.domain,
        country: protocol.country,
        city: protocol.city,
        core_version: protocol.coreVersion,
        bap_id: protocol.bapId,
        bap_uri: protocol.bapUri,
      },
      bppId: row.bppId,
      bppUri: row.bppUri,
      providerId: row.providerId ?? undefined,
      fulfillmentId: row.fulfillmentId ?? undefined,
      billingName: row.billingName ?? undefined,
      billingEmail: row.billingEmail ?? undefined,
      billingPhone: row.billingPhone ?? undefined,
      transactionId,
      messageId,
      now,
    });

    // buildIssuePayload always populates a single initial "OPEN" action.
    const initialAction = payload.message.issue.actions?.[0];
    if (!initialAction) throw new IssueValidationError("failed to build initial action");
    const { created } = await this.dependencies.repository.createIssue({
      payload,
      orderId: input.orderId,
      categoryCode: input.categoryCode,
      initialAction: {
        actionId: initialAction.id,
        descriptorCode: initialAction.descriptor.code,
        descriptorName: initialAction.descriptor.name,
        shortDesc: initialAction.descriptor.short_desc,
        updatedAt: initialAction.updated_at,
        actionBy: initialAction.action_by,
        actorDetailsName: initialAction.actor_details?.name,
      },
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

    if (input.actionCode === "ESCALATED") {
      if (existing.level !== "ISSUE")
        throw new IssueValidationError(
          "issue is already at GRIEVANCE level or higher",
          "actionCode",
        );
      if (existing.status === "CLOSED")
        throw new IssueValidationError(
          "a closed issue cannot be escalated",
          "actionCode",
        );
      const hasResolvedOrAccepted = existing.actions.some(
        (a) =>
          a.descriptorCode === "RESOLVED" ||
          a.descriptorCode === "RESOLUTION_ACCEPTED",
      );
      if (!hasResolvedOrAccepted)
        throw new IssueValidationError(
          "escalation is only allowed after a resolution has been proposed and accepted",
          "actionCode",
        );
    }

    const transactionId = input.context?.transaction_id ?? existing.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const { protocol } = this.dependencies;

    const { payload, nextStatus, nextLevel, newAction, nextLongDesc } =
      buildIssueUpdatePayload({
        existing,
        actionCode: input.actionCode,
        resolutionId: input.resolutionId,
        descriptorLongDesc: input.descriptorLongDesc,
        images: input.images,
        context: {
          domain: protocol.domain,
          country: protocol.country,
          city: protocol.city,
          core_version: protocol.coreVersion,
          bap_id: protocol.bapId,
          bap_uri: protocol.bapUri,
        },
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
      nextLevel,
      nextLongDesc,
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
    const { protocol } = this.dependencies;

    const payload = buildIssueStatusPayload({
      issueId: input.issueId,
      context: {
        domain: protocol.domain,
        country: protocol.country,
        city: protocol.city,
        core_version: protocol.coreVersion,
        bap_id: protocol.bapId,
        bap_uri: protocol.bapUri,
      },
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
