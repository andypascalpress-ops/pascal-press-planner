'use client';

/**
 * AdsManagerTab — embedded Google Ads management interface.
 * Persistent left sidebar for conversation history (like Claude's own UI).
 */

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '@/lib/types';

// ─── Account config ────────────────────────────────────────────────────────────

type Account = 'pp' | 'etz' | 'hsc';

const ACCOUNTS: { id: Account; label: string; sub: string; color: string; dot: string }[] = [
  { id: 'pp',  label: 'Pascal Press',    sub: '246-104-2966', color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  { id: 'etz', label: 'Excel Test Zone', sub: '893-408-4207', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  { id: 'hsc', label: 'HSC Copilot',     sub: '140-426-6935', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
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
  if (diff < 60_000)         return 'Just now';
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2 * 86_400_000) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// Group conversations: Today / Yesterday / Earlier
function groupConversations(convs: SavedConversation[]) {
  const now   = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);

  const groups: { label: string; items: SavedConversation[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier',   items: [] },
  ];
  for (const c of convs) {
    const d = new Date(c.updatedAt); d.setHours(0, 0, 0, 0);
    if (d >= today)          groups[0].items.push(c);
    else if (d >= yest)      groups[1].items.push(c);
    else                     groups[2].items.push(c);
  }
  return groups.filter(g => g.items.length > 0);
}

// ─── Quick-action prompts ──────────────────────────────────────────────────────

const SUGGESTIONS: Record<Account, string[]> = {
  pp: [
    'Show all active campaigns with spend and GA4 ROAS this month',
    'Pull the top 20 search terms — flag wasteful ones and add as negatives',
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

// ─── Markdown renderer ─────────────────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="bg-blue-50 border border-blue-100 px-1 py-0.5 rounded text-xs font-mono text-blue-800">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function parseTableRow(line: string) { return line.split('|').slice(1, -1).map(c => c.trim()); }
function isSepRow(line: string) { const c = line.split('|').slice(1,-1).map(s=>s.trim()); return c.length>0&&c.every(s=>/^:?-+:?$/.test(s)); }

function TableBlock({ lines }: { lines: string[] }) {
  const rows = lines.filter(l => !isSepRow(l));
  if (!rows.length) return null;
  const [hdr, ...data] = rows;
  const headers = parseTableRow(hdr);
  return (
    <div className="overflow-x-auto my-2 rounded-lg border border-gray-200 shadow-sm">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b border-gray-200">
            {headers.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap"><InlineText text={h} /></th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri} className={`border-b border-gray-100 last:border-0 ${ri%2===0?'bg-white':'bg-gray-50'}`}>
              {headers.map((_, ci) => <td key={ci} className="px-3 py-2 text-gray-700 align-top"><InlineText text={parseTableRow(row)[ci]??''} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  const bullets: string[] = [];
  let i = 0;

  const flush = (k: string) => {
    if (!bullets.length) return;
    result.push(<ul key={`ul-${k}`} className="list-disc ml-5 space-y-0.5 my-1">{bullets.map((b,j)=><li key={j} className="leading-snug"><InlineText text={b}/></li>)}</ul>);
    bullets.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i], k = String(i);
    if (line.trim().startsWith('|')) {
      flush(k);
      const tbl: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tbl.push(lines[i]); i++; }
      result.push(<TableBlock key={`tbl-${k}`} lines={tbl} />);
      continue;
    }
    if (/^### /.test(line))      { flush(k); result.push(<h3 key={k} className="font-semibold text-gray-800 mt-3 mb-1 text-sm"><InlineText text={line.slice(4)}/></h3>); }
    else if (/^## /.test(line))  { flush(k); result.push(<h2 key={k} className="font-bold text-gray-900 mt-4 mb-1"><InlineText text={line.slice(3)}/></h2>); }
    else if (/^# /.test(line))   { flush(k); result.push(<h1 key={k} className="font-bold text-gray-900 mt-4 mb-1 text-base"><InlineText text={line.slice(2)}/></h1>); }
    else if (/^[-•] /.test(line))       { bullets.push(line.slice(2)); }
    else if (/^\d+\. /.test(line))      { bullets.push(line.replace(/^\d+\. /,'')); }
    else if (line.trim()==='---')        { flush(k); result.push(<hr key={k} className="border-gray-200 my-2"/>); }
    else if (line.trim()==='')           { flush(k); if (result.length>0) result.push(<div key={k} className="h-1"/>); }
    else                                 { flush(k); result.push(<p key={k} className="leading-relaxed"><InlineText text={line}/></p>); }
    i++;
  }
  flush('end');
  return <div className="text-sm space-y-0.5">{result}</div>;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AdsManagerTab() {
  const [account,     setAccount]     = useState<Account>('pp');
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [savedConvs,  setSavedConvs]  = useState<SavedConversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true); // visible by default

  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLTextAreaElement>(null);
  const currentConvId = useRef<string | null>(null);

  // Load history on mount
  useEffect(() => {
    setSavedConvs(loadFromStorage());
  }, []);

  // Reset when switching account
  useEffect(() => {
    setMessages([]);
    setError('');
    setInput('');
    currentConvId.current = null;
  }, [account]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Persist ──────────────────────────────────────────────────────────────────

  const persistConversation = (msgs: ChatMessage[]) => {
    if (!msgs.length) return;
    const title = (msgs.find(m => m.role === 'user')?.content ?? 'Conversation')
      .slice(0, 60).trimEnd() + (msgs[0]?.content?.length > 60 ? '…' : '');
    const serialised = msgs.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp.toISOString() }));
    const all = loadFromStorage();

    if (currentConvId.current) {
      const idx = all.findIndex(c => c.id === currentConvId.current);
      if (idx !== -1) {
        all[idx].messages  = serialised;
        all[idx].updatedAt = Date.now();
        writeToStorage(all);
        setSavedConvs([...all]);
        return;
      }
    }

    const newConv: SavedConversation = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      account,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages:  serialised,
    };
    const updated = [newConv, ...all];
    writeToStorage(updated);
    setSavedConvs(updated);
    currentConvId.current = newConv.id;
  };

  // ── Load / delete ─────────────────────────────────────────────────────────────

  const loadConversation = (conv: SavedConversation) => {
    setMessages(conv.messages.map(m => ({
      role:      m.role as 'user' | 'assistant',
      content:   m.content,
      timestamp: new Date(m.timestamp),
    })));
    setAccount(conv.account);
    setError('');
    setInput('');
    currentConvId.current = conv.id;
  };

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

  const newConversation = () => {
    setMessages([]);
    setError('');
    setInput('');
    currentConvId.current = null;
  };

  // ── Send ──────────────────────────────────────────────────────────────────────

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setError('');
    const userMsg: ChatMessage = { role: 'user', content: text.trim(), timestamp: new Date() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);
    try {
      const res  = await fetch('/api/ads-chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ account, messages: history.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to get response');
      const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply, timestamp: new Date() };
      const next = [...history, assistantMsg];
      setMessages(next);
      persistConversation(next);
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
  const groups         = groupConversations(savedConvs);

  // ─── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-white overflow-hidden">

      {/* ── History sidebar ────────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 flex flex-col border-r border-gray-200 bg-gray-50 transition-all duration-200 ${sidebarOpen ? 'w-60' : 'w-0 overflow-hidden'}`}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 pt-4 pb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">History</span>
          <button
            onClick={newConversation}
            title="New conversation"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            New
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {savedConvs.length === 0 ? (
            <div className="px-2 py-6 text-center">
              <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
              </svg>
              <p className="text-xs text-gray-400 leading-relaxed">
                Your conversations will appear here after your first message.
              </p>
            </div>
          ) : (
            groups.map(group => (
              <div key={group.label} className="mb-3">
                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider px-2 mb-1">{group.label}</p>
                {group.items.map(conv => {
                  const acc      = ACCOUNTS.find(a => a.id === conv.account);
                  const isActive = conv.id === currentConvId.current;
                  return (
                    <button
                      key={conv.id}
                      onClick={() => loadConversation(conv)}
                      className={`w-full text-left rounded-lg px-2 py-2 mb-0.5 group transition-colors ${
                        isActive ? 'bg-blue-50 border border-blue-100' : 'hover:bg-white hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${acc?.dot ?? 'bg-gray-400'}`} />
                        <span className="text-[10px] text-gray-400 truncate">{relativeTime(conv.updatedAt)}</span>
                        <button
                          onClick={e => deleteConversation(conv.id, e)}
                          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 flex-shrink-0"
                          title="Delete"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                      <p className="text-xs text-gray-700 leading-snug line-clamp-2">{conv.title}</p>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Main chat area ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              title={sidebarOpen ? 'Hide history' : 'Show history'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>

            {/* Logo + title */}
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 40 40" fill="none">
              <path d="M27.5 7.5L12.5 32.5" stroke="#FBBC04" strokeWidth="6" strokeLinecap="round"/>
              <path d="M12.5 32.5H32.5" stroke="#34A853" strokeWidth="6" strokeLinecap="round"/>
              <path d="M7.5 32.5C7.5 30.0147 9.51472 28 12 28C14.4853 28 16.5 30.0147 16.5 32.5C16.5 34.9853 14.4853 37 12 37C9.51472 37 7.5 34.9853 7.5 32.5Z" fill="#EA4335"/>
            </svg>
            <div className="mr-auto">
              <h1 className="text-sm font-semibold text-gray-900 leading-none">Google Ads Manager</h1>
              <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">Analyse &amp; manage campaigns with Claude</p>
            </div>

            {/* Account selector */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-shrink-0">
              {ACCOUNTS.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => setAccount(acc.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    account === acc.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="max-w-2xl mx-auto space-y-4 pt-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-medium mb-1">
                  👋 Managing <span className="font-bold">{currentAccount.label}</span>
                  <span className="text-blue-600 font-normal ml-1">({currentAccount.sub})</span>
                </p>
                <p className="text-blue-700 leading-relaxed">
                  Ask me to analyse campaigns, check GA4 revenue, audit keywords, view or edit ads, manage assets, or make changes.
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

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-7 h-7 bg-blue-700 rounded-full flex items-center justify-center mr-2 mt-1">
                  <span className="text-white text-xs font-bold">C</span>
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-50 border border-gray-200 text-gray-800 rounded-bl-sm'
              }`}>
                {msg.role === 'assistant'
                  ? <MarkdownContent text={msg.content} />
                  : <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>}
                <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                  {msg.timestamp.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex-shrink-0 w-7 h-7 bg-blue-700 rounded-full flex items-center justify-center mr-2">
                <span className="text-white text-xs font-bold">C</span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1.5 items-center h-5">
                  {[0,1,2].map(j => (
                    <div key={j} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${j*0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              ⚠️ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white px-5 py-3 flex-shrink-0">
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7"/>
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            🔍 campaigns, keywords (QS), ads (RSA), search terms, assets, devices, GA4 &nbsp;·&nbsp;
            ✏️ create, pause, edit ads, update bids, manage keywords &amp; assets
          </p>
        </div>
      </div>
    </div>
  );
}
