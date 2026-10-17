import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const loginAccounts = sqliteTable("login_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  identity: text("identity").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  recoveryHash: text("recovery_hash").notNull(),
  signupPortal: text("signup_portal").notNull().default("member"),
  createdAt: text("created_at").notNull(),
});
export const adminInvitations = sqliteTable("admin_invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedBy: text("used_by"),
  revokedAt: integer("revoked_at"),
});
export const loginSessions = sqliteTable("login_sessions", {
  hash: text("hash").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => loginAccounts.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  location: text("location"),
});
export const locationSessions = sqliteTable("location_sessions", {
  hash: text("hash").primaryKey(),
  identity: text("identity").notNull(),
  location: text("location").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const loginLimits = sqliteTable("login_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  endsAt: integer("ends_at").notNull(),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    identity: text("identity").notNull().unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    ref: text("ref").notNull().unique(),
    parent: text("parent"),
    position: text("position").notNull(),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("Draft"),
    profile: text("profile").notNull().default("{}"),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("binary_position").on(t.parent, t.position)],
);
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("document_kind").on(t.memberId, t.kind)],
);
export const tasks = sqliteTable("tasks", {
  completedAt: text("completed_at"),
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  assignee: text("assignee").notNull(),
  assignedBy: text("assigned_by").notNull(),
  due: text("due").notNull(),
  status: text("status").notNull().default("To do"),
  createdAt: text("created_at").notNull(),
});
export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    accountId: text("account_id"),
    kind: text("kind").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    reference: text("reference").notNull().unique(),
    description: text("description").notNull(),
    date: text("date").notNull(),
    status: text("status").notNull().default("Pending"),
    source: text("source").notNull(),
    createdBy: text("created_by").notNull(),
    reviewedBy: text("reviewed_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("entry_member_date").on(t.memberId, t.date)],
);
export const audit = sqliteTable(
  "audit",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    subject: text("subject").notNull(),
    detail: text("detail").notNull(),
    ip: text("ip").notNull(),
    country: text("country"),
    city: text("city"),
    location: text("location"),
    userAgent: text("user_agent").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_actor_date").on(t.actor, t.createdAt)],
);
export const tokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hash: text("hash").notNull().unique(),
  owner: text("owner").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});
export const rewardPlans = sqliteTable("reward_plans", {
  version: integer("version").primaryKey(),
  config: text("config").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});
export const commissionRuns = sqliteTable("commission_runs", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull().unique(),
  memberId: text("member_id").notNull(),
  memberName: text("member_name").notNull(),
  planVersion: integer("plan_version").notNull(),
  transactions: integer("transactions").notNull(),
  turnover: integer("turnover").notNull(),
  fee: integer("fee").notNull(),
  reserve: integer("reserve").notNull(),
  company: integer("company").notNull(),
  allocations: text("allocations").notNull(),
  status: text("status").notNull(),
  date: text("date").notNull(),
  createdAt: text("created_at").notNull(),
  note: text("note").notNull(),
});
export const entrySessions = sqliteTable(
  "entry_sessions",
  {
    hash: text("hash").primaryKey(),
    stage: text("stage").notNull(),
    keySpot: integer("key_spot").notNull(),
    walkAfter: integer("walk_after").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("entry_expiry").on(t.expiresAt)],
);
export const rewardClaims = sqliteTable("reward_claims", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  taskId: text("task_id"),
  rank: text("rank"),
  period: text("period").notNull(),
  claimKey: text("claim_key").notNull().unique(),
  criteria: text("criteria").notNull(),
  createdAt: text("created_at").notNull(),
  note: text("note").notNull(),
});

export const visitorSessions = sqliteTable("visitor_sessions", {
  hash: text("hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});
export const visitorCheckins = sqliteTable(
  "visitor_checkins",
  {
    id: text("id").primaryKey(),
    sessionHash: text("session_hash").notNull().unique(),
    name: text("name").notNull(),
    objectKey: text("object_key").notNull(),
    size: integer("size").notNull(),
    ip: text("ip").notNull(),
    country: text("country"),
    city: text("city"),
    location: text("location").notNull(),
    userAgent: text("user_agent").notNull(),
    consentVersion: text("consent_version").notNull(),
    consentAt: text("consent_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("visitor_created").on(t.createdAt)],
);
