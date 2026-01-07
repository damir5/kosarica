/**
 * Metro Chain Adapter
 *
 * Adapter for parsing Metro retail chain price data files.
 * Metro uses XML format with store information embedded in the XML structure.
 * Store resolution is based on portal ID within the XML content.
 */

import type { XmlFieldMapping } from '../parsers/xml'
import { BaseXmlAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * XML field mapping for Metro files.
 * Maps Metro's XML elements to NormalizedRow fields.
 * Metro XML structure typically has store info and product data nested.
 */
const METRO_FIELD_MAPPING: XmlFieldMapping = {
  storeIdentifier: (item) => {
    // Extract store ID from item or parent store block
    const storeId =
      (item['store_id'] as string) ??
      (item['storeId'] as string) ??
      (item['Store'] as Record<string, unknown>)?.['Id'] as string ??
      null
    return storeId ? String(storeId) : null
  },
  externalId: 'code',
  name: 'name',
  description: 'description',
  category: 'category',
  subcategory: 'subcategory',
  brand: 'brand',
  unit: 'unit',
  unitQuantity: 'quantity',
  price: 'price',
  discountPrice: 'discount_price',
  discountStart: 'discount_start',
  discountEnd: 'discount_end',
  barcodes: 'barcode',
  imageUrl: 'image_url',
  // Croatian price transparency fields
  unitPrice: 'unit_price',
  unitPriceBaseQuantity: 'unit_price_quantity',
  unitPriceBaseUnit: 'unit_price_unit',
  lowestPrice30d: 'lowest_price_30d',
  anchorPrice: 'anchor_price',
  anchorPriceAsOf: 'anchor_price_date',
}

/**
 * Alternative field mapping for Metro XML files (uppercase/different naming).
 */
const METRO_FIELD_MAPPING_ALT: XmlFieldMapping = {
  storeIdentifier: (item) => {
    const storeId =
      (item['StoreId'] as string) ??
      (item['STORE_ID'] as string) ??
      (item['Poslovnica'] as Record<string, unknown>)?.['Id'] as string ??
      null
    return storeId ? String(storeId) : null
  },
  externalId: 'Sifra',
  name: 'Naziv',
  description: 'Opis',
  category: 'Kategorija',
  subcategory: 'Podkategorija',
  brand: 'Marka',
  unit: 'Jedinica',
  unitQuantity: 'Kolicina',
  price: 'Cijena',
  discountPrice: 'AkcijskaCijena',
  discountStart: 'PocetakAkcije',
  discountEnd: 'KrajAkcije',
  barcodes: 'Barkod',
  imageUrl: 'Slika',
  // Croatian price transparency fields
  unitPrice: 'CijenaZaJedinicuMjere',
  unitPriceBaseQuantity: 'JedinicaMjereKolicina',
  unitPriceBaseUnit: 'JedinicaMjereOznaka',
  lowestPrice30d: 'NajnizaCijena30Dana',
  anchorPrice: 'SidrenaCijena',
  anchorPriceAsOf: 'SidrenaCijenaDatum',
}

/**
 * Metro chain adapter implementation.
 * Extends BaseXmlAdapter for common XML parsing functionality.
 */
export class MetroAdapter extends BaseXmlAdapter {
  constructor() {
    super({
      slug: 'metro',
      name: 'Metro',
      supportedTypes: ['xml'],
      chainConfig: CHAIN_CONFIGS.metro,
      fieldMapping: METRO_FIELD_MAPPING,
      alternativeFieldMapping: METRO_FIELD_MAPPING_ALT,
      defaultItemsPath: 'products.product',
      filenamePrefixPatterns: [
        /^Metro[_-]?/i,
        /^cjenik[_-]?/i,
      ],
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })
  }
}

/**
 * Create a Metro adapter instance.
 */
export function createMetroAdapter(): MetroAdapter {
  return new MetroAdapter()
}
