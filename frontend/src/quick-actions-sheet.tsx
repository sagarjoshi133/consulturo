/**
 * QuickActionsSheet — Wave 2 · H
 *
 * Long-press action sheet for patient/booking cards. Triggered
 * from the parent via:
 *   const [open, setOpen] = useState(false);
 *   <Pressable onLongPress={() => setOpen(true)} ...>
 *   <QuickActionsSheet visible={open} onClose={()=>setOpen(false)}
 *                      actions={[{icon, label, onPress}, ...]} />
 *
 * Cross-platform: bottom sheet on native, centred modal on web.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import { haptics } from './haptics';

export type QuickAction = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'destructive' | 'success';
  disabled?: boolean;
  testID?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  actions: QuickAction[];
};

export function QuickActionsSheet({ visible, onClose, title, subtitle, actions }: Props) {
  const insets = useSafeAreaInsets();

  const onTap = (a: QuickAction) => {
    if (a.disabled) return;
    haptics.tap();
    onClose();
    // Defer slightly so the sheet animates out cleanly before navigation.
    setTimeout(() => { try { a.onPress(); } catch {} }, 80);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: 12 + insets.bottom }]}>
              <View style={styles.handleWrap}><View style={styles.handle} /></View>
              {(title || subtitle) ? (
                <View style={styles.headWrap}>
                  {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
                  {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
                </View>
              ) : null}
              <View style={styles.list}>
                {actions.map((a, i) => {
                  const color =
                    a.tone === 'destructive' ? '#B91C1C' :
                    a.tone === 'success' ? '#059669' :
                    COLORS.textPrimary;
                  return (
                    <TouchableOpacity
                      key={a.testID || `${a.label}-${i}`}
                      onPress={() => onTap(a)}
                      disabled={a.disabled}
                      style={[styles.row, a.disabled && { opacity: 0.4 }]}
                      testID={a.testID}
                      activeOpacity={0.65}
                    >
                      <View style={[styles.iconCircle, { backgroundColor: color + '14' }]}>
                        <Ionicons name={a.icon} size={18} color={color} />
                      </View>
                      <Text style={[styles.rowText, { color }]}>{a.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 4,
    ...(Platform.OS === 'web'
      ? { alignSelf: 'center', maxWidth: 480, width: '100%', borderRadius: 20 }
      : null),
  },
  handleWrap: { alignItems: 'center', paddingTop: 8, marginBottom: 4 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' },
  headWrap: { paddingHorizontal: 8, paddingVertical: 10 },
  title: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  list: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 11,
  },
  iconCircle: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText: { ...FONTS.bodyMedium, fontSize: 14, flex: 1 },
  cancelBtn: {
    marginHorizontal: 8,
    marginTop: 8,
    paddingVertical: 13,
    borderRadius: RADIUS.pill,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 14 },
});
