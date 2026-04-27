/**
 * SuggestInput — a TextInput wired to a live backend "suggestions"
 * endpoint. As the user types, we debounce a fetch to
 * GET /surgeries/suggestions?field=X&q=... and render matches inline
 * below the field. Tapping a suggestion commits it back.
 *
 * Used across the Surgery-logbook form for fields like surgery_name,
 * diagnosis, referred_by, hospital, imaging, etc.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';

type Suggestion = { value: string; count: number };

type Props = {
  field: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  style?: any;
  testID?: string;
  /** If true the field only shows suggestions when user types; otherwise
   * shows the top 5 on focus. Default true (show all-time top on focus). */
  suggestOnFocus?: boolean;
  /** Optional extra ref to attach */
  inputRef?: React.RefObject<TextInput>;
  minChars?: number; // default 0
  disabled?: boolean;
};

export function SuggestInput({
  field,
  value,
  onChangeText,
  placeholder,
  multiline,
  style,
  testID,
  suggestOnFocus = true,
  inputRef,
  minChars = 0,
  disabled = false,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const lastReqId = useRef(0);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (!focused || dismissed) return;
    const q = value.trim();
    if (q.length < minChars) { setItems([]); return; }

    const reqId = ++lastReqId.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/surgeries/suggestions', {
          params: { field, q: q || undefined, limit: 8 },
        });
        if (reqId !== lastReqId.current) return; // stale
        // Hide the suggestion that exactly matches current value (nothing to auto-complete).
        const filtered: Suggestion[] = (data || []).filter(
          (s: Suggestion) => s.value.toLowerCase() !== q.toLowerCase()
        );
        setItems(filtered);
      } catch {
        setItems([]);
      } finally {
        if (reqId === lastReqId.current) setLoading(false);
      }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, focused, field, dismissed, minChars]);

  const commit = (s: Suggestion) => {
    onChangeText(s.value);
    setItems([]);
    setDismissed(true);
    // Keep keyboard open on multi-step forms, but blur long-text fields.
    if (Platform.OS !== 'web') Keyboard.dismiss();
  };

  const showList = focused && !dismissed && items.length > 0;

  return (
    <View style={{ position: 'relative' }}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(v) => { onChangeText(v); setDismissed(false); }}
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onBlur={() => {
          // slight delay so tapping a suggestion registers before blur
          setTimeout(() => setFocused(false), 160);
        }}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, multiline && { minHeight: 76, textAlignVertical: 'top' }, style]}
        multiline={multiline}
        editable={!disabled}
        testID={testID}
      />
      {loading ? (
        <ActivityIndicator
          size="small"
          color={COLORS.primary}
          style={styles.spinner}
        />
      ) : null}
      {showList && (
        <View style={styles.dropdown} testID={testID ? `${testID}-drop` : undefined}>
          <View style={styles.dropHead}>
            <Ionicons name="sparkles-outline" size={12} color={COLORS.primary} />
            <Text style={styles.dropHeadText}>
              {value.trim() ? 'Matches' : 'Frequently used'}
            </Text>
            <TouchableOpacity
              onPress={() => { setDismissed(true); setItems([]); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginLeft: 'auto' }}
            >
              <Ionicons name="close" size={14} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          {items.map((s) => (
            <TouchableOpacity
              key={s.value}
              onPress={() => commit(s)}
              style={styles.dropRow}
              testID={testID ? `${testID}-sug-${s.value.slice(0, 20)}` : undefined}
            >
              <Text style={styles.dropText} numberOfLines={1}>{s.value}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{s.count}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    ...FONTS.body, color: COLORS.textPrimary, fontSize: 14,
    marginTop: 4,
  },
  spinner: {
    position: 'absolute',
    right: 10,
    top: 16,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  dropHead: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '0D',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  dropHeadText: { ...FONTS.label, color: COLORS.primary, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  dropRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  dropText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  countBadge: {
    minWidth: 24, paddingHorizontal: 6, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary + '18',
  },
  countText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
});
