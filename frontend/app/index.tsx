import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { hasSeenOnboarding } from './onboarding';
import { useAuth } from '../src/auth';
import { COLORS } from '../src/theme';

export default function Index() {
  const [state, setState] = React.useState<'loading' | 'onboarding' | 'home'>('loading');
  const { user, loading: authLoading } = useAuth();

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

  // If we're still resolving the session OR onboarding flag, render a
  // spinner. This prevents the 3-slide Welcome from briefly flashing
  // for a returning signed-in user (was a race that broke deep links
  // with `?session_token=...` and confused QA test runs).
  if (state === 'loading' || authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  // Already signed in → skip onboarding entirely (returning user). The
  // Welcome slides are only meaningful for first-time anonymous users.
  if (state === 'onboarding' && !user) {
    return <Redirect href={'/onboarding' as any} />;
  }

  return <Redirect href={'/(tabs)' as any} />;
}
