import React, { useState } from 'react';
import { StateSnapshot } from '../data/mockData';
import Icon from './Icon';

interface StateInspectorProps {
    stateData: {
        current: StateSnapshot;
        previous: StateSnapshot;
    };
    currentTime: string;
}

const StateInspector: React.FC<StateInspectorProps> = ({ stateData, currentTime }) => {
    const [showDiff, setShowDiff] = useState(false);

    return (
        <div className="w-[420px] bg-white border-l border-slate-200 flex flex-col">
            {/* Inspector Header */}
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon name="cpu" className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700">State Inspector</span>
                </div>
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                    <button
                        onClick={() => setShowDiff(false)}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${!showDiff ? 'bg-white shadow-sm text-slate-800 font-medium' : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        Raw
                    </button>
                    <button
                        onClick={() => setShowDiff(true)}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${showDiff ? 'bg-white shadow-sm text-slate-800 font-medium' : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        Diff
                    </button>
                </div>
            </div>

            {/* File Name */}
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-mono text-slate-600">session-summary.json</span>
                <span className="text-xs text-slate-400">@ {currentTime}</span>
            </div>

            {/* State Content */}
            <div className="flex-1 overflow-y-auto">
                {showDiff ? (
                    // Diff View - Full context with inline changes
                    <div className="font-mono text-xs leading-relaxed">
                        <div className="px-4 py-2 text-slate-600">{"{"}</div>
                        <div className="px-4 py-1 text-slate-600 pl-8">"session_id": "{stateData.current.session_id}",</div>
                        <div className="px-4 py-1 text-slate-600 pl-8">"session_title": "{stateData.current.session_title}",</div>

                        {/* Changed: session_title_confidence */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-8">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "session_title_confidence": {stateData.previous.session_title_confidence},
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-8">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "session_title_confidence": {stateData.current.session_title_confidence},
                            </div>
                        </div>

                        {/* Changed: latest_intent */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-8">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "latest_intent": "{stateData.previous.latest_intent}",
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-8">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "latest_intent": "{stateData.current.latest_intent}",
                            </div>
                        </div>

                        {/* Changed: latest_intent_confidence */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-8">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "latest_intent_confidence": {stateData.previous.latest_intent_confidence},
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-8">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "latest_intent_confidence": {stateData.current.latest_intent_confidence},
                            </div>
                        </div>

                        <div className="px-4 py-1 text-slate-600 pl-8">"tokens": {"{"}</div>

                        {/* Changed: tokens.input */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-12">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "input": {stateData.previous.tokens.input},
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-12">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "input": {stateData.current.tokens.input},
                            </div>
                        </div>

                        {/* Changed: tokens.output */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-12">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "output": {stateData.previous.tokens.output}
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-12">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "output": {stateData.current.tokens.output}
                            </div>
                        </div>

                        <div className="px-4 py-1 text-slate-600 pl-8">{"},"}</div>

                        {/* Changed: cost_usd */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-8">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "cost_usd": {stateData.previous.cost_usd},
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-8">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "cost_usd": {stateData.current.cost_usd},
                            </div>
                        </div>

                        {/* Changed: duration_sec */}
                        <div className="bg-red-50 border-l-2 border-red-400">
                            <div className="px-4 py-0.5 text-red-700 pl-8">
                                <span className="select-none text-red-400 mr-2">-</span>
                                "duration_sec": {stateData.previous.duration_sec}
                            </div>
                        </div>
                        <div className="bg-green-50 border-l-2 border-green-400">
                            <div className="px-4 py-0.5 text-green-700 pl-8">
                                <span className="select-none text-green-400 mr-2">+</span>
                                "duration_sec": {stateData.current.duration_sec}
                            </div>
                        </div>

                        <div className="px-4 py-2 text-slate-600">{"}"}</div>
                    </div>
                ) : (
                    // Raw View
                    <div className="p-4 font-mono text-xs">
                        <pre className="text-slate-700 whitespace-pre-wrap">
                            {JSON.stringify(stateData.current, null, 2)}
                        </pre>
                    </div>
                )}
            </div>

            {/* Stats Footer */}
            <div className="border-t border-slate-200 p-3 grid grid-cols-3 gap-3 bg-slate-50">
                <div className="text-center">
                    <p className="text-lg font-semibold text-slate-800">{(stateData.current.tokens.input + stateData.current.tokens.output) / 1000}k</p>
                    <p className="text-xs text-slate-500">Tokens</p>
                </div>
                <div className="text-center">
                    <p className="text-lg font-semibold text-slate-800">${stateData.current.cost_usd}</p>
                    <p className="text-xs text-slate-500">Cost</p>
                </div>
                <div className="text-center">
                    <p className="text-lg font-semibold text-slate-800">{Math.floor(stateData.current.duration_sec / 60)}:{String(stateData.current.duration_sec % 60).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-500">Duration</p>
                </div>
            </div>
        </div>
    );
};

export default StateInspector;
