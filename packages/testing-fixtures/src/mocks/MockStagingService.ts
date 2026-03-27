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
  /** Consumed reminders: key is `${hookName}:${reminderName}`, value is array of consumed reminders (newest first) */
  private consumedReminders = new Map<string, StagedReminder[]>()

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

  listReminders(hookName: string): Promise<StagedReminder[]> {
    const results: StagedReminder[] = []
    for (const [key, reminder] of this.reminders) {
      if (key.startsWith(`${hookName}:`)) {
        results.push(reminder)
      }
    }
    return Promise.resolve(results)
  }

  deleteReminder(hookName: string, reminderName: string): Promise<boolean> {
    const key = this.key(hookName, reminderName)
    const existed = this.reminders.has(key)
    this.reminders.delete(key)
    return Promise.resolve(existed)
  }

  listConsumedReminders(hookName: string, reminderName: string): Promise<StagedReminder[]> {
    const key = this.key(hookName, reminderName)
    return Promise.resolve(this.consumedReminders.get(key) ?? [])
  }

  getLastConsumed(hookName: string, reminderName: string): Promise<StagedReminder | null> {
    const key = this.key(hookName, reminderName)
    const consumed = this.consumedReminders.get(key)
    return Promise.resolve(consumed?.[0] ?? null)
  }

  // Test utilities

  /**
   * Reset all staged reminders and consumed reminders.
   */
  reset(): void {
    this.reminders.clear()
    this.consumedReminders.clear()
  }

  /**
   * Add a consumed reminder (for testing reactivation logic).
   */
  addConsumedReminder(hookName: string, reminderName: string, reminder: StagedReminder): void {
    const key = this.key(hookName, reminderName)
    const existing = this.consumedReminders.get(key) ?? []
    this.consumedReminders.set(key, [reminder, ...existing])
  }

  /**
   * Get all staged reminders.
   */
  getAllReminders(): Map<string, StagedReminder> {
    return new Map(this.reminders)
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
