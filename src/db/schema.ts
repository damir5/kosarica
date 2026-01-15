import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { cuid2 } from "./custom-types";

export const todos = sqliteTable("todos", {
	id: integer({ mode: "number" }).primaryKey({
		autoIncrement: true,
	}),
	title: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

// Better Auth tables
export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
	image: text("image"),
	role: text("role").default("user"),
	banned: integer("banned", { mode: "boolean" }).default(false),
	bannedAt: integer("bannedAt", { mode: "timestamp" }),
	bannedReason: text("bannedReason"),
	createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
	id: text("id").primaryKey(),
	expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
	ipAddress: text("ipAddress"),
	userAgent: text("userAgent"),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
	id: text("id").primaryKey(),
	accountId: text("accountId").notNull(),
	providerId: text("providerId").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("accessToken"),
	refreshToken: text("refreshToken"),
	idToken: text("idToken"),
	accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
	refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
		mode: "timestamp",
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
	createdAt: integer("createdAt", { mode: "timestamp" }),
	updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

export const passkey = sqliteTable("passkey", {
	id: text("id").primaryKey(),
	name: text("name"),
	publicKey: text("publicKey").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	credentialID: text("credentialID").notNull().unique(),
	counter: integer("counter").notNull(),
	deviceType: text("deviceType").notNull(),
	backedUp: integer("backedUp", { mode: "boolean" }).notNull(),
	transports: text("transports"),
	createdAt: integer("createdAt", { mode: "timestamp" }),
});

// App Settings table
export const appSettings = sqliteTable("app_settings", {
	id: cuid2("cfg").primaryKey(),
	appName: text("appName").default("Kosarica"),
	requireEmailVerification: integer("requireEmailVerification", {
		mode: "boolean",
	}).default(false),
	minPasswordLength: integer("minPasswordLength").default(8),
	maxPasswordLength: integer("maxPasswordLength").default(128),
	passkeyEnabled: integer("passkeyEnabled", { mode: "boolean" }).default(true),
	updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// Retail World: chains, stores, store_identifiers, retailer_items, retailer_item_barcodes
// ============================================================================

export const chains = sqliteTable("chains", {
	slug: text("slug").primaryKey(), // konzum, lidl, plodine, etc.
	name: text("name").notNull(),
	website: text("website"),
	logoUrl: text("logo_url"),
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const stores = sqliteTable(
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
		isVirtual: integer("is_virtual", { mode: "boolean" }).default(true),
		priceSourceStoreId: text("price_source_store_id").references(
			(): AnySQLiteColumn => stores.id,
		),
		status: text("status").default("active"), // 'active' | 'pending'
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => ({
		chainSlugIdx: index("stores_chain_slug_idx").on(table.chainSlug),
		cityIdx: index("stores_city_idx").on(table.city),
		statusIdx: index("stores_status_idx").on(table.status),
		priceSourceIdx: index("stores_price_source_idx").on(
			table.priceSourceStoreId,
		),
	}),
);

export const storeIdentifiers = sqliteTable(
	"store_identifiers",
	{
		id: cuid2("sid").primaryKey(),
		storeId: text("store_id")
			.notNull()
			.references(() => stores.id, { onDelete: "cascade" }),
		type: text("type").notNull(), // 'filename_code', 'portal_id', 'internal_id', etc.
		value: text("value").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
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

export const retailerItems = sqliteTable(
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
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
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

export const retailerItemBarcodes = sqliteTable(
	"retailer_item_barcodes",
	{
		id: cuid2("rib").primaryKey(),
		retailerItemId: text("retailer_item_id")
			.notNull()
			.references(() => retailerItems.id, { onDelete: "cascade" }),
		barcode: text("barcode").notNull(), // EAN-13, EAN-8, etc.
		isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => ({
		barcodeIdx: index("retailer_item_barcodes_barcode_idx").on(table.barcode),
	}),
);

// ============================================================================
// Canonical Catalog: products, product_aliases, product_links, product_relations
// ============================================================================

export const products = sqliteTable("products", {
	id: cuid2("prd").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	category: text("category"),
	subcategory: text("subcategory"),
	brand: text("brand"),
	unit: text("unit"),
	unitQuantity: text("unit_quantity"),
	imageUrl: text("image_url"),
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
	updatedAt: integer("updated_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const productAliases = sqliteTable("product_aliases", {
	id: cuid2("pal").primaryKey(),
	productId: text("product_id")
		.notNull()
		.references(() => products.id, { onDelete: "cascade" }),
	alias: text("alias").notNull(), // alternative name/variant
	source: text("source"), // where this alias came from
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const productLinks = sqliteTable(
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
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => ({
		productRetailerItemUnique: uniqueIndex(
			"product_links_product_retailer_item_unique",
		).on(table.productId, table.retailerItemId),
	}),
);

export const productRelations = sqliteTable("product_relations", {
	id: cuid2("prl").primaryKey(),
	productId: text("product_id")
		.notNull()
		.references(() => products.id, { onDelete: "cascade" }),
	relatedProductId: text("related_product_id")
		.notNull()
		.references(() => products.id, { onDelete: "cascade" }),
	relationType: text("relation_type").notNull(), // 'variant', 'substitute', 'bundle', etc.
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

// ============================================================================
// Prices: store_item_state, store_item_price_periods
// ============================================================================

export const storeItemState = sqliteTable(
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
		discountStart: integer("discount_start", { mode: "timestamp" }),
		discountEnd: integer("discount_end", { mode: "timestamp" }),
		inStock: integer("in_stock", { mode: "boolean" }).default(true),
		// Price transparency fields (Croatian regulation)
		unitPrice: integer("unit_price"), // price per unit in cents (e.g., per kg/l)
		unitPriceBaseQuantity: text("unit_price_base_quantity"), // base quantity for unit price (e.g., "1", "100")
		unitPriceBaseUnit: text("unit_price_base_unit"), // unit for unit price (e.g., "kg", "l", "kom")
		lowestPrice30d: integer("lowest_price_30d"), // lowest price in last 30 days, in cents
		anchorPrice: integer("anchor_price"), // "sidrena cijena" anchor/reference price in cents
		anchorPriceAsOf: integer("anchor_price_as_of", { mode: "timestamp" }), // date when anchor price was set
		priceSignature: text("price_signature"), // hash for deduplication (excludes lowestPrice30d to avoid churn)
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
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

export const storeItemPricePeriods = sqliteTable(
	"store_item_price_periods",
	{
		id: cuid2("sip").primaryKey(),
		storeItemStateId: text("store_item_state_id")
			.notNull()
			.references(() => storeItemState.id, { onDelete: "cascade" }),
		price: integer("price").notNull(), // price in cents/lipa
		discountPrice: integer("discount_price"),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
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

export const ingestionRuns = sqliteTable("ingestion_runs", {
	id: cuid2("igr").primaryKey(),
	chainSlug: text("chain_slug")
		.notNull()
		.references(() => chains.slug, { onDelete: "cascade" }),
	source: text("source").notNull(), // 'cli', 'worker', 'scheduled'
	status: text("status").notNull().default("pending"), // 'pending', 'running', 'completed', 'failed'
	startedAt: integer("started_at", { mode: "timestamp" }),
	completedAt: integer("completed_at", { mode: "timestamp" }),
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
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const ingestionFiles = sqliteTable("ingestion_files", {
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
	processedAt: integer("processed_at", { mode: "timestamp" }),
	metadata: text("metadata"), // JSON for file-specific info
	// Chunking support
	totalChunks: integer("total_chunks").default(0),
	processedChunks: integer("processed_chunks").default(0),
	chunkSize: integer("chunk_size"), // rows per chunk
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const ingestionChunks = sqliteTable(
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
		processedAt: integer("processed_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => ({
		fileChunkIdx: index("ingestion_chunks_file_chunk_idx").on(
			table.fileId,
			table.chunkIndex,
		),
		statusIdx: index("ingestion_chunks_status_idx").on(table.status),
	}),
);

export const ingestionFileEntries = sqliteTable("ingestion_file_entries", {
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
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const ingestionErrors = sqliteTable("ingestion_errors", {
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
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

// ============================================================================
// Store Enrichment: store_enrichment_tasks
// ============================================================================

export const storeEnrichmentTasks = sqliteTable(
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
		verifiedAt: integer("verified_at", { mode: "timestamp" }),
		errorMessage: text("error_message"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => ({
		storeTypeIdx: index("store_enrichment_tasks_store_type_idx").on(
			table.storeId,
			table.type,
		),
		statusIdx: index("store_enrichment_tasks_status_idx").on(table.status),
	}),
);
