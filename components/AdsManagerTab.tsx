'use client';

/**
 * AdsManagerTab — embedded Google Ads management interface.
 * Team members can chat with Claude to analyse campaigns and make changes
 * across the Pascal Press, Excel Test Zone, and HSC Copilot ad accounts.
 */

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '@/lib/types';

// ─── Account config ────────────────────────────────────────────────────────────

type Account = 'pp' | 'etz' | 'hsc';

const ACCOUNTS: { id: Account; label: string; sub: string }[] = [
  { id: 'pp',  label: 'Pascal Press',    sub: '246-104-2966' },
  { id: 'etz', label: 'Excel Test Zone', sub: '893-408-4207' },
  { id: 'hsc', label: 'HSC Copilot',     sub: '140-426-6935' },
];

// ─── Quick-action prompts ──────────────────────────────────────────────────────

const SUGGESTIONS: Record<Account, string[]> = {
  pp: [
    'Show all active campaigns with spend this month',
    'Find shopping products with high spend but no conversions',
    'Pull the top 20 search terms by spend and flag any wasteful ones',
    'Cross-reference GA4 revenue with shopping spend — calculate ROAS per campaign',
    'Pause the campaigns with the lowest ROAS',
  ],
  etz: [
    'Show all active campaigns with spend this month',
    'Find shopping products with high spend but no conversions',
    'What are the top search terms driving clicks?',
    'What is the blended ROAS for Excel Test Zone this month?',
  ],
  hsc: [
    'Show all active campaigns with spend this month',
    'Find keywords with high spend but zero conversions',
    'What search terms triggered ads this month?',
    'What is our spend and estimated ROAS this month?',
  ],
};

// ─── Simple markdown renderer ──────────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  // Split on **bold** and `code` spans
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono text-gray-700">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  const bullets: string[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length) {
      result.push(
        <ul key={`ul-${key}`} className="list-disc ml-5 space-y-0.5 my-1">
          {bullets.map((b, i) => (
            <li key={i} className="leading-snug">
              <InlineText text={b} />
            </li>
          ))}
        </ul>,
      );
      bullets.length = 0;
    }
  };

  lines.forEach((line, i) => {
    const k = String(i);
    if (/^### /.test(line)) {
      flushBullets(k);
      result.push(
        <h3 key={k} className="font-semibold text-gray-800 mt-3 mb-1 text-sm">
          <InlineText text={line.slice(4)} />
        </h3>,
      );
    } else if (/^## /.test(line)) {
      flushBullets(k);
      result.push(
        <h2 key={k} className="font-bold text-gray-900 mt-4 mb-1">
          <InlineText text={line.slice(3)} />
        </h2>,
      );
    } else if (/^# /.test(line)) {
      flushBullets(k);
      result.push(
        <h1 key={k} className="font-bold text-gray-900 mt-4 mb-1 text-base">
          <InlineText text={line.slice(2)} />
        </h1>,
      );
    } else if (/^[-•] /.test(line)) {
      bullets.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      // Numbered list item — collect inline, flush as ordered list when block ends
      bullets.push(line.replace(/^\d+\. /, ''));
    } else if (line === '---') {
      flushBullets(k);
      result.push(<hr key={k} className="border-gray-200 my-2" />);
    } else if (line.trim() === '') {
      flushBullets(k);
      result.push(<div key={k} className="h-1.5" />);
    } else {
      flushBullets(k);
      result.push(
        <p key={k} className="leading-relaxed">
          <InlineText text={line} />
        </p>,
      );
    }
  });
  flushBullets('end');

  return <div className="text-sm space-y-0.5">{result}</div>;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AdsManagerTab() {
  const [account,  setAccount]  = useState<Account>('pp');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  // Reset conversation when switching accounts
  useEffect(() => {
    setMessages([]);
    setError('');
    setInput('');
  }, [account]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setError('');

    const userMsg: ChatMessage = { role: 'user', content: text.trim(), timestamp: new Date() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ads-chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          account,
          messages: history.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to get response');

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.reply, timestamp: new Date() },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(prev => prev.slice(0, -1)); // roll back optimistic user message
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const currentAccount = ACCOUNTS.find(a => a.id === account)!;

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Title */}
          <div className="flex items-center gap-2 mr-auto">
            {/* Google Ads icon */}
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M27.5 7.5L12.5 32.5" stroke="#FBBC04" strokeWidth="6" strokeLinecap="round"/>
              <path d="M12.5 32.5H32.5" stroke="#34A853" strokeWidth="6" strokeLinecap="round"/>
              <path d="M7.5 32.5C7.5 30.0147 9.51472 28 12 28C14.4853 28 16.5 30.0147 16.5 32.5C16.5 34.9853 14.4853 37 12 37C9.51472 37 7.5 34.9853 7.5 32.5Z" fill="#EA4335"/>
            </svg>
            <div>
              <h1 className="text-sm font-semibold text-gray-900 leading-none">Google Ads Manager</h1>
              <p className="text-xs text-gray-500 mt-0.5">Analyse &amp; manage campaigns with Claude</p>
            </div>
          </div>

          {/* Account selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-shrink-0">
            {ACCOUNTS.map(acc => (
              <button
                key={acc.id}
                onClick={() => setAccount(acc.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  account === acc.id
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

        {/* Empty state / suggestions */}
        {messages.length === 0 && !loading && (
          <div className="max-w-2xl mx-auto space-y-4 pt-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
              <p className="font-medium mb-1">
                👋 Managing <span className="font-bold">{currentAccount.label}</span>
                <span className="text-blue-600 font-normal ml-1">({currentAccount.sub})</span>
              </p>
              <p className="text-blue-700 leading-relaxed">
                Ask me to analyse campaigns, cross-reference GA4 revenue, find wasted spend, or make changes.
                I use GA4 as the source of truth for revenue — not Google Ads conversions.
              </p>
            </div>

            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Quick actions</p>
              <div className="space-y-2">
                {SUGGESTIONS[account].map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="w-full text-left text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-4 py-2.5 transition-colors flex items-start gap-2"
                  >
                    <span className="flex-shrink-0 mt-0.5 text-blue-400">→</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Conversation */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {/* Avatar for assistant */}
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-7 h-7 bg-blue-700 rounded-full flex items-center justify-center mr-2 mt-1">
                <span className="text-white text-xs font-bold">C</span>
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-50 border border-gray-200 text-gray-800 rounded-bl-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <MarkdownContent text={msg.content} />
              ) : (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              )}
              <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                {msg.timestamp.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="flex-shrink-0 w-7 h-7 bg-blue-700 rounded-full flex items-center justify-center mr-2">
              <span className="text-white text-xs font-bold">C</span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center h-5">
                {[0, 1, 2].map(j => (
                  <div
                    key={j}
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${j * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ──────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-200 bg-white px-6 py-4 flex-shrink-0">
        {messages.length > 0 && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => { setMessages([]); setError(''); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear conversation
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${currentAccount.label} campaigns… (Enter to send, Shift+Enter for new line)`}
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 h-10 w-10 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 rounded-xl flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-white disabled:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          🔍 Read-only: get_campaigns, shopping, search terms, GA4 revenue &nbsp;·&nbsp;
          ✏️ Write: pause/enable campaigns, update budgets, add negative keywords
        </p>
      </div>
    </div>
  );
}
