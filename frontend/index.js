// Custom app entry.
//
// STEP 1 — install the Android fetch polyfill as the very first thing,
// before expo-router or any networking code runs. This works around the
// Expo SDK 54 Hermes/New-Architecture Android bug where global `fetch`
// hangs on production builds (https://github.com/expo/expo/issues/40061).
// The import below runs `installFetchPolyfill()` as a side effect.
import './src/net/install';

// STEP 2 — hand off to expo-router's default entry (registers the root
// component from the /app directory). Kept as a separate side-effect
// import AFTER the polyfill so module-evaluation order is guaranteed.
import 'expo-router/entry';
