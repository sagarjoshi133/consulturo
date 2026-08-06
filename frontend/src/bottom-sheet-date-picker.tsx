/**
 * BottomSheetDatePicker — Wave 2 · L
 *
 * Cross-platform date picker that opens in a bottom sheet on small
 * screens and an inline modal on desktop. Wraps
 * @react-native-community/datetimepicker on native and a simple
 * native <input type="date"> on web (the best a11y you'll get for
 * free on web).
 *
 * Why a custom wrapper? The default DateTimePicker UX on Android is
 * a full-screen modal which feels heavy and hides the form behind
 * it. Our bottom-sheet version (slide-up, 50% screen, semi-transparent
 * backdrop) lets the user see the form context while picking.
 *
 * Usage:
 *   <BottomSheetDatePicker
 *     visible={open}
 *     value={date}
 *     mode="date"            // or "time" or "datetime"
 *     onChange={setDate}
 *     onClose={() => setOpen(false)}
 *   />
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS, FONTS, RADIUS } from './theme';

type Mode = 'date' | 'time' | 'datetime';

type Props = {
  visible: boolean;
  value: Date;
  mode?: Mode;
  minimumDate?: Date;
  maximumDate?: Date;
  title?: string;
  onChange: (d: Date) => void;
  onClose: () => void;
  testID?: string;
};

export function BottomSheetDatePicker({
  visible,
  value,
  mode = 'date',
  minimumDate,
  maximumDate,
  title,
  onChange,
  onClose,
  testID,
}: Props) {
  const insets = useSafeAreaInsets();
  const [staged, setStaged] = useState<Date>(value);

  // Keep `staged` in sync with the incoming `value` whenever the sheet opens.
  React.useEffect(() => { if (visible) setStaged(value); }, [visible, value]);

  const commit = () => { onChange(staged); onClose(); };

  // Web: use a native HTML input. It's accessible, themable, and free.
  if (Platform.OS === 'web') {
    const iso = (d: Date) =>
      mode === 'time'
        ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.webCard}>
                <View style={styles.head}>
                  <Text style={styles.headTitle}>{title || (mode === 'time' ? 'Pick a time' : 'Pick a date')}</Text>
                  <TouchableOpacity onPress={onClose} hitSlop={8}>
                    <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  // React Native Web routes type="date"/"time" through to the underlying <input>.
                  // @ts-ignore — RN typings don't include the `type` prop but RN-Web honours it.
                  type={mode === 'time' ? 'time' : 'date'}
                  value={iso(staged)}
                  onChangeText={(t) => {
                    if (mode === 'time') {
                      const [hh, mm] = t.split(':').map(Number);
                      const next = new Date(staged);
                      next.setHours(hh || 0, mm || 0, 0, 0);
                      setStaged(next);
                    } else {
                      const [y, m, d] = t.split('-').map(Number);
                      if (y && m && d) setStaged(new Date(y, m - 1, d));
                    }
                  }}
                  style={styles.webInput}
                  testID={testID}
                />
                <View style={styles.btnRow}>
                  <TouchableOpacity onPress={onClose} style={[styles.btn, styles.btnGhost]}>
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={commit} style={[styles.btn, styles.btnPrimary]}>
                    <Text style={styles.btnPrimaryText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }

  // Native (iOS / Android) — slide-up bottom sheet with spinner picker.
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: 12 + insets.bottom }]}>
              <View style={styles.handleWrap}><View style={styles.handle} /></View>
              <View style={styles.head}>
                <Text style={styles.headTitle}>
                  {title || (mode === 'time' ? 'Pick a time' : mode === 'datetime' ? 'Pick date & time' : 'Pick a date')}
                </Text>
                <TouchableOpacity onPress={onClose} hitSlop={8}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={{ alignItems: 'center' }}>
                <DateTimePicker
                  value={staged}
                  mode={mode === 'datetime' ? 'datetime' : mode}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  minimumDate={minimumDate}
                  maximumDate={maximumDate}
                  onChange={(_e, d) => { if (d) setStaged(d); }}
                />
              </View>
              <View style={styles.btnRow}>
                <TouchableOpacity onPress={onClose} style={[styles.btn, styles.btnGhost]}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={commit} style={[styles.btn, styles.btnPrimary]}>
                  <Text style={styles.btnPrimaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  webCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 18,
    width: 360,
    maxWidth: '92%',
  },
  handleWrap: { alignItems: 'center', paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  headTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  webInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  btn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: RADIUS.pill },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 13 },
});
