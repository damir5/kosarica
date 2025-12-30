/**
 * Parsers Module
 *
 * File parsers for the ingestion pipeline.
 */

export { Parser, ParserRegistry, parserRegistry } from './base'
export type { ParseContext } from './base'

export { CsvParser, detectDelimiter, detectEncoding } from './csv'
export type { CsvColumnMapping, CsvDelimiter, CsvEncoding, CsvParserOptions } from './csv'

export { XmlParser, createXmlParser, detectItemsPath } from './xml'
export type { XmlFieldMapping, XmlParserOptions } from './xml'

export { XlsxParser, createXlsxParser, detectXlsxHeaders, getXlsxSheetNames } from './xlsx'
export type { XlsxColumnMapping, XlsxParserOptions } from './xlsx'
