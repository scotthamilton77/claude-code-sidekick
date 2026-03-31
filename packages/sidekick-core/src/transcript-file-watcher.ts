/**
 * Transcript File Watcher
 *
 * Handles file watching, streaming reads, and circular buffer management
 * for transcript processing. Extracted from TranscriptServiceImpl.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import chokidar, { FSWatcher } from 'chokidar'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { TranscriptEntrySchema } from './state/index.js'
import { LogEvents, logEvent } from './structured-logging.js'
import { EXCERPT_BUFFER_SIZE, type BufferedEntry } from './transcript-helpers.js'
import { parseUuid } from './transcript-normalizer.js'
import type { TranscriptEntry, TranscriptMetrics, Logger } from '@sidekick/types'

// ============================================================================
// Streaming State
// ============================================================================

/**
 * Mutable state for the file watcher's streaming processor.
 * Encapsulates all state that changes during incremental file reads.
 */
export interface StreamingState {
  /** Byte offset of last processed position in transcript file */
  lastProcessedByteOffset: number
  /** Ring buffer of recent transcript entries for excerpt queries */
  excerptBuffer: BufferedEntry[]
  /** Write position in circular buffer */
  excerptBufferHead: number
  /** Number of entries currently in buffer (up to EXCERPT_BUFFER_SIZE) */
  excerptBufferCount: number
  /** Set of all known UUIDs for summary validation */
  knownUuids: Set<string>
}

/**
 * Create a fresh streaming state with all defaults.
 */
export function createStreamingState(): StreamingState {
  return {
    lastProcessedByteOffset: 0,
    excerptBuffer: [],
    excerptBufferHead: 0,
    excerptBufferCount: 0,
    knownUuids: new Set<string>(),
  }
}

// ============================================================================
// Streaming State Management
// ============================================================================

/**
 * Reset streaming state when file is detected as truncated/replaced.
 */
export function resetStreamingState(state: StreamingState, metrics: TranscriptMetrics): void {
  state.lastProcessedByteOffset = 0
  metrics.lastProcessedLine = 0
  state.excerptBuffer = []
  state.excerptBufferHead = 0
  state.excerptBufferCount = 0
  state.knownUuids.clear()
}

// ============================================================================
// Circular Buffer Operations
// ============================================================================

/**
 * Add an entry to the circular excerpt buffer.
 * Maintains EXCERPT_BUFFER_SIZE most recent entries.
 */
export function addToExcerptBuffer(state: StreamingState, lineNumber: number, rawLine: string): void {
  const uuid = parseUuid(rawLine)
  if (uuid) {
    state.knownUuids.add(uuid)
  }

  const entry: BufferedEntry = { lineNumber, rawLine, uuid }

  if (state.excerptBuffer.length < EXCERPT_BUFFER_SIZE) {
    // Buffer not yet full - append
    state.excerptBuffer.push(entry)
    state.excerptBufferCount = state.excerptBuffer.length
  } else {
    // Buffer full - overwrite oldest
    state.excerptBuffer[state.excerptBufferHead] = entry
    state.excerptBufferHead = (state.excerptBufferHead + 1) % EXCERPT_BUFFER_SIZE
    // excerptBufferCount stays at EXCERPT_BUFFER_SIZE
  }
}

// ============================================================================
// File Watcher Setup
// ============================================================================

/**
 * Start watching a transcript file for changes.
 *
 * @param transcriptPath - Path to the transcript file
 * @param watchDebounceMs - Debounce interval for file change events
 * @param onFileChanged - Callback when file changes (after debounce)
 * @param logger - Logger for observability
 * @param sessionId - Session ID for logging
 * @returns The FSWatcher instance and a function to clear the debounce timer
 */
export function startWatching(
  transcriptPath: string,
  watchDebounceMs: number,
  onFileChanged: () => void,
  logger: Logger,
  sessionId: string | null
): { watcher: FSWatcher; clearDebounce: () => void } {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = chokidar.watch(transcriptPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: watchDebounceMs,
      pollInterval: 50,
    },
  })

  watcher.on('change', () => {
    logger.debug('File watcher detected change', { sessionId })
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(onFileChanged, watchDebounceMs)
  })

  watcher.on('error', (err) => {
    logger.error('File watcher error', { err, sessionId })
  })

  return {
    watcher,
    clearDebounce: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
    },
  }
}

// ============================================================================
// Transcript File Processing
// ============================================================================

/**
 * Process transcript file incrementally using streaming.
 * Only reads from lastProcessedByteOffset to avoid loading entire file.
 * Populates excerpt buffer for memory-based excerpt generation.
 *
 * @param transcriptPath - Path to transcript file
 * @param state - Streaming state (modified in place)
 * @param metrics - Transcript metrics (modified in place)
 * @param processEntryFn - Callback to process each parsed entry for metrics
 * @param emitBulkComplete - Callback to emit BulkProcessingComplete event
 * @param logger - Logger
 * @param sessionId - Session ID
 * @param bulkState - Bulk processing state for backlog detection
 */
