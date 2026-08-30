/**
 * ContentPager — horizontally-swipable tab pager with:
 *   • lazy panel mounting (active + immediate neighbours only)
 *   • windowed mounting — far-away panels are unmounted to bound peak
 *     memory (prevents native OOM crashes on constrained Android)
 *   • per-tab pull-to-refresh via PanelRefreshContext
 *   • desktop-aware inner padding (wider + capped max-width on web)
 *
 * Extracted from app/dashboard.tsx (previously ~170 lines inline)
 * so the monolithic dashboard file can shed dead weight. Purely
 * presentational, no coupling to dashboard business logic — any
 * future section of the app can reuse this pager.
 */
import React from 'react';
import {
  View,
  ScrollView,
  Animated as RNAnimated,
  RefreshControl,
  Platform,
  Dimensions,
} from 'react-native';
import { COLORS } from '../theme';
import { useResponsive } from '../responsive';
import { PanelRefreshContext } from '../panel-refresh';

export type TabItem = { id: string; label: string; icon: any; badge?: number };

export default function ContentPager({
  tabs,
  activeId,
  onChange,
  renderPanel,
  onVerticalScroll,
}: {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  renderPanel: (id: string) => React.ReactNode;
  onVerticalScroll?: (e: any) => void;
}) {
  const pagerRef = React.useRef<ScrollView | null>(null);
  const [width, setWidth] = React.useState(Dimensions.get('window').width);
  const activeIndex = Math.max(0, tabs.findIndex((x) => x.id === activeId));

  // Lazy panel mounting — keeps initial dashboard mount cheap by only
  // rendering the panel for the active tab + its immediate neighbours
  // (so the swipe gesture still feels native). Once a tab has been
  // visited the panel STAYS mounted so its in-tab state, scroll
  // position and any cached data are preserved across swipes.
  //
  // Without this, all 13 dashboard panels mounted on the very first
  // render — each one fired its own /api/* request and ran its own
  // useFocusEffect, which on Android APK starved the JS thread and
  // could trigger a silent native crash back to the home tab.
  // Only the active tab + its immediate neighbours stay mounted. Panels
  // that scroll far out of view are UNMOUNTED to release their memory
  // (native views, cached API payloads, timers). Previously every
  // visited panel stayed mounted for the whole session, so a doctor who
  // browsed through all ~13 heavy panels accumulated the memory of all
  // of them at once — on a constrained Android device this eventually
  // triggered a native OOM crash that reloaded the JS bundle and dumped
  // the user back on the Home tab ("dashboard keeps crashing to home").
  // Keeping only active ± 1 mounted bounds peak memory to 3 panels.
  const computeWindow = React.useCallback(
    (idx: number): Set<string> => {
      const s = new Set<string>();
      if (tabs[idx]?.id) s.add(tabs[idx].id);
      if (tabs[idx + 1]?.id) s.add(tabs[idx + 1].id);
      if (idx > 0 && tabs[idx - 1]?.id) s.add(tabs[idx - 1].id);
      return s;
    },
    [tabs],
  );
  const [mountedIds, setMountedIds] = React.useState<Set<string>>(() => computeWindow(activeIndex));
  React.useEffect(() => {
    const next = computeWindow(activeIndex);
    setMountedIds((prev) => {
      if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [activeIndex, computeWindow]);

  // Desktop-aware inner padding & max-width so dashboard panels feel
  // compact + centred on wide web viewports. Mobile keeps the existing
  // tight 20px padding which is best for thumb use.
  const { isWebDesktop } = useResponsive();
  const panelPad = React.useMemo(
    () => (isWebDesktop
      ? { paddingHorizontal: 28, paddingTop: 16, paddingBottom: 48 }
      : { padding: 20, paddingBottom: 110 }),
    [isWebDesktop],
  );
  const panelMax = isWebDesktop ? 1120 : undefined;
  const settleTimer = React.useRef<any>(null);

  // ── Refresh context plumbing ───────────────────────────────────
  const refreshMap = React.useRef<Record<string, () => Promise<void> | void>>({});
  const [refreshingTab, setRefreshingTab] = React.useState<string>('');
  const register = React.useCallback((tabId: string, fn: () => Promise<void> | void) => {
    refreshMap.current[tabId] = fn;
  }, []);
  const unregister = React.useCallback((tabId: string) => {
    delete refreshMap.current[tabId];
  }, []);
  const trigger = React.useCallback(async (tabId: string) => {
    const fn = refreshMap.current[tabId];
    if (!fn) return;
    setRefreshingTab(tabId);
    try { await Promise.resolve(fn()); } finally { setRefreshingTab(''); }
  }, []);

  React.useEffect(() => {
    if (width > 0 && pagerRef.current) {
      pagerRef.current.scrollTo({ x: activeIndex * width, animated: true });
    }
  }, [activeIndex, width]);

  const settleToPage = React.useCallback(
    (x: number) => {
      if (width <= 0) return;
      const idx = Math.round(x / width);
      if (tabs[idx] && tabs[idx].id !== activeId) {
        onChange(tabs[idx].id);
      }
    },
    [width, tabs, activeId, onChange],
  );

  return (
    <PanelRefreshContext.Provider value={{ register, unregister }}>
      <View
        style={{ flex: 1, backgroundColor: COLORS.bg }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={Platform.OS === 'web' ? 16 : 64}
          onScroll={Platform.OS === 'web' ? (e) => {
            const x = e.nativeEvent.contentOffset.x;
            if (settleTimer.current) clearTimeout(settleTimer.current);
            settleTimer.current = setTimeout(() => settleToPage(x), 140);
          } : undefined}
          onMomentumScrollEnd={(e) => settleToPage(e.nativeEvent.contentOffset.x)}
          onScrollEndDrag={(e) => settleToPage(e.nativeEvent.contentOffset.x)}
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 0 }}
        >
          {tabs.map((tb) => {
            const shouldMount = mountedIds.has(tb.id);
            return (
              <RNAnimated.ScrollView
                key={tb.id}
                style={{ width }}
                contentContainerStyle={panelPad}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={32}
                onScroll={onVerticalScroll}
                decelerationRate={Platform.OS === 'ios' ? 'normal' : 0.985}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingTab === tb.id}
                    onRefresh={() => trigger(tb.id)}
                    tintColor={COLORS.primary}
                    colors={[COLORS.primary]}
                  />
                }
              >
                {shouldMount ? (
                  panelMax ? (
                    <View style={{ width: '100%', maxWidth: panelMax, alignSelf: 'center' }}>
                      {renderPanel(tb.id)}
                    </View>
                  ) : (
                    renderPanel(tb.id)
                  )
                ) : (
                  // Cheap placeholder preserves pager geometry without
                  // mounting heavy panel components or firing their
                  // initial data fetches.
                  <View style={{ flex: 1, minHeight: 200 }} />
                )}
              </RNAnimated.ScrollView>
            );
          })}
        </ScrollView>
      </View>
    </PanelRefreshContext.Provider>
  );
}
