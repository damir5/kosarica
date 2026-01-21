import { getConfigInfo } from "./admin";
import {
	getCategories,
	getStoresByChain,
	listCatalogPrices,
} from "./catalog-prices";
import * as basket from "./basket";
import * as priceService from "./price-service";
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
import { addTodo, listTodos } from "./todos";
import {
	banUser,
	deleteUser,
	getUser,
	listUsers,
	updateUserRole,
} from "./users";
import {
	approveMatch,
	bulkApprove,
	getPendingMatchCount,
	getPendingMatches,
	getStats,
	rejectMatch,
	resolveSuspicious,
	searchProducts,
} from "./products";

export default {
	listTodos,
	addTodo,
	basket: {
		optimizeSingle: basket.optimizeSingle,
		optimizeMulti: basket.optimizeMulti,
		cacheWarmup: basket.cacheWarmup,
		cacheRefresh: basket.cacheRefresh,
		cacheHealth: basket.cacheHealth,
	},
	prices: {
		getStorePrices: priceService.getStorePrices,
		searchItems: priceService.searchItems,
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
		ingestion: {
			listRuns: priceService.listRuns,
			getRun: priceService.getRun,
			listFiles: priceService.listFiles,
			listErrors: priceService.listErrors,
			getStats: priceService.getStats,
			triggerChain: priceService.triggerChain,
			rerunRun: priceService.rerunRun,
			deleteRun: priceService.deleteRun,
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
		},
		catalogPrices: {
			list: listCatalogPrices,
			getStoresByChain: getStoresByChain,
			getCategories: getCategories,
		},
		products: {
			getPendingMatches,
			getPendingMatchCount,
			approveMatch,
			rejectMatch,
			bulkApprove,
			resolveSuspicious,
			searchProducts,
			getStats,
		},
	},
};
