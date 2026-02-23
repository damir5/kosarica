import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	bigserial,
	boolean,
	check,
	date,
	index,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { cuid2, pgVector, typedJsonb } from "./custom-types";
import {
	archiveMetadata,
	catalogEventPayload,
	cronJobPayload,
	cronRunMetadata,
	llmDecisionInput,
	llmDecisionOutput,
	taskQueuePayload,
	validationErrors,
} from "./jsonb-schemas";

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

// Better Auth API Key plugin table
export const apikey = pgTable(
	"apikey",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		start: text("start"),
		prefix: text("prefix"),
		key: text("key").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		refillInterval: integer("refillInterval"),
		refillAmount: integer("refillAmount"),
		lastRefillAt: timestamp("lastRefillAt"),
		enabled: boolean("enabled").default(true),
		rateLimitEnabled: boolean("rateLimitEnabled").default(true),
		rateLimitTimeWindow: integer("rateLimitTimeWindow"),
		rateLimitMax: integer("rateLimitMax"),
		requestCount: integer("requestCount").default(0),
		remaining: integer("remaining"),
		lastRequest: timestamp("lastRequest"),
		expiresAt: timestamp("expiresAt"),
		createdAt: timestamp("createdAt").notNull(),
		updatedAt: timestamp("updatedAt").notNull(),
		permissions: text("permissions"),
		metadata: text("metadata"),
	},
	(table) => ({
		keyIdx: index("apikey_key_idx").on(table.key),
		userIdIdx: index("apikey_user_id_idx").on(table.userId),
	}),
);

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
		displayName: text("display_name"),
		displayNameManual: boolean("display_name_manual").default(false),
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
		// Denormalized for fast/deterministic store resolution. Backfilled from stores.chain_slug.
		chainSlug: text("chain_slug")
			.notNull()
			.references(() => chains.slug, { onDelete: "cascade" }),
		type: text("type").notNull(), // 'filename_code', 'portal_id', 'internal_id', etc.
		value: text("value").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		storeTypeValueUnique: uniqueIndex(
			"store_identifiers_store_type_value_unique",
		).on(table.storeId, table.type, table.value),
		chainTypeValueIdx: index("store_identifiers_chain_type_value_idx").on(
			table.chainSlug,
			table.type,
			table.value,
		),
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
		isPrimary: boolean("is_primary").default(false),
		createdAt: timestamp("created_at").defaultNow(),
		name: text("name").notNull(),
		externalId: text("external_id"),
		description: text("description"),
		brand: text("brand"),
		category: text("category"),
		subcategory: text("subcategory"),
		unit: text("unit"),
		unitQuantity: text("unit_quantity"),
		imageUrl: text("image_url"),
		chainSlug: text("chain_slug"),
		// Archive tracking for traceability
		archiveId: text("archive_id").references(() => archives.id, {
			onDelete: "set null",
		}),
		// Dedup: normalized name hash for items without externalId
		normalizedNameHash: text("normalized_name_hash"),
		// Soft-delete dedup: points to the surviving item after merge
		mergedIntoId: text("merged_into_id").references(
			(): AnyPgColumn => retailerItems.id,
		),
		// Override protection: tracks who set category/unit values
		categoryOverrideBy: text("category_override_by"), // 'manual', 'ai', 'auto', null
		unitOverrideBy: text("unit_override_by"), // 'manual', 'ai', 'auto', null
		// Normalized unit data
		normalizedUnit: text("normalized_unit"), // "kg", "l", "kom"
		normalizedQuantity: real("normalized_quantity"), // 0.5, 1.98
	},
	(table) => ({
		archiveIdIdx: index("idx_retailer_items_archive_id").on(table.archiveId),
		// Unique index for finding items by chain and external ID
		chainExternalIdUnique: uniqueIndex(
			"retailer_items_chain_slug_external_id_unique",
		).on(table.chainSlug, table.externalId),
		// Index for name-hash dedup lookups
		chainNameHashIdx: index("retailer_items_chain_name_hash_idx").on(
			table.chainSlug,
			table.normalizedNameHash,
		),
		// Index for filtering out merged items (used by all matching queries)
		mergedIntoIdx: index("retailer_items_merged_into_id_idx").on(
			table.mergedIntoId,
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
		barcode: text("barcode").notNull(), // EAN-13, EAN-8, GTIN codes
		barcodeClass: text("barcode_class").notNull().default("unknown"),
		isPrimary: boolean("is_primary").default(false),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		retailerItemIdIdx: index("retailer_item_barcodes_retailer_item_id_idx").on(
			table.retailerItemId,
		),
		barcodeIdx: index("retailer_item_barcodes_barcode_new_idx").on(
			table.barcode,
		),
		barcodeClassIdx: index("retailer_item_barcodes_barcode_class_idx").on(
			table.barcodeClass,
		),
		barcodeItemIdx: index("retailer_item_barcodes_barcode_item_idx").on(
			table.barcode,
			table.retailerItemId,
		),
		// Ensure unique barcode per retailer item
		retailerItemBarcodeUnique: uniqueIndex(
			"retailer_item_barcodes_item_barcode_unique",
		).on(table.retailerItemId, table.barcode),
	}),
);

