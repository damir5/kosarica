import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	pgTable,
	serial,
	smallint,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { cuid2 } from "./custom-types";

export const todos = pgTable("todos", {
	id: serial().primaryKey(),
	title: text().notNull(),
	createdAt: timestamp("created_at").defaultNow(),
});

// Better Auth tables
export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("emailVerified").notNull(),
	image: text("image"),
	role: text("role").default("user"),
	banned: boolean("banned").default(false),
	bannedAt: timestamp("bannedAt"),
	bannedReason: text("bannedReason"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expiresAt").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	ipAddress: text("ipAddress"),
	userAgent: text("userAgent"),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("accountId").notNull(),
	providerId: text("providerId").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("accessToken"),
	refreshToken: text("refreshToken"),
	idToken: text("idToken"),
	accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
	refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expiresAt").notNull(),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt"),
});

export const passkey = pgTable("passkey", {
	id: text("id").primaryKey(),
	name: text("name"),
	publicKey: text("publicKey").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	credentialID: text("credentialID").notNull().unique(),
	counter: integer("counter").notNull(),
	deviceType: text("deviceType").notNull(),
	backedUp: boolean("backedUp").notNull(),
	transports: text("transports"),
	createdAt: timestamp("createdAt"),
});

// App Settings table
export const appSettings = pgTable("app_settings", {
	id: cuid2("cfg").primaryKey(),
	appName: text("appName").default("Kosarica"),
	requireEmailVerification: boolean("requireEmailVerification").default(false),
	minPasswordLength: integer("minPasswordLength").default(8),
	maxPasswordLength: integer("maxPasswordLength").default(128),
	passkeyEnabled: boolean("passkeyEnabled").default(true),
	updatedAt: timestamp("updatedAt").notNull(),
});

// ============================================================================
// Retail World: chains, stores, store_identifiers, retailer_items, retailer_item_barcodes
// ============================================================================

export const chains = pgTable("chains", {
	slug: text("slug").primaryKey(), // konzum, lidl, plodine, etc.
	name: text("name").notNull(),
	website: text("website"),
	logoUrl: text("logo_url"),
	createdAt: timestamp("created_at").defaultNow(),
});

export const stores = pgTable(
	"stores",
	{
		id: cuid2("sto").primaryKey(),
		chainSlug: text("chain_slug")
			.notNull()
			.references(() => chains.slug, { onDelete: "cascade" }),
		name: text("name").notNull(),
		address: text("address"),
		city: text("city"),
		postalCode: text("postal_code"),
		latitude: text("latitude"), // stored as text for precision
		longitude: text("longitude"),
		// Virtual store support
		isVirtual: boolean("is_virtual").default(true),
		priceSourceStoreId: text("price_source_store_id").references(
			(): AnyPgColumn => stores.id,
		),
		status: text("status").default("active"), // 'active' | 'pending' | 'enriched' | 'needs_review' | 'approved' | 'rejected' | 'merged' | 'failed'
		// Approval workflow tracking
		approvalNotes: text("approval_notes"), // Notes from approval/rejection
		approvedBy: text("approved_by").references(() => user.id, {
			onDelete: "set null",
		}), // User who approved/rejected
		approvedAt: timestamp("approved_at"), // When approval/rejection happened
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		chainSlugIdx: index("stores_chain_slug_idx").on(table.chainSlug),
		cityIdx: index("stores_city_idx").on(table.city),
		statusIdx: index("stores_status_idx").on(table.status),
		priceSourceIdx: index("stores_price_source_idx").on(
			table.priceSourceStoreId,
		),
		approvedByIdx: index("stores_approved_by_idx").on(table.approvedBy),
	}),
);

