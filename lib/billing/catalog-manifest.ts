import { createHash } from "node:crypto";
import { STRIPE_API_VERSION } from "@/lib/billing/config";
import {
  TEACHER_AI_PRICE_BOOK,
  type TeacherAiPriceBook,
} from "@/lib/teacher-ai-pricing";

export type StripeCatalogDimensionKey = "teacher";

export type StripeCatalogMetadata = Readonly<Record<string, string>>;

export type StripeCatalogDimension = Readonly<{
  key: StripeCatalogDimensionKey;
  productId: string;
  productName: string;
  productDescription: string;
  productUnitLabel: string;
  priceLookupKey: string;
  priceNickname: string;
  priceEnvironmentVariable: string;
  unitAmountCents: number;
  metadata: StripeCatalogMetadata;
}>;

export type StripeTeacherCatalogPriceBook = TeacherAiPriceBook;

export type StripeCatalogManifest = Readonly<{
  schemaVersion: 2;
  apiVersion: typeof STRIPE_API_VERSION;
  priceBookId: StripeTeacherCatalogPriceBook["id"];
  priceBookStatus: StripeTeacherCatalogPriceBook["status"];
  currency: "usd";
  publishedAt: string;
  effectiveAt: string;
  fingerprint: string;
  dimensions: readonly [StripeCatalogDimension];
}>;

export const STRIPE_TEACHER_CATALOG_PRICE_BOOK = TEACHER_AI_PRICE_BOOK;

function assertPriceBookContract(priceBook: StripeTeacherCatalogPriceBook) {
  if (priceBook.id !== "tryhabla-teacher-usd-v3") {
    throw new Error("Stripe setup requires price book tryhabla-teacher-usd-v3.");
  }
  if (priceBook.currency !== "USD") {
    throw new Error("The TryHabla Teacher Stripe price book must use USD.");
  }
  if (priceBook.status !== "active") {
    throw new Error("The TryHabla Teacher Stripe price book must be active.");
  }
  if (priceBook.monthlyPriceUsd !== 20 || priceBook.billingCadence !== "month") {
    throw new Error("The TryHabla Teacher Stripe price must be $20 per month.");
  }
  if (
    priceBook.plan !== "teacher" ||
    priceBook.billingModel !== "licensed_allowance" ||
    priceBook.includedAiReviews !== 300 ||
    priceBook.maxAudioMinutesPerReview !== 5 ||
    priceBook.overagePolicy !== "pause_ai" ||
    priceBook.rollover !== false ||
    priceBook.freeAllowance.reviews !== 30 ||
    priceBook.freeAllowance.period !== "account_lifetime" ||
    priceBook.freeAllowance.rollover !== false
  ) {
    throw new Error("The TryHabla Teacher allowance contract does not match catalog v3.");
  }
  if (!priceBook.publishedAt.trim() || !priceBook.effectiveAt.trim()) {
    throw new Error("The TryHabla Teacher Stripe price book must be published and effective.");
  }
}

function catalogFingerprint(
  priceBook: StripeTeacherCatalogPriceBook,
  dimension: Omit<StripeCatalogDimension, "metadata">,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 2,
        priceBook: {
          id: priceBook.id,
          currency: priceBook.currency,
          status: priceBook.status,
          publishedAt: priceBook.publishedAt,
          effectiveAt: priceBook.effectiveAt,
          plan: priceBook.plan,
          billingModel: priceBook.billingModel,
          monthlyPriceUsd: priceBook.monthlyPriceUsd,
          billingCadence: priceBook.billingCadence,
          includedAiReviews: priceBook.includedAiReviews,
          maxAudioMinutesPerReview: priceBook.maxAudioMinutesPerReview,
          overagePolicy: priceBook.overagePolicy,
          rollover: priceBook.rollover,
          successfulReviewIdentity: priceBook.successfulReviewIdentity,
          feedbackIncluded: priceBook.feedbackIncluded,
        },
        price: {
          key: dimension.key,
          productId: dimension.productId,
          productName: dimension.productName,
          productDescription: dimension.productDescription,
          productUnitLabel: dimension.productUnitLabel,
          lookupKey: dimension.priceLookupKey,
          nickname: dimension.priceNickname,
          environmentVariable: dimension.priceEnvironmentVariable,
          unitAmountCents: dimension.unitAmountCents,
          recurringInterval: "month",
          usageType: "licensed",
          quantity: 1,
        },
      }),
    )
    .digest("hex");
}

export function createStripeCatalogManifest(
  priceBook: StripeTeacherCatalogPriceBook = STRIPE_TEACHER_CATALOG_PRICE_BOOK,
): StripeCatalogManifest {
  assertPriceBookContract(priceBook);
  const monthlyPriceCents = priceBook.monthlyPriceUsd * 100;

  const dimensionWithoutMetadata: Omit<StripeCatalogDimension, "metadata"> = {
    key: "teacher",
    productId: "tryhabla_teacher_usd_v3",
    productName: "TryHabla",
    productDescription:
      `Teacher plan with ${priceBook.includedAiReviews} AI-reviewed recordings ` +
      "per monthly billing period.",
    productUnitLabel: "subscription",
    priceLookupKey: "tryhabla_teacher_usd_v3_monthly",
    priceNickname: `TryHabla Teacher - $${priceBook.monthlyPriceUsd} monthly`,
    priceEnvironmentVariable: "STRIPE_TRYHABLA_TEACHER_PRICE_ID",
    unitAmountCents: monthlyPriceCents,
  };
  const fingerprint = catalogFingerprint(priceBook, dimensionWithoutMetadata);
  const dimension: StripeCatalogDimension = Object.freeze({
    ...dimensionWithoutMetadata,
    metadata: Object.freeze({
      habla_catalog: "tryhabla_teacher",
      catalog_schema_version: "2",
      catalog_fingerprint: fingerprint,
      price_book_id: priceBook.id,
      price_book_status: priceBook.status,
      published_at: priceBook.publishedAt,
      effective_at: priceBook.effectiveAt,
      dimension: dimensionWithoutMetadata.key,
      plan: "teacher",
      billing_model: "licensed",
      billing_interval: "month",
      unit_amount_cents: String(monthlyPriceCents),
      checkout_quantity: "1",
      included_ai_reviews: String(priceBook.includedAiReviews),
      max_audio_minutes_per_review: String(priceBook.maxAudioMinutesPerReview),
      overage_policy: priceBook.overagePolicy,
      rollover: String(priceBook.rollover),
    }),
  });

  return Object.freeze({
    schemaVersion: 2,
    apiVersion: STRIPE_API_VERSION,
    priceBookId: priceBook.id,
    priceBookStatus: priceBook.status,
    currency: "usd",
    publishedAt: priceBook.publishedAt,
    effectiveAt: priceBook.effectiveAt,
    fingerprint,
    dimensions: Object.freeze([dimension]) as readonly [StripeCatalogDimension],
  });
}

export const STRIPE_CATALOG_MANIFEST = createStripeCatalogManifest();
