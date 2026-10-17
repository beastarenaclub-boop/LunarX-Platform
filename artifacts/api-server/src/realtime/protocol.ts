/**
 * Re-export of the canonical realtime wire protocol so existing imports
 * (`./protocol`) continue to work. The schema lives in `@workspace/api-zod`
 * and is shared verbatim with browser clients — server publishers and
 * client consumers share one discriminated union.
 */
export {
  ALLOWED_ROLES_PER_TOPIC,
  type ClientToServer,
  type ServerToClient,
  type AnyServerEvent,
  type BetsGlobalEvent,
  type RoundsLunarEvent,
  type RoundsRouletteEvent,
  type BannersActiveEvent,
  type WalletEvent,
  type NotificationEvent,
  type WithdrawalsAdminEvent,
  type AdminMetricsEvent,
  type AgentEvent,
  type GameConfigUpdatedEvent,
  type BonusEvent,
  type AdminBonusEventsEvent,
  type AdminBonusMetricsEvent,
} from "@workspace/api-zod";