export const storeIdentifiers = pgTable(
	"store_identifiers",
	{
		id: cuid2("sid").primaryKey(),
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		type: text("type").notNull(), // 'filename_code', 'portal_id', 'internal_id', etc.
		value: text("value").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		storeTypeValueUnique: uniqueIndex(
			"store_identifiers_store_type_value_unique",
		).on(table.storeId, table.type, table.value),
		typeValueIdx: index("store_identifiers_type_value_idx").on(
			table.type,
			table.value,
		),
	}),
);

export const retailerItems = pgTable(
	"retailer_items",
	{
		id: cuid2("rit").primaryKey(),
		chainSlug: text("chain_slug")
			.notNull()
			.references(() => chains.slug, { onDelete: "cascade" }),
		externalId: text("external_id"), // retailer's internal ID for the item
		name: text("name").notNull(),
		description: text("description"),
		category: text("category"),
		subcategory: text("subcategory"),
		brand: text("brand"),
		unit: text("unit"), // kg, l, kom, etc.
		unitQuantity: text("unit_quantity"), // "1", "0.5", "500g", etc.
		imageUrl: text("image_url"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		chainExternalIdIdx: index("retailer_items_chain_external_id_idx").on(
			table.chainSlug,
			table.externalId,
		),
		chainNameIdx: index("retailer_items_chain_name_idx").on(
			table.chainSlug,
			table.name,
		),
	}),
);

export const retailerItemBarcodes = pgTable(
	"retailer_item_barcodes",
	{
		id: cuid2("rib").primaryKey(),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		barcode: text("barcode").notNull(), // EAN-13, EAN-8, etc.
		isPrimary: boolean("is_primary").default(false),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		barcodeIdx: index("retailer_item_barcodes_barcode_idx").on(table.barcode),
	}),
);

// ============================================================================
// Canonical Catalog: products, product_aliases, product_links, product_relations
// ============================================================================