// ============================================================================
// Archives: track all downloaded files
// ============================================================================

export const archives = pgTable(
	"archives",
	{
		id: text("id").primaryKey(),
		chainSlug: text("chain_slug").notNull(),
		sourceUrl: text("source_url").notNull(),
		filename: text("filename").notNull(),
		originalFormat: text("original_format").notNull(),
		archivePath: text("archive_path").notNull(),
		archiveType: text("archive_type").notNull(),
		contentType: text("content_type"),
		fileSize: bigint("file_size", { mode: "number" }),
		compressedSize: bigint("compressed_size", { mode: "number" }),
		isCompressed: boolean("is_compressed").default(false),
		checksum: text("checksum").notNull(),
		downloadedAt: timestamp("downloaded_at", { withTimezone: true }).notNull(),
		metadata: typedJsonb(archiveMetadata, "metadata").default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		runId: text("run_id"),
	},
	(table) => ({
		chainSlugIdx: index("idx_archives_chain_slug").on(table.chainSlug),
		downloadedAtIdx: index("idx_archives_downloaded_at").on(table.downloadedAt),
		checksumIdx: index("idx_archives_checksum").on(table.checksum),
		chainDownloadedIdx: index("idx_archives_chain_downloaded").on(
			table.chainSlug,
			table.downloadedAt,
		),
		runIdIdx: index("idx_archives_run_id").on(table.runId),
	}),
);

// ============================================================================
// Parquet Files: track generated Parquet files and ClickHouse import status
// ============================================================================

export const parquetFiles = pgTable(
	"parquet_files",
	{
		id: cuid2("pqf").primaryKey(),
		chainSlug: text("chain_slug")
			.notNull()
			.references(() => chains.slug, { onDelete: "cascade" }),
		targetDate: date("target_date").notNull(),
		storageKey: text("storage_key").notNull(),
		fileSize: bigint("file_size", { mode: "number" }),
		checksum: text("checksum"),
		importedAt: timestamp("imported_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		chainDateIdx: index("idx_parquet_files_chain_date").on(
			table.chainSlug,
			table.targetDate,
		),
		storageKeyIdx: uniqueIndex("parquet_files_storage_key_unique").on(
			table.storageKey,
		),
		chainDateUnique: uniqueIndex("parquet_files_chain_date_unique").on(
			table.chainSlug,
			table.targetDate,
		),
		importedAtIdx: index("idx_parquet_files_imported_at").on(table.importedAt),
	}),
);

// ============================================================================
// Ingestion: ingestion_runs, ingestion_files, ingestion_file_entries, ingestion_errors
// ============================================================================

export const ingestionRuns = pgTable(
	"ingestion_runs",
	{
		id: text("id").primaryKey(), // CUID2 format: run_xxx
		chainSlug: text("chain_slug")
			.notNull()
			.references(() => chains.slug, { onDelete: "cascade" }),
		source: text("source").notNull(), // 'cli', 'worker', 'scheduled'
		status: text("status").notNull().default("pending"), // 'pending', 'running', 'completed', 'failed'
		statusReason: text("status_reason"),
		statusSeverity: text("status_severity"), // 'warning', 'error', 'critical'
		statusType: text("status_type"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		totalFiles: integer("total_files").default(0),
		processedFiles: integer("processed_files").default(0),
		totalEntries: integer("total_entries").default(0),
		processedEntries: integer("processed_entries").default(0),
		errorCount: integer("error_count").default(0),
		metadata: text("metadata"), // JSON for additional run info
		// Archive tracking
		archiveId: text("archive_id").references(() => archives.id, {
			onDelete: "set null",
		}),
		sourceUrl: text("source_url"),
		// Rerun support
		parentRunId: text("parent_run_id"), // FK to ingestionRuns.id for rerun tracking
		rerunType: text("rerun_type"), // 'file', 'chunk', 'entry', null for original runs
		rerunTargetId: text("rerun_target_id"), // ID of file/chunk/entry being rerun
		// Target date for duplicate detection
		targetDate: timestamp("target_date", { withTimezone: true }),
		isForced: boolean("is_forced").default(false),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		archiveIdIdx: index("idx_ingestion_runs_archive_id").on(table.archiveId),
		// Fast duplicate detection by chain and date
		chainDateIdx: index("idx_ingestion_runs_chain_date").on(
			table.chainSlug,
			table.targetDate,
		),
		// Partial index for active runs only (pending, running)
		activeRunsIdx: index("idx_ingestion_runs_active").on(
			table.chainSlug,
			table.targetDate,
			table.status,
		),
	}),
);

