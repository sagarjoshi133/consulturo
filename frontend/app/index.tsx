import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { hasSeenOnboarding } from './onboarding';
import { COLORS } from '../src/theme';

export default function Index() {
  const [state, setState] = React.useState<'loading' | 'onboarding' | 'home'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await hasSeenOnboarding();
      if (!cancelled) setState(seen ? 'home' : 'onboarding');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (state === 'onboarding') {
    return <Redirect href={'/onboarding' as any} />;
  }

  return <Redirect href={'/(tabs)' as any} />;
}
