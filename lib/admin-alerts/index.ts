import "server-only";

export {
  AdminAlertConfigurationError,
  isAdminAlertDeliveryEnabled,
  resolveAdminAlertOperationalConfig,
  resolveAdminAlertsEnvironment,
  validateDiscordWebhookUrl,
  type AdminAlertOperationalConfig,
} from "@/lib/admin-alerts/config";
export {
  calculateAdminAlertBackoffMs,
  deliverPendingAdminAlerts,
  MAX_ADMIN_ALERT_DELIVERY_BATCH,
  readAdminAlertOutboxHealth,
  type AdminAlertDeliveryRunResult,
} from "@/lib/admin-alerts/delivery";
export {
  adminAlertEventSchema,
  getAdminAlertDestinations,
  parseAdminAlertEvent,
  type AdminAlertEvent,
  type WeeklyAdminAlertAggregate,
} from "@/lib/admin-alerts/events";
export {
  escapeDiscordText,
  formatAdminAlertForDiscord,
  type DiscordWebhookPayload,
} from "@/lib/admin-alerts/format";
export {
  deriveAdminAlertIdentity,
  type AdminAlertIdentityKind,
} from "@/lib/admin-alerts/identity";
export {
  buildProcessedStripeAdminAlerts,
  type StripeAdminAlertScope,
} from "@/lib/admin-alerts/stripe";
export {
  AdminAlertDedupeConflictError,
  buildAdminAlertOutboxRows,
  enqueueAdminAlert,
  enqueueAdminAlerts,
  recordStripeWebhookProcessedWithAdminAlerts,
  type AdminAlertEnqueueInput,
  type AdminAlertEnqueueResult,
} from "@/lib/admin-alerts/outbox";