export const ingestionFiles = pgTable("ingestion_files", {
	id: bigserial({ mode: "bigint" }).primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => ingestionRuns.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	fileType: text("file_type").notNull(), // 'csv', 'xml', 'xlsx', 'zip'
	fileSize: integer("file_size"),
	fileHash: text("file_hash"), // for deduplication
	status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
	statusReason: text("status_reason"),
	statusSeverity: text("status_severity"), // 'warning', 'error', 'critical'
	statusType: text("status_type"),
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
		fileId: bigint("file_id", { mode: "bigint" })
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

export const ingestionErrors = pgTable("ingestion_errors", {
	id: bigserial({ mode: "bigint" }).primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => ingestionRuns.id, { onDelete: "cascade" }),
	fileId: bigint("file_id", { mode: "bigint" }).references(
		() => ingestionFiles.id,
		{
			onDelete: "set null",
		},
	),
	chunkId: text("chunk_id").references(() => ingestionChunks.id, {
		onDelete: "set null",
	}),
	entryId: text("entry_id"), // orphaned - ingestion_file_entries table removed
	errorType: text("error_type").notNull(), // 'parse', 'validation', 'store_resolution', 'persist', etc.
	errorMessage: text("error_message").notNull(),
	errorDetails: text("error_details"), // JSON with stack trace, context, etc.
	severity: text("severity").notNull().default("error"), // 'warning', 'error', 'critical'
	createdAt: timestamp("created_at").defaultNow(),
});

export const ingestionStoreStats = pgTable(
	"ingestion_store_stats",
	{
		id: bigserial({ mode: "bigint" }).primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => ingestionRuns.id, { onDelete: "cascade" }),
		fileId: bigint("file_id", { mode: "bigint" })
			.notNull()
			.references(() => ingestionFiles.id, { onDelete: "cascade" }),
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		storeIdentifier: text("store_identifier").notNull(),
		rowCount: integer("row_count").notNull().default(0),
		persistedCount: integer("persisted_count").notNull().default(0),
		priceChanges: integer("price_changes").notNull().default(0),
		failedRows: integer("failed_rows").notNull().default(0),
		warningRows: integer("warning_rows").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		runIdx: index("ingestion_store_stats_run_idx").on(table.runId),
		fileIdx: index("ingestion_store_stats_file_idx").on(table.fileId),
		storeIdx: index("ingestion_store_stats_store_idx").on(table.storeId),
	}),
);

