'use client';

/**
 * AdsManagerTab — embedded Google Ads management interface.
 * Team members can chat with Claude to analyse campaigns and make changes
 * across the Pascal Press, Excel Test Zone, and HSC Copilot ad accounts.
 *
 * Conversation history is persisted in localStorage (up to 50 conversations).
 */

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '@/lib/types';

// ─── Account config ────────────────────────────────────────────────────────────

type Account = 'pp' | 'etz' | 'hsc';

const ACCOUNTS: { id: Account; label: string; sub: string; color: string }[] = [
  { id: 'pp',  label: 'Pascal Press',    sub: '246-104-2966', color: 'bg-blue-100 text-blue-700' },
  { id: 'etz', label: 'Excel Test Zone', sub: '893-408-4207', color: 'bg-green-100 text-green-700' },
  { id: 'hsc', label: 'HSC Copilot',     sub: '140-426-6935', color: 'bg-purple-100 text-purple-700' },
];

// ─── Conversation history (localStorage) ──────────────────────────────────────

interface SavedConversation {
  id: string;
  account: Account;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{ role: string; content: string; timestamp: string }>;
}

const LS_KEY    = 'pp_ads_conversations';
const MAX_SAVED = 50;

function loadFromStorage(): SavedConversation[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'); }
  catch { return []; }
}

function writeToStorage(convs: SavedConversation[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(convs.slice(0, MAX_SAVED)));
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)           return 'Just now';
  if (diff < 3_600_000)        return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)       return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2 * 86_400_000)   return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ─── Quick-action prompts ──────────────────────────────────────────────────────

const SUGGESTIONS: Record<Account, string[]> = {
  pp: [
    'Show all active campaigns with spend and GA4 ROAS this month',
    'Pull the top 20 search terms — flag any wasteful ones and recommend negatives',
    'Show keywords with Quality Score below 5',
    'Compare this week vs last week — any anomalies?',
    'Recommend new campaigns to improve ROAS',
  ],
  etz: [
    'Show all active campaigns with spend and GA4 revenue this month',
    'Pull search terms and flag irrelevant queries',
    'Show keyword-level performance — any low QS or wasted spend?',
    'Compare this week vs last week across all campaigns',
  ],
  hsc: [
    'Show all active campaigns with spend and ROAS this month',
    'Find keywords with high spend but zero conversions',
    'What search terms triggered ads this month?',
    'Compare this month vs last month — how are we tracking?',
  ],
};

// ─── Markdown renderer (supports tables, headers, bullets, bold, code) ──────────

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-blue-50 border border-blue-100 px-1 py-0.5 rounded text-xs font-mono text-blue-800">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function parseTableRow(line: string): string[] {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

