/**
 * User Profile Types
 *
 * Optional user identity loaded from ~/.sidekick/user.yaml.
 * Provides name, role, and interests for persona personalization.
 */
import { z } from 'zod'

export const UserProfileSchema = z.object({
  /** User's display name */
  name: z.string(),
  /** User's role (e.g., "Software Architect") */
  role: z.string(),
  /** User's interests as string array */
  interests: z.array(z.string()),
})

export type UserProfile = z.infer<typeof UserProfileSchema>
