/**
 * Lazy wrappers for the larger admin panels mounted in dashboard.tsx.
 *
 * Each of these components is only rendered when the owner switches
 * to the relevant dashboard tab, so it's a clear web-bundle win to
 * defer them. The fallback is a small in-place spinner so the tab
 * switch feels instant.
 *
 *  - TeamPanelV2          (973 LoC)
 *  - ConsultationsPanel   (724 LoC)
 *  - BroadcastsPanel      (622 LoC)
 *  - AdminOverviewPanel   (421 LoC)
 *  - ReferrersPanel       (356 LoC)
 *  - AvailabilityPanel    (362 LoC)
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

function Fallback() {
  return (
    <View style={{ paddingVertical: 24, alignItems: 'center' }}>
      <ActivityIndicator color={COLORS.primary} size="small" />
    </View>
  );
}

/** Generic factory for "named export" components. */
function lazyNamed<T>(loader: () => Promise<{ [k: string]: T }>, name: string) {
  return React.lazy(async () => {
    const mod = await loader();
    return { default: (mod as any)[name] as any };
  });
}

const _Team       = lazyNamed(() => import('./team-panel'),         'TeamPanelV2');
const _Cons       = lazyNamed(() => import('./consultations-panel'),'ConsultationsPanel');
const _Broad      = lazyNamed(() => import('./broadcasts-panel'),   'BroadcastsPanel');
const _AdminOv    = lazyNamed(() => import('./admin-overview-panel'),'AdminOverviewPanel');
const _Refs       = lazyNamed(() => import('./referrers-panel'),    'ReferrersPanel');
const _Avail      = lazyNamed(() => import('./availability-panel'), 'AvailabilityPanel');

function wrap<P>(C: React.ComponentType<P>): React.ComponentType<P> {
  // eslint-disable-next-line react/display-name
  return (props: any) => (
    <Suspense fallback={<Fallback />}>
      <C {...props} />
    </Suspense>
  );
}

export const TeamPanelV2        = wrap(_Team as any) as any;
export const ConsultationsPanel = wrap(_Cons as any) as any;
export const BroadcastsPanel    = wrap(_Broad as any) as any;
export const AdminOverviewPanel = wrap(_AdminOv as any) as any;
export const ReferrersPanel     = wrap(_Refs as any) as any;
export const AvailabilityPanel  = wrap(_Avail as any) as any;
