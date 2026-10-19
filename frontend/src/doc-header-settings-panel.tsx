/**
 * Branding → Document Headers.
 *
 * Per-document-type editor letting the owner:
 *   • upload / replace a left-side logo image,
 *   • pick which line is the big title (Clinic name OR Doctor name),
 *   • reorder (↑/↓), show/hide, and edit the text of every header line.
 *
 * Stored in clinic_settings.doc_headers keyed by document type.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, RADIUS } from './theme';
import api from './api';
import { invalidateClinicSettingsCache } from './rx-pdf';
import { clearClinicSettingsCache } from './clinic-settings';
import {
  DOC_HEADER_TYPES, HEADER_LINE_DEFS, getDocHeaderCfg,
  type DocHeaderType, type DocHeaderCfg, type HeaderLine,
} from './pdf-header';

const LABEL: Record<string, string> = Object.fromEntries(
  HEADER_LINE_DEFS.map((d) => [d.key, d.label]),
);

export default function DocHeaderSettingsPanel() {
  const [docType, setDocType] = useState<DocHeaderType>('prescription');
  const [all, setAll] = useState<any>({});
  const [flags, setFlags] = useState<{ use_letterhead?: boolean; letterhead_image_b64?: string; rx_print_mode?: boolean }>({});
  const [cfg, setCfg] = useState<DocHeaderCfg>(() => getDocHeaderCfg({}, 'prescription'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/clinic-settings');
        setAll(data?.doc_headers || {});
        setFlags({
          use_letterhead: !!data?.use_letterhead,
          letterhead_image_b64: data?.letterhead_image_b64 || '',
          rx_print_mode: !!data?.rx_print_mode,
        });
      } catch { /* defaults */ }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    setCfg(getDocHeaderCfg(all, docType));
  }, [docType, all]);

  const persist = async (next: DocHeaderCfg) => {
    setCfg(next);
    setSaving(true);
    const merged = { ...all, [docType]: next };
    setAll(merged);
    try {
      await api.patch('/clinic-settings', { doc_headers: merged });
      invalidateClinicSettingsCache();
      clearClinicSettingsCache();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Could not save. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload a logo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const uri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
    if (uri.length > 900_000) {
      Alert.alert('Image too large', 'Please pick a smaller / more compressed logo (under ~650 KB).');
      return;
    }
    void persist({ ...cfg, logo_b64: uri });
  };

  const move = (idx: number, dir: -1 | 1) => {
    const lines = [...cfg.lines];
    const j = idx + dir;
    if (j < 0 || j >= lines.length) return;
    [lines[idx], lines[j]] = [lines[j], lines[idx]];
    void persist({ ...cfg, lines: lines.map((l, i) => ({ ...l, order: i })) });
  };

  const toggleVisible = (key: string) => {
    void persist({
      ...cfg,
      lines: cfg.lines.map((l) => (l.key === key ? { ...l, visible: !l.visible } : l)),
    });
  };

  const editText = (key: string, text: string) => {
    setCfg((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, text } : l)) }));
  };
  const commitText = () => { void persist(cfg); };

  if (loading) {
    return <View style={{ padding: 30 }}><ActivityIndicator color={COLORS.primary} /></View>;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }} showsVerticalScrollIndicator={false}>
      {/* Doc type selector */}
      <Text style={styles.sectionLabel}>Choose a document</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {DOC_HEADER_TYPES.map((d) => {
            const on = docType === d.key;
            return (
              <TouchableOpacity
                key={d.key}
                onPress={() => setDocType(d.key)}
                style={[styles.docChip, on && styles.docChipOn]}
                testID={`dh-doc-${d.key}`}
              >
                <Text style={[styles.docChipTxt, on && { color: '#fff' }]}>{d.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Precedence notice — "Prescription Look" letterhead / print mode
          overrides these per-document header settings. Keeps the two
          Branding areas from silently colliding. */}
      {(() => {
        const bannerOverrides = ['prescription', 'receipt', 'encounter', 'discharge', 'medical_certificate'];
        const letterheadActive = !!flags.use_letterhead && !!(flags.letterhead_image_b64 || '').trim();
        const printActive = docType === 'prescription' && !!flags.rx_print_mode;
        const bannerHits = letterheadActive && bannerOverrides.includes(docType);
        if (!bannerHits && !printActive) return null;
        return (
          <View style={styles.noticeCard} testID="dh-override-notice">
            <Ionicons name="information-circle" size={18} color="#B45309" />
            <Text style={styles.noticeTxt}>
              {printActive
                ? 'Print Mode is ON under “Prescription Look”, so the prescription header & footer are suppressed. These header settings won’t appear until you turn Print Mode off.'
                : 'A full-width letterhead banner is enabled under “Prescription Look”. It replaces this configurable header for this document. Turn the letterhead off there to use these settings.'}
            </Text>
          </View>
        );
      })()}

      {/* Logo */}
      <Text style={styles.sectionLabel}>Header logo (left side)</Text>
      <View style={styles.logoRow}>
        <View style={styles.logoBox}>
          {cfg.logo_b64 ? (
            <Image source={{ uri: cfg.logo_b64 }} style={styles.logoImg} resizeMode="contain" />
          ) : (
            <Ionicons name="image-outline" size={28} color={COLORS.textDisabled} />
          )}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <TouchableOpacity onPress={pickLogo} style={styles.btn} testID="dh-pick-logo">
            <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            <Text style={styles.btnTxt}>{cfg.logo_b64 ? 'Replace logo' : 'Upload logo'}</Text>
          </TouchableOpacity>
          {cfg.logo_b64 ? (
            <TouchableOpacity onPress={() => persist({ ...cfg, logo_b64: '' })} style={styles.btnGhost} testID="dh-clear-logo">
              <Text style={styles.btnGhostTxt}>Use default logo</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Title source */}
      <Text style={styles.sectionLabel}>Main title (big heading)</Text>
      <View style={styles.segment}>
        {(['clinic', 'doctor'] as const).map((src) => {
          const on = cfg.title_source === src;
          return (
            <TouchableOpacity
              key={src}
              onPress={() => persist({ ...cfg, title_source: src })}
              style={[styles.segBtn, on && styles.segBtnOn]}
              testID={`dh-title-${src}`}
            >
              <Text style={[styles.segTxt, on && { color: '#fff' }]}>
                {src === 'clinic' ? 'Clinic / Hospital name' : 'Doctor name'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Lines */}
      <Text style={styles.sectionLabel}>Header lines — reorder, show/hide, edit</Text>
      {cfg.lines.map((ln: HeaderLine, idx: number) => (
        <View key={ln.key} style={[styles.lineCard, !ln.visible && { opacity: 0.6 }]}>
          <View style={styles.lineTop}>
            <View style={styles.arrows}>
              <TouchableOpacity onPress={() => move(idx, -1)} disabled={idx === 0} style={styles.arrowBtn} testID={`dh-up-${ln.key}`}>
                <Ionicons name="chevron-up" size={16} color={idx === 0 ? COLORS.textDisabled : COLORS.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => move(idx, 1)} disabled={idx === cfg.lines.length - 1} style={styles.arrowBtn} testID={`dh-down-${ln.key}`}>
                <Ionicons name="chevron-down" size={16} color={idx === cfg.lines.length - 1 ? COLORS.textDisabled : COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.lineLabel}>{LABEL[ln.key] || ln.key}</Text>
            <TouchableOpacity onPress={() => toggleVisible(ln.key)} style={styles.eyeBtn} testID={`dh-eye-${ln.key}`}>
              <Ionicons name={ln.visible ? 'eye' : 'eye-off'} size={18} color={ln.visible ? COLORS.primary : COLORS.textDisabled} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.lineInput}
            value={ln.text || ''}
            onChangeText={(t) => editText(ln.key, t)}
            onBlur={commitText}
            placeholder={`Default from clinic settings`}
            placeholderTextColor={COLORS.textDisabled}
            testID={`dh-text-${ln.key}`}
          />
        </View>
      ))}

      <Text style={styles.hint}>
        Leave a line blank to use the value from your clinic settings. Changes save automatically
        {saving ? ' · saving…' : ' ✓'}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, marginBottom: 8, marginTop: 6, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.6 },
  docChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  docChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  docChipTxt: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  logoRow: { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'center' },
  logoBox: { width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#F7F9FA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 10, borderRadius: RADIUS.sm },
  btnTxt: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  btnGhost: { alignItems: 'center', paddingVertical: 8 },
  btnGhostTxt: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  segment: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', backgroundColor: '#fff' },
  segBtnOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segTxt: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12.5 },
  lineCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 10, marginBottom: 10, backgroundColor: '#fff' },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  arrows: { flexDirection: 'column' },
  arrowBtn: { width: 28, height: 20, alignItems: 'center', justifyContent: 'center' },
  lineLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  eyeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  lineInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 10 : 7, fontSize: 13, color: COLORS.textPrimary, backgroundColor: '#FCFEFE' },
  hint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, marginTop: 10, lineHeight: 17 },
  noticeCard: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1, borderRadius: RADIUS.md, padding: 10, marginBottom: 14 },
  noticeTxt: { ...FONTS.body, color: '#92400E', fontSize: 12, lineHeight: 17, flex: 1 },
});
