export const WHITE_LABEL_PUBLICATION_CONTRACT_VERSION = "1.0" as const;

export type WhiteLabelModuleKey =
  | "services" | "projects" | "tickets" | "reporting" | "invoices"
  | "subscriptions" | "coupons" | "investment_intent" | "forms";

export type PublishedWhiteLabelConfiguration = {
  tenantId: string;
  publicationRevision: number;
  sourceDraftRevision: number;
  displayName: string;
  primaryColor: string;
  accentColor: string;
  moduleKeys: WhiteLabelModuleKey[];
  publishedAt: string;
};

export type RuntimeWhiteLabelConfiguration =
  | { kind: "published"; configuration: PublishedWhiteLabelConfiguration }
  | { kind: "legacy_modules"; tenantId: string;
      publicationRevision: number; moduleKeys: WhiteLabelModuleKey[] }
  | { kind: "unpublished"; tenantId: string; publicationRevision: 0 };

export type PublishWhiteLabelInput = {
  tenantId: string;
  sourceDraftRevision: number;       // >= 1, saved revision reviewed by caller
  expectedPublicationRevision: number; // >= 0, including legacy revisions
  requestId: string;                // UUID, stable through uncertain retry
  reason: string;                   // trimmed 1–500 characters
};

export type PublicationReceipt = {
  configuration: PublishedWhiteLabelConfiguration;
  requestId: string;
  expectedPublicationRevision: number;
  publishedBy: string;              // auth.uid(), never supplied by caller
  reason: string;
};

export type PublicationBlockerCode =
  | "DRAFT_NOT_SAVED" | "STALE_DRAFT" | "STALE_PUBLICATION"
  | "TENANT_INACTIVE" | "SERVICES_REQUIRED" | "INVALID_MODULE_POLICY"
  | "OUTSTANDING_PROJECTS" | "OUTSTANDING_TICKETS"
  | "UNCANCELED_SUBSCRIPTIONS" | "OUTSTANDING_FINANCIAL_OBLIGATIONS";

export type PublicationPreflight = {
  tenantId: string;
  sourceDraftRevision: number;
  currentDraftRevision: number;
  expectedPublicationRevision: number;
  currentPublicationRevision: number;
  candidate: {
    displayName: string; primaryColor: string; accentColor: string;
    moduleKeys: WhiteLabelModuleKey[];
  } | null;
  publishable: boolean; // exactly candidate !== null && blockers.length === 0
  blockers: { code: PublicationBlockerCode }[];
};

export type PublishWhiteLabelResult = {
  outcome: "published" | "already_applied";
  receipt: PublicationReceipt;
};

export type PublicationReconciliation =
  | { outcome: "applied"; receipt: PublicationReceipt }
  | { outcome: "not_found" };

import { z } from "zod";
import { DatabaseError } from "../../lib/errors/application-error";

const PG_INTEGER_MAX = 2_147_483_647;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const revision = z.number().int().min(0).max(PG_INTEGER_MAX);
const expectedRevision = revision.max(PG_INTEGER_MAX - 1);
const timestamp = z.iso.datetime({ offset: true });
const trimSpaces = (value: string) => value.replace(/^ +| +$/g, "");
const name = z.string().refine((value) => value === trimSpaces(value) &&
  [...value].length >= 1 && [...value].length <= 60 && !/\p{Cc}/u.test(value));
