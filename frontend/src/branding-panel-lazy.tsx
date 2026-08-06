/**
 * Lazy wrapper for the Branding panel.
 *
 * `branding-panel.tsx` is 1.1 K LoC, pulls in an image picker, colour
 * picker, font preview, gradient generator, etc. — only opened when
 * an Owner customises the clinic look-and-feel. Wrap in `React.lazy`
 * so the rest of the admin shell loads instantly.
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

const Real = React.lazy(() => import('./branding-panel'));

type Props = React.ComponentProps<typeof import('./branding-panel').default>;

export default function BrandingPanelLazy(props: Props) {
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
