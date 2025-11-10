/**
 * Data loaders for test data structures
 *
 * Loads data from test-data/ directory:
 * - Golden set and metadata
 * - Transcripts (JSONL format)
 * - Reference outputs (individual and consensus)
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  GoldenSet,
  MetadataCollection,
  Transcript,
  TranscriptMessage,
  TranscriptMetadata,
  ReferenceOutput,
  ConsensusOutput,
  ReferenceDirectory,
  ReferenceVersionMetadata,
} from './types.js'

// Get project root (3 levels up from this file)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..')
const TEST_DATA_ROOT = join(PROJECT_ROOT, 'test-data')
const TRANSCRIPTS_DIR = join(TEST_DATA_ROOT, 'transcripts')
const REFERENCES_DIR = join(TEST_DATA_ROOT, 'references')

/**
 * Load golden set metadata
 *
 * @param transcriptsDir - Optional custom transcripts directory path
 * @returns Golden set metadata with 15 reference transcripts
 */
export async function loadGoldenSet(transcriptsDir: string = TRANSCRIPTS_DIR): Promise<GoldenSet> {
  const goldenSetPath = join(transcriptsDir, 'golden-set.json')
  const content = await readFile(goldenSetPath, 'utf-8')
  return JSON.parse(content) as GoldenSet
}

/**
 * Load all transcript metadata
 *
 * @param transcriptsDir - Optional custom transcripts directory path
 * @returns Metadata for all 497 transcripts
 */
export async function loadMetadata(
  transcriptsDir: string = TRANSCRIPTS_DIR
): Promise<MetadataCollection> {
  const metadataPath = join(transcriptsDir, 'metadata.json')
  const content = await readFile(metadataPath, 'utf-8')
  return JSON.parse(content) as MetadataCollection
}

/**
 * Load a single transcript from JSONL file
 *
 * @param transcriptId - Transcript ID (e.g., "short-001")
 * @param transcriptsDir - Optional custom transcripts directory path
 * @returns Array of transcript messages
 */
export async function loadTranscript(
  transcriptId: string,
  transcriptsDir: string = TRANSCRIPTS_DIR
): Promise<Transcript> {
  const transcriptPath = join(transcriptsDir, `${transcriptId}.jsonl`)
  const content = await readFile(transcriptPath, 'utf-8')

  // Parse JSONL (one JSON object per line)
  const lines = content.trim().split('\n')
  const messages: TranscriptMessage[] = lines.map((line) => JSON.parse(line) as TranscriptMessage)

  return messages
}

/**
 * Load transcript metadata by ID
 *
 * @param transcriptId - Transcript ID (e.g., "short-001")
 * @param transcriptsDir - Optional custom transcripts directory path
 * @returns Transcript metadata or undefined if not found
 */
export async function loadTranscriptMetadata(
  transcriptId: string,
  transcriptsDir: string = TRANSCRIPTS_DIR
): Promise<TranscriptMetadata | undefined> {
  const metadata = await loadMetadata(transcriptsDir)
  return metadata.transcripts.find((t) => t.id === transcriptId)
}

/**
 * Load all transcripts from golden set
 *
 * @param transcriptsDir - Optional custom transcripts directory path
 * @returns Map of transcript ID to transcript messages
 */
export async function loadGoldenSetTranscripts(
  transcriptsDir: string = TRANSCRIPTS_DIR
): Promise<Map<string, Transcript>> {
  const goldenSet = await loadGoldenSet(transcriptsDir)
  const transcripts = new Map<string, Transcript>()

  // Load all golden set transcripts in parallel
  await Promise.all(
    goldenSet.golden_ids.map(async (id) => {
      const transcript = await loadTranscript(id, transcriptsDir)
      transcripts.set(id, transcript)
    })
  )

  return transcripts
}

/**
 * List all available reference versions
 *
 * @param referencesDir - Optional custom references directory path
 * @returns Array of reference directories with metadata
 */
export async function listReferenceVersions(
  referencesDir: string = REFERENCES_DIR
): Promise<ReferenceDirectory[]> {
  const entries = await readdir(referencesDir, { withFileTypes: true })
  const versionDirs = entries.filter((e) => e.isDirectory())

  const versions = await Promise.all(
    versionDirs.map(async (dir) => {
      const versionPath = join(referencesDir, dir.name)
      const transcriptEntries = await readdir(versionPath, {
        withFileTypes: true,
      })
      const transcriptIds = transcriptEntries
        .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
        .map((e) => e.name)

      // Try to load metadata if exists
      let metadata: ReferenceVersionMetadata | undefined
      try {
        const metadataPath = join(versionPath, '_metadata.json')
        const content = await readFile(metadataPath, 'utf-8')
        metadata = JSON.parse(content) as ReferenceVersionMetadata
      } catch {
        // Metadata file doesn't exist or can't be parsed
        metadata = undefined
      }

      return {
        version: dir.name,
        path: versionPath,
        transcriptIds,
        metadata,
      }
    })
  )

  return versions
}

/**
 * Load reference output from a specific model
 *
 * @param version - Reference version (e.g., "v1.0_2025-10-28_072648")
 * @param transcriptId - Transcript ID (e.g., "short-001")
 * @param modelFile - Model filename (e.g., "openai-gpt-5-chat.json")
 * @param referencesDir - Optional custom references directory path
 * @returns Reference output from model
 */
export async function loadReferenceOutput(
  version: string,
  transcriptId: string,
  modelFile: string,
  referencesDir: string = REFERENCES_DIR
): Promise<ReferenceOutput> {
  const referencePath = join(referencesDir, version, transcriptId, modelFile)
  const content = await readFile(referencePath, 'utf-8')
  return JSON.parse(content) as ReferenceOutput
}

/**
 * Load consensus output for a transcript
 *
 * @param version - Reference version (e.g., "v1.0_2025-10-28_072648")
 * @param transcriptId - Transcript ID (e.g., "short-001")
 * @param referencesDir - Optional custom references directory path
 * @returns Consensus reference output
 */
export async function loadConsensusOutput(
  version: string,
  transcriptId: string,
  referencesDir: string = REFERENCES_DIR
): Promise<ConsensusOutput> {
  const consensusPath = join(referencesDir, version, transcriptId, 'consensus.json')
  const content = await readFile(consensusPath, 'utf-8')
  return JSON.parse(content) as ConsensusOutput
}

/**
 * Load all reference outputs for a transcript (individual models + consensus)
 *
 * @param version - Reference version (e.g., "v1.0_2025-10-28_072648")
 * @param transcriptId - Transcript ID (e.g., "short-001")
 * @param referencesDir - Optional custom references directory path
 * @returns Object with model outputs and consensus
 */
export async function loadAllReferenceOutputs(
  version: string,
  transcriptId: string,
  referencesDir: string = REFERENCES_DIR
): Promise<{
  consensus: ConsensusOutput
  models: Map<string, ReferenceOutput>
}> {
  const transcriptDir = join(referencesDir, version, transcriptId)
  const files = await readdir(transcriptDir)

  // Load consensus
  const consensus = await loadConsensusOutput(version, transcriptId, referencesDir)

  // Load all model outputs (exclude consensus.json)
  const models = new Map<string, ReferenceOutput>()
  const modelFiles = files.filter((f) => f.endsWith('.json') && f !== 'consensus.json')

  await Promise.all(
    modelFiles.map(async (file) => {
      const output = await loadReferenceOutput(version, transcriptId, file, referencesDir)
      // Use filename without extension as key
      const modelKey = basename(file, '.json')
      models.set(modelKey, output)
    })
  )

  return { consensus, models }
}