// Failed rows archive for analysis and re-processing
export const retailerItemsFailed = pgTable("retailer_items_failed", {
	id: cuid2("id").primaryKey(),
	chainSlug: text("chain_slug").notNull(),
	runId: text("run_id").references(() => ingestionRuns.id, {
		onDelete: "cascade",
	}),
	fileId: bigint("file_id", { mode: "bigint" }).references(
		() => ingestionFiles.id,
		{
			onDelete: "cascade",
		},
	),
	storeIdentifier: text("store_identifier"),
	rowNumber: integer("row_number"),
	rawData: text("raw_data").notNull(), // Full CSV row data for analysis
	validationErrors: typedJsonb(validationErrors, "validation_errors").notNull(),
	failedAt: timestamp("failed_at").defaultNow(),
	reviewed: boolean("reviewed").default(false),
	reviewedBy: text("reviewed_by"),
	reviewNotes: text("review_notes"),
	reprocessable: boolean("reprocessable").default(true),
	reprocessedAt: timestamp("reprocessed_at"),
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
// Semantic Clustering V2: features, pair decisions, clusters
// ============================================================================

export const containerTypes = pgTable("container_types", {
	code: text("code").primaryKey(),
	label: text("label").notNull(),
});

export const retailerItemFeatures = pgTable(
	"retailer_item_features",
	{
		id: cuid2("rif").primaryKey(),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		normalizedName: text("normalized_name").notNull(),
		normalizedCategory: text("normalized_category"),
		extractedBrand: text("extracted_brand"),
		extractedAmount: real("extracted_amount"),
		extractedUnit: text("extracted_unit"),
		isCountItem: boolean("is_count_item").notNull().default(false),
		isMultipack: boolean("is_multipack").notNull().default(false),
		packAmount: integer("pack_amount").notNull().default(1),
		unitAmount: real("unit_amount"),
		totalAmount: real("total_amount"),
		containerType: text("container_type").references(() => containerTypes.code),
		everydayName: text("everyday_name"),
		productType: text("product_type"),
		variant: text("variant"),
		searchTags: text("search_tags").array(),
		categorizedAt: timestamp("categorized_at"),
		categorizationModel: text("categorization_model"),
		categorizationConfidence: real("categorization_confidence"),
		categorizationNeedsReview: boolean("categorization_needs_review")
			.notNull()
			.default(false),
		embedding: pgVector("embedding", 1024),
		blockingKeys: text("blocking_keys").array(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		itemUnique: uniqueIndex("retailer_item_features_item_uniq").on(
			table.retailerItemId,
		),
		categoryBrandIdx: index("retailer_item_features_category_brand_idx").on(
			table.normalizedCategory,
			table.extractedBrand,
		),
		unitAmountIdx: index("retailer_item_features_unit_amount_idx").on(
			table.extractedUnit,
			table.totalAmount,
		),
		productTypeIdx: index("retailer_item_features_product_type_idx").on(
			table.productType,
		),
		categorizedAtIdx: index("retailer_item_features_categorized_at_idx").on(
			table.categorizedAt,
		),
		needsReviewIdx: index("retailer_item_features_needs_review_idx").on(
			table.categorizationNeedsReview,
		),
		updatedAtIdx: index("retailer_item_features_updated_at_idx").on(
			table.updatedAt,
		),
	}),
);

export const semanticPairDecisions = pgTable(
	"semantic_pair_decisions",
	{
		itemAId: text("item_a_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		itemBId: text("item_b_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		method: text("method").notNull(),
		similarityScore: real("similarity_score"),
		llmVerdict: text("llm_verdict"),
		llmConfidence: real("llm_confidence"),
		llmReasoning: text("llm_reasoning"),
		votesJson: text("votes_json"),
		consensusScore: real("consensus_score"),
		humanVerdict: text("human_verdict"),
		finalVerdict: text("final_verdict"),
		finalConfidence: real("final_confidence"),
		finalStatus: text("final_status").notNull().default("PENDING_REVIEW"),
		systemError: text("system_error"),
		reviewedBy: text("reviewed_by").references(() => user.id),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		pairUnique: uniqueIndex("semantic_pair_decisions_pair_uniq").on(
			table.itemAId,
			table.itemBId,
		),
		statusIdx: index("semantic_pair_decisions_status_idx").on(table.finalStatus),
		llmVerdictIdx: index("semantic_pair_decisions_llm_verdict_idx").on(
			table.llmVerdict,
		),
		methodIdx: index("semantic_pair_decisions_method_idx").on(table.method),
	}),
);

// ============================================================================
// Canonical Catalog: canonical SKUs, item links, barcode mappings, event log
// ============================================================================

export const canonicalSkus = pgTable(
	"canonical_skus",
	{
		id: cuid2("csku").primaryKey(),
		baseProductId: text("base_product_id").references(
			(): AnyPgColumn => canonicalSkus.id,
			{ onDelete: "set null" },
		),
		mergedIntoId: text("merged_into_id").references(
			(): AnyPgColumn => canonicalSkus.id,
			{ onDelete: "set null" },
		),
		canonicalName: text("canonical_name").notNull(),
		everydayName: text("everyday_name"),
		brand: text("brand"),
		productType: text("product_type"),
		normalizedUnit: text("normalized_unit"),
		normalizedQuantity: real("normalized_quantity"),
		packAmount: integer("pack_amount").notNull().default(1),
		containerType: text("container_type"),
		isBaseProduct: boolean("is_base_product").notNull().default(false),
		matchPolicy: text("match_policy").notNull().default("matchable"),
		status: text("status").notNull().default("draft"),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		baseProductIdx: index("canonical_skus_base_product_idx").on(
			table.baseProductId,
		),
		mergedIntoIdx: index("canonical_skus_merged_into_idx").on(table.mergedIntoId),
		statusIdx: index("canonical_skus_status_idx").on(table.status),
		matchPolicyIdx: index("canonical_skus_match_policy_idx").on(table.matchPolicy),
		activeNameIdx: index("canonical_skus_active_name_idx")
			.on(table.canonicalName)
			.where(sql`status = 'active'`),
		matchPolicyCheck: check(
			"canonical_skus_match_policy_check",
			sql`match_policy IN ('matchable', 'private_label', 'non_comparable')`,
		),
		statusCheck: check(
			"canonical_skus_status_check",
			sql`status IN ('draft', 'active', 'merged', 'deprecated')`,
		),
		baseProductInvariantCheck: check(
			"canonical_skus_base_product_invariant_check",
			sql`(is_base_product = false) OR base_product_id IS NULL`,
		),
		activeVariantBaseCheck: check(
			"canonical_skus_active_variant_base_check",
			sql`(is_base_product = true) OR (status <> 'active') OR (base_product_id IS NOT NULL)`,
		),
		mergedStatusTargetCheck: check(
			"canonical_skus_merged_status_target_check",
			sql`(status <> 'merged') OR (merged_into_id IS NOT NULL)`,
		),
	}),
);

export const barcodeSkuMappings = pgTable(
	"barcode_sku_mappings",
	{
		id: cuid2("bsm").primaryKey(),
		barcode: text("barcode").notNull(),
		canonicalSkuId: text("canonical_sku_id")
			.notNull()
			.references(() => canonicalSkus.id, { onDelete: "cascade" }),
		confidence: real("confidence").notNull().default(1),
		source: text("source").notNull(),
		verifiedBy: text("verified_by").references(() => user.id, {
			onDelete: "set null",
		}),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		barcodeUnique: uniqueIndex("barcode_sku_mappings_barcode_unique").on(
			table.barcode,
		),
		skuIdx: index("barcode_sku_mappings_sku_idx").on(table.canonicalSkuId),
		sourceIdx: index("barcode_sku_mappings_source_idx").on(table.source),
		verifiedByIdx: index("barcode_sku_mappings_verified_by_idx").on(
			table.verifiedBy,
		),
		confidenceCheck: check(
			"barcode_sku_mappings_confidence_check",
			sql`confidence >= 0 AND confidence <= 1`,
		),
		sourceCheck: check(
			"barcode_sku_mappings_source_check",
			sql`source IN ('barcode_cluster', 'llm', 'manual')`,
		),
	}),
);