const color = z.string().regex(/^#[0-9a-f]{6}$/);
const reason = z.string().transform(trimSpaces).refine((value) => [...value].length >= 1 && [...value].length <= 500);
const storedReason = z.string().refine((value) => value === trimSpaces(value) && [...value].length >= 1 && [...value].length <= 500);
const moduleKey = z.enum(["services", "projects", "tickets", "reporting", "invoices", "subscriptions", "coupons", "investment_intent", "forms"]);
const moduleKeys = z.array(moduleKey).max(9).refine((keys) => keys.every((key, index) => index === 0 || keys[index - 1]! < key));

export function staticPublicationBlocker(keys: readonly WhiteLabelModuleKey[]): "SERVICES_REQUIRED" | "INVALID_MODULE_POLICY" | null {
  if (!keys.includes("services")) return "SERVICES_REQUIRED";
  if ((keys.includes("projects") && !keys.includes("tickets")) ||
      (keys.includes("subscriptions") && !keys.includes("invoices"))) return "INVALID_MODULE_POLICY";
  return null;
}

export const preflightWhiteLabelPublicationSchema = z.strictObject({
  tenantId: uuid,
  sourceDraftRevision: revision.min(1),
  expectedPublicationRevision: expectedRevision,
});

export const publishWhiteLabelSchema = preflightWhiteLabelPublicationSchema.extend({ requestId: uuid, reason });

const candidate = z.strictObject({ displayName: name, primaryColor: color, accentColor: color, moduleKeys });
const configuration = candidate.extend({
  tenantId: uuid,
  publicationRevision: revision.min(1),
  sourceDraftRevision: revision.min(1),
  publishedAt: timestamp,
}).refine((value) => staticPublicationBlocker(value.moduleKeys) === null);

const receipt = z.strictObject({
  configuration,
  requestId: uuid,
  expectedPublicationRevision: expectedRevision,
  publishedBy: uuid,
  reason: storedReason,
}).refine((value) => value.configuration.publicationRevision === value.expectedPublicationRevision + 1);

const runtime = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("published"), configuration }),
  z.strictObject({ kind: z.literal("legacy_modules"), tenantId: uuid, publicationRevision: revision.min(1),
    moduleKeys: moduleKeys.refine((keys) => staticPublicationBlocker(keys) === null) }),
  z.strictObject({ kind: z.literal("unpublished"), tenantId: uuid, publicationRevision: z.literal(0) }),
]);

const blocker = z.enum(["DRAFT_NOT_SAVED", "STALE_DRAFT", "STALE_PUBLICATION", "TENANT_INACTIVE", "SERVICES_REQUIRED",
  "INVALID_MODULE_POLICY", "OUTSTANDING_PROJECTS", "OUTSTANDING_TICKETS", "UNCANCELED_SUBSCRIPTIONS", "OUTSTANDING_FINANCIAL_OBLIGATIONS"]);
const preflight = z.strictObject({
  tenantId: uuid,
  sourceDraftRevision: revision.min(1),
  currentDraftRevision: revision,
  expectedPublicationRevision: expectedRevision,
  currentPublicationRevision: revision,
  candidate: candidate.nullable(),
  publishable: z.boolean(),
  blockers: z.array(z.strictObject({ code: blocker })).max(10),
}).refine((value) => {
  const codes = value.blockers.map((entry) => entry.code);
  const staticBlocker = value.candidate && staticPublicationBlocker(value.candidate.moduleKeys);
  return new Set(codes).size === codes.length &&
    value.publishable === (value.candidate !== null && codes.length === 0) &&
    (value.candidate !== null) === (value.currentDraftRevision > 0) &&
    codes.includes("DRAFT_NOT_SAVED") === (value.currentDraftRevision === 0) &&
    codes.includes("STALE_DRAFT") === (value.sourceDraftRevision !== value.currentDraftRevision) &&
    codes.includes("STALE_PUBLICATION") === (value.expectedPublicationRevision !== value.currentPublicationRevision) &&
    (!staticBlocker || codes.includes(staticBlocker));
});

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DatabaseError(parsed.error);
  return parsed.data;
}

export const decodeRuntimeWhiteLabelConfiguration = (value: unknown): RuntimeWhiteLabelConfiguration => decode(runtime, value);
export const decodePublicationPreflight = (value: unknown): PublicationPreflight => decode(preflight, value);
export const decodePublishWhiteLabelResult = (value: unknown): PublishWhiteLabelResult =>
  decode(z.strictObject({ outcome: z.enum(["published", "already_applied"]), receipt }), value);
export const decodePublicationReconciliation = (value: unknown): PublicationReconciliation =>
  decode(z.discriminatedUnion("outcome", [z.strictObject({ outcome: z.literal("applied"), receipt }),
    z.strictObject({ outcome: z.literal("not_found") })]), value);
