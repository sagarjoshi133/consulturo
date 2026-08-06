/**
 * Lazy wrapper for the Surgeries panel.
 *
 * `surgery-panel.tsx` is 1.7 K LoC, pulls in calendar libs,
 * pre-op consent forms, surgery-CSV import logic and a procedure
 * catalogue — heavyweight and used only when an owner / partner
 * actually opens the "Surgery" tab on the dashboard. Wrapping in
 * `React.lazy` so it lives in its own JS chunk on web.
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

const Real = React.lazy(async () => {
  const mod = await import('./surgery-panel');
  return { default: mod.SurgeriesPanel };
});

export type SurgeriesPanelProps = React.ComponentProps<
  typeof import('./surgery-panel').SurgeriesPanel
>;

export function SurgeriesPanel(props: SurgeriesPanelProps) {
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