export const skuItemLinks = pgTable(
	"sku_item_links",
	{
		id: cuid2("sil").primaryKey(),
		canonicalSkuId: text("canonical_sku_id")
			.notNull()
			.references(() => canonicalSkus.id, { onDelete: "cascade" }),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		linkType: text("link_type").notNull(),
		confidence: real("confidence"),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		itemUnique: uniqueIndex("sku_item_links_item_unique").on(table.retailerItemId),
		skuItemUnique: uniqueIndex("sku_item_links_sku_item_unique").on(
			table.canonicalSkuId,
			table.retailerItemId,
		),
		skuIdx: index("sku_item_links_sku_idx").on(table.canonicalSkuId),
		linkTypeIdx: index("sku_item_links_link_type_idx").on(table.linkType),
		confidenceCheck: check(
			"sku_item_links_confidence_check",
			sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 1)`,
		),
		linkTypeCheck: check(
			"sku_item_links_link_type_check",
			sql`link_type IN ('barcode', 'llm', 'manual', 'feature_match')`,
		),
	}),
);

export const llmEndpoints = pgTable(
	"llm_endpoints",
	{
		id: cuid2("lep").primaryKey(),
		name: text("name").notNull(),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		endpoint: text("endpoint").notNull(),
		apiKeyEnv: text("api_key_env").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		baseWeight: real("base_weight").notNull().default(1),
		timeoutMs: integer("timeout_ms").notNull().default(20_000),
		maxRetries: integer("max_retries").notNull().default(1),
		responseFormat: text("response_format"),
		jsonSchemaNullable: boolean("json_schema_nullable")
			.notNull()
			.default(false),
		maxTokens: integer("max_tokens"),
		modelClass: text("model_class").notNull().default("standard"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		enabledIdx: index("llm_endpoints_enabled_idx").on(table.enabled),
		providerIdx: index("llm_endpoints_provider_idx").on(table.provider),
		modelIdx: index("llm_endpoints_model_idx").on(table.model),
		nameUnique: uniqueIndex("llm_endpoints_name_unique").on(table.name),
	}),
);

export const llmEndpointCapabilities = pgTable(
	"llm_endpoint_capabilities",
	{
		id: cuid2("lec").primaryKey(),
		endpointId: text("endpoint_id")
			.notNull()
			.references(() => llmEndpoints.id, { onDelete: "cascade" }),
		capability: text("capability").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		endpointIdx: index("llm_endpoint_capabilities_endpoint_idx").on(
			table.endpointId,
		),
		capabilityIdx: index("llm_endpoint_capabilities_capability_idx").on(
			table.capability,
		),
		endpointCapabilityUnique: uniqueIndex(
			"llm_endpoint_capabilities_endpoint_capability_unique",
		).on(table.endpointId, table.capability),
	}),
);

export const llmEndpointRuntime = pgTable(
	"llm_endpoint_runtime",
	{
		endpointId: text("endpoint_id")
			.primaryKey()
			.references(() => llmEndpoints.id, { onDelete: "cascade" }),
		circuitState: text("circuit_state").notNull().default("closed"),
		cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
		consecutiveFailures: integer("consecutive_failures").notNull().default(0),
		successRate: real("success_rate").notNull().default(1),
		errorRate: real("error_rate").notNull().default(0),
		avgLatencyMs: real("avg_latency_ms"),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
		lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
		lastErrorMessage: text("last_error_message"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		circuitStateIdx: index("llm_endpoint_runtime_circuit_state_idx").on(
			table.circuitState,
		),
		cooldownIdx: index("llm_endpoint_runtime_cooldown_idx").on(
			table.cooldownUntil,
		),
	}),
);

export const llmEndpointHealthChecks = pgTable(
	"llm_endpoint_health_checks",
	{
		id: bigserial("id", { mode: "bigint" }).primaryKey(),
		endpointId: text("endpoint_id")
			.notNull()
			.references(() => llmEndpoints.id, { onDelete: "cascade" }),
		checkType: text("check_type").notNull(),
		success: boolean("success").notNull(),
		latencyMs: integer("latency_ms"),
		statusCode: integer("status_code"),
		errorMessage: text("error_message"),
		checkedAt: timestamp("checked_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		endpointCheckedAtIdx: index("llm_endpoint_health_checks_endpoint_checked_at_idx")
			.on(table.endpointId, table.checkedAt),
		checkedAtIdx: index("llm_endpoint_health_checks_checked_at_idx").on(
			table.checkedAt,
		),
	}),
);

export const llmEndpointQualityDaily = pgTable(
	"llm_endpoint_quality_daily",
	{
		id: cuid2("lqd").primaryKey(),
		endpointId: text("endpoint_id")
			.notNull()
			.references(() => llmEndpoints.id, { onDelete: "cascade" }),
		day: date("day").notNull(),
		decisionCount: integer("decision_count").notNull().default(0),
		overrideCount: integer("override_count").notNull().default(0),
		lowConfidenceCount: integer("low_confidence_count").notNull().default(0),
		qualityScore: real("quality_score").notNull().default(1),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		endpointDayUnique: uniqueIndex("llm_endpoint_quality_daily_endpoint_day_unique")
			.on(table.endpointId, table.day),
		endpointIdx: index("llm_endpoint_quality_daily_endpoint_idx").on(
			table.endpointId,
		),
		dayIdx: index("llm_endpoint_quality_daily_day_idx").on(table.day),
	}),
);

export const llmRoutingDecisions = pgTable(
	"llm_routing_decisions",
	{
		id: cuid2("lrd").primaryKey(),
		capability: text("capability").notNull(),
		selectedEndpointId: text("selected_endpoint_id").references(
			() => llmEndpoints.id,
			{ onDelete: "set null" },
		),
		reason: text("reason"),
		selectedScore: real("selected_score"),
		candidateCount: integer("candidate_count").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		capabilityCreatedAtIdx: index("llm_routing_decisions_capability_created_at_idx")
			.on(table.capability, table.createdAt),
		selectedEndpointIdx: index("llm_routing_decisions_selected_endpoint_idx").on(
			table.selectedEndpointId,
		),
	}),
);

export const llmDecisionLog = pgTable(
	"llm_decision_log",
	{
		id: cuid2("ldl").primaryKey(),
		taskType: text("task_type").notNull(),
		inputHash: text("input_hash").notNull(),
		input: typedJsonb(llmDecisionInput, "input").notNull(),
		output: typedJsonb(llmDecisionOutput, "output"),
		modelId: text("model_id").notNull(),
		provider: text("provider").notNull(),
		endpointId: text("endpoint_id").references(() => llmEndpoints.id, {
			onDelete: "set null",
		}),
		latencyMs: integer("latency_ms"),
		tokenCount: integer("token_count"),
		costCents: integer("cost_cents"),
		verdict: text("verdict"),
		confidence: real("confidence"),
		reasoning: text("reasoning"),
		humanOverride: text("human_override"),
		humanNotes: text("human_notes"),
		reviewedBy: text("reviewed_by").references(() => user.id, {
			onDelete: "set null",
		}),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		createdAtIdx: index("llm_decision_log_created_at_idx").on(table.createdAt),
		taskTypeCreatedAtIdx: index("llm_decision_log_task_type_created_at_idx").on(
			table.taskType,
			table.createdAt,
		),
		modelCreatedAtIdx: index("llm_decision_log_model_created_at_idx").on(
			table.modelId,
			table.createdAt,
		),
		endpointCreatedAtIdx: index("llm_decision_log_endpoint_created_at_idx").on(
			table.endpointId,
			table.createdAt,
		),
		inputHashIdx: index("llm_decision_log_input_hash_idx").on(table.inputHash),
		confidenceCheck: check(
			"llm_decision_log_confidence_check",
			sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 1)`,
		),
	}),
);

