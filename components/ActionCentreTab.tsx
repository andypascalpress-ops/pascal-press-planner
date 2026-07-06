'use client';

import { useState, useEffect, useCallback } from 'react';

interface Insight {
  id:         string;
  severity:   'critical' | 'warning' | 'opportunity' | 'info';
  category:   'google-ads' | 'email' | 'bigcommerce' | 'band6' | 'seasonal' | 'budget';
  title:      string;
  body:       string;
  metric:     string;
  chatPrompt: string;
  action?:    string;
}

interface Props {
  onNavigate:    (tab: string) => void;
  onOpenChat:    (prompt: string) => void;
  onAddSpend:    (brand?: string) => void;
  onAddCampaign: () => void;
}

type Status = 'idle' | 'fetching' | 'analysing' | 'ready' | 'error';

const CAT_LABELS: Record<string, string> = {
  'google-ads': 'Google Ads',
  'email':      'Email',
  'bigcommerce':'BigCommerce',
  'band6':      'Band 6',
  'seasonal':   'Seasonal',
  'budget':     'Budget',
};

const SEV: Record<string, { leftBorder: string; badge: string; dot: string; icon: string }> = {
  critical:    { leftBorder: 'border-l-red-500',   badge: 'bg-red-50 text-red-700 border-red-200',     dot: 'bg-red-500',   icon: '🔴' },
  warning:     { leftBorder: 'border-l-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200',dot: 'bg-amber-400', icon: '🟡' },
  opportunity: { leftBorder: 'border-l-blue-500',   badge: 'bg-blue-50 text-blue-700 border-blue-200',  dot: 'bg-blue-500',  icon: '💡' },
  info:        { leftBorder: 'border-l-gray-300',   badge: 'bg-gray-50 text-gray-600 border-gray-200',  dot: 'bg-gray-400',  icon: 'ℹ️' },
};

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short',
    timeZone: 'Australia/Sydney',
  });
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="bg-white rounded-xl border border-l-4 border-gray-200 border-l-gray-200 p-4 space-y-3 animate-pulse"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <div className="h-5 w-16 bg-gray-200 rounded-full" />
          <div className="h-5 w-20 bg-gray-200 rounded-full" />
        </div>
        <div className="h-4 w-4 bg-gray-200 rounded" />
      </div>
      <div className="h-4 w-3/4 bg-gray-200 rounded" />
      <div className="space-y-1.5">
        <div className="h-3 w-full bg-gray-100 rounded" />
        <div className="h-3 w-5/6 bg-gray-100 rounded" />
        <div className="h-3 w-2/3 bg-gray-100 rounded" />
      </div>
      <div className="flex gap-2 pt-1">
        <div className="h-7 w-28 bg-gray-200 rounded-lg" />
        <div className="h-7 w-24 bg-gray-100 rounded-lg" />
      </div>
    </div>
  );
}