export async function processTranscriptFile(
  transcriptPath: string,
  state: StreamingState,
  metrics: TranscriptMetrics,
  processEntryFn: (entry: TranscriptEntry, lineNumber: number) => Promise<void>,
  emitBulkComplete: (lineNumber: number, durationMs: number) => Promise<void>,
  logger: Logger,
  sessionId: string | null,
  bulkState: {
    hasBacklogAtPrepareTime: boolean
    isBulkProcessing: boolean
    hasFiredBulkComplete: boolean
    bulkStartTime: number
    setIsBulkProcessing: (v: boolean) => void
    setHasFiredBulkComplete: (v: boolean) => void
    setBulkStartTime: (v: number) => void
  }
): Promise<void> {
  if (!existsSync(transcriptPath)) {
    return
  }

  // Get current file size to detect if we need to read anything
  const fileStats = statSync(transcriptPath)
  const currentFileSize = fileStats.size

  // If file size is smaller than our offset, file was truncated/replaced
  // This shouldn't happen with append-only transcripts, but handle gracefully
  if (currentFileSize < state.lastProcessedByteOffset) {
    logger.warn('Transcript file appears truncated, resetting state', {
      sessionId,
      expectedOffset: state.lastProcessedByteOffset,
      actualSize: currentFileSize,
    })
    resetStreamingState(state, metrics)
  }

  // Nothing new to read
  if (currentFileSize === state.lastProcessedByteOffset) {
    return
  }

  const startLine = metrics.lastProcessedLine
  const isBulkStart = startLine === 0 && state.lastProcessedByteOffset === 0 && bulkState.hasBacklogAtPrepareTime

  if (isBulkStart && !bulkState.hasFiredBulkComplete) {
    bulkState.setIsBulkProcessing(true)
    bulkState.setBulkStartTime(Date.now())
    logEvent(logger, LogEvents.bulkProcessingStart({ sessionId: sessionId! }, { fileSize: currentFileSize }))
  }

  // Stream from last processed position
  const stream = createReadStream(transcriptPath, {
    encoding: 'utf-8',
    start: state.lastProcessedByteOffset,
  })

  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  let lineNumber = metrics.lastProcessedLine
  let bytesRead = state.lastProcessedByteOffset
  let linesProcessed = 0

  logger.debug('processTranscriptFile streaming started', {
    sessionId,
    startByteOffset: state.lastProcessedByteOffset,
    startLineNumber: lineNumber,
  })

  try {
    for await (const line of rl) {
      // Track bytes (line + newline character)
      bytesRead += Buffer.byteLength(line, 'utf-8') + 1

      // Skip empty lines
      if (!line.trim()) continue

      lineNumber++
      linesProcessed++

      // Add to excerpt buffer
      addToExcerptBuffer(state, lineNumber, line)

      // Process the entry for metrics
      try {
        const parsed = TranscriptEntrySchema.safeParse(JSON.parse(line))
        if (!parsed.success) {
          logger.warn('Skipping invalid transcript line', {
            sessionId,
            line: lineNumber,
            error: parsed.error.message,
          })
          continue
        }
        const entry = parsed.data as TranscriptEntry
        await processEntryFn(entry, lineNumber)
      } catch {
        logger.warn('Skipping malformed transcript line', {
          sessionId,
          line: lineNumber,
          rawLine: line,
        })
      }
    }
  } finally {
    // Ensure stream is closed
    stream.destroy()
  }

  // Update watermarks
  state.lastProcessedByteOffset = bytesRead
  metrics.lastProcessedLine = lineNumber
  metrics.lastUpdatedAt = Date.now()

  logger.debug('processTranscriptFile streaming complete', {
    sessionId,
    linesProcessed,
    totalLines: lineNumber,
    newByteOffset: bytesRead,
  })

  // Emit BulkProcessingComplete if we were in bulk mode
  if (isBulkStart && bulkState.isBulkProcessing && !bulkState.hasFiredBulkComplete) {
    bulkState.setIsBulkProcessing(false)
    bulkState.setHasFiredBulkComplete(true)
    const durationMs = Date.now() - bulkState.bulkStartTime
    logEvent(
      logger,
      LogEvents.bulkProcessingFinish({ sessionId: sessionId! }, { totalLinesProcessed: lineNumber, durationMs })
    )
    await emitBulkComplete(lineNumber, durationMs)
  }
}

// ============================================================================
// Processing Queue
// ============================================================================

/**
 * Enqueue a processTranscriptFile() call through a serialization chain.
 * Guarantees no concurrent execution: if a call is in-flight, this one
 * waits for it to finish, then runs (finding nothing new if the first
 * call already consumed everything).
 *
 * @param currentChain - The current promise chain
 * @param processCallback - The processing function to call
 * @returns Object with the next promise (for caller to await) and the updated chain
 */
export function enqueueProcessing(
  currentChain: Promise<void>,
  processCallback: () => Promise<void>
): { promise: Promise<void>; chain: Promise<void> } {
  const next = currentChain.then(() => processCallback())
  // Swallow errors on the chain itself so a failed call doesn't break
  // subsequent enqueued calls. The returned promise still rejects for
  // the caller who enqueued it.
  const chain = next.catch(() => {})
  return { promise: next, chain }
}
