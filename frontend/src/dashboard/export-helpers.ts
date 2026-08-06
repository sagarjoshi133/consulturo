/**
 * Dashboard — CSV export helper.
 *
 * Owner-only on the backend; on web triggers a real file download
 * (Blob + <a download>), on native it just informs the user.
 *
 * Extracted from app/dashboard.tsx during the 2026-05-31 refactor
 * to start shrinking the monolithic dashboard file.
 */
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function downloadCsv(kind: 'bookings' | 'prescriptions' | 'referrers'): Promise<void> {
  try {
    const backend = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
    const url = `${backend}/api/export/${kind}.csv`;
    const token = await AsyncStorage.getItem('session_token');
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      const msg = resp.status === 403 ? 'Owner access required' : `Export failed (${resp.status})`;
      if (Platform.OS === 'web') (globalThis as any).window?.alert?.(msg);
      else Alert.alert('Export failed', msg);
      return;
    }
    const blob = await resp.blob();
    const filename = `consulturo-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    if (Platform.OS === 'web' && typeof (globalThis as any).window !== 'undefined') {
      const w = (globalThis as any).window;
      const d = (globalThis as any).document;
      const blobUrl = w.URL.createObjectURL(blob);
      const a = d.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      d.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { d.body.removeChild(a); } catch { /* ignored */ }
        try { w.URL.revokeObjectURL(blobUrl); } catch { /* ignored */ }
      }, 2000);
    } else {
      Alert.alert(
        'CSV ready',
        `Downloaded ${filename} (open via a file sharing flow on mobile).`,
      );
    }
  } catch (e: any) {
    const msg = e?.message || 'Could not export CSV';
    if (Platform.OS === 'web') (globalThis as any).window?.alert?.(msg);
    else Alert.alert('Export failed', msg);
  }
}
