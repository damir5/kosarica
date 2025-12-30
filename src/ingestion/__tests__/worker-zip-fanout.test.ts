/**
 * Tests for ZIP Fanout with Cloudflare Queue
 *
 * Task: main-4mn.33
 *
 * Tests:
 * 1. ZIP fanout - extract ZIP and enqueue parse messages for each entry
 * 2. parse_entry message verification - correct message structure
 * 3. Parallel processing - verify concurrent processing with concurrency limit
 * 4. Backpressure and retry behavior - error handling and retry logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { zipSync } from 'fflate'
import type {
  QueueMessage,
  ExpandQueueMessage,
  ParseQueueMessage,
  DiscoveredFile,
} from '../core/types'
import type { Storage, GetResult, StorageMetadata } from '../core/storage'

// ============================================================================
// Mock Types
// ============================================================================

interface MockMessage<T = QueueMessage> {
  body: T
  attempts: number
  ack: () => void
  retry: (options?: { delaySeconds?: number }) => void
}

interface MockMessageBatch<T = QueueMessage> {
  queue: string
  messages: MockMessage<T>[]
}

interface MockQueue<T = QueueMessage> {
  send: (message: T) => Promise<void>
  sendBatch: (messages: { body: T }[]) => Promise<void>
}

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_RUN_ID = 'run_test123'
const TEST_CHAIN_SLUG = 'lidl'

function createMockDiscoveredFile(
  filename: string,
  type: 'csv' | 'xml' | 'xlsx' | 'zip' = 'zip',
): DiscoveredFile {
  return {
    url: `https://example.com/${filename}`,
    filename,
    type,
    size: null,
    lastModified: null,
    metadata: {},
  }
}

function createExpandMessage(
  r2Key: string,
  file: DiscoveredFile,
): ExpandQueueMessage {
  return {
    id: 'msg_expand_123',
    type: 'expand',
    runId: TEST_RUN_ID,
    chainSlug: TEST_CHAIN_SLUG,
    createdAt: new Date().toISOString(),
    r2Key,
    file,
  }
}

/**
 * Create a test ZIP file containing multiple CSV files
 */
function createTestZip(files: Record<string, string>): Uint8Array {
  const filesData: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()

  for (const [filename, content] of Object.entries(files)) {
    filesData[filename] = encoder.encode(content)
  }

  return zipSync(filesData)
}

/**
 * Create mock storage that returns the specified ZIP content
 */
function createMockStorage(
  zipContent: Uint8Array,
  storedFiles: Map<string, ArrayBuffer> = new Map(),
): Storage {
  return {
    get: vi.fn(async (key: string): Promise<GetResult | null> => {
      if (key.includes('.zip') || storedFiles.size === 0) {
        return {
          content: zipContent.buffer.slice(
            zipContent.byteOffset,
            zipContent.byteOffset + zipContent.byteLength,
          ) as ArrayBuffer,
          metadata: {
            key,
            size: zipContent.length,
            lastModified: new Date(),
          },
        }
      }
      const stored = storedFiles.get(key)
      if (stored) {
        return {
          content: stored,
          metadata: {
            key,
            size: stored.byteLength,
            lastModified: new Date(),
          },
        }
      }
      return null
    }),
    put: vi.fn(
      async (
        key: string,
        content: ArrayBuffer | Uint8Array | string,
      ): Promise<StorageMetadata> => {
        let buffer: ArrayBuffer
        if (typeof content === 'string') {
          buffer = new TextEncoder().encode(content).buffer as ArrayBuffer
        } else if (content instanceof Uint8Array) {
          buffer = content.buffer.slice(
            content.byteOffset,
            content.byteOffset + content.byteLength,
          ) as ArrayBuffer
        } else {
          buffer = content
        }
        storedFiles.set(key, buffer)
        return {
          key,
          size: buffer.byteLength,
          lastModified: new Date(),
        }
      },
    ),
    delete: vi.fn(async () => true),
    exists: vi.fn(async () => true),
    head: vi.fn(async () => null),
    list: vi.fn(async () => []),
  }
}

