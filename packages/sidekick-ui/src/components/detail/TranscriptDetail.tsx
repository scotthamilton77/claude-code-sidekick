import type { TimelineEvent } from '../../types'

interface TranscriptDetailProps {
  event: TimelineEvent
}

export function TranscriptDetail({ event }: TranscriptDetailProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Full content */}
      {event.content && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Content</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
            {event.content}
          </p>
        </div>
      )}

      {/* LLM metadata (for assistant messages or LLM calls) */}
      {(event.llmModel || event.llmTokensIn != null) && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-2">Metadata</h3>
          <table className="text-xs w-full">
            <tbody>
              {event.llmModel && (
                <tr>
                  <td className="text-slate-500 pr-3 py-0.5">Model</td>
                  <td className="font-mono text-slate-700 dark:text-slate-300">{event.llmModel}</td>
                </tr>
              )}
              {event.llmTokensIn != null && (
                <tr>
                  <td className="text-slate-500 pr-3 py-0.5">Tokens In</td>
                  <td className="tabular-nums text-slate-700 dark:text-slate-300">{event.llmTokensIn.toLocaleString()}</td>
                </tr>
              )}
              {event.llmTokensOut != null && (
                <tr>
                  <td className="text-slate-500 pr-3 py-0.5">Tokens Out</td>
                  <td className="tabular-nums text-slate-700 dark:text-slate-300">{event.llmTokensOut.toLocaleString()}</td>
                </tr>
              )}
              {event.llmCostUsd != null && (
                <tr>
                  <td className="text-slate-500 pr-3 py-0.5">Cost</td>
                  <td className="tabular-nums text-slate-700 dark:text-slate-300">${event.llmCostUsd.toFixed(4)}</td>
                </tr>
              )}
              {event.llmLatencyMs != null && (
                <tr>
                  <td className="text-slate-500 pr-3 py-0.5">Latency</td>
                  <td className="tabular-nums text-slate-700 dark:text-slate-300">{(event.llmLatencyMs / 1000).toFixed(1)}s</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
