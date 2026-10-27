import { compact } from "../utils/compact.js";

type AnyIssue = Record<string, any>;

/** Structural subset of issue.repository's IncomingAction. */
interface ActionLike {
  descriptorCode: string;
  shortDesc?: string;
  updatedAt: string;
  side?: "complainant" | "respondent";
  cascadedLevel?: number;
  actorOrgName?: string;
  actorPersonName?: string;
}

/**
 * Verbose details for the issue_updated / issue_status_updated stream
 * events (IGM 1.0.0 shape, tolerant of the older flat one): status, type,
 * category, the newly received actions, the resolution and the resolution
 * provider (org, support chat link/contact, GROs). Existing fields
 * (issueId, orderId, newActionCount) are kept by the callers.
 */
export const buildIssueEventDetails = (
  issue: AnyIssue | undefined,
  newActions: ActionLike[],
) => {
  if (!issue) return {};
  const provider = issue.resolution_provider?.respondent_info;
  const support = provider?.resolution_support;
  const gros = Array.isArray(support?.gros) ? support.gros : [];
  return (
    compact({
      status: issue.status as string | undefined,
      issueType: (issue.issue_type ?? issue.level) as string | undefined,
      category: issue.category as string | undefined,
      subCategory: issue.sub_category as string | undefined,
      newActions: newActions.length
        ? newActions.map((a) =>
            compact({
              side: a.side,
              code: a.descriptorCode,
              shortDesc: a.shortDesc,
              updatedAt: a.updatedAt,
              cascadedLevel: a.cascadedLevel,
              orgName: a.actorOrgName,
              personName: a.actorPersonName,
            }),
          )
        : undefined,
      resolution: compact({
        shortDesc: issue.resolution?.short_desc as string | undefined,
        longDesc: issue.resolution?.long_desc as string | undefined,
        actionTriggered: issue.resolution?.action_triggered as string | undefined,
        refundAmount: issue.resolution?.refund_amount as string | undefined,
      }),
      resolutionProvider: provider
        ? compact({
            type: provider.type as string | undefined,
            orgName: provider.organization?.org?.name as string | undefined,
            chatLink: support?.chat_link as string | undefined,
            supportContact: compact({
              phone: support?.contact?.phone as string | undefined,
              email: support?.contact?.email as string | undefined,
            }),
            gros: gros.length
              ? gros.map((g: AnyIssue) =>
                  compact({
                    groType: g.gro_type as string | undefined,
                    name: g.person?.name as string | undefined,
                    phone: g.contact?.phone as string | undefined,
                    email: g.contact?.email as string | undefined,
                  }),
                )
              : undefined,
          })
        : undefined,
      issueUpdatedAt: issue.updated_at as string | undefined,
    }) ?? {}
  );
};
