/**
 * Persona Domain Types
 *
 * Types for persona profiles that shape creative outputs (snarky messages, resume messages)
 * while keeping deterministic analysis untouched.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 */

import { z } from 'zod'

// ============================================================================
// Persona Definition
// ============================================================================

/**
 * Schema for persona definition files.
 *
 * Location: `assets/sidekick/personas/<name>.yaml`
 * Overrides: `~/.sidekick/personas/` and `.sidekick/personas/`
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Persona Asset Format
 */
export const PersonaDefinitionSchema = z.object({
  /** Persona identifier (must match filename stem) */
  id: z.string(),
  /** Display name for the persona */
  display_name: z.string(),
  /** Theme description (e.g., "Sci-fi snark with dry wit") */
  theme: z.string(),
  /** Personality traits (e.g., ["sarcastic", "impatient", "clever"]) */
  personality_traits: z.array(z.string()),
  /** Tone traits (e.g., ["snarky", "playful", "concise"]) */
  tone_traits: z.array(z.string()),
  /** Optional persona-specific empty-session messages for statusline */
  statusline_empty_messages: z.array(z.string()).optional(),
  /** Optional persona-specific snarky comment examples */
  snarky_examples: z.array(z.string()).optional(),
  /** Optional persona-specific resume message examples */
  resume_examples: z.array(z.string()).optional(),
})

export type PersonaDefinition = z.infer<typeof PersonaDefinitionSchema>
