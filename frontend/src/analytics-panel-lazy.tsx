/**
 * Lazy wrapper for the Analytics panel.
 *
 * `analytics-panel.tsx` is 540 LoC and pulls in chart primitives.
 * Owners view it only when they switch to the Analytics tab on the
 * dashboard, so it's a clear win to ship it in its own chunk.
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

const Real = React.lazy(async () => {
  const mod = await import('./analytics-panel');
  return { default: mod.AnalyticsPanel };
});

export type AnalyticsPanelProps = React.ComponentProps<
  typeof import('./analytics-panel').AnalyticsPanel
>;

export function AnalyticsPanel(props: AnalyticsPanelProps) {
  return (
    <Suspense
      fallback={
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.primary} size="small" />
        </View>
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
