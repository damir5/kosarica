/**
 * Chain Adapter Registry
 *
 * Registry for chain adapters mapping chain_id to their implementations.
 * Each chain has configuration for data source URLs, file formats, and parsing options.
 *
 * This module provides a centralized, pre-registered adapter registry that is
 * ready to use on import. All adapters are automatically registered when
 * the module is loaded.
 */

import type { ChainAdapter } from "../core/types";

// Re-export configuration types and constants from config module
// This breaks circular dependency: adapters import from config.ts, not index.ts
export {
	CHAIN_CONFIGS,
	CHAIN_IDS,
	type ChainConfig,
	type ChainId,
	getChainConfig,
	isValidChainId,
} from "./config";

import { CHAIN_CONFIGS, type ChainConfig, type ChainId } from "./config";
import { createDmAdapter } from "./dm";
import { createEurospinAdapter } from "./eurospin";
import { createIntersparAdapter } from "./interspar";
import { createKauflandAdapter } from "./kaufland";
// Import all adapter factory functions
import { createKonzumAdapter } from "./konzum";
import { createKtcAdapter } from "./ktc";
import { createLidlAdapter } from "./lidl";
import { createMetroAdapter } from "./metro";
import { createPlodineAdapter } from "./plodine";
import { createStudenacAdapter } from "./studenac";
import { createTrgocentarAdapter } from "./trgocentar";

/**
 * Registry for chain adapter instances.
 * Allows looking up the appropriate adapter for a chain.
 */
export class ChainAdapterRegistry {
	private adapters: Map<ChainId, ChainAdapter> = new Map();

	/**
	 * Register a chain adapter.
	 * @param chainId - The chain identifier
	 * @param adapter - The adapter instance
	 */
	register(chainId: ChainId, adapter: ChainAdapter): void {
		this.adapters.set(chainId, adapter);
	}

	/**
	 * Get a chain adapter by ID.
	 * @param chainId - The chain identifier
	 * @returns The adapter, or undefined if not registered
	 */
	getAdapter(chainId: ChainId): ChainAdapter | undefined {
		return this.adapters.get(chainId);
	}

	/**
	 * Check if an adapter is registered for a chain.
	 * @param chainId - The chain identifier
	 * @returns true if an adapter is registered
	 */
	hasAdapter(chainId: ChainId): boolean {
		return this.adapters.has(chainId);
	}

	/**
	 * Get all registered chain IDs.
	 * @returns Array of registered chain IDs
	 */
	getRegisteredChains(): ChainId[] {
		return Array.from(this.adapters.keys());
	}

	/**
	 * Get all registered adapters.
	 * @returns Map of chain ID to adapter
	 */
	getAllAdapters(): Map<ChainId, ChainAdapter> {
		return new Map(this.adapters);
	}

	/**
	 * Get the configuration for a chain.
	 * @param chainId - The chain identifier
	 * @returns The chain configuration
	 */
	getConfig(chainId: ChainId): ChainConfig {
		return CHAIN_CONFIGS[chainId];
	}

	/**
	 * Get all chain configurations.
	 * @returns All chain configurations
	 */
	getAllConfigs(): Record<ChainId, ChainConfig> {
		return { ...CHAIN_CONFIGS };
	}
}

// ============================================================================
// Registry Initialization
// ============================================================================

/**
 * Adapter factory functions mapped by chain ID.
 * Used for initialization of adapters.
 */
const ADAPTER_FACTORIES: Record<ChainId, () => ChainAdapter> = {
	konzum: createKonzumAdapter,
	lidl: createLidlAdapter,
	plodine: createPlodineAdapter,
	interspar: createIntersparAdapter,
	studenac: createStudenacAdapter,
	kaufland: createKauflandAdapter,
	eurospin: createEurospinAdapter,
	dm: createDmAdapter,
	ktc: createKtcAdapter,
	metro: createMetroAdapter,
	trgocentar: createTrgocentarAdapter,
};

/**
 * Initialize the registry with all adapters.
 * Instantiates all adapters on module load.
 *
 * @returns A fully initialized ChainAdapterRegistry
 */
function initializeRegistry(): ChainAdapterRegistry {
	const registry = new ChainAdapterRegistry();

	// Register all adapters from factory functions
	for (const [chainId, factory] of Object.entries(ADAPTER_FACTORIES)) {
		registry.register(chainId as ChainId, factory());
	}

	return registry;
}

/**
 * Default chain adapter registry instance.
 * Pre-registered with all available chain adapters.
 * Ready to use on import - no manual registration required.
 */
export const chainAdapterRegistry = initializeRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get a chain adapter by ID from the default registry.
 * @param chainId - The chain identifier
 * @returns The adapter, or undefined if not registered
 */
export function getAdapter(chainId: ChainId): ChainAdapter | undefined {
	return chainAdapterRegistry.getAdapter(chainId);
}

/**
 * Get a chain adapter by ID, throwing an error if not found.
 * Use this when you know the adapter should exist.
 *
 * @param chainId - The chain identifier
 * @returns The adapter
 * @throws Error if no adapter is registered for the chain
 */
export function getAdapterOrThrow(chainId: ChainId): ChainAdapter {
	const adapter = chainAdapterRegistry.getAdapter(chainId);
	if (!adapter) {
		throw new Error(`No adapter registered for chain: ${chainId}`);
	}
	return adapter;
}

/**
 * Get all registered adapters as an array.
 * Useful for iterating over all adapters.
 *
 * @returns Array of all registered chain adapters
 */
export function getAllAdapters(): ChainAdapter[] {
	return Array.from(chainAdapterRegistry.getAllAdapters().values());
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

// Re-export adapter factory functions for cases where
// a fresh adapter instance is needed
export {
	createKonzumAdapter,
	createLidlAdapter,
	createPlodineAdapter,
	createIntersparAdapter,
	createStudenacAdapter,
	createKauflandAdapter,
	createEurospinAdapter,
	createDmAdapter,
	createKtcAdapter,
	createMetroAdapter,
	createTrgocentarAdapter,
};