export const catalogEvents = pgTable(
	"catalog_events",
	{
		id: cuid2("cev").primaryKey(),
		eventType: text("event_type").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id").notNull(),
		actorId: text("actor_id").references(() => user.id, {
			onDelete: "set null",
		}),
		payload: typedJsonb(catalogEventPayload, "payload").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		entityCreatedAtIdx: index("catalog_events_entity_created_at_idx").on(
			table.entityType,
			table.entityId,
			table.createdAt,
		),
		eventTypeCreatedAtIdx: index("catalog_events_event_type_created_at_idx").on(
			table.eventType,
			table.createdAt,
		),
	}),
);

export const barcodeTriageClaims = pgTable(
	"barcode_triage_claims",
	{
		barcode: text("barcode").primaryKey(),
		claimedBy: text("claimed_by").references(() => user.id, {
			onDelete: "set null",
		}),
		claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		expiresAtIdx: index("barcode_triage_claims_expires_at_idx").on(
			table.expiresAt,
		),
		claimedByIdx: index("barcode_triage_claims_claimed_by_idx").on(table.claimedBy),
	}),
);

// Deprecated: replaced by canonical_skus + sku_item_links + barcode_sku_mappings.
export const productClusters = pgTable(
	"product_clusters",
	{
		id: cuid2("pcl").primaryKey(),
		clusterType: text("cluster_type").notNull(), // 'variant' | 'base'
		canonicalName: text("canonical_name"),
		representativeRetailerItemId: text(
			"representative_retailer_item_id",
		).references(() => retailerItems.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		typeIdx: index("product_clusters_type_idx").on(table.clusterType),
		repIdx: index("product_clusters_representative_item_idx").on(
			table.representativeRetailerItemId,
		),
	}),
);

export const clusterMembers = pgTable(
	"cluster_members",
	{
		id: cuid2("pcm").primaryKey(),
		clusterId: text("cluster_id")
			.notNull()
			.references(() => productClusters.id, { onDelete: "cascade" }),
		retailerItemId: text("retailer_item_id").references(() => retailerItems.id, {
			onDelete: "cascade",
		}),
		variantClusterId: text("variant_cluster_id").references(
			() => productClusters.id,
			{
				onDelete: "cascade",
			},
		),
		isCanonical: boolean("is_canonical").notNull().default(false),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		clusterIdx: index("cluster_members_cluster_idx").on(table.clusterId),
		itemUnique: uniqueIndex("cluster_members_item_uniq")
			.on(table.retailerItemId)
			.where(sql`retailer_item_id IS NOT NULL`),
		variantUnique: uniqueIndex("cluster_members_variant_uniq")
			.on(table.variantClusterId)
			.where(sql`variant_cluster_id IS NOT NULL`),
		clusterItemUnique: uniqueIndex("cluster_members_cluster_item_unique")
			.on(table.clusterId, table.retailerItemId)
			.where(sql`retailer_item_id IS NOT NULL`),
		clusterVariantUnique: uniqueIndex("cluster_members_cluster_variant_unique")
			.on(table.clusterId, table.variantClusterId)
			.where(sql`variant_cluster_id IS NOT NULL`),
	}),
);