export const products = pgTable("products", {
	id: cuid2("prd").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	category: text("category"),
	subcategory: text("subcategory"),
	brand: text("brand"),
	unit: text("unit"),
	unitQuantity: text("unit_quantity"),
	imageUrl: text("image_url"),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const productAliases = pgTable("product_aliases", {
	id: cuid2("pal").primaryKey(),
	productId: text("product_id")
		.notNull()
		.references(() => products.id, { onDelete: "cascade" }),
	alias: text("alias").notNull(), // alternative name/variant
	source: text("source"), // where this alias came from
	createdAt: timestamp("created_at").defaultNow(),
});

export const productLinks = pgTable(
	"product_links",
	{
		id: cuid2("plk").primaryKey(),
		productId: text("product_id")
			.notNull()
			.references(() => products.id, { onDelete: "cascade" }),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		confidence: text("confidence"), // 'auto', 'manual', 'verified'
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		productRetailerItemUnique: uniqueIndex(
			"product_links_product_retailer_item_unique",
		).on(table.productId, table.retailerItemId),
		// Unique constraint on retailer_item_id ensures 1:1 mapping
		// (each retailer item -> exactly one product)
		itemUniq: uniqueIndex("product_links_item_uniq").on(table.retailerItemId),
	}),
);

export const productRelations = pgTable("product_relations", {
	id: cuid2("prl").primaryKey(),
	productId: text("product_id")
		.notNull()
		.references(() => products.id, { onDelete: "cascade" }),
	relatedProductId: text("related_product_id")
		.notNull()
		.references(() => products.id, { onDelete: "cascade" }),
	relationType: text("relation_type").notNull(), // 'variant', 'substitute', 'bundle', etc.
	createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// Prices: store_item_state, store_item_price_periods
// ============================================================================

export const storeItemState = pgTable(
	"store_item_state",
	{
		id: cuid2("sis").primaryKey(),
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		currentPrice: integer("current_price"), // price in cents/lipa
		previousPrice: integer("previous_price"), // for comparison
		discountPrice: integer("discount_price"), // promotional price if active
		discountStart: timestamp("discount_start"),
		discountEnd: timestamp("discount_end"),
		inStock: boolean("in_stock").default(true),
		// Price transparency fields (Croatian regulation)
		unitPrice: integer("unit_price"), // price per unit in cents (e.g., per kg/l)
		unitPriceBaseQuantity: text("unit_price_base_quantity"), // base quantity for unit price (e.g., "1", "100")
		unitPriceBaseUnit: text("unit_price_base_unit"), // unit for unit price (e.g., "kg", "l", "kom")
		lowestPrice30d: integer("lowest_price_30d"), // lowest price in last 30 days, in cents
		anchorPrice: integer("anchor_price"), // "sidrena cijena" anchor/reference price in cents
		anchorPriceAsOf: timestamp("anchor_price_as_of"), // date when anchor price was set
		priceSignature: text("price_signature"), // hash for deduplication (excludes lowestPrice30d to avoid churn)
		lastSeenAt: timestamp("last_seen_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		storeRetailerIdx: index("store_item_state_store_retailer_idx").on(
			table.storeId,
			table.retailerItemId,
		),
		lastSeenIdx: index("store_item_state_last_seen_idx").on(table.lastSeenAt),
		priceSignatureIdx: index("store_item_state_price_signature_idx").on(
			table.priceSignature,
		),
	}),
);

export const storeItemPricePeriods = pgTable(
	"store_item_price_periods",
	{
		id: cuid2("sip").primaryKey(),
		storeItemStateId: text("store_item_state_id")
			.notNull()
			.references(() => storeItemState.id, { onDelete: "cascade" }),
		price: integer("price").notNull(), // price in cents/lipa
		discountPrice: integer("discount_price"),
		startedAt: timestamp("started_at").notNull(),
		endedAt: timestamp("ended_at"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		storeItemStateIdx: index("store_item_price_periods_state_idx").on(
			table.storeItemStateId,
		),
		timeRangeIdx: index("store_item_price_periods_time_range_idx").on(
			table.startedAt,
			table.endedAt,
		),
	}),
);

// ============================================================================
// Ingestion: ingestion_runs, ingestion_files, ingestion_file_entries, ingestion_errors
// ============================================================================

export const ingestionRuns = pgTable("ingestion_runs", {
	id: cuid2("igr").primaryKey(),
	chainSlug: text("chain_slug")
		.notNull()
		.references(() => chains.slug, { onDelete: "cascade" }),
	source: text("source").notNull(), // 'cli', 'worker', 'scheduled'
	status: text("status").notNull().default("pending"), // 'pending', 'running', 'completed', 'failed'
	startedAt: timestamp("started_at"),
	completedAt: timestamp("completed_at"),
	totalFiles: integer("total_files").default(0),
	processedFiles: integer("processed_files").default(0),
	totalEntries: integer("total_entries").default(0),
	processedEntries: integer("processed_entries").default(0),
	errorCount: integer("error_count").default(0),
	metadata: text("metadata"), // JSON for additional run info
	// Rerun support
	parentRunId: text("parent_run_id"), // FK to ingestionRuns.id for rerun tracking
	rerunType: text("rerun_type"), // 'file', 'chunk', 'entry', null for original runs
	rerunTargetId: text("rerun_target_id"), // ID of the file/chunk/entry being rerun
	createdAt: timestamp("created_at").defaultNow(),
});

export const ingestionFiles = pgTable("ingestion_files", {
	id: cuid2("igf").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => ingestionRuns.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	fileType: text("file_type").notNull(), // 'csv', 'xml', 'xlsx', 'zip'
	fileSize: integer("file_size"),
	fileHash: text("file_hash"), // for deduplication
	status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
	entryCount: integer("entry_count").default(0),
	processedAt: timestamp("processed_at"),
	metadata: text("metadata"), // JSON for file-specific info
	// Chunking support
	totalChunks: integer("total_chunks").default(0),
	processedChunks: integer("processed_chunks").default(0),
	chunkSize: integer("chunk_size"), // rows per chunk
	createdAt: timestamp("created_at").defaultNow(),
});

export const ingestionChunks = pgTable(
	"ingestion_chunks",
	{
		id: cuid2("igc").primaryKey(),
		fileId: text("file_id")
			.notNull()
			.references(() => ingestionFiles.id, { onDelete: "cascade" }),
		chunkIndex: integer("chunk_index").notNull(), // 0-based index
		startRow: integer("start_row").notNull(), // first row number in chunk
		endRow: integer("end_row").notNull(), // last row number in chunk
		rowCount: integer("row_count").notNull(),
		status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
		r2Key: text("r2_key"), // R2 object key for chunk JSON
		persistedCount: integer("persisted_count").default(0),
		errorCount: integer("error_count").default(0),
		processedAt: timestamp("processed_at"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		fileChunkIdx: index("ingestion_chunks_file_chunk_idx").on(
			table.fileId,
			table.chunkIndex,
		),
		statusIdx: index("ingestion_chunks_status_idx").on(table.status),
	}),
);

export const ingestionFileEntries = pgTable("ingestion_file_entries", {
	id: cuid2("ige").primaryKey(),
	fileId: text("file_id")
		.notNull()
		.references(() => ingestionFiles.id, { onDelete: "cascade" }),
	rowNumber: integer("row_number"),
	storeIdentifier: text("store_identifier"), // resolved to store
	itemExternalId: text("item_external_id"),
	itemName: text("item_name"),
	price: integer("price"), // price in cents/lipa
	discountPrice: integer("discount_price"),
	barcode: text("barcode"),
	rawData: text("raw_data"), // JSON of original row
	status: text("status").notNull().default("pending"), // 'pending', 'processed', 'skipped', 'failed'
	createdAt: timestamp("created_at").defaultNow(),
});

export const ingestionErrors = pgTable("ingestion_errors", {
	id: cuid2("ier").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => ingestionRuns.id, { onDelete: "cascade" }),
	fileId: text("file_id").references(() => ingestionFiles.id, {
		onDelete: "set null",
	}),
	chunkId: text("chunk_id").references(() => ingestionChunks.id, {
		onDelete: "set null",
	}),
	entryId: text("entry_id").references(() => ingestionFileEntries.id, {
		onDelete: "set null",
	}),
	errorType: text("error_type").notNull(), // 'parse', 'validation', 'store_resolution', 'persist', etc.
	errorMessage: text("error_message").notNull(),
	errorDetails: text("error_details"), // JSON with stack trace, context, etc.
	severity: text("severity").notNull().default("error"), // 'warning', 'error', 'critical'
	createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// Store Enrichment: store_enrichment_tasks
// ============================================================================

export const storeEnrichmentTasks = pgTable(
	"store_enrichment_tasks",
	{
		id: cuid2("set").primaryKey(),
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		type: text("type").notNull(), // 'geocode', 'verify_address', 'ai_categorize'
		status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
		inputData: text("input_data"), // JSON of input for the task
		outputData: text("output_data"), // JSON of output/result
		confidence: text("confidence"), // confidence level of the result (e.g., 'high', 'medium', 'low' or numeric)
		verifiedBy: text("verified_by").references(() => user.id, {
			onDelete: "set null",
		}),
		verifiedAt: timestamp("verified_at"),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		storeTypeIdx: index("store_enrichment_tasks_store_type_idx").on(
			table.storeId,
			table.type,
		),
		statusIdx: index("store_enrichment_tasks_status_idx").on(table.status),
	}),
);

// ============================================================================
// Price Groups: price_groups, group_prices, store_group_history, store_price_exceptions
// Content-addressable price storage for 50%+ storage reduction
// ============================================================================

export const priceGroups = pgTable(
	"price_groups",
	{
		id: cuid2("prg").primaryKey(),
		chainSlug: text("chain_slug")
			.notNull()
			.references(() => chains.slug, { onDelete: "cascade" }),
		priceHash: text("price_hash").notNull(), // SHA-256 hex
		hashVersion: integer("hash_version")
			.notNull()
			.default(1), // For hash algorithm versioning
		storeCount: integer("store_count").notNull().default(0),
		itemCount: integer("item_count").notNull().default(0),
		firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
		lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		chainSlugIdx: index("price_groups_chain_slug_idx").on(table.chainSlug),
		priceHashIdx: index("price_groups_price_hash_idx").on(table.priceHash),
		lastSeenIdx: index("price_groups_last_seen_idx").on(table.lastSeenAt),
		storeCountIdx: index("price_groups_store_count_idx").on(table.storeCount),
		// Content-addressable uniqueness constraint
		chainHashVersionUnique: uniqueIndex(
			"price_groups_chain_hash_unique",
		).on(table.chainSlug, table.priceHash, table.hashVersion),
	}),
);

export const groupPrices = pgTable(
	"group_prices",
	{
		priceGroupId: text("price_group_id")
			.notNull()
			.references(() => priceGroups.id, { onDelete: "cascade" }),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		price: integer("price").notNull(), // cents/lipa, NOT NULL
		discountPrice: integer("discount_price"), // NULL = no discount (distinct from 0!)
		unitPrice: integer("unit_price"), // price per unit in cents (e.g., per kg/l)
		anchorPrice: integer("anchor_price"), // "sidrena cijena" anchor/reference price in cents
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		// Composite primary key
		priceGroupRetailerItemPk: uniqueIndex(
			"group_prices_pkey",
		).on(table.priceGroupId, table.retailerItemId),
		priceGroupIdIdx: index("group_prices_price_group_id_idx").on(
			table.priceGroupId,
		),
		retailerItemIdIdx: index("group_prices_retailer_item_id_idx").on(
			table.retailerItemId,
		),
	}),
);

