// Shared pull-to-refresh registry for dashboard panels.
// Each panel registers a per-tab refresh callback; the ContentPager
// (in dashboard.tsx) owns the RefreshControl and dispatches to the
// callback matching the active tab id.

import React from 'react';

type Fn = () => Promise<void> | void;

export const PanelRefreshContext = React.createContext<{
  register: (tabId: string, fn: Fn) => void;
  unregister: (tabId: string) => void;
}>({ register: () => {}, unregister: () => {} });

export function usePanelRefresh(tabId: string, fn: Fn) {
  const { register, unregister } = React.useContext(PanelRefreshContext);
  // Keep the latest callback in a ref so registering once doesn't capture stale state
  const fnRef = React.useRef(fn);
  React.useEffect(() => { fnRef.current = fn; }, [fn]);
  React.useEffect(() => {
    register(tabId, () => fnRef.current());
    return () => unregister(tabId);
  }, [tabId, register, unregister]);
}
