/**
 * Chain Adapter Registry
 *
 * Registry for chain adapters mapping chain_id to their implementations.
 * Each chain has configuration for data source URLs, file formats, and parsing options.
 */

import type {
  ChainAdapter,
  FileType,
} from '../core/types'
import type { CsvDelimiter, CsvEncoding } from '../parsers/csv'

/**
 * Unique identifier for each retail chain.
 */
export type ChainId =
  | 'konzum'
  | 'lidl'
  | 'plodine'
  | 'interspar'
  | 'studenac'
  | 'kaufland'
  | 'eurospin'
  | 'dm'
  | 'ktc'
  | 'metro'
  | 'trgocentar'

/**
 * All supported chain IDs.
 */
export const CHAIN_IDS: readonly ChainId[] = [
  'konzum',
  'lidl',
  'plodine',
  'interspar',
  'studenac',
  'kaufland',
  'eurospin',
  'dm',
  'ktc',
  'metro',
  'trgocentar',
] as const

/**
 * Configuration for a retail chain's data source.
 */
export interface ChainConfig {
  /** Unique chain identifier */
  id: ChainId
  /** Human-readable chain name */
  name: string
  /** Base URL for price data files */
  baseUrl: string
  /** Primary file type for this chain */
  primaryFileType: FileType
  /** All supported file types */
  supportedFileTypes: FileType[]
  /** CSV-specific configuration */
  csv?: {
    delimiter: CsvDelimiter
    encoding: CsvEncoding
    hasHeader: boolean
  }
  /** Whether this chain uses ZIP archives */
  usesZip: boolean
  /** Store resolution strategy */
  storeResolution: 'filename' | 'portal_id' | 'national'
  /** Additional metadata */
  metadata?: Record<string, string>
}

/**
 * Configuration for all supported chains.
 */
export const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  konzum: {
    id: 'konzum',
    name: 'Konzum',
    baseUrl: 'https://www.konzum.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: ',',
      encoding: 'utf-8',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
  lidl: {
    id: 'lidl',
    name: 'Lidl',
    baseUrl: 'https://www.lidl.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv', 'zip'],
    csv: {
      delimiter: ',',
      encoding: 'utf-8',
      hasHeader: true,
    },
    usesZip: true,
    storeResolution: 'filename',
  },
  plodine: {
    id: 'plodine',
    name: 'Plodine',
    baseUrl: 'https://www.plodine.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: ';',
      encoding: 'windows-1250',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
  interspar: {
    id: 'interspar',
    name: 'Interspar',
    baseUrl: 'https://www.interspar.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: ';',
      encoding: 'utf-8',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
  studenac: {
    id: 'studenac',
    name: 'Studenac',
    baseUrl: 'https://www.studenac.hr/cjenik',
    primaryFileType: 'xml',
    supportedFileTypes: ['xml'],
    usesZip: false,
    storeResolution: 'portal_id',
  },
  kaufland: {
    id: 'kaufland',
    name: 'Kaufland',
    baseUrl: 'https://www.kaufland.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: '\t',
      encoding: 'utf-8',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
  eurospin: {
    id: 'eurospin',
    name: 'Eurospin',
    baseUrl: 'https://www.eurospin.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: ';',
      encoding: 'utf-8',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
  dm: {
    id: 'dm',
    name: 'DM',
    baseUrl: 'https://www.dm.hr/cjenik',
    primaryFileType: 'xlsx',
    supportedFileTypes: ['xlsx'],
    usesZip: false,
    storeResolution: 'national',
  },
  ktc: {
    id: 'ktc',
    name: 'KTC',
    baseUrl: 'https://www.ktc.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: ';',
      encoding: 'windows-1250',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
  metro: {
    id: 'metro',
    name: 'Metro',
    baseUrl: 'https://www.metro.hr/cjenik',
    primaryFileType: 'xml',
    supportedFileTypes: ['xml'],
    usesZip: false,
    storeResolution: 'portal_id',
  },
  trgocentar: {
    id: 'trgocentar',
    name: 'Trgocentar',
    baseUrl: 'https://www.trgocentar.hr/cjenik',
    primaryFileType: 'csv',
    supportedFileTypes: ['csv'],
    csv: {
      delimiter: ';',
      encoding: 'windows-1250',
      hasHeader: true,
    },
    usesZip: false,
    storeResolution: 'filename',
  },
}

/**
 * Registry for chain adapter instances.
 * Allows looking up the appropriate adapter for a chain.
 */
export class ChainAdapterRegistry {
  private adapters: Map<ChainId, ChainAdapter> = new Map()

  /**
   * Register a chain adapter.
   * @param chainId - The chain identifier
   * @param adapter - The adapter instance
   */
  register(chainId: ChainId, adapter: ChainAdapter): void {
    this.adapters.set(chainId, adapter)
  }

  /**
   * Get a chain adapter by ID.
   * @param chainId - The chain identifier
   * @returns The adapter, or undefined if not registered
   */
  getAdapter(chainId: ChainId): ChainAdapter | undefined {
    return this.adapters.get(chainId)
  }

  /**
   * Check if an adapter is registered for a chain.
   * @param chainId - The chain identifier
   * @returns true if an adapter is registered
   */
  hasAdapter(chainId: ChainId): boolean {
    return this.adapters.has(chainId)
  }

  /**
   * Get all registered chain IDs.
   * @returns Array of registered chain IDs
   */
  getRegisteredChains(): ChainId[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Get all registered adapters.
   * @returns Map of chain ID to adapter
   */
  getAllAdapters(): Map<ChainId, ChainAdapter> {
    return new Map(this.adapters)
  }

  /**
   * Get the configuration for a chain.
   * @param chainId - The chain identifier
   * @returns The chain configuration
   */
  getConfig(chainId: ChainId): ChainConfig {
    return CHAIN_CONFIGS[chainId]
  }

  /**
   * Get all chain configurations.
   * @returns All chain configurations
   */
  getAllConfigs(): Record<ChainId, ChainConfig> {
    return { ...CHAIN_CONFIGS }
  }
}

/**
 * Default chain adapter registry instance.
 * Import and use this, or create your own registry.
 */
export const chainAdapterRegistry = new ChainAdapterRegistry()

/**
 * Get a chain adapter by ID from the default registry.
 * @param chainId - The chain identifier
 * @returns The adapter, or undefined if not registered
 */
export function getAdapter(chainId: ChainId): ChainAdapter | undefined {
  return chainAdapterRegistry.getAdapter(chainId)
}

/**
 * Get the configuration for a chain.
 * @param chainId - The chain identifier
 * @returns The chain configuration
 */
export function getChainConfig(chainId: ChainId): ChainConfig {
  return CHAIN_CONFIGS[chainId]
}

/**
 * Check if a string is a valid chain ID.
 * @param value - The value to check
 * @returns true if it's a valid ChainId
 */
export function isValidChainId(value: string): value is ChainId {
  return CHAIN_IDS.includes(value as ChainId)
}