export const clusterRelations = pgTable(
	"cluster_relations",
	{
		id: cuid2("pcr").primaryKey(),
		fromClusterId: text("from_cluster_id")
			.notNull()
			.references(() => productClusters.id, { onDelete: "cascade" }),
		toClusterId: text("to_cluster_id")
			.notNull()
			.references(() => productClusters.id, { onDelete: "cascade" }),
		relationshipType: text("relationship_type").notNull(), // MULTIPACK_VARIANT | SIZE_VARIANT | CONTAINER_VARIANT
		confidence: real("confidence"),
		reasoning: text("reasoning"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		fromIdx: index("cluster_relations_from_idx").on(table.fromClusterId),
		toIdx: index("cluster_relations_to_idx").on(table.toClusterId),
		pairUnique: uniqueIndex("cluster_relations_pair_uniq").on(
			table.fromClusterId,
			table.toClusterId,
		),
	}),
);

export const llmDecisionCache = pgTable(
	"llm_decision_cache",
	{
		inputHash: text("input_hash").primaryKey(),
		output: text("output").notNull(),
		modelPlanHash: text("model_plan_hash").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		updatedIdx: index("llm_decision_cache_updated_idx").on(table.updatedAt),
	}),
);

// ============================================================================
// Cron System: cron_jobs (definitions), cron_runs (execution history)
// Postgres-coordinated scheduling with advisory locks for distributed execution
// ============================================================================

export const cronJobs = pgTable(
	"cron_jobs",
	{
		id: text("id").primaryKey(), // e.g., "daily-ingestion"
		name: text("name").notNull(),
		cronExpression: text("cron_expression").notNull(), // e.g., "0 6 * * *"
		timezone: text("timezone").default("UTC"),
		taskType: text("task_type").notNull(), // e.g., "ingestion"
		taskPayload: typedJsonb(cronJobPayload, "task_payload"), // optional JSON payload for the task
		enabled: boolean("enabled").default(true),
		nextRunAt: timestamp("next_run_at", { withTimezone: true }),
		lastRunAt: timestamp("last_run_at", { withTimezone: true }),
		lastRunStatus: text("last_run_status"), // "completed", "failed", "skipped"
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		// Index for finding due jobs efficiently
		nextRunIdx: index("cron_jobs_next_run_idx")
			.on(table.nextRunAt)
			.where(sql`enabled = true`),
		enabledIdx: index("cron_jobs_enabled_idx").on(table.enabled),
	}),
);

export const cronRuns = pgTable(
	"cron_runs",
	{
		id: bigserial({ mode: "bigint" }).primaryKey(),
		jobId: text("job_id")
			.notNull()
			.references(() => cronJobs.id, { onDelete: "cascade" }),
		idempotencyKey: text("idempotency_key").notNull(), // e.g., "cron:daily-ingestion:2024-01-15T06:00:00Z"
		status: text("status").notNull().default("pending"), // "pending", "running", "completed", "failed", "skipped"
		scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		errorMessage: text("error_message"),
		errorDetails: text("error_details"), // JSON with stack trace, context
		tasksEnqueued: integer("tasks_enqueued").default(0),
		metadata: typedJsonb(cronRunMetadata, "metadata"), // Additional run info
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => ({
		// Critical: prevent duplicate runs for same job+schedule
		idempotencyIdx: uniqueIndex("cron_runs_idempotency_idx").on(
			table.idempotencyKey,
		),
		jobIdIdx: index("cron_runs_job_id_idx").on(table.jobId),
		statusIdx: index("cron_runs_status_idx").on(table.status),
		// For listing recent runs per job
		jobCreatedIdx: index("cron_runs_job_created_idx").on(
			table.jobId,
			table.createdAt,
		),
	}),
);

// ============================================================================
// Task Queue: Cross-service worker coordination
// ============================================================================

export const taskQueue = pgTable(
	"task_queue",
	{
		id: text("id").primaryKey().default(sql`gen_random_uuid()::TEXT`),
		taskType: text("task_type").notNull(),
		payload: typedJsonb(taskQueuePayload, "payload").notNull(),
		priority: integer("priority").default(0),
		status: text("status").notNull().default("pending"),
		scheduledFor: timestamp("scheduled_for").default(sql`NOW()`),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		failedAt: timestamp("failed_at"),
		workerId: text("worker_id"),
		retryCount: integer("retry_count").default(0),
		maxRetries: integer("max_retries").default(3),
		errorMessage: text("error_message"),
		// Parent-child task support
		parentTaskId: text("parent_task_id"),
		expectedChildren: integer("expected_children").default(0),
		completedChildren: integer("completed_children").default(0),
		createdAt: timestamp("created_at").default(sql`NOW()`),
		updatedAt: timestamp("updated_at").default(sql`NOW()`),
	},
	(table) => ({
		statusIdx: index("idx_task_queue_status").on(table.status),
		scheduledIdx: index("idx_task_queue_scheduled").on(table.scheduledFor),
		workerIdx: index("idx_task_queue_worker").on(table.workerId),
		typePriorityIdx: index("idx_task_queue_type_priority").on(
			table.taskType,
			table.priority,
			table.scheduledFor,
		),
		parentIdx: index("idx_task_queue_parent")
			.on(table.parentTaskId)
			.where(sql`parent_task_id IS NOT NULL`),
	}),
);

// ============================================================================
// Active Ingestion Operations: Prevents concurrent cluster tasks for same chain/date
// Uses UNIQUE constraint for atomic lock acquisition instead of advisory locks
// ============================================================================

export const activeIngestionOperations = pgTable(
	"active_ingestion_operations",
	{
		id: text("id").primaryKey().default(sql`gen_random_uuid()::TEXT`),
		chainSlug: text("chain_slug").notNull(),
		targetDate: date("target_date").notNull(),
		taskId: text("task_id").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		// Unique constraint ensures only one operation per chain/date
		uniqueActiveOp: uniqueIndex("unique_active_op").on(
			table.chainSlug,
			table.targetDate,
		),
		chainDateIdx: index("idx_active_ops_chain_date").on(
			table.chainSlug,
			table.targetDate,
		),
		taskIdIdx: index("idx_active_ops_task_id").on(table.taskId),
	}),
);

