/**
 * Lazy-loaded VoiceDictationSheet wrapper.
 *
 * The real `voice-dictation-sheet.tsx` pulls in expo-audio, the
 * recording state machine and Claude STT — heavy and only needed
 * when a doctor taps the mic icon on /prescriptions/new.
 *
 * Wrapping it in `React.lazy` keeps the initial /prescriptions bundle
 * smaller and helps the patient-side bundle (which doesn't import
 * this at all) by signalling to the bundler that this chunk is a
 * separate dynamic import.
 */
import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from './theme';

const Real = React.lazy(async () => {
  const mod = await import('./voice-dictation-sheet');
  return { default: mod.VoiceDictationSheet };
});

// Mirror the public props of `VoiceDictationSheet` (named export).
export type VoiceDictationSheetProps = React.ComponentProps<
  typeof import('./voice-dictation-sheet').VoiceDictationSheet
>;

export function VoiceDictationSheetLazy(props: VoiceDictationSheetProps) {
  if (!props.visible) return null;
  return (
    <Suspense
      fallback={
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.18)',
          }}
        >
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