export const storeGroupHistory = pgTable(
	"store_group_history",
	{
		id: cuid2("sgh").primaryKey(),
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		priceGroupId: text("price_group_id")
			.notNull()
			.references(() => priceGroups.id, { onDelete: "cascade" }),
		validFrom: timestamp("valid_from").notNull(),
		validTo: timestamp("valid_to"), // NULL = current membership
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		storeIdIdx: index("store_group_history_store_id_idx").on(table.storeId),
		priceGroupIdIdx: index("store_group_history_price_group_id_idx").on(
			table.priceGroupId,
		),
		validFromIdx: index("store_group_history_valid_from_idx").on(
			table.validFrom,
		),
		// Partial unique index for current membership (valid_to IS NULL)
		// Ensures each store has exactly one current price group
		currentMembershipUnique: uniqueIndex(
			"store_group_history_current",
		).on(table.storeId).where(sql`valid_to IS NULL`),
		// Note: GiST exclusion constraint for no-overlap must be added manually in SQL
		// as Drizzle doesn't support EXCLUDE constraints natively
	}),
);

export const storePriceExceptions = pgTable(
	"store_price_exceptions",
	{
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		price: integer("price").notNull(), // cents/lipa
		discountPrice: integer("discount_price"), // NULL = no discount (distinct from 0!)
		reason: text("reason").notNull(), // why this exception exists
		expiresAt: timestamp("expires_at").notNull(), // exceptions MUST expire
		createdAt: timestamp("created_at").notNull().defaultNow(),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => ({
		// Composite primary key
		storeRetailerItemPk: uniqueIndex(
			"store_price_exceptions_pkey",
		).on(table.storeId, table.retailerItemId),
		storeIdIdx: index("store_price_exceptions_store_id_idx").on(
			table.storeId,
		),
		retailerItemIdIdx: index("store_price_exceptions_retailer_item_id_idx").on(
			table.retailerItemId,
		),
		expiresAtIdx: index("store_price_exceptions_expires_at_idx").on(
			table.expiresAt,
		),
	}),
);

// ============================================================================
// Product Matching: Match candidates, review queue, rejections, audit
// ============================================================================

// Product match candidates - supports top-N suggestions per item with versioning
export const productMatchCandidates = pgTable(
	"product_match_candidates",
	{
		id: cuid2("pmc").primaryKey(),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		candidateProductId: text("candidate_product_id").references(() => products.id, {
			onDelete: "cascade",
		}),
		similarity: text("similarity"), // stored as text to match real type in Go
		matchType: text("match_type").notNull(), // 'barcode', 'ai', 'trgm', 'heuristic'
		rank: smallint("rank").default(1), // 1 = best candidate
		flags: text("flags"), // 'suspicious_barcode', 'private_label', etc.
		// Versioning for invalidation
		matchingRunId: text("matching_run_id"), // Which run generated this
		modelVersion: text("model_version"), // e.g., 'text-embedding-3-small-v1'
		normalizedTextHash: text("normalized_text_hash"), // Hash of input text for cache invalidation
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		itemIdx: index("pmc_item_idx").on(table.retailerItemId),
		typeIdx: index("pmc_type_idx").on(table.matchType),
		// Prevent duplicate candidates per item
		itemCandidateUniq: uniqueIndex("pmc_item_candidate_uniq").on(
			table.retailerItemId,
			table.candidateProductId,
		),
		// Unique rank per item
		itemRankUniq: uniqueIndex("pmc_item_rank_uniq").on(
			table.retailerItemId,
			table.rank,
		),
	}),
);

