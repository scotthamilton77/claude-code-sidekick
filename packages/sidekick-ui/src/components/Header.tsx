import React, { useState } from 'react'
import type { Session } from '../types'
import Icon from './Icon'

interface HeaderProps {
  currentSession: Session
  otherSessions: Session[]
  isLive: boolean
  onToggleLive: () => void
  onSelectSession: (session: Session) => void
}

const Header: React.FC<HeaderProps> = ({ currentSession, otherSessions, isLive, onToggleLive, onSelectSession }) => {
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)

  return (
    <header className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Session Selector */}
        <div className="relative">
          <button
            onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className="text-left">
              <p className="text-sm font-medium text-slate-800">{currentSession.title}</p>
              <p className="text-xs text-slate-500">{currentSession.date}</p>
            </div>
            <Icon
              name="chevron-down"
              className={`w-4 h-4 text-slate-400 transition-transform ${sessionDropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {sessionDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Recent Sessions</p>
              </div>
              {otherSessions.map((session) => (
                <button
                  key={session.id}
                  className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                  onClick={() => {
                    onSelectSession(session)
                    setSessionDropdownOpen(false)
                  }}
                >
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div>
                    <p className="text-sm text-slate-700">{session.title}</p>
                    <p className="text-xs text-slate-500">{session.date}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Current Branch */}
        <div className="flex items-center gap-1.5 text-sm text-slate-600">
          <Icon name="git-branch" className="w-4 h-4 text-slate-400" />
          <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{currentSession.branch}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Live Mode Toggle */}
        <button
          onClick={onToggleLive}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            isLive
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${isLive ? 'animate-spin' : ''}`} />
          {isLive ? 'Live' : 'Paused'}
        </button>
      </div>
    </header>
  )
}

export default Header
