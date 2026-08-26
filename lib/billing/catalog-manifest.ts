import { createHash } from "node:crypto";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import {
  TEACHER_AI_PRICE_BOOK,
  type TeacherAiPriceBook,
} from "@/lib/teacher-ai-pricing";

export type StripeCatalogDimensionKey = "successful_grade" | "audio_second";

export type StripeCatalogMetadata = Readonly<Record<string, string>>;

export type StripeCatalogDimension = Readonly<{
  key: StripeCatalogDimensionKey;
  meterDisplayName: string;
  meterEventName: string;
  billingUnit: "grade" | "second";
  productId: string;
  productName: string;
  productDescription: string;
  productUnitLabel: string;
  priceLookupKey: string;
  priceNickname: string;
  priceEnvironmentVariable: string;
  unitAmountDecimalCents: string;
  metadata: StripeCatalogMetadata;
}>;

export type StripeCatalogManifest = Readonly<{
  schemaVersion: 1;
  apiVersion: typeof STRIPE_API_VERSION;
  priceBookId: string;
  priceBookStatus: TeacherAiPriceBook["status"];
  currency: "usd";
  publishedAt: string;
  effectiveAt: string | null;
  fingerprint: string;
  dimensions: readonly StripeCatalogDimension[];
}>;

const HUNDRED = Stripe.Decimal.from("100");
const SIXTY = Stripe.Decimal.from("60");

function usdToCents(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite USD amount.`);
  }
  return Stripe.Decimal.from(value.toString()).mul(HUNDRED);
}

function productToken(priceBookId: string) {
  const token = priceBookId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!token) throw new Error("The teacher AI price book ID cannot produce a Stripe identifier.");
  return token;
}

function catalogFingerprint(
  priceBook: TeacherAiPriceBook,
  dimensions: readonly Omit<StripeCatalogDimension, "metadata">[],
) {
  const contract = {
    schemaVersion: 1,
    priceBook: {
      id: priceBook.id,
      currency: priceBook.currency,
      status: priceBook.status,
      publishedAt: priceBook.publishedAt,
      effectiveAt: priceBook.effectiveAt,
      baseSuccessfulGradeUsd: priceBook.baseSuccessfulGradeUsd,
      audioMinuteUsd: priceBook.audioMinuteUsd,
      successfulGradeIdentity: priceBook.successfulGradeIdentity,
      feedbackIncluded: priceBook.feedbackIncluded,
      freeCreditPolicy: priceBook.freeCreditPolicy,
    },
    dimensions: dimensions.map((dimension) => ({
      key: dimension.key,
      meterEventName: dimension.meterEventName,
      billingUnit: dimension.billingUnit,
      productId: dimension.productId,
      priceLookupKey: dimension.priceLookupKey,
      unitAmountDecimalCents: dimension.unitAmountDecimalCents,
    })),
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

export function createStripeCatalogManifest(
  priceBook: TeacherAiPriceBook = TEACHER_AI_PRICE_BOOK,
): StripeCatalogManifest {
  if (priceBook.currency !== "USD") {
    throw new Error(`Stripe teacher AI setup supports USD only, received ${priceBook.currency}.`);
  }
  if (!priceBook.id.trim()) throw new Error("The teacher AI price book ID is required.");
  if (
    !Number.isSafeInteger(priceBook.freeCreditPolicy.maxQualifyingClasses) ||
    priceBook.freeCreditPolicy.maxQualifyingClasses < 1
  ) {
    throw new Error("The teacher AI free-credit class cap must be a positive safe integer.");
  }

  const token = productToken(priceBook.id);
  const successfulGradeCents = usdToCents(
    priceBook.baseSuccessfulGradeUsd,
    "baseSuccessfulGradeUsd",
  );
  const audioSecondCents = usdToCents(priceBook.audioMinuteUsd, "audioMinuteUsd").div(
    SIXTY,
    12,
    "half-up",
  );
  const dimensionsWithoutMetadata: readonly Omit<StripeCatalogDimension, "metadata">[] = [
    {
      key: "successful_grade",
      meterDisplayName: "Habla successful AI grades",
      meterEventName: "habla_ai_successful_grade",
      billingUnit: "grade",
      productId: `${token}_successful_grade`,
      productName: "Habla AI successful grades",
      productDescription: "Successful, unique AI grading results for Habla teachers.",
      productUnitLabel: "grade",
      priceLookupKey: `${token}_successful_grade_monthly`,
      priceNickname: `${priceBook.id}: successful grade`,
      priceEnvironmentVariable: "STRIPE_AI_GRADE_PRICE_ID",
      unitAmountDecimalCents: successfulGradeCents.toString(),
    },
    {
      key: "audio_second",
      meterDisplayName: "Habla processed AI audio seconds",
      meterEventName: "habla_ai_audio_seconds",
      billingUnit: "second",
      productId: `${token}_audio_second`,
      productName: "Habla AI processed audio",
      productDescription:
        "Processed audio for Habla AI grading, billed by second at the published per-minute rate.",
      productUnitLabel: "second",
      priceLookupKey: `${token}_audio_second_monthly`,
      priceNickname: `${priceBook.id}: audio second`,
      priceEnvironmentVariable: "STRIPE_AI_AUDIO_SECONDS_PRICE_ID",
      unitAmountDecimalCents: audioSecondCents.toString(),
    },
  ];

  const fingerprint = catalogFingerprint(priceBook, dimensionsWithoutMetadata);
  const dimensions = dimensionsWithoutMetadata.map((dimension) =>
    Object.freeze({
      ...dimension,
      metadata: Object.freeze({
        habla_catalog: "teacher_ai",
        catalog_schema_version: "1",
        catalog_fingerprint: fingerprint,
        price_book_id: priceBook.id,
        price_book_status: priceBook.status,
        published_at: priceBook.publishedAt,
        effective_at: priceBook.effectiveAt ?? "pending",
        dimension: dimension.key,
        billing_unit: dimension.billingUnit,
        unit_amount_decimal_cents: dimension.unitAmountDecimalCents,
      }),
    }),
  );

  return Object.freeze({
    schemaVersion: 1,
    apiVersion: STRIPE_API_VERSION,
    priceBookId: priceBook.id,
    priceBookStatus: priceBook.status,
    currency: "usd",
    publishedAt: priceBook.publishedAt,
    effectiveAt: priceBook.effectiveAt,
    fingerprint,
    dimensions: Object.freeze(dimensions),
  });
}

export const STRIPE_CATALOG_MANIFEST = createStripeCatalogManifest();
