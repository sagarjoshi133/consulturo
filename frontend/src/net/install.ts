/**
 * Side-effect module: installs the Android fetch polyfill immediately
 * on import. Imported FIRST from the app entry (index.js) so it runs
 * before expo-router / any network code. See ./fetch-polyfill.ts.
 */
import { installFetchPolyfill } from './fetch-polyfill';

installFetchPolyfill();
