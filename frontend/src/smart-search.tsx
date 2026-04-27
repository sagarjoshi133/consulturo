// Reusable debounced search bar with clear button. Pill-shaped, matches
// the ConsultUro visual language (soft shadow, subtle border, primary
// accent on focus). Emits debounced `onDebouncedChange` 250ms after the
// last keystroke so parent list filtering doesn't thrash on each key.

import React from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';

type Props = {
  placeholder?: string;
  onDebouncedChange: (text: string) => void;
  debounceMs?: number;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function SmartSearch({
  placeholder = 'Search…',
  onDebouncedChange,
  debounceMs = 250,
  autoFocus = false,
  style,
  testID,
}: Props) {
  const [text, setText] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onDebouncedChange(next.trim()), debounceMs);
  };

  const clear = () => {
    setText('');
    if (timer.current) clearTimeout(timer.current);
    onDebouncedChange('');
  };

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <View
      style={[
        styles.wrap,
        focused && { borderColor: COLORS.primary, shadowOpacity: 0.12 },
        style,
      ]}
    >
      <Ionicons name="search" size={18} color={focused ? COLORS.primary : COLORS.textSecondary} />
      <TextInput
        testID={testID}
        value={text}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {text.length > 0 && (
        <TouchableOpacity onPress={clear} hitSlop={10} style={styles.clearBtn} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#0B3142',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  input: {
    flex: 1,
    padding: 0,
    margin: 0,
    ...FONTS.body,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  clearBtn: { padding: 2 },
});
