// Metro bundler config — keeps Expo Router defaults but excludes
// build-artifact directories from the file watcher so we don't
// exhaust inotify limits in containerised environments.
//
// IMPORTANT: This file only adds a `resolver.blockList`. It does NOT
// override any other Expo Metro defaults. Module resolution and
// Expo Router behaviour are unchanged — only file watching is
// trimmed to skip platform-specific build folders that Metro never
// needs to follow for the web preview / Expo Go.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const extraBlocks = [
  // Avoid following nested node_modules graphs (prevents N^2 watching).
  /node_modules\/.*\/node_modules\/.*/,
  // Native build artefacts — irrelevant for the web bundle.
  // IMPORTANT: Only block `android/` / `ios/` when it is a direct child of
  // the project root or a package root. We must NOT block paths like
  // `node_modules/<pkg>/build/android/...` because some Expo SDK 55 packages
  // (e.g. expo-symbols) ship platform JS code under `build/android/`.
  /^android\/.*/,
  /^ios\/.*/,
  /node_modules\/(?:@[^/]+\/)?[^/]+\/android\/.*/,
  /node_modules\/(?:@[^/]+\/)?[^/]+\/ios\/.*/,
  /.*\/gradle-plugin\/.*/,
  // Test and build outputs that Metro should ignore.
  /.*\/__tests__\/.*/,
  /.*\/web-build\/.*/,
  // Firebase JS SDK ships ~12 sub-packages. We only consume `app` and
  // `auth` (web shim for phone auth bridging). Exclude the rest to
  // stay under inotify's max_user_watches limit in containerised
  // environments.
  /node_modules\/firebase\/(messaging|firestore|database|functions|storage|analytics|installations|performance|remote-config|app-check|vertexai|data-connect)\/.*/,
  /node_modules\/@firebase\/(messaging|firestore|database|functions|storage|analytics|installations|performance|remote-config|app-check|vertexai|data-connect)\/.*/,
  // React Native ships a massive ReactAndroid + Libraries native tree.
  // For the *web* preview none of this is consumed, so we keep it out
  // of the file watcher (this alone reclaims thousands of inotify
  // handles in containerised environments).
  /node_modules\/react-native\/ReactAndroid\/.*/,
  /node_modules\/react-native\/ReactCommon\/.*/,
  /node_modules\/react-native\/Libraries\/.*\/__tests__\/.*/,
  /node_modules\/react-native\/sdks\/.*/,
  /node_modules\/react-native\/template\/.*/,
  /node_modules\/react-native\/scripts\/.*/,
  // Other RN packages that ship an `android/` or `ios/` native dir
  // already get caught by the broad regex above. Catch their
  // `windows/` and `macos/` siblings too.
  /node_modules\/.*\/macos\/.*/,
  /node_modules\/.*\/windows\/.*/,
  // Pure documentation / fixture trees inside packages.
  /node_modules\/.*\/(docs|fixtures|examples|sample)\/.*/,
  // Source maps + flow type files — never consumed at runtime.
  /node_modules\/.*\.flow$/,
  /node_modules\/.*\.map$/,
];

config.resolver = config.resolver || {};
config.resolver.blockList = config.resolver.blockList
  ? [...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList]), ...extraBlocks]
  : extraBlocks;

module.exports = config;
