'use client';

/**
 * SystemsTab — top-level standalone wrapper for the Systems Check view.
 * Fetches current-month revenue/spend context then delegates to SystemsCheckView
 * inside FinanceDashboard (re-exported here to avoid prop-threading through page.tsx).
 */

import { useState, useEffect } from 'react';
import FinanceDashboard from './FinanceDashboard';

/**
 * We render FinanceDashboard in a hidden state with financeView='systems'
 * pre-set via a thin shim. Rather than duplicating the whole SystemsCheckView,
 * we export a wrapper that mounts FinanceDashboard with forced systems view.
 *
 * Actually — simpler: just render the FinanceDashboard component which has
 * all the context it needs. The user clicks Systems in the top nav and the
 * Finance component mounts with its sub-view forced to 'systems'.
 */

export default function SystemsTab() {
  // Minimal spend records so FinanceDashboard doesn't complain — it fetches
  // live data itself. The systems sub-view doesn't use spend records at all.
  return (
    <FinanceDashboard
      records={[]}
      syncing={false}
      lastSynced={undefined}
      onSyncGoogleAds={async () => {}}
      initialView="systems"
    />
  );
}