// Review queue with audit trail
export const productMatchQueue = pgTable(
	"product_match_queue",
	{
		id: cuid2("pmq").primaryKey(),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		status: text("status").default("pending"), // pending, approved, rejected, skipped
		decision: text("decision"), // 'linked', 'new_product', 'no_match'
		linkedProductId: text("linked_product_id").references(() => products.id),
		reviewedBy: text("reviewed_by").references(() => user.id),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		reviewNotes: text("review_notes"),
		// Version for optimistic locking (prevents concurrent review conflicts)
		version: integer("version").default(1),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		statusIdx: index("pmq_status_idx").on(table.status),
		itemUniq: uniqueIndex("pmq_item_uniq").on(table.retailerItemId),
	}),
);

// Scoped rejections - reject specific candidates, not global block
export const productMatchRejections = pgTable(
	"product_match_rejections",
	{
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		rejectedProductId: text("rejected_product_id")
			.notNull()
			.references(() => products.id, { onDelete: "cascade" }),
		reason: text("reason"), // 'wrong_product', 'different_size', 'private_label', etc.
		rejectedBy: text("rejected_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		// Composite primary key on (retailerItemId, rejectedProductId)
		pk: uniqueIndex("product_match_rejections_pk").on(
			table.retailerItemId,
			table.rejectedProductId,
		),
	}),
);

// Audit log - with proper FK
export const productMatchAudit = pgTable(
	"product_match_audit",
	{
		id: cuid2("pma").primaryKey(),
		queueId: text("queue_id")
			.notNull()
			.references(() => productMatchQueue.id, { onDelete: "cascade" }), // FK!
		action: text("action").notNull(), // 'approved', 'rejected', 'created', 'unlinked'
		userId: text("user_id").references(() => user.id),
		previousState: text("previous_state"), // JSON stored as text
		newState: text("new_state"), // JSON stored as text
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		queueIdIdx: index("product_match_audit_queue_id_idx").on(table.queueId),
		actionIdx: index("product_match_audit_action_idx").on(table.action),
	}),
);

// Canonical barcodes - with nullable product_id for race-safe creation
export const canonicalBarcodes = pgTable(
	"canonical_barcodes",
	{
		barcode: text("barcode").primaryKey(),
		productId: text("product_id").references(() => products.id, {
			onDelete: "cascade",
		}), // NULLABLE for placeholder pattern
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		productIdIdx: index("canonical_barcodes_product_id_idx").on(table.productId),
	}),
);