// ─── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({ insight, rank, onDismiss, onOpenChat }: {
  insight:     Insight;
  rank:        number;
  onDismiss:   (id: string) => void;
  onOpenChat:  (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const s   = SEV[insight.severity] ?? SEV.info;
  const cat = CAT_LABELS[insight.category] ?? insight.category;

  return (
    <div className={`bg-white rounded-xl border border-l-4 ${s.leftBorder} border-gray-200 p-4`}>

      {/* Top row */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-gray-400 font-mono text-xs font-medium mt-0.5 shrink-0">#{rank}</span>
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>
            {insight.severity.charAt(0).toUpperCase() + insight.severity.slice(1)}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full font-medium">
            {cat}
          </span>
        </div>
        <button
          onClick={() => onDismiss(insight.id)}
          className="text-gray-300 hover:text-gray-500 text-xl leading-none shrink-0 -mt-0.5"
          title="Dismiss"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Title */}
      <h4 className="text-sm font-semibold text-gray-800 mb-2 leading-snug">{insight.title}</h4>

      {/* Metric badge */}
      {insight.metric && (
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1 mb-2">
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
          {insight.metric}
        </div>
      )}

      {/* Body */}
      <p className={`text-sm text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
        {insight.body}
      </p>
      {insight.body.length > 180 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-blue-500 hover:text-blue-700 mt-1"
        >
          {expanded ? 'Show less ↑' : 'Read more ↓'}
        </button>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          onClick={() => onOpenChat(insight.chatPrompt)}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h2v3l3-3h7a1 1 0 001-1V3a1 1 0 00-1-1z"/>
          </svg>
          Ask Claude
        </button>
        {insight.action && (
          <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-1.5 rounded-lg">
            {insight.action}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHead({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">{label}</h3>
      <span className="text-xs text-gray-400 font-medium">({count})</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActionCentreTab({ onNavigate, onOpenChat, onAddSpend, onAddCampaign }: Props) {

  const [status,      setStatus]      = useState<Status>('idle');
  const [insights,    setInsights]    = useState<Insight[]>([]);
  const [dismissed,   setDismissed]   = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ac-dismissed-v2') : null;
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg,    setErrorMsg]    = useState('');

  // ── Dismiss ──────────────────────────────────────────────────────────────────

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem('ac-dismissed-v2', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const restoreDismissed = useCallback(() => {
    setDismissed(new Set());
    try { localStorage.removeItem('ac-dismissed-v2'); } catch {}
  }, []);

  // ── Refresh ──────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setStatus('fetching');
    setInsights([]);
    setErrorMsg('');

    try {
      const month = currentMonthStr();

      const [spendRes, campaignsRes, emailRes, band6Res, bcRes] = await Promise.all([
        fetch('/api/spend').then(r => r.json()).catch(() => ({})),
        fetch('/api/google-ads-campaigns').then(r => r.json()).catch(() => ({})),
        fetch(`/api/hubspot-email?month=${month}`).then(r => r.json()).catch(() => ({})),
        fetch('/api/band6-tracker').then(r => r.json()).catch(() => ({})),
        fetch('/api/bc-performance').then(r => r.json()).catch(() => ({})),
      ]);

      setStatus('analysing');

      const insightRes = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: {
            campaigns: campaignsRes,
            email:     emailRes,
            band6:     band6Res,
            spend:     spendRes,
            bc:        bcRes,
          },
        }),
      });

      if (!insightRes.ok) throw new Error(`Insights API ${insightRes.status}`);

      // Route streams plain text (Claude tokens) — collect then parse JSON
      const rawText = await insightRes.text();
      const cleaned = rawText.replace(/^```json?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
      const raw = JSON.parse(cleaned);

      setInsights(Array.isArray(raw) ? raw : []);
      setStatus('ready');
      setLastUpdated(new Date());
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ─────────────────────────────────────────────────────────────

  const visible      = insights.filter(i => !dismissed.has(i.id));
  const critical     = visible.filter(i => i.severity === 'critical' || i.severity === 'warning');
  const opps         = visible.filter(i => i.severity === 'opportunity');
  const infoItems    = visible.filter(i => i.severity === 'info');
  const isLoading    = status === 'fetching' || status === 'analysing';
  const dismissedCnt = [...dismissed].filter(id => insights.some(i => i.id === id)).length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sm:px-6 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-orange-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
              </svg>
              Marketing Intelligence
            </h2>
            {status === 'ready' && lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {fmtDate(lastUpdated)} · {fmtTime(lastUpdated)}
                {visible.length > 0 && <span className="ml-1.5 text-gray-500">{visible.length} item{visible.length !== 1 ? 's' : ''}</span>}
              </p>
            )}
            {isLoading && (
              <p className="text-xs text-blue-500 mt-0.5 animate-pulse">
                {status === 'fetching' ? 'Loading campaign data…' : 'Claude is analysing…'}
              </p>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M14 8a6 6 0 01-6 6 6 6 0 01-6-6 6 6 0 016-6" strokeLinecap="round"/>
              <path d="M14 4V8h-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-6">

        {/* Error */}
        {status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-red-700 mb-1">Analysis failed</p>
            <p className="text-xs text-red-500 break-all">{errorMsg}</p>
            <button
              onClick={refresh}
              className="mt-3 text-xs font-medium text-red-600 hover:text-red-800 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {status === 'fetching' ? 'Fetching campaigns, emails & store data' : 'Claude is analysing your marketing data'}
              </span>
            </div>
            {[0, 1, 2, 3].map(i => <SkeletonCard key={i} index={i} />)}
          </div>
        )}

        {/* Empty state */}
        {status === 'ready' && visible.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-gray-700 mb-1">All clear</p>
            <p className="text-sm text-gray-500 mb-4">No action items found. Refresh to re-analyse.</p>
            <button
              onClick={refresh}
              className="text-xs text-blue-600 hover:text-blue-700 underline"
            >
              Refresh now
            </button>
          </div>
        )}

        {/* ── Priority Actions ── */}
        {status === 'ready' && critical.length > 0 && (
          <section>
            <SectionHead
              count={critical.length}
              label="Priority Actions"
              icon={
                <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
              }
            />
            <div className="space-y-3">
              {critical.map((ins, i) => (
                <InsightCard
                  key={ins.id} rank={i + 1} insight={ins}
                  onDismiss={dismiss} onOpenChat={onOpenChat}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Opportunities ── */}
        {status === 'ready' && opps.length > 0 && (
          <section>
            <SectionHead
              count={opps.length}
              label="Opportunities"
              icon={
                <svg className="w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.298.082-.58.195-.844a3 3 0 10-4.39 0c.113.263.18.546.195.844h4z"/>
                </svg>
              }
            />
            <div className="space-y-3">
              {opps.map((ins, i) => (
                <InsightCard
                  key={ins.id} rank={i + 1} insight={ins}
                  onDismiss={dismiss} onOpenChat={onOpenChat}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Performance Notes ── */}
        {status === 'ready' && infoItems.length > 0 && (
          <section>
            <SectionHead
              count={infoItems.length}
              label="Performance Notes"
              icon={
                <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
                </svg>
              }
            />
            <div className="space-y-3">
              {infoItems.map((ins, i) => (
                <InsightCard
                  key={ins.id} rank={i + 1} insight={ins}
                  onDismiss={dismiss} onOpenChat={onOpenChat}
                />
              ))}
            </div>
          </section>
        )}

        {/* Restore dismissed */}
        {dismissedCnt > 0 && status === 'ready' && (
          <div className="text-center py-2">
            <button
              onClick={restoreDismissed}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Restore {dismissedCnt} dismissed item{dismissedCnt !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* ── Quick Actions ── */}
        {status === 'ready' && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onOpenChat('Give me a detailed Google Ads performance breakdown for Pascal Press and Excel Test Zone this month. List each campaign by name with ROAS, CTR, and cost. Tell me which campaigns to pause, scale, or restructure, and why.')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 rounded-lg p-2.5 transition-colors"
              >
                <div className="font-semibold text-gray-700 mb-0.5">🎯 Google Ads Breakdown</div>
                <div className="text-gray-500">Campaign-by-campaign ROAS</div>
              </button>
              <button
                onClick={() => onOpenChat('Analyse our HubSpot email campaigns from this month. Which subject lines worked best? Which audience segments have the highest open rate? Give me 3 concrete changes I should make to improve open rates and click-through rates.')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 rounded-lg p-2.5 transition-colors"
              >
                <div className="font-semibold text-gray-700 mb-0.5">📧 Email Deep Dive</div>
                <div className="text-gray-500">Subject lines + segments</div>
              </button>
              <button
                onClick={() => onOpenChat('Based on our BigCommerce sales data and current Term 3 period, which products should we be prioritising in Google Ads? Are there any product bundles, promotions, or ad campaigns I should create? Which products are underperforming and why?')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 rounded-lg p-2.5 transition-colors"
              >
                <div className="font-semibold text-gray-700 mb-0.5">🛒 Product Intelligence</div>
                <div className="text-gray-500">What to push in ads</div>
              </button>
              <button
                onClick={() => onNavigate('calendar')}
                className="text-left text-xs bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 rounded-lg p-2.5 transition-colors"
              >
                <div className="font-semibold text-gray-700 mb-0.5">📅 Campaign Calendar</div>
                <div className="text-gray-500">View & plan campaigns</div>
              </button>
            </div>
          </section>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