// ============================================================================
// Search Index: Unified full-text search for products, items, and stores
// ============================================================================

export const searchIndex = pgTable(
	"search_index",
	{
		id: cuid2("six").primaryKey(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id").notNull(),
		chainSlug: text("chain_slug"),
		category: text("category"),
		subcategory: text("subcategory"),
		title: text("title").notNull(),
		subtitle: text("subtitle"),
		body: text("body"),
		imageUrl: text("image_url"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		entityUnique: uniqueIndex("search_index_entity_unique").on(
			table.entityType,
			table.entityId,
		),
		entityTypeIdx: index("search_index_entity_type_idx").on(table.entityType),
		chainSlugIdx: index("search_index_chain_slug_idx").on(table.chainSlug),
		categoryIdx: index("search_index_category_idx").on(table.category),
	}),
);

// ============================================================================
// Price Alerts: user-defined price notifications
// ============================================================================

export const priceAlerts = pgTable(
	"price_alerts",
	{
		id: cuid2("pal").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		variantClusterId: text("variant_cluster_id").references(
			() => productClusters.id,
			{
				onDelete: "cascade",
			},
		),
		baseClusterId: text("base_cluster_id").references(() => productClusters.id, {
			onDelete: "cascade",
		}),
		alertScope: text("alert_scope").notNull().default("variant"), // 'variant' | 'base'
		targetPrice: integer("target_price").notNull(), // cents
		direction: text("direction").notNull(), // 'below' | 'above'
		status: text("status").notNull().default("active"), // 'active' | 'triggered' | 'disabled'
		triggeredAt: timestamp("triggered_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		userIdx: index("price_alerts_user_id_idx").on(table.userId),
		variantClusterIdx: index("price_alerts_variant_cluster_id_idx").on(
			table.variantClusterId,
		),
		baseClusterIdx: index("price_alerts_base_cluster_id_idx").on(
			table.baseClusterId,
		),
		statusIdx: index("price_alerts_status_idx").on(table.status),
		userVariantUnique: uniqueIndex("price_alerts_user_variant_unique").on(
			table.userId,
			table.variantClusterId,
			table.direction,
		),
		userBaseUnique: uniqueIndex("price_alerts_user_base_unique").on(
			table.userId,
			table.baseClusterId,
			table.direction,
		),
	}),
);

// ============================================================================
// Croatian Administrative Divisions: Reference data for validation/normalization
// ============================================================================

export const croatianCounties = pgTable("croatian_counties", {
	id: integer("id").primaryKey(),
	name: text("name").notNull(),
	externalId: integer("external_id"),
});

export const croatianMunicipalities = pgTable(
	"croatian_municipalities",
	{
		id: integer("id").primaryKey(),
		name: text("name").notNull(),
		externalId: integer("external_id"),
		countyId: integer("county_id")
			.notNull()
			.references(() => croatianCounties.id),
	},
	(table) => ({
		countyIdx: index("croatian_municipalities_county_idx").on(table.countyId),
	}),
);

export const croatianSettlements = pgTable(
	"croatian_settlements",
	{
		id: integer("id").primaryKey(),
		name: text("name").notNull(),
		externalId: integer("external_id"),
		municipalityId: integer("municipality_id")
			.notNull()
			.references(() => croatianMunicipalities.id),
	},
	(table) => ({
		municipalityIdx: index("croatian_settlements_municipality_idx").on(
			table.municipalityId,
		),
		nameIdx: index("croatian_settlements_name_idx").on(table.name),
	}),
);
