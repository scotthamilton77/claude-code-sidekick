import { z } from 'zod'

/** Schema for a project registry entry in ~/.sidekick/projects/{encoded}/registry.json */
export const ProjectRegistryEntrySchema = z.object({
  /** Absolute filesystem path to the project root */
  path: z.string(),
  /** Human-readable project name (derived from directory name) */
  displayName: z.string(),
  /** ISO 8601 timestamp of last daemon activity */
  lastActive: z.iso.datetime(),
})

export type ProjectRegistryEntry = z.infer<typeof ProjectRegistryEntrySchema>