function isSeparatorRow(line: string): boolean {
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

function TableBlock({ lines }: { lines: string[] }) {
  const nonSeparator = lines.filter(l => !isSeparatorRow(l));
  if (nonSeparator.length === 0) return null;
  const [headerLine, ...dataLines] = nonSeparator;
  const headers = parseTableRow(headerLine);
  const rows    = dataLines.map(parseTableRow);
  return (
    <div className="overflow-x-auto my-2 rounded-lg border border-gray-200 shadow-sm">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b border-gray-200">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                <InlineText text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={`border-b border-gray-100 last:border-0 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
              {headers.map((_, ci) => (
                <td key={ci} className="px-3 py-2 text-gray-700 align-top">
                  <InlineText text={row[ci] ?? ''} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  const lines  = text.split('\n');
  const result: React.ReactNode[] = [];
  const bullets: string[] = [];
  let   i = 0;

  const flushBullets = (key: string) => {
    if (!bullets.length) return;
    result.push(
      <ul key={`ul-${key}`} className="list-disc ml-5 space-y-0.5 my-1">
        {bullets.map((b, j) => (
          <li key={j} className="leading-snug"><InlineText text={b} /></li>
        ))}
      </ul>,
    );
    bullets.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const k    = String(i);

    if (line.trim().startsWith('|')) {
      flushBullets(k);
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tableLines.push(lines[i]); i++; }
      result.push(<TableBlock key={`tbl-${k}`} lines={tableLines} />);
      continue;
    }

    if (/^### /.test(line)) {
      flushBullets(k);
      result.push(<h3 key={k} className="font-semibold text-gray-800 mt-3 mb-1 text-sm"><InlineText text={line.slice(4)} /></h3>);
    } else if (/^## /.test(line)) {
      flushBullets(k);
      result.push(<h2 key={k} className="font-bold text-gray-900 mt-4 mb-1"><InlineText text={line.slice(3)} /></h2>);
    } else if (/^# /.test(line)) {
      flushBullets(k);
      result.push(<h1 key={k} className="font-bold text-gray-900 mt-4 mb-1 text-base"><InlineText text={line.slice(2)} /></h1>);
    } else if (/^[-•] /.test(line)) {
      bullets.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      bullets.push(line.replace(/^\d+\. /, ''));
    } else if (line.trim() === '---') {
      flushBullets(k);
      result.push(<hr key={k} className="border-gray-200 my-2" />);
    } else if (line.trim() === '') {
      flushBullets(k);
      if (result.length > 0) result.push(<div key={k} className="h-1" />);
    } else {
      flushBullets(k);
      result.push(<p key={k} className="leading-relaxed"><InlineText text={line} /></p>);
    }

    i++;
  }

  flushBullets('end');
  return <div className="text-sm space-y-0.5">{result}</div>;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AdsManagerTab() {
  const [account,      setAccount]      = useState<Account>('pp');
  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [showHistory,  setShowHistory]  = useState(false);
  const [savedConvs,   setSavedConvs]   = useState<SavedConversation[]>([]);

  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const currentConvId  = useRef<string | null>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    setSavedConvs(loadFromStorage());
  }, []);

  // Reset conversation when switching accounts
  useEffect(() => {
    setMessages([]);
    setError('');
    setInput('');
    currentConvId.current = null;
  }, [account]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Persist conversation ─────────────────────────────────────────────────────

  const persistConversation = (msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    const firstUser = msgs.find(m => m.role === 'user')?.content ?? 'Conversation';
    const title     = firstUser.length > 60 ? firstUser.slice(0, 57) + '…' : firstUser;

    const all = loadFromStorage();

    if (currentConvId.current) {
      const idx = all.findIndex(c => c.id === currentConvId.current);
      if (idx !== -1) {
        all[idx].messages  = msgs.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp.toISOString() }));
        all[idx].updatedAt = Date.now();
        writeToStorage(all);
        setSavedConvs([...all]);
        return;
      }
    }

    // New conversation
    const newConv: SavedConversation = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      account,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages:  msgs.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp.toISOString() })),
    };
    const updated = [newConv, ...all];
    writeToStorage(updated);
    setSavedConvs(updated);
    currentConvId.current = newConv.id;
  };

  // ── Load a saved conversation ────────────────────────────────────────────────

  const loadConversation = (conv: SavedConversation) => {
    const msgs: ChatMessage[] = conv.messages.map(m => ({
      role:      m.role as 'user' | 'assistant',
      content:   m.content,
      timestamp: new Date(m.timestamp),
    }));
    setAccount(conv.account);
    setMessages(msgs);
    setError('');
    setInput('');
    currentConvId.current = conv.id;
    setShowHistory(false);
  };

  // ── Delete a saved conversation ──────────────────────────────────────────────

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = loadFromStorage().filter(c => c.id !== id);
    writeToStorage(updated);
    setSavedConvs(updated);
    if (currentConvId.current === id) {
      setMessages([]);
      setError('');
      currentConvId.current = null;
    }
  };

  // ── Start a new conversation ─────────────────────────────────────────────────

  const newConversation = () => {
    setMessages([]);
    setError('');
    setInput('');
    currentConvId.current = null;
    setShowHistory(false);
  };

  // ── Send message ─────────────────────────────────────────────────────────────

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

      const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply, timestamp: new Date() };
      const newMsgs = [...history, assistantMsg];
      setMessages(newMsgs);
      persistConversation(newMsgs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const currentAccount = ACCOUNTS.find(a => a.id === account)!;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full bg-white overflow-hidden">

      {/* ── History overlay backdrop ─────────────────────────────────────────── */}
      {showHistory && (
        <div
          className="absolute inset-0 z-10 bg-black/20"
          onClick={() => setShowHistory(false)}
        />
      )}

      {/* ── History sidebar ──────────────────────────────────────────────────── */}
      {showHistory && (
        <div className="absolute inset-y-0 left-0 w-72 z-20 bg-white border-r border-gray-200 shadow-xl flex flex-col">
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-gray-800 text-sm">Conversations</span>
            <button
              onClick={() => setShowHistory(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* New conversation button */}
          <div className="px-3 pt-3 pb-2">
            <button
              onClick={newConversation}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New conversation
            </button>
          </div>

          {/* Conversations list */}
          <div className="flex-1 overflow-y-auto">
            {savedConvs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center mt-8 px-4">
                No saved conversations yet.<br />Start chatting to save automatically.
              </p>
            ) : (
              <div className="px-2 pb-3 space-y-0.5">
                {savedConvs.map(conv => {
                  const acc    = ACCOUNTS.find(a => a.id === conv.account);
                  const isActive = conv.id === currentConvId.current;
                  return (
                    <button
                      key={conv.id}
                      onClick={() => loadConversation(conv)}
                      className={`w-full text-left rounded-lg px-3 py-2.5 group transition-colors relative ${
                        isActive
                          ? 'bg-blue-50 border border-blue-100'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Account badge + time */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${acc?.color ?? 'bg-gray-100 text-gray-600'}`}>
                          {acc?.label.split(' ')[0] ?? conv.account.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-gray-400 ml-auto">{relativeTime(conv.updatedAt)}</span>
                      </div>
                      {/* Title */}
                      <p className="text-xs text-gray-700 leading-snug line-clamp-2 pr-5">{conv.title}</p>
                      {/* Delete button */}
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 p-0.5"
                        title="Delete conversation"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Title + history button */}
          <div className="flex items-center gap-2 mr-auto">
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M27.5 7.5L12.5 32.5" stroke="#FBBC04" strokeWidth="6" strokeLinecap="round"/>
              <path d="M12.5 32.5H32.5" stroke="#34A853" strokeWidth="6" strokeLinecap="round"/>
              <path d="M7.5 32.5C7.5 30.0147 9.51472 28 12 28C14.4853 28 16.5 30.0147 16.5 32.5C16.5 34.9853 14.4853 37 12 37C9.51472 37 7.5 34.9853 7.5 32.5Z" fill="#EA4335"/>
            </svg>
            <div>
              <h1 className="text-sm font-semibold text-gray-900 leading-none">Google Ads Manager</h1>
              <p className="text-xs text-gray-500 mt-0.5">Analyse &amp; manage campaigns with Claude</p>
            </div>
            {/* History toggle */}
            <button
              onClick={() => setShowHistory(v => !v)}
              title="Conversation history"
              className={`ml-2 p-1.5 rounded-lg transition-colors ${
                showHistory ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {savedConvs.length > 0 && (
                <span className="sr-only">{savedConvs.length} saved</span>
              )}
            </button>
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
                Ask me to analyse campaigns, cross-reference GA4 revenue, find wasted spend, review keywords, or make changes.
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
          <div className="flex justify-between mb-2">
            <button
              onClick={() => setShowHistory(true)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {savedConvs.length > 0 ? `${savedConvs.length} saved` : 'History'}
            </button>
            <button
              onClick={newConversation}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              New conversation
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
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          🔍 Read: campaigns (IS%), keywords (QS), search terms, shopping, GA4, ad groups &nbsp;·&nbsp;
          ✏️ Write: pause/enable campaigns &amp; ad groups, budgets, keyword bids, bulk negatives, create campaigns &amp; assets
        </p>
      </div>
    </div>
  );
}
