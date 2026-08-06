/**
 * Lazy-loaded MessageComposer wrapper.
 *
 * The real `message-composer.tsx` pulls in expo-image-picker,
 * FormData, and a full attachment UI — none of which is needed until
 * the user actually taps "Compose" / "Reply".  This wrapper
 * defers the import via `React.lazy` so the patient-facing JS bundle
 * shrinks accordingly on web.
 *
 * On native, Metro bundles every reachable module into the single
 * main JS bundle so there is no real code-splitting — the dynamic
 * `import()` resolves to a synchronous `require` and React.lazy
 * resolves on the next microtask. This wrapper is therefore safe
 * (and a no-op overhead) on Android / iOS.
 *
 * Props are typed *concretely* — we explicitly mirror the underlying
 * component's prop shape rather than using `typeof import(...)`,
 * because some Babel/Metro configs leave the typeof-import expression
 * in the runtime output, which then evaluates the dynamic import
 * EAGERLY at module load (defeating the lazy purpose and, more
 * importantly, sometimes crashing on production Hermes builds where
 * native modules of the composer are not warmed up yet).
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

const RealComposer = React.lazy(() => import('./message-composer'));

type Recipient = {
  user_id: string;
  name?: string;
  email?: string;
  role?: string;
  picture?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSent?: () => void;
  initialRecipient?: Recipient | null;
};

export default function MessageComposerLazy(props: Props) {
  // Only mount the heavy chunk while the modal is visible — the
  // parent always passes `visible: boolean`, so when it's false we
  // render nothing and pay zero cost.
  if (!props.visible) return null;
  return (
    <Suspense
      fallback={
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.18)',
          }}
        >
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      }
    >
      {/* @ts-expect-error: forwarded props match the real component's signature */}
      <RealComposer {...props} />
    </Suspense>
  );
}
