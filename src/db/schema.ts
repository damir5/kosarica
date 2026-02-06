import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	bigserial,
	boolean,
	date,
	index,
	integer,
	pgTable,
	real,
	serial,
	smallint,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { cuid2, pgVector, typedJsonb } from "./custom-types";
import {
	archiveMetadata,
	cronJobPayload,
	cronRunMetadata,
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
		retailerItemId: integer("retailer_item_id"), // nullable - legacy column, not used
		barcode: text("barcode"), // EAN-13, EAN-8, etc. (nullable - legacy column, not used)
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
		barcodeIdx: index("retailer_item_barcodes_barcode_idx").on(table.barcode),
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
// Canonical Catalog: products, product_aliases, product_links, product_relations
// ============================================================================

export const products = pgTable(
	"products",
	{
		id: cuid2("prd").primaryKey(),
		name: text("name").notNull(),
		description: text("description"),
		category: text("category"),
		subcategory: text("subcategory"),
		brand: text("brand"),
		unit: text("unit"),
		unitQuantity: text("unit_quantity"),
		imageUrl: text("image_url"),
		normalizedUnit: text("normalized_unit"), // "kg", "l", "kom"
		normalizedQuantity: real("normalized_quantity"),
		canonicalKey: text("canonical_key"),
		embedding: pgVector("embedding", 1024),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		canonicalKeyIdx: uniqueIndex("products_canonical_key_idx")
			.on(table.canonicalKey)
			.where(sql`canonical_key IS NOT NULL`),
	}),
);

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
		candidateProductId: text("candidate_product_id").references(
			() => products.id,
			{
				onDelete: "cascade",
			},
		),
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
		id: bigserial({ mode: "bigint" }).primaryKey(),
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
		productIdIdx: index("canonical_barcodes_product_id_idx").on(
			table.productId,
		),
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
		productId: text("product_id")
			.notNull()
			.references(() => products.id, { onDelete: "cascade" }),
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
		productIdx: index("price_alerts_product_id_idx").on(table.productId),
		statusIdx: index("price_alerts_status_idx").on(table.status),
		userProductUnique: uniqueIndex("price_alerts_user_product_unique").on(
			table.userId,
			table.productId,
			table.direction,
		),
	}),
);
