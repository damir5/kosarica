import { getConfigInfo } from "./admin";
import * as alerts from "./alerts";
import * as barcodeTriage from "./barcode-triage";
import * as basket from "./basket";
import {
	getCategories,
	getStoresByChain,
	listCatalogPrices,
} from "./catalog-prices";
import * as categorization from "./categorization";
import * as clickhouse from "./clickhouse";
import * as cron from "./cron";
import * as ingestion from "./ingestion";
import * as llmDecisions from "./llm-decisions";
import * as matching from "./matching";
import * as prices from "./prices";
import { getProductPrices, getSimilarVariants } from "./products-public";
import * as search from "./search";
import {
	approveDecision,
	getClusterStats,
	getPendingDecisions,
	rejectDecision,
	triggerPipeline,
} from "./semantic-clusters";
import { getSettings, updateSettings } from "./settings";
import {
	approveStore,
	bulkApproveStores,
	bulkRejectStores,
	createPhysicalStore,
	forceApproveStore,
	getEnrichmentTasks,
	getLinkedPhysicalStores,
	getPendingStores,
	getStore,
	getStoreDetail,
	getVirtualStoresForLinking,
	linkPriceSource,
	listAllForMap,
	listPhysicalStores,
	listStores,
	listVirtualStores,
	mergeStores,
	rejectStore,
	triggerEnrichment,
	unlinkPriceSource,
	updateStore,
	verifyEnrichment,
} from "./stores";
import { listCities, listNearbyStores } from "./stores-public";
import * as taskQueue from "./task-queue";
import { addTodo, listTodos } from "./todos";
import {
	banUser,
	deleteUser,
	getUser,
	listUsers,
	updateUserRole,
} from "./users";

export default {
	listTodos,
	addTodo,
	catalogPrices: {
		list: listCatalogPrices,
		getStoresByChain,
		getCategories,
	},
	stores: {
		list: listStores,
		get: getStore,
		getDetail: getStoreDetail,
		listNearby: listNearbyStores,
		listCities: listCities,
	},
	basket: {
		optimizeSingle: basket.optimizeSingle,
		optimizeMulti: basket.optimizeMulti,
		cacheWarmup: basket.cacheWarmup,
		cacheRefresh: basket.cacheRefresh,
		cacheHealth: basket.cacheHealth,
	},
	prices: {
		getStorePrices: prices.getStorePrices,
		searchItems: prices.searchItems,
	},
	search: {
		autocomplete: search.autocomplete,
		search: search.search,
	},
	products: {
		get: getProductPrices,
		getSimilarVariants,
	},
	alerts: {
		list: alerts.listAlerts,
		create: alerts.createAlert,
		delete: alerts.deleteAlert,
		history: alerts.alertHistory,
	},
	admin: {
		getConfigInfo,
		users: {
			list: listUsers,
			get: getUser,
			updateRole: updateUserRole,
			delete: deleteUser,
			ban: banUser,
		},
		settings: {
			get: getSettings,
			update: updateSettings,
		},
		clickhouse: {
			loadAll: clickhouse.loadAll,
			loadMissing: clickhouse.loadMissing,
			status: clickhouse.status,
			startSync: clickhouse.startSync,
		},
		ingestion: {
			listRuns: ingestion.listRuns,
			getRun: ingestion.getRun,
			listFiles: ingestion.listFiles,
			listErrors: ingestion.listErrors,
			listRunStoreStats: ingestion.listRunStoreStats,
			getStats: ingestion.getStats,
			triggerChain: ingestion.triggerChain,
			rerunRun: ingestion.rerunRun,
			deleteRun: ingestion.deleteRun,
			getFile: ingestion.getFile,
			listChunks: ingestion.listChunks,
			rerunFile: ingestion.rerunFile,
			rerunChunk: ingestion.rerunChunk,
			listFileErrors: ingestion.listFileErrors,
			listFileStoreStats: ingestion.listFileStoreStats,
		},
		stores: {
			list: listStores,
			listVirtual: listVirtualStores,
			listPhysical: listPhysicalStores,
			getVirtualStoresForLinking: getVirtualStoresForLinking,
			get: getStore,
			getDetail: getStoreDetail,
			create: createPhysicalStore,
			update: updateStore,
			approve: approveStore,
			reject: rejectStore,
			merge: mergeStores,
			bulkApprove: bulkApproveStores,
			bulkReject: bulkRejectStores,
			forceApprove: forceApproveStore,
			linkPriceSource: linkPriceSource,
			unlinkPriceSource: unlinkPriceSource,
			getPending: getPendingStores,
			getLinkedPhysical: getLinkedPhysicalStores,
			triggerEnrichment: triggerEnrichment,
			getEnrichmentTasks: getEnrichmentTasks,
			verifyEnrichment: verifyEnrichment,
			listAllForMap: listAllForMap,
		},
		catalogPrices: {
			list: listCatalogPrices,
			getStoresByChain: getStoresByChain,
			getCategories: getCategories,
		},
		semanticClusters: {
			getPendingDecisions,
			approveDecision,
			rejectDecision,
			triggerPipeline,
			getClusterStats,
		},
		cron: {
			list: cron.list,
			get: cron.get,
			listRuns: cron.listRuns,
			trigger: cron.trigger,
			toggle: cron.toggle,
			health: cron.health,
			getRun: cron.getRun,
		},
		taskQueue: {
			stats: taskQueue.stats,
			list: taskQueue.list,
			get: taskQueue.get,
			cancel: taskQueue.cancel,
			requeue: taskQueue.requeue,
			reschedule: taskQueue.reschedule,
			recoverOrphaned: taskQueue.recoverOrphaned,
			cleanupCompleted: taskQueue.cleanupCompleted,
		},
		categorization: {
			list: categorization.listCategorizations,
			getStats: categorization.getStats,
			update: categorization.updateCategorization,
			trigger: categorization.triggerCategorization,
		},
		barcodeTriage: {
			getQueue: barcodeTriage.getTriageQueue,
			claim: barcodeTriage.claimTriageItem,
			triggerAutoTriage: barcodeTriage.triggerAutoTriage,
			getClusterDetail: barcodeTriage.getClusterDetail,
			submitDecision: barcodeTriage.submitDecision,
			revertDecision: barcodeTriage.revertDecision,
			getDecisionHistory: barcodeTriage.getDecisionHistory,
			searchCanonicalSkus: barcodeTriage.searchCanonicalSkus,
		},
		llmDecisions: {
			list: llmDecisions.listLlmDecisions,
			get: llmDecisions.getLlmDecision,
			override: llmDecisions.overrideLlmDecision,
			stats: llmDecisions.getLlmDecisionStats,
		},
		matching: {
			triggerUnifiedMatching: matching.triggerUnifiedMatching,
			triggerPairwiseSemanticClustering:
				matching.triggerPairwiseSemanticClustering,
			triggerListwiseSemanticClustering:
				matching.triggerListwiseSemanticClustering,
		},
	},
};