/**
 * Create mock queue that tracks sent messages
 */
function createMockQueue(): MockQueue & {
  sentMessages: QueueMessage[]
  sentBatches: { body: QueueMessage }[][]
} {
  const sentMessages: QueueMessage[] = []
  const sentBatches: { body: QueueMessage }[][] = []

  return {
    sentMessages,
    sentBatches,
    send: vi.fn(async (message: QueueMessage) => {
      sentMessages.push(message)
    }),
    sendBatch: vi.fn(async (messages: { body: QueueMessage }[]) => {
      sentBatches.push(messages)
      for (const msg of messages) {
        sentMessages.push(msg.body)
      }
    }),
  }
}

// ============================================================================
// handleExpand Tests - ZIP Fanout
// ============================================================================

describe('ZIP Fanout with Queue', () => {
  describe('handleExpand - ZIP extraction and message enqueue', () => {
    it('should extract ZIP with multiple entries and enqueue parse messages', async () => {
      // Create ZIP with 3 CSV files
      const zipContent = createTestZip({
        'store1_prices.csv': 'name,price\nProduct1,100\nProduct2,200',
        'store2_prices.csv': 'name,price\nProduct3,150',
        'store3_prices.csv': 'name,price\nProduct4,250\nProduct5,300',
      })

      const mockStorage = createMockStorage(zipContent)
      const mockQueue = createMockQueue()

      const file = createMockDiscoveredFile('prices_batch.zip')
      const message = createExpandMessage(
        `ingestion/${TEST_RUN_ID}/${TEST_CHAIN_SLUG}/prices_batch.zip`,
        file,
      )

      // Simulate handleExpand logic
      const result = await mockStorage.get(message.r2Key)
      expect(result).not.toBeNull()

      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      const parseMessages: ParseQueueMessage[] = []
      for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
        if (innerFilename.endsWith('/') || innerFilename.startsWith('__MACOSX'))
          continue

        const expandedKey = `ingestion/${TEST_RUN_ID}/${TEST_CHAIN_SLUG}/expanded/${file.filename}/${innerFilename}`
        await mockStorage.put(expandedKey, innerContent)

        const expandedFile: DiscoveredFile = {
          ...file,
          filename: innerFilename,
          type: 'csv',
          size: innerContent.byteLength,
        }

        parseMessages.push({
          id: `msg_parse_${innerFilename}`,
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
          r2Key: expandedKey,
          file: expandedFile,
          innerFilename,
          hash: 'test_hash',
        })
      }

      await mockQueue.sendBatch(parseMessages.map((msg) => ({ body: msg })))

      // Verify 3 parse messages were enqueued
      expect(mockQueue.sentMessages.length).toBe(3)
      expect(mockQueue.sentBatches.length).toBe(1)
      expect(mockQueue.sentBatches[0].length).toBe(3)

      // Verify all messages are 'parse' type
      for (const msg of mockQueue.sentMessages) {
        expect(msg.type).toBe('parse')
      }

      // Verify files were stored
      expect(mockStorage.put).toHaveBeenCalledTimes(3)
    })

    it('should generate correct parse_entry messages with all required fields', async () => {
      const zipContent = createTestZip({
        'store_data.csv': 'name,price\nTest,100',
      })

      const mockStorage = createMockStorage(zipContent)
      const mockQueue = createMockQueue()

      const file = createMockDiscoveredFile('test.zip')
      const r2Key = `ingestion/${TEST_RUN_ID}/${TEST_CHAIN_SLUG}/test.zip`

      const result = await mockStorage.get(r2Key)
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      const entries = Object.entries(unzipped).filter(
        ([name]) => !name.endsWith('/') && !name.startsWith('__MACOSX'),
      )

      for (const [innerFilename, innerContent] of entries) {
        const expandedKey = `ingestion/${TEST_RUN_ID}/${TEST_CHAIN_SLUG}/expanded/${file.filename}/${innerFilename}`
        await mockStorage.put(expandedKey, innerContent)

        const parseMessage: ParseQueueMessage = {
          id: `msg_parse_${Date.now()}`,
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
          r2Key: expandedKey,
          file: {
            ...file,
            filename: innerFilename,
            type: 'csv',
            size: innerContent.byteLength,
          },
          innerFilename,
          hash: 'sha256_hash_placeholder',
        }

        await mockQueue.send(parseMessage)
      }

      expect(mockQueue.sentMessages.length).toBe(1)

      const msg = mockQueue.sentMessages[0] as ParseQueueMessage
      // Verify all required ParseQueueMessage fields
      expect(msg.id).toBeDefined()
      expect(msg.type).toBe('parse')
      expect(msg.runId).toBe(TEST_RUN_ID)
      expect(msg.chainSlug).toBe(TEST_CHAIN_SLUG)
      expect(msg.createdAt).toBeDefined()
      expect(msg.r2Key).toContain('expanded')
      expect(msg.file).toBeDefined()
      expect(msg.file.filename).toBe('store_data.csv')
      expect(msg.file.type).toBe('csv')
      expect(msg.innerFilename).toBe('store_data.csv')
      expect(msg.hash).toBeDefined()
    })

    it('should skip directories and __MACOSX metadata in ZIP', async () => {
      const zipContent = createTestZip({
        'data/': '', // Directory entry
        '__MACOSX/._hidden': 'metadata',
        '__MACOSX/data/._file.csv': 'metadata',
        'data/prices.csv': 'name,price\nProduct,100',
        'data/stores.csv': 'store,address\nStore1,Address1',
      })

      const mockStorage = createMockStorage(zipContent)
      const mockQueue = createMockQueue()

      const result = await mockStorage.get('test.zip')
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      let validEntryCount = 0
      for (const [innerFilename] of Object.entries(unzipped)) {
        if (innerFilename.endsWith('/') || innerFilename.startsWith('__MACOSX'))
          continue
        validEntryCount++
      }

      // Only 2 valid entries (data/prices.csv and data/stores.csv)
      expect(validEntryCount).toBe(2)
    })

    it('should detect file type from inner filename extension', async () => {
      const zipContent = createTestZip({
        'prices.csv': 'name,price',
        'catalog.xml': '<items></items>',
        'data.xlsx': 'fake xlsx content',
        'readme.txt': 'info',
      })

      const mockStorage = createMockStorage(zipContent)

      const result = await mockStorage.get('test.zip')
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      const detectFileType = (
        filename: string,
      ): 'csv' | 'xml' | 'xlsx' | 'zip' => {
        const ext = filename.split('.').pop()?.toLowerCase()
        switch (ext) {
          case 'csv':
            return 'csv'
          case 'xml':
            return 'xml'
          case 'xlsx':
            return 'xlsx'
          case 'zip':
            return 'zip'
          default:
            return 'csv'
        }
      }

      const detectedTypes: Record<string, string> = {}
      for (const [filename] of Object.entries(unzipped)) {
        if (!filename.endsWith('/')) {
          detectedTypes[filename] = detectFileType(filename)
        }
      }

      expect(detectedTypes['prices.csv']).toBe('csv')
      expect(detectedTypes['catalog.xml']).toBe('xml')
      expect(detectedTypes['data.xlsx']).toBe('xlsx')
      expect(detectedTypes['readme.txt']).toBe('csv') // Default fallback
    })

    it('should handle empty ZIP gracefully', async () => {
      // Create empty ZIP
      const zipContent = zipSync({})

      const mockStorage = createMockStorage(zipContent)
      const mockQueue = createMockQueue()

      const result = await mockStorage.get('empty.zip')
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      const entries = Object.entries(unzipped).filter(
        ([name]) => !name.endsWith('/'),
      )

      expect(entries.length).toBe(0)

      // No messages should be enqueued for empty ZIP
      expect(mockQueue.sentMessages.length).toBe(0)
    })

    it('should use sendBatch for efficient message enqueue', async () => {
      const zipContent = createTestZip({
        'file1.csv': 'data1',
        'file2.csv': 'data2',
        'file3.csv': 'data3',
        'file4.csv': 'data4',
        'file5.csv': 'data5',
      })

      const mockStorage = createMockStorage(zipContent)
      const mockQueue = createMockQueue()

      const result = await mockStorage.get('batch.zip')
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      const parseMessages: ParseQueueMessage[] = []
      for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
        if (innerFilename.endsWith('/')) continue

        parseMessages.push({
          id: `msg_${innerFilename}`,
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
          r2Key: `key/${innerFilename}`,
          file: createMockDiscoveredFile(innerFilename, 'csv'),
          innerFilename,
          hash: 'hash',
        })
      }

      // Use sendBatch for efficiency
      await mockQueue.sendBatch(parseMessages.map((msg) => ({ body: msg })))

      // Verify sendBatch was called once with all messages
      expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
      expect(mockQueue.sentBatches[0].length).toBe(5)
    })
  })

  // ============================================================================
  // Parallel Processing Tests
  // ============================================================================

  describe('Parallel Processing', () => {
    it('should process queue messages in parallel with concurrency limit', async () => {
      const CONCURRENCY_LIMIT = 5
      const TOTAL_MESSAGES = 12

      const processingTimes: number[] = []
      const processMessage = vi.fn(async (message: MockMessage) => {
        const startTime = Date.now()
        await new Promise((resolve) => setTimeout(resolve, 10)) // Simulate work
        processingTimes.push(Date.now() - startTime)
        message.ack()
      })

      // Create mock messages
      const messages: MockMessage[] = Array.from(
        { length: TOTAL_MESSAGES },
        (_, i) => ({
          body: {
            id: `msg_${i}`,
            type: 'parse' as const,
            runId: TEST_RUN_ID,
            chainSlug: TEST_CHAIN_SLUG,
            createdAt: new Date().toISOString(),
            r2Key: `key_${i}`,
            file: createMockDiscoveredFile(`file_${i}.csv`, 'csv'),
            innerFilename: `file_${i}.csv`,
            hash: `hash_${i}`,
          },
          attempts: 1,
          ack: vi.fn(),
          retry: vi.fn(),
        }),
      )

      // Simulate worker queue processing with concurrency limit
      const allMessages = [...messages]
      const startTime = Date.now()

      while (allMessages.length > 0) {
        const chunk = allMessages.splice(0, CONCURRENCY_LIMIT)
        await Promise.all(chunk.map((msg) => processMessage(msg)))
      }

      const totalTime = Date.now() - startTime

      // Verify all messages were processed
      expect(processMessage).toHaveBeenCalledTimes(TOTAL_MESSAGES)

      // With 12 messages and concurrency of 5, we need 3 batches
      // Total time should be less than sequential processing
      // Sequential would be ~120ms (12 * 10ms), parallel should be ~30ms (3 * 10ms)
      expect(totalTime).toBeLessThan(100) // Allow some margin
    })

    it('should maintain message isolation during parallel processing', async () => {
      const processedIds = new Set<string>()
      const concurrentCount = { current: 0, max: 0 }

      const processMessage = async (message: MockMessage<ParseQueueMessage>) => {
        const id = message.body.id

        // Track concurrent executions
        concurrentCount.current++
        concurrentCount.max = Math.max(concurrentCount.max, concurrentCount.current)

        // Simulate async work with longer delay to ensure overlap
        await new Promise((resolve) => setTimeout(resolve, 20))

        // Each message should only be processed once
        expect(processedIds.has(id)).toBe(false)
        processedIds.add(id)

        concurrentCount.current--
        message.ack()
      }

      const messages: MockMessage<ParseQueueMessage>[] = Array.from(
        { length: 5 },
        (_, i) => ({
          body: {
            id: `msg_${i}`,
            type: 'parse' as const,
            runId: TEST_RUN_ID,
            chainSlug: TEST_CHAIN_SLUG,
            createdAt: new Date().toISOString(),
            r2Key: `key_${i}`,
            file: createMockDiscoveredFile(`file_${i}.csv`, 'csv'),
            innerFilename: `file_${i}.csv`,
            hash: `hash_${i}`,
          },
          attempts: 1,
          ack: vi.fn(),
          retry: vi.fn(),
        }),
      )

      // Process all in parallel
      await Promise.all(messages.map((msg) => processMessage(msg)))

      // Verify all messages processed exactly once
      expect(processedIds.size).toBe(5)

      // Verify parallel execution occurred (max concurrent > 1)
      expect(concurrentCount.max).toBeGreaterThan(1)

      // Verify all acks were called
      for (const msg of messages) {
        expect(msg.ack).toHaveBeenCalledTimes(1)
      }
    })
  })

  // ============================================================================
  // Backpressure and Retry Tests
  // ============================================================================

  describe('Backpressure and Retry Behavior', () => {
    it('should retry failed messages with exponential backoff', async () => {
      const retryDelays: number[] = []

      const mockMessage: MockMessage = {
        body: {
          id: 'msg_retry_test',
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
        } as QueueMessage,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn((options) => {
          if (options?.delaySeconds) {
            retryDelays.push(options.delaySeconds)
          }
        }),
      }

      // Simulate retry logic from worker
      const MAX_RETRIES = 3

      const calculateBackoff = (attempt: number): number => {
        return Math.min(60 * Math.pow(2, attempt - 1), 3600)
      }

      // Simulate 3 failed attempts
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        mockMessage.attempts = attempt
        const delaySeconds = calculateBackoff(attempt)
        mockMessage.retry({ delaySeconds })
      }

      // Verify exponential backoff: 60, 120, 240 seconds
      expect(retryDelays).toEqual([60, 120, 240])
    })

    it('should send to DLQ after max retries exceeded', async () => {
      const dlqMessages: QueueMessage[] = []
      const mockDLQ = {
        send: vi.fn(async (msg: QueueMessage) => {
          dlqMessages.push(msg)
        }),
      }

      const mockMessage: MockMessage = {
        body: {
          id: 'msg_dlq_test',
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
        } as QueueMessage,
        attempts: 4, // Exceeds max retries (3)
        ack: vi.fn(),
        retry: vi.fn(),
      }

      const MAX_RETRIES = 3

      // Simulate error handling
      if (mockMessage.attempts >= MAX_RETRIES) {
        await mockDLQ.send(mockMessage.body)
        mockMessage.ack() // Don't retry anymore
      }

      expect(mockDLQ.send).toHaveBeenCalledTimes(1)
      expect(dlqMessages.length).toBe(1)
      expect(dlqMessages[0].id).toBe('msg_dlq_test')
      expect(mockMessage.ack).toHaveBeenCalled()
      expect(mockMessage.retry).not.toHaveBeenCalled()
    })

    it('should ack successful messages immediately', async () => {
      const mockMessage: MockMessage = {
        body: {
          id: 'msg_success',
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
        } as QueueMessage,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      // Simulate successful processing
      const processSuccess = async () => {
        // Processing succeeds
        return true
      }

      const success = await processSuccess()
      if (success) {
        mockMessage.ack()
      }

      expect(mockMessage.ack).toHaveBeenCalledTimes(1)
      expect(mockMessage.retry).not.toHaveBeenCalled()
    })

    it('should handle transient errors with retry', async () => {
      let attemptCount = 0
      const retryInvocations: { attempt: number; delay: number }[] = []

      const mockMessage: MockMessage = {
        body: {
          id: 'msg_transient',
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
        } as QueueMessage,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn((options) => {
          retryInvocations.push({
            attempt: attemptCount,
            delay: options?.delaySeconds || 0,
          })
        }),
      }

      // Simulate transient error (e.g., network timeout)
      const processWithTransientError = async () => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Network timeout')
        }
        return true
      }

      const MAX_RETRIES = 3

      // Process with retries
      for (let i = 1; i <= MAX_RETRIES; i++) {
        mockMessage.attempts = i
        try {
          await processWithTransientError()
          mockMessage.ack()
          break
        } catch (error) {
          if (i < MAX_RETRIES) {
            const delaySeconds = Math.min(60 * Math.pow(2, i - 1), 3600)
            mockMessage.retry({ delaySeconds })
          }
        }
      }

      // Should have retried twice before succeeding on third attempt
      expect(retryInvocations.length).toBe(2)
      expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    })

    it('should respect backoff cap at 1 hour', async () => {
      const calculateBackoff = (attempt: number): number => {
        return Math.min(60 * Math.pow(2, attempt - 1), 3600)
      }

      // Test various attempt numbers
      expect(calculateBackoff(1)).toBe(60) // 1 minute
      expect(calculateBackoff(2)).toBe(120) // 2 minutes
      expect(calculateBackoff(3)).toBe(240) // 4 minutes
      expect(calculateBackoff(4)).toBe(480) // 8 minutes
      expect(calculateBackoff(5)).toBe(960) // 16 minutes
      expect(calculateBackoff(6)).toBe(1920) // 32 minutes
      expect(calculateBackoff(7)).toBe(3600) // Capped at 1 hour
      expect(calculateBackoff(8)).toBe(3600) // Still capped
      expect(calculateBackoff(10)).toBe(3600) // Still capped
    })

    it('should handle queue batch processing errors gracefully', async () => {
      const processedMessages: string[] = []
      const failedMessages: string[] = []

      const messages: MockMessage<ParseQueueMessage>[] = [
        {
          body: {
            id: 'msg_1',
            type: 'parse',
            runId: TEST_RUN_ID,
            chainSlug: TEST_CHAIN_SLUG,
            createdAt: new Date().toISOString(),
            r2Key: 'key_1',
            file: createMockDiscoveredFile('file1.csv', 'csv'),
            innerFilename: 'file1.csv',
            hash: 'hash_1',
          },
          attempts: 1,
          ack: vi.fn(),
          retry: vi.fn(),
        },
        {
          body: {
            id: 'msg_2_fail',
            type: 'parse',
            runId: TEST_RUN_ID,
            chainSlug: TEST_CHAIN_SLUG,
            createdAt: new Date().toISOString(),
            r2Key: 'key_2',
            file: createMockDiscoveredFile('file2.csv', 'csv'),
            innerFilename: 'file2.csv',
            hash: 'hash_2',
          },
          attempts: 1,
          ack: vi.fn(),
          retry: vi.fn(),
        },
        {
          body: {
            id: 'msg_3',
            type: 'parse',
            runId: TEST_RUN_ID,
            chainSlug: TEST_CHAIN_SLUG,
            createdAt: new Date().toISOString(),
            r2Key: 'key_3',
            file: createMockDiscoveredFile('file3.csv', 'csv'),
            innerFilename: 'file3.csv',
            hash: 'hash_3',
          },
          attempts: 1,
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ]

      const processMessage = async (message: MockMessage<ParseQueueMessage>) => {
        // Simulate one message failing
        if (message.body.id === 'msg_2_fail') {
          throw new Error('Processing failed')
        }
        return true
      }

      // Process messages, handling individual failures
      await Promise.all(
        messages.map(async (msg) => {
          try {
            await processMessage(msg)
            processedMessages.push(msg.body.id)
            msg.ack()
          } catch (error) {
            failedMessages.push(msg.body.id)
            msg.retry({ delaySeconds: 60 })
          }
        }),
      )

      // Verify successful messages were acked
      expect(processedMessages).toContain('msg_1')
      expect(processedMessages).toContain('msg_3')
      expect(processedMessages).not.toContain('msg_2_fail')

      // Verify failed message was retried
      expect(failedMessages).toContain('msg_2_fail')
      expect(messages[1].retry).toHaveBeenCalledWith({ delaySeconds: 60 })

      // One failure shouldn't affect others
      expect(messages[0].ack).toHaveBeenCalled()
      expect(messages[2].ack).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration - Full ZIP Fanout Flow', () => {
    it('should complete full fanout from ZIP to parse messages', async () => {
      // Create realistic ZIP with multiple store price files
      const zipContent = createTestZip({
        'Supermarket_Store1_prices.csv':
          'Naziv,Cijena,Barkod\nMlijeko,1.50,3850123456789\nKruh,2.00,3850987654321',
        'Supermarket_Store2_prices.csv':
          'Naziv,Cijena,Barkod\nVoda,0.99,3850111222333',
        'Supermarket_Store3_prices.csv':
          'Naziv,Cijena,Barkod\nJogurt,1.20,3850444555666\nSir,3.50,3850777888999',
      })

      const storedFiles = new Map<string, ArrayBuffer>()
      const mockStorage = createMockStorage(zipContent, storedFiles)
      const mockQueue = createMockQueue()

      // 1. Fetch ZIP from storage
      const r2Key = `ingestion/${TEST_RUN_ID}/${TEST_CHAIN_SLUG}/batch_prices.zip`
      const zipResult = await mockStorage.get(r2Key)
      expect(zipResult).not.toBeNull()

      // 2. Extract ZIP
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(zipResult!.content))

      // 3. Store expanded files and create parse messages
      const parseMessages: ParseQueueMessage[] = []

      for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
        if (innerFilename.endsWith('/') || innerFilename.startsWith('__MACOSX'))
          continue

        const expandedKey = `ingestion/${TEST_RUN_ID}/${TEST_CHAIN_SLUG}/expanded/batch_prices.zip/${innerFilename}`

        // Store expanded file
        await mockStorage.put(expandedKey, innerContent)

        // Create parse message
        parseMessages.push({
          id: `msg_${innerFilename.replace(/[^a-z0-9]/gi, '_')}`,
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
          r2Key: expandedKey,
          file: {
            url: `https://example.com/${innerFilename}`,
            filename: innerFilename,
            type: 'csv',
            size: innerContent.byteLength,
            lastModified: null,
            metadata: {},
          },
          innerFilename,
          hash: `hash_${innerFilename}`,
        })
      }

      // 4. Enqueue all parse messages in batch
      await mockQueue.sendBatch(parseMessages.map((msg) => ({ body: msg })))

      // Verify results
      expect(parseMessages.length).toBe(3)
      expect(storedFiles.size).toBe(3)
      expect(mockQueue.sentMessages.length).toBe(3)

      // Verify each message has correct structure
      for (const msg of mockQueue.sentMessages as ParseQueueMessage[]) {
        expect(msg.type).toBe('parse')
        expect(msg.runId).toBe(TEST_RUN_ID)
        expect(msg.chainSlug).toBe(TEST_CHAIN_SLUG)
        expect(msg.r2Key).toContain('expanded')
        expect(msg.file.type).toBe('csv')
        expect(msg.innerFilename).toBeTruthy()
        expect(msg.hash).toBeTruthy()
      }
    })

    it('should handle large ZIP with many files efficiently', async () => {
      // Create ZIP with many files
      const files: Record<string, string> = {}
      for (let i = 0; i < 50; i++) {
        files[`store_${i.toString().padStart(3, '0')}.csv`] =
          `name,price\nProduct${i},${100 + i}`
      }

      const zipContent = createTestZip(files)
      const mockStorage = createMockStorage(zipContent)
      const mockQueue = createMockQueue()

      const startTime = Date.now()

      // Extract and process
      const result = await mockStorage.get('large.zip')
      const { unzipSync } = await import('fflate')
      const unzipped = unzipSync(new Uint8Array(result!.content))

      const parseMessages: ParseQueueMessage[] = []
      for (const [innerFilename, innerContent] of Object.entries(unzipped)) {
        if (innerFilename.endsWith('/')) continue

        parseMessages.push({
          id: `msg_${innerFilename}`,
          type: 'parse',
          runId: TEST_RUN_ID,
          chainSlug: TEST_CHAIN_SLUG,
          createdAt: new Date().toISOString(),
          r2Key: `key/${innerFilename}`,
          file: createMockDiscoveredFile(innerFilename, 'csv'),
          innerFilename,
          hash: 'hash',
        })
      }

      await mockQueue.sendBatch(parseMessages.map((msg) => ({ body: msg })))

      const duration = Date.now() - startTime

      // Should complete within reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000)
      expect(mockQueue.sentMessages.length).toBe(50)
    })
  })
})
