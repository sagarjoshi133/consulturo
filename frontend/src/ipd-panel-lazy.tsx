/**
 * Lazy wrapper for the IPD panel.
 *
 * The IPD module under `src/ipd/` is a dozen files (dashboard, drawer,
 * 6 tab components, transfer modal, types, shared styles). It's
 * irrelevant to patient-facing sessions and rarely opened even on
 * staff sessions (only when a beds-aware urology clinic uses IPD).
 * Wrapping in `React.lazy` keeps the initial dashboard bundle small.
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

const Real = React.lazy(() => import('./ipd/dashboard'));

type Props = React.ComponentProps<typeof import('./ipd/dashboard').default>;

export default function IPDPanelLazy(props: Props) {
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
