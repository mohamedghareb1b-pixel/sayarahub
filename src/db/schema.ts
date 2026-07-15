import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["owner", "sales"]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["free", "pro"]);
export const joinRequestStatusEnum = pgEnum("join_request_status", [
  "pending",
  "approved",
  "rejected",
]);
export const salesInviteStatusEnum = pgEnum("sales_invite_status", [
  "pending",
  "accepted",
  "rejected",
]);
export const sourceTypeEnum = pgEnum("source_type", [
  "whatsapp_structured",
  "whatsapp_freetext",
  "whatsapp_forward",
  "whatsapp_group",
  "excel",
  "word",
  "web",
  "admin_manual",
]);
export const classificationEnum = pgEnum("classification", [
  "supply",
  "demand",
  "unknown",
  "ignore",
]);
export const rawImportStatusEnum = pgEnum("raw_import_status", [
  "pending",
  "pending_ai",
  "parsed",
  "rejected",
]);
export const inventoryStatusEnum = pgEnum("inventory_status", [
  "available",
  "processing",
  "reserved",
  "sold",
  "expired",
]);
export const requestStatusEnum = pgEnum("request_status", [
  "open",
  "matched",
  "fulfilled",
  "expired",
  "cancelled",
]);
export const matchStatusEnum = pgEnum("match_status", [
  "pending_confirmation",
  "confirmed_available",
  "connected",
  "declined",
  "expired",
  "no_response",
]);
export const messageTypeEnum = pgEnum("message_type", [
  "service_reply",
  "utility",
  "daily_ping",
]);
export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "retry",
]);
export const chatDirectionEnum = pgEnum("chat_direction", ["in", "out"]);

// ── Showrooms ────────────────────────────────────────────────────────────
export const showrooms = pgTable("showrooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  ownerUserId: uuid("owner_user_id"),
  nextSalespersonIndex: integer("next_salesperson_index").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  subscriptionPlan: subscriptionPlanEnum("subscription_plan").notNull().default("free"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '30 days'`),
  monthlyConfirmedMatches: integer("monthly_confirmed_matches").notNull().default(0),
  maxConfirmedMatches: integer("max_confirmed_matches").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Users (WhatsApp identities) ─────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  showroomId: uuid("showroom_id").references(() => showrooms.id),
  role: userRoleEnum("role").notNull().default("sales"),
  isActive: boolean("is_active").notNull().default(true),
  isActiveToday: boolean("is_active_today").notNull().default(false),
  lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
  freeWindowUntil: timestamp("free_window_until", { withTimezone: true }),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  conversationState: jsonb("conversation_state").notNull().default({ step: "ask_role" }),
  weeklyMatchCount: integer("weekly_match_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyCheckins = pgTable(
  "daily_checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkinDate: text("checkin_date").notNull().default(sql`to_char(now(), 'YYYY-MM-DD')`),
  },
  (t) => [uniqueIndex("idx_checkin_unique").on(t.userId, t.checkinDate)],
);

export const joinRequests = pgTable("join_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  showroomId: uuid("showroom_id").references(() => showrooms.id),
  status: joinRequestStatusEnum("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});

export const salesInvites = pgTable("sales_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  showroomId: uuid("showroom_id").references(() => showrooms.id),
  phone: text("phone").notNull(),
  invitedBy: uuid("invited_by").references(() => users.id),
  status: salesInviteStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Raw imports (group / free text / excel ingestion) ───────────────────
export const rawImports = pgTable("raw_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  showroomId: uuid("showroom_id").references(() => showrooms.id),
  rawText: text("raw_text"),
  fileUrl: text("file_url"),
  sourceType: sourceTypeEnum("source_type").notNull().default("whatsapp_freetext"),
  sourceGroupName: text("source_group_name"),
  senderPhone: text("sender_phone"),
  senderName: text("sender_name"),
  classification: classificationEnum("classification").notNull().default("unknown"),
  status: rawImportStatusEnum("status").notNull().default("pending"),
  parsedData: jsonb("parsed_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Inventory ────────────────────────────────────────────────────────────
export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showroomId: uuid("showroom_id")
      .notNull()
      .references(() => showrooms.id),
    addedBy: uuid("added_by").references(() => users.id),
    rawImportId: uuid("raw_import_id").references(() => rawImports.id),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
    trim: text("trim"),
    color: text("color"),
    interiorColor: text("interior_color"),
    extraFeatures: text("extra_features"),
    engineSize: text("engine_size"),
    spec: text("spec"),
    city: text("city").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    priceNote: text("price_note"),
    quantity: integer("quantity").notNull().default(1),
    fingerprint: text("fingerprint").notNull(),
    status: inventoryStatusEnum("status").notNull().default("available"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_inventory_search").on(t.brand, t.model, t.year, t.status, t.expiresAt),
    uniqueIndex("idx_inventory_fingerprint")
      .on(t.showroomId, t.fingerprint)
      .where(sql`status = 'available'`),
  ],
);

// ── Requests ─────────────────────────────────────────────────────────────
export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showroomId: uuid("showroom_id")
      .notNull()
      .references(() => showrooms.id),
    requestedBy: uuid("requested_by").references(() => users.id),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
    trim: text("trim"),
    color: text("color"),
    interiorColor: text("interior_color"),
    extraFeatures: text("extra_features"),
    engineSize: text("engine_size"),
    spec: text("spec"),
    city: text("city").notNull(),
    acceptOtherCities: boolean("accept_other_cities").notNull().default(false),
    fingerprint: text("fingerprint").notNull(),
    status: requestStatusEnum("status").notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '12 hours'`),
    renewedCount: integer("renewed_count").notNull().default(0),
    reminderSent: boolean("reminder_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_requests_search").on(t.brand, t.model, t.year, t.status, t.expiresAt)],
);

