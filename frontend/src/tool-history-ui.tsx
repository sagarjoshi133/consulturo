import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import type { ToolScore } from './tool-history';

function formatWhen(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');
    const h12 = h % 12 || 12;
    return `${dd}-${mm}-${yy} · ${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
  } catch {
    return '';
  }
}

export function ToolHistoryList({
  history,
  loading,
  onDelete,
  emptyLabel = 'No saved scores yet',
}: {
  history: ToolScore[];
  loading: boolean;
  onDelete?: (id: string) => void;
  emptyLabel?: string;
}) {
  if (loading) {
    return <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} />;
  }
  if (!history || history.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="time-outline" size={22} color={COLORS.textDisabled} />
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {history.map((h) => (
        <View key={h.score_id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{h.label || (h.score != null ? String(h.score) : '—')}</Text>
            <Text style={styles.when}>{formatWhen(h.created_at)}</Text>
          </View>
          {onDelete && (
            <TouchableOpacity onPress={() => onDelete(h.score_id)} style={styles.delBtn} testID={`tool-del-${h.score_id}`}>
              <Ionicons name="trash-outline" size={14} color={COLORS.accent} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

export function SaveScoreButton({
  onPress,
  saving,
  disabled,
  label = 'Save to history',
}: {
  onPress: () => void;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || saving}
      style={[styles.saveBtn, (disabled || saving) && { opacity: 0.5 }]}
      testID="tool-save-btn"
    >
      {saving ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Ionicons name="bookmark" size={16} color="#fff" />
      )}
      <Text style={styles.saveBtnText}>{saving ? 'Saving…' : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  empty: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  label: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  when: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  delBtn: { padding: 6 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, marginTop: 10 },
  saveBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },
});
