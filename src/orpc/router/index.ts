import { getConfigInfo } from "./admin";
import * as alerts from "./alerts";
import * as barcodeTriage from "./barcode-triage";
import * as basket from "./basket";
import * as catalog from "./catalog";
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
import * as llmEndpoints from "./llm-endpoints";
import * as matching from "./matching";
import * as prices from "./prices";
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
	bulkGeocodeStores,
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
	catalog: {
		getCategories: catalog.getCategories,
		getFeatured: catalog.getFeatured,
		listFamilies: catalog.listFamilies,
		getFamily: catalog.getFamily,
		getFamilyGraph: catalog.getFamilyGraph,
		getFamilyOffers: catalog.getFamilyOffers,
		getCollection: catalog.getCollection,
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
			bulkGeocode: bulkGeocodeStores,
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
			getReviewQueueStats: categorization.getReviewQueueStats,
			listReviewQueue: categorization.listReviewQueue,
			approveReviewItem: categorization.approveReviewItem,
			rejectReviewItem: categorization.rejectReviewItem,
			triggerReverification: categorization.triggerReverification,
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
		llmEndpoints: {
			list: llmEndpoints.list,
			create: llmEndpoints.create,
			toggle: llmEndpoints.toggle,
			setCapabilities: llmEndpoints.setCapabilities,
			health: llmEndpoints.health,
			quality: llmEndpoints.quality,
			stats: llmEndpoints.stats,
		},
		matching: {
			triggerUnifiedMatching: matching.triggerUnifiedMatching,
			triggerListwiseSemanticClustering:
				matching.triggerListwiseSemanticClustering,
		},
	},
};