// ── Matches ──────────────────────────────────────────────────────────────
export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => requests.id),
  inventoryId: uuid("inventory_id")
    .notNull()
    .references(() => inventory.id),
  requestShowroomId: uuid("request_showroom_id").references(() => showrooms.id),
  inventoryShowroomId: uuid("inventory_showroom_id").references(() => showrooms.id),
  matchScore: integer("match_score").notNull().default(0),
  status: matchStatusEnum("status").notNull().default("pending_confirmation"),
  confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  respondingUserId: uuid("responding_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Message queue (WhatsApp outbound, cost tracking) ─────────────────────
export const messageQueue = pgTable(
  "message_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toPhone: text("to_phone").notNull(),
    toUserId: uuid("to_user_id").references(() => users.id),
    messageType: messageTypeEnum("message_type").notNull().default("service_reply"),
    templateName: text("template_name"),
    templateParams: jsonb("template_params"),
    body: text("body"),
    buttons: jsonb("buttons"),
    isFree: boolean("is_free").notNull().default(true),
    status: messageStatusEnum("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_queue_pending").on(t.status, t.createdAt)],
);

// ── Bot vocabulary (managed from /admin — teaches the bot new terms) ──────
// يسمح لصاحب المنصة بإضافة مرادفات موديلات (زي "راف4" => تويوتا/راف فور)،
// فئات جديدة، ألوان جديدة، أو ملاحظات إضافية (زي "سقف اسود") بدون تعديل كود.
export const vocabularyCategoryEnum = pgEnum("vocabulary_category", [
  "trim",
  "color",
  "feature",
  "model_alias",
]);

export const vocabularyTerms = pgTable(
  "vocabulary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: vocabularyCategoryEnum("category").notNull(),
    term: text("term").notNull(), // النص اللي المستخدم ممكن يكتبه، مثل "راف4" أو "سقف اسود"
    canonicalValue: text("canonical_value").notNull(), // القيمة الرسمية المخزنة، مثل "راف فور"
    brand: text("brand"), // فقط لفئة model_alias: الماركة الرسمية
    model: text("model"), // فقط لفئة model_alias: الموديل الرسمي
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idx_vocab_term_category").on(t.term, t.category)],
);
// كل نص طُبّع وأُرسل من مستخدم ووافق البوت على تحليله (أو صححه) يتخزن هنا.
// المرة الجاية اللي حد يكتب نص طبيعي مشابه، بنرجع النتيجة المحفوظة مباشرة
// بدل ما نعيد التحليل بالقواعد أو بالذكاء الاصطناعي من الصفر.
export const parseCorrections = pgTable(
  "parse_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalizedText: text("normalized_text").notNull(),
    rawTextSample: text("raw_text_sample").notNull(),
    parsedResult: jsonb("parsed_result").notNull(),
    source: text("source").notNull().default("user_confirmed"), // user_confirmed | user_edited | admin_manual
    hitCount: integer("hit_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idx_parse_corrections_text").on(t.normalizedText)],
);

// ── Chat transcript (used by the bot simulator + webhook) ────────────────
export const chatLog = pgTable("chat_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull(),
  direction: chatDirectionEnum("direction").notNull(),
  body: text("body").notNull(),
  buttons: jsonb("buttons"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
