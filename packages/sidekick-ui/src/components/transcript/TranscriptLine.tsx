import { useState, useMemo } from 'react'
import { BookOpen, Scissors, ChevronDown, ChevronRight } from 'lucide-react'
import type { TranscriptLine as TLine } from '../../types'
import { formatTime } from '../../utils/formatTime'
import { CollapsibleContent } from './CollapsibleContent'
import { truncate, formatToolInput, extractSkillName, getSystemInjectionLabel, isSafeUrl } from './TranscriptLineUtils'
import { getLineStyles, buildSidekickSingleLine, isSidekickEventType } from './TranscriptLineStyles'

interface PairNavigation {
  color: string
  isToolUse: boolean
  onNavigate: () => void
}

interface TranscriptLineProps {
  line: TLine
  isSelected: boolean
  isSynced: boolean
  onClick: () => void
  pairNavigation?: PairNavigation
  defaultModel?: string
}

export function TranscriptLineCard({
  line,
  isSelected,
  isSynced,
  onClick,
  pairNavigation,
  defaultModel,
}: TranscriptLineProps) {
  const [showThinking, setShowThinking] = useState(false)
  const [showInjection, setShowInjection] = useState(false)
  const toolInputJson = useMemo(
    () => line.toolInput ? JSON.stringify(line.toolInput, null, 2) : '',
    [line.toolInput]
  )

  // Compaction gets special full-width divider treatment
  if (line.type === 'compaction') {
    return (
      <div
        onClick={onClick}
        className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <Scissors size={12} />
          <span>Segment {line.compactionSegment ?? '?'}</span>
          {line.compactionTokensBefore != null && line.compactionTokensAfter != null && (
            <>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span>
                {(line.compactionTokensBefore / 1000).toFixed(0)}k → {(line.compactionTokensAfter / 1000).toFixed(0)}k
              </span>
            </>
          )}
        </div>
        <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
      </div>
    )
  }

  // Skill content: purple collapsed pill with skill name
  if (line.type === 'user-message' && line.userSubtype === 'skill-content') {
    const skillName = extractSkillName(line.content ?? '') ?? 'unknown'
    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
          <div
            className={`rounded-lg px-2.5 py-1 bg-purple-50 dark:bg-purple-950/30 border-l-2 border border-purple-200 dark:border-purple-800 border-l-purple-400 dark:border-l-purple-500 ${
              isSelected
                ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
                : isSynced
                  ? 'ring-2 ring-amber-400 dark:ring-amber-500'
                  : ''
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowInjection(!showInjection)
              }}
              className="flex items-center gap-1.5 w-full"
            >
              {showInjection ? (
                <ChevronDown size={10} className="text-purple-400" />
              ) : (
                <ChevronRight size={10} className="text-purple-400" />
              )}
              <BookOpen size={10} className="text-purple-500 dark:text-purple-400" />
              <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400">Skill: {skillName}</span>
              <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">
                {formatTime(line.timestamp)}
              </span>
            </button>
            {showInjection && line.content && (
              <p className="text-[10px] font-mono text-purple-600/70 dark:text-purple-300/60 mt-1 leading-relaxed whitespace-pre-wrap line-clamp-[20]">
                {line.content}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // System injection: gray collapsed with context-aware label
  if (line.type === 'user-message' && line.userSubtype === 'system-injection') {
    const label = getSystemInjectionLabel(line.content ?? '')
    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
          <div
            className={`rounded-lg px-2.5 py-1 bg-gray-50 dark:bg-gray-900/50 border-l-2 border border-gray-200 dark:border-gray-700 border-l-gray-400 dark:border-l-gray-500 ${
              isSelected
                ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
                : isSynced
                  ? 'ring-2 ring-amber-400 dark:ring-amber-500'
                  : ''
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowInjection(!showInjection)
              }}
              className="flex items-center gap-1.5 w-full"
            >
              {showInjection ? (
                <ChevronDown size={10} className="text-gray-400" />
              ) : (
                <ChevronRight size={10} className="text-gray-400" />
              )}
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{label}</span>
              <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">
                {formatTime(line.timestamp)}
              </span>
            </button>
            {showInjection && line.content && (
              <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mt-1 leading-relaxed whitespace-pre-wrap line-clamp-[20]">
                {line.content}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const isSidekick = isSidekickEventType(line.type)

  // Sidekick events: single-line compact, center-justified 60% width
  if (isSidekick) {
    const styles = getLineStyles(line)
    const { label, detail } = buildSidekickSingleLine(line)

    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
          <div
            className={`rounded-lg px-2.5 py-1 transition-all ${styles.bg} ${styles.border} ${
              isSelected
                ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
                : isSynced
                  ? 'ring-2 ring-amber-400 dark:ring-amber-500'
                  : ''
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <styles.Icon size={11} className={`${styles.iconColor} flex-shrink-0`} />
              <span className={`text-[10px] font-medium ${styles.labelColor} truncate`}>
                {label}
                {detail ? <span className="opacity-60 font-normal"> · {detail}</span> : null}
              </span>
              <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">
                {formatTime(line.timestamp)}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const styles = getLineStyles(line)

  // Positioning: user prompts/commands right-aligned, assistant left-aligned,
  // tools indented, system types center-justified 60% width
  const isUserPrompt = line.type === 'user-message' && (line.userSubtype === 'prompt' || line.userSubtype === 'command')
  const isAssistant = line.type === 'assistant-message'
  const isTool = line.type === 'tool-use' || line.type === 'tool-result'
  const isSystemType = line.type === 'turn-duration' || line.type === 'api-error' || line.type === 'pr-link'

  return (
    <div
      onClick={onClick}
      className={`px-2 py-0.5 transition-all cursor-pointer ${
        isUserPrompt
          ? 'flex justify-end'
          : isAssistant
            ? 'ml-2'
            : isTool
              ? 'ml-6'
              : isSystemType
                ? 'flex justify-center'
                : ''
      }`}
    >
      <div
        className={
          isUserPrompt ? 'w-[90%]' : isAssistant ? 'w-[90%]' : isTool ? 'w-[85%]' : isSystemType ? 'w-[60%]' : undefined
        }
      >
        <div
          className={`rounded-lg px-2.5 py-1.5 transition-all ${styles.bg} ${styles.border} ${
            isSelected
              ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
              : isSynced
                ? 'ring-2 ring-amber-400 dark:ring-amber-500'
                : ''
          }`}
        >
          {/* Header: icon + label + time */}
          <div className="flex items-center gap-1.5">
            <styles.Icon size={11} className={styles.iconColor} />
            <span className={`text-[10px] font-medium ${styles.labelColor} truncate`}>
              {styles.label}
              {line.type === 'tool-use' &&
                line.toolInput &&
                (() => {
                  const preview = formatToolInput(line.toolName, line.toolInput)
                  return preview ? (
                    <span className="font-mono font-normal opacity-75">: {truncate(preview, 80)}</span>
                  ) : null
                })()}
            </span>
            {line.isSidechain && (
              <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded">sidechain</span>
            )}
            {line.type === 'assistant-message' && !line.content && line.thinking && (
              <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded">thinking</span>
            )}
            {line.model && line.model !== defaultModel && (
              <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded font-mono">
                {line.model.replace('claude-', '').split('-202')[0]}
              </span>
            )}
            {line.type === 'tool-use' && line.toolDurationMs != null && (
              <span className="text-[9px] text-slate-400 tabular-nums">{line.toolDurationMs}ms</span>
            )}
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">
              {formatTime(line.timestamp)}
            </span>
          </div>

          {/* Content */}
          {line.content && !(line.type === 'user-message' && line.userSubtype === 'command') && (
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-3 mt-0.5">
              {line.content}
            </p>
          )}

          {/* Tool input (collapsible JSON) */}
          {line.type === 'tool-use' && line.toolInput && (
            <CollapsibleContent
              content={toolInputJson}
              previewLines={3}
              previewChars={300}
              mono
              highlight="json"
              className="text-slate-500 dark:text-slate-400 mt-0.5"
              label="input"
            />
          )}

          {/* Thinking-only assistant message — show thinking as primary content */}
          {line.type === 'assistant-message' && !line.content && line.thinking && (
            <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700 mt-0.5">
              <CollapsibleContent
                content={line.thinking}
                previewLines={3}
                previewChars={300}
                className="text-slate-500 dark:text-slate-400 italic"
                label="thinking"
              />
            </div>
          )}

          {/* Thinking block (collapsible) — only when there IS text content */}
          {line.type === 'assistant-message' && line.content && line.thinking && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowThinking(!showThinking)
              }}
              className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 hover:text-slate-600"
            >
              {showThinking ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <span>thinking</span>
            </button>
          )}
          {showThinking && line.thinking && (
            <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700 mt-1">
              <CollapsibleContent
                content={line.thinking}
                previewLines={5}
                previewChars={500}
                className="text-slate-500 dark:text-slate-400 italic"
                label="thinking"
              />
            </div>
          )}

          {/* Tool result */}
          {line.type === 'tool-result' && line.toolOutput && (
            <CollapsibleContent
              content={line.toolOutput}
              previewLines={3}
              previewChars={300}
              mono
              className={
                line.toolSuccess === false
                  ? 'text-red-600 dark:text-red-400 mt-0.5'
                  : 'text-slate-500 dark:text-slate-400 mt-0.5'
              }
              label="output"
            />
          )}

          {/* Tool pair navigation link */}
          {pairNavigation && (line.type === 'tool-use' || line.type === 'tool-result') && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                pairNavigation.onNavigate()
              }}
              className="text-[9px] mt-0.5 hover:underline"
              style={{ color: pairNavigation.color }}
            >
              {pairNavigation.isToolUse ? '→ result' : '← call'}
            </button>
          )}

          {/* API error message */}
          {line.type === 'api-error' && line.errorMessage && (
            <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5 font-mono">{line.errorMessage}</p>
          )}

          {/* PR link URL */}
          {line.type === 'pr-link' && line.prUrl && isSafeUrl(line.prUrl) && (
            <a
              href={line.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 mt-0.5 font-mono truncate block"
              onClick={(e) => e.stopPropagation()}
            >
              {line.prUrl}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
