import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n, LANGS } from './i18n';
import { COLORS, FONTS, RADIUS } from './theme';

type Props = {
  /** compact (for top-right corners) vs large */
  compact?: boolean;
  testID?: string;
};

/**
 * Small pill showing the current language + chevron-down.
 * Tapping opens a dropdown menu with the 3 language options.
 * Designed to sit in the top-right of a header.
 */
export default function LanguageDropdown({ compact = true, testID = 'lang-dropdown' }: Props) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);

  const current = LANGS.find((l) => l.code === lang) || LANGS[0];

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.pill, compact && styles.pillCompact]}
        testID={testID}
        activeOpacity={0.8}
      >
        <Ionicons name="globe-outline" size={14} color={COLORS.primary} />
        <Text style={styles.pillText}>{current.native}</Text>
        <Ionicons name="chevron-down" size={14} color={COLORS.primary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Language / भाषा / ભાષા</Text>
            {LANGS.map((L) => (
              <TouchableOpacity
                key={L.code}
                onPress={async () => {
                  await setLang(L.code);
                  setOpen(false);
                }}
                style={[styles.item, lang === L.code && styles.itemActive]}
                testID={`${testID}-${L.code}`}
              >
                <Text style={[styles.itemText, lang === L.code && styles.itemTextActive]}>
                  {L.native}
                </Text>
                <Text style={styles.itemSub}>{L.label}</Text>
                {lang === L.code && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={COLORS.primary}
                    style={{ marginLeft: 'auto' }}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pillCompact: { paddingVertical: 6, paddingHorizontal: 10 },
  pillText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 80,
    paddingRight: 16,
  },
  menu: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    minWidth: 220,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuTitle: {
    ...FONTS.label,
    color: COLORS.textSecondary,
    fontSize: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    gap: 8,
  },
  itemActive: { backgroundColor: COLORS.primary + '12' },
  itemText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  itemTextActive: { color: COLORS.primary },
  itemSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
});
