import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// CRITICAL: hardcoded production fallback so APK builds NEVER end up
// pointing at localhost when EAS env vars are misconfigured. The first
// candidate to be non-empty wins.
// This is the always-on Emergent deployment URL (full-stack: API +
// MongoDB). The preview URL was retired in v1.0.9 — it auto-sleeps and
// caused 502 / Network Errors on Google Sign-In, prescription PDF,
// share, etc. for installed APK users.
const PROD_FALLBACK = 'https://urology-pro.emergent.host';
const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Platform.OS === 'web' ? 'http://localhost:8001' : PROD_FALLBACK);

export const API_BASE = `${BACKEND_URL.replace(/\/$/, '')}/api`;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('session_token');
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
