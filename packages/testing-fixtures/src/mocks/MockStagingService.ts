/**
 * Mock Staging Service for Testing
 *
 * Provides an in-memory staging service for testing without file I/O.
 * Implements the StagingService interface from @sidekick/types.
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 */

import type { StagingService, StagedReminder } from '@sidekick/types'

export class MockStagingService implements StagingService {
  private reminders = new Map<string, StagedReminder>()
  private suppressedHooks = new Set<string>()

  /** Get the storage key for a reminder */
  private key(hookName: string, reminderName: string): string {
    return `${hookName}:${reminderName}`
  }

  stageReminder(hookName: string, reminderName: string, data: StagedReminder): Promise<void> {
    this.reminders.set(this.key(hookName, reminderName), data)
    return Promise.resolve()
  }

  readReminder(hookName: string, reminderName: string): Promise<StagedReminder | null> {
    return Promise.resolve(this.reminders.get(this.key(hookName, reminderName)) ?? null)
  }

  clearStaging(hookName?: string): Promise<void> {
    if (hookName) {
      // Clear reminders for specific hook
      for (const key of this.reminders.keys()) {
        if (key.startsWith(`${hookName}:`)) {
          this.reminders.delete(key)
        }
      }
    } else {
      this.reminders.clear()
    }
    return Promise.resolve()
  }

  suppressHook(hookName: string): Promise<void> {
    this.suppressedHooks.add(hookName)
    return Promise.resolve()
  }

  isHookSuppressed(hookName: string): Promise<boolean> {
    return Promise.resolve(this.suppressedHooks.has(hookName))
  }

  clearSuppression(hookName: string): Promise<void> {
    this.suppressedHooks.delete(hookName)
    return Promise.resolve()
  }

  listReminders(hookName: string): Promise<StagedReminder[]> {
    const results: StagedReminder[] = []
    for (const [key, reminder] of this.reminders) {
      if (key.startsWith(`${hookName}:`)) {
        results.push(reminder)
      }
    }
    return Promise.resolve(results)
  }

  deleteReminder(hookName: string, reminderName: string): Promise<void> {
    const key = this.key(hookName, reminderName)
    this.reminders.delete(key)
    return Promise.resolve()
  }

  // Test utilities

  /**
   * Reset all staged reminders and suppressed hooks.
   */
  reset(): void {
    this.reminders.clear()
    this.suppressedHooks.clear()
  }

  /**
   * Get all staged reminders.
   */
  getAllReminders(): Map<string, StagedReminder> {
    return new Map(this.reminders)
  }

  /**
   * Get all suppressed hooks.
   */
  getSuppressedHooks(): Set<string> {
    return new Set(this.suppressedHooks)
  }

  /**
   * Get reminders for a specific hook.
   */
  getRemindersForHook(hookName: string): StagedReminder[] {
    const result: StagedReminder[] = []
    for (const [key, reminder] of this.reminders) {
      if (key.startsWith(`${hookName}:`)) {
        result.push(reminder)
      }
    }
    return result
  }
}
