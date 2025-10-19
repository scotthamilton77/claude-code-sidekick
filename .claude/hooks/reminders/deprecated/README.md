# Deprecated Reminder Templates

This directory contains reminder templates that have been superseded by the LLM-based transcript analysis system.

## Obsolete Files

- **topic-unset-reminder.txt**: Previously injected when conversation topic was unset
- **topic-refresh-reminder.txt**: Previously injected to prompt topic updates

## Why Deprecated

These prompt-based reminders have been replaced by:
- Automated LLM analysis via `analyze-transcript.sh`
- JSON-based topic tracking with clarity scores
- Adaptive cadence based on conversation clarity
- Direct integration with statusline.sh

The old approach required manual Claude invocations of `write-topic.sh`/`write-unclear-topic.sh`, which was:
- Invasive (constant reminders)
- Low fidelity (simple text files)
- Token-wasteful (reminders on every response)

The new approach is:
- Transparent (background analysis)
- Rich (JSON with metrics)
- Efficient (adaptive cadence)

## Retention

These files are kept for historical reference only. They can be safely deleted after validation of the new system.
