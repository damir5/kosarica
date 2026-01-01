/**
 * Chain Configuration
 *
 * Configuration for all supported retail chains.
 * This module is separate from the registry to avoid circular dependencies.
 */

import type { FileType } from '../core/types'
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
