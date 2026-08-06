/**
 * ContentPager — horizontally-swipable tab pager with:
 *   • lazy panel mounting (active + immediate neighbours only)
 *   • once-visited-stays-mounted to preserve scroll + in-tab state
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
  const [mountedIds, setMountedIds] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    if (tabs[activeIndex]?.id) s.add(tabs[activeIndex].id);
    if (tabs[activeIndex + 1]?.id) s.add(tabs[activeIndex + 1].id);
    if (activeIndex > 0 && tabs[activeIndex - 1]?.id) s.add(tabs[activeIndex - 1].id);
    return s;
  });
  React.useEffect(() => {
    setMountedIds((prev) => {
      const next = new Set(prev);
      if (tabs[activeIndex]?.id) next.add(tabs[activeIndex].id);
      if (tabs[activeIndex + 1]?.id) next.add(tabs[activeIndex + 1].id);
      if (activeIndex > 0 && tabs[activeIndex - 1]?.id) next.add(tabs[activeIndex - 1].id);
      return next.size === prev.size ? prev : next;
    });
  }, [activeIndex, tabs]);

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
