import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const kycStatusEnum = pgEnum("kyc_status", [
  "pending",
  "approved",
  "rejected",
]);

export const kycSubmissionsTable = pgTable(
  "kyc_submissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    documentType: text("document_type").notNull(),
    documentNumber: text("document_number").notNull(),
    idDocumentKey: text("id_document_key").notNull(),
    selfieKey: text("selfie_key").notNull(),
    status: kycStatusEnum("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    reviewedBy: text("reviewed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("kyc_user_id_idx").on(t.userId),
    index("kyc_status_idx").on(t.status),
  ],
);

export type KycSubmission = typeof kycSubmissionsTable.$inferSelect;
export type KycStatus = (typeof kycStatusEnum.enumValues)[number];
