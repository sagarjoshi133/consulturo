/*
 * AttachmentsCard — Upload + gallery for booking attachments (Bundle I).
 *
 * Same component on patient pre-call screen + staff console:
 *   • Tap "Add report / image" → expo-image-picker or expo-document-picker
 *   • Image preview thumbnails (lazy-loaded with base64 content)
 *   • PDF / other files: filename + open-in-browser button
 *   • Delete (any uploader can delete their own; staff can delete any)
 *
 * Storage: base64 in MongoDB. Cap 8 MB per file (server-enforced).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';

type Attachment = {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  uploaded_at?: string;
  uploaded_by_role?: string;
  content_base64?: string;
};

type Props = {
  bookingId: string;
  visible?: boolean;
  /** When true, allow delete for ANY attachment (staff). When false,
   *  patient can still upload — server enforces ownership. */
  isStaff?: boolean;
};

export default function AttachmentsCard({ bookingId, visible = true, isStaff = false }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!bookingId) return;
    try {
      // Include base64 so we can render image thumbnails inline.
      const r = await api.get(`/video/bookings/${bookingId}/attachments?include_content=1`);
      setItems(r.data?.attachments || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [bookingId]);

  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);

  if (!visible) return null;

  /* ── helpers ─────────────────────────────────────────────────── */
  const uploadBase64 = async (b64: string, name: string, mime: string) => {
    setBusy('upload');
    try {
      await api.post(`/video/bookings/${bookingId}/attachments`, {
        name, content_base64: b64, mime_type: mime,
      }, { timeout: 60000 });
      await refresh();
    } catch (e: any) {
      Alert.alert('Upload', e?.response?.data?.detail || 'Could not upload — check size (max 8 MB) and try again.');
    } finally { setBusy(null); }
  };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission', 'Photo library permission is needed to share images.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const b64 = a.base64 || '';
      if (!b64) return Alert.alert('Upload', 'Image could not be encoded.');
      const name = (a.fileName || `photo-${Date.now()}.jpg`).slice(0, 200);
      await uploadBase64(b64, name, a.mimeType || 'image/jpeg');
    } catch (e: any) {
      Alert.alert('Upload', String(e?.message || e));
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      // expo-document-picker doesn't return base64 by default — read it.
      let b64: string;
      try {
        b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      } catch (e) {
        Alert.alert('Upload', 'Could not read the file.');
        return;
      }
      await uploadBase64(b64, (a.name || `file-${Date.now()}`).slice(0, 200), a.mimeType || 'application/octet-stream');
    } catch (e: any) {
      Alert.alert('Upload', String(e?.message || e));
    }
  };

  const remove = async (id: string) => {
    Alert.alert('Remove file', 'Delete this attachment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(id);
          try {
            await api.delete(`/video/bookings/${bookingId}/attachments/${id}`);
            await refresh();
          } catch (e: any) {
            Alert.alert('Delete', e?.response?.data?.detail || 'Could not delete.');
          } finally { setBusy(null); }
        },
      },
    ]);
  };

  const openFile = (a: Attachment) => {
    if (!a.content_base64) return;
    // For web, open a data URL in a new tab. For native, only image
    // preview is meaningful inline; PDFs we surface via a download.
    if (Platform.OS === 'web') {
      const dataUrl = `data:${a.mime_type};base64,${a.content_base64}`;
      try {
        const w = (globalThis as any).window;
        if (w?.open) {
          w.open(dataUrl, '_blank');
          return;
        }
      } catch { /* fallthrough */ }
    }
    // Native fallback: write to cache and open via system viewer.
    (async () => {
      try {
        const path = `${FileSystem.cacheDirectory}${a.name}`;
        await FileSystem.writeAsStringAsync(path, a.content_base64!, { encoding: FileSystem.EncodingType.Base64 });
        Linking.openURL(path).catch(() => {});
      } catch { /* silent */ }
    })();
  };

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <View style={styles.card} testID="attachments-card">
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="attach" size={13} color="#fff" />
        </View>
        <Text style={styles.title}>Reports & images</Text>
        <Text style={styles.count}>{items.length}</Text>
      </View>

      {/* Upload buttons — patient-only.
          The doctor / staff role can still SEE attachments (gallery
          below) and delete them, but it's the patient who provides
          source documents (X-ray, USG, lab PDFs). Showing upload UI
          on the staff side led to confusing role boundaries — fixed
          per UX feedback 2026-06-18. */}
      {!isStaff && (
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={pickImage}
            disabled={busy === 'upload'}
            testID="att-pick-image"
          >
            {busy === 'upload' ? (
              <ActivityIndicator color={COLORS.primary} size="small" />
            ) : (
              <>
                <Ionicons name="image-outline" size={14} color={COLORS.primary} />
                <Text style={styles.uploadText}>Photo</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={pickDocument}
            disabled={busy === 'upload'}
            testID="att-pick-doc"
          >
            <Ionicons name="document-outline" size={14} color={COLORS.primary} />
            <Text style={styles.uploadText}>Report (PDF)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Gallery */}
      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 10 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>
          {isStaff
            ? 'No attachments yet — the patient hasn\u2019t shared any X-ray, USG report or lab PDF for this booking.'
            : 'No attachments yet — add an X-ray, USG report, or lab PDF to share with Dr. Joshi.'}
        </Text>
      ) : (
        <View style={styles.grid}>
          {items.map((a) => {
            const isImage = (a.mime_type || '').startsWith('image/');
            return (
              <View key={a.id} style={styles.item}>
                {isImage && a.content_base64 ? (
                  <TouchableOpacity onPress={() => openFile(a)} activeOpacity={0.8}>
                    <Image
                      source={{ uri: `data:${a.mime_type};base64,${a.content_base64}` }}
                      style={styles.thumb}
                    />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => openFile(a)} style={styles.fileChip}>
                    <Ionicons name="document-text-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.fileName} numberOfLines={2}>{a.name}</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.itemFooter}>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {(a.size / 1024).toFixed(0)} KB · {a.uploaded_by_role || 'patient'}
                  </Text>
                  {(isStaff || a.uploaded_by_role === 'patient') ? (
                    <TouchableOpacity onPress={() => remove(a.id)} disabled={busy === a.id} hitSlop={6}>
                      {busy === a.id ? (
                        <ActivityIndicator size="small" color="#9A2F2F" />
                      ) : (
                        <Ionicons name="trash-outline" size={13} color="#9A2F2F" />
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12, padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#F9FBFC',
    borderWidth: 1, borderColor: '#DDEAEE',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  headerIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h4, color: COLORS.primaryDark, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', flex: 1 },
  count: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700' },

  btnRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  uploadBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 10, borderRadius: RADIUS.pill,
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary + '55',
  },
  uploadText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },

  empty: { color: '#88999D', fontSize: 11.5, fontStyle: 'italic', textAlign: 'center', paddingVertical: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { width: '48%', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#DDEAEE', overflow: 'hidden' },
  thumb: { width: '100%', height: 90, backgroundColor: '#F4F9F9' },
  fileChip: { padding: 14, alignItems: 'center', gap: 6, minHeight: 90, justifyContent: 'center' },
  fileName: { color: COLORS.textPrimary, fontSize: 11, textAlign: 'center' },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 6 },
  itemMeta: { color: '#88999D', fontSize: 10, flex: 1 },
});
