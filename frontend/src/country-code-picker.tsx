/**
 * Country code (calling code) picker for phone-number inputs.
 *
 * - Defaults to India (+91).
 * - Compact pill on the left showing flag + dial code, opens a modal
 *   with a searchable list of ~70 commonly-used countries.
 * - Composes with any TextInput by emitting (dialCode, isoCode) as
 *   the parent maintains the local digits separately. This avoids
 *   round-trip parsing edge-cases.
 *
 * Stored format: when submitting to the backend, parents should send
 * `${dialCode}${digits}` e.g. "+919988887777" — E.164 friendly.
 */
import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';

export type Country = {
  iso: string;       // ISO-3166 alpha-2
  name: string;
  dial: string;      // calling code without leading '+'
  flag: string;      // emoji flag
};

// Curated list of ~70 most-relevant countries (India first, then alphabetical).
// Hand-curated to avoid bundling a 250-country dataset that bloats the JS bundle.
export const COUNTRIES: Country[] = [
  { iso: 'IN', name: 'India',                 dial: '91',  flag: '🇮🇳' },
  { iso: 'AE', name: 'United Arab Emirates',  dial: '971', flag: '🇦🇪' },
  { iso: 'AF', name: 'Afghanistan',           dial: '93',  flag: '🇦🇫' },
  { iso: 'AR', name: 'Argentina',             dial: '54',  flag: '🇦🇷' },
  { iso: 'AT', name: 'Austria',               dial: '43',  flag: '🇦🇹' },
  { iso: 'AU', name: 'Australia',             dial: '61',  flag: '🇦🇺' },
  { iso: 'BD', name: 'Bangladesh',            dial: '880', flag: '🇧🇩' },
  { iso: 'BE', name: 'Belgium',               dial: '32',  flag: '🇧🇪' },
  { iso: 'BH', name: 'Bahrain',               dial: '973', flag: '🇧🇭' },
  { iso: 'BR', name: 'Brazil',                dial: '55',  flag: '🇧🇷' },
  { iso: 'CA', name: 'Canada',                dial: '1',   flag: '🇨🇦' },
  { iso: 'CH', name: 'Switzerland',           dial: '41',  flag: '🇨🇭' },
  { iso: 'CN', name: 'China',                 dial: '86',  flag: '🇨🇳' },
  { iso: 'CZ', name: 'Czech Republic',        dial: '420', flag: '🇨🇿' },
  { iso: 'DE', name: 'Germany',               dial: '49',  flag: '🇩🇪' },
  { iso: 'DK', name: 'Denmark',               dial: '45',  flag: '🇩🇰' },
  { iso: 'EG', name: 'Egypt',                 dial: '20',  flag: '🇪🇬' },
  { iso: 'ES', name: 'Spain',                 dial: '34',  flag: '🇪🇸' },
  { iso: 'FI', name: 'Finland',               dial: '358', flag: '🇫🇮' },
  { iso: 'FR', name: 'France',                dial: '33',  flag: '🇫🇷' },
  { iso: 'GB', name: 'United Kingdom',        dial: '44',  flag: '🇬🇧' },
  { iso: 'GR', name: 'Greece',                dial: '30',  flag: '🇬🇷' },
  { iso: 'HK', name: 'Hong Kong',             dial: '852', flag: '🇭🇰' },
  { iso: 'HU', name: 'Hungary',               dial: '36',  flag: '🇭🇺' },
  { iso: 'ID', name: 'Indonesia',             dial: '62',  flag: '🇮🇩' },
  { iso: 'IE', name: 'Ireland',               dial: '353', flag: '🇮🇪' },
  { iso: 'IL', name: 'Israel',                dial: '972', flag: '🇮🇱' },
  { iso: 'IQ', name: 'Iraq',                  dial: '964', flag: '🇮🇶' },
  { iso: 'IR', name: 'Iran',                  dial: '98',  flag: '🇮🇷' },
  { iso: 'IT', name: 'Italy',                 dial: '39',  flag: '🇮🇹' },
  { iso: 'JO', name: 'Jordan',                dial: '962', flag: '🇯🇴' },
  { iso: 'JP', name: 'Japan',                 dial: '81',  flag: '🇯🇵' },
  { iso: 'KE', name: 'Kenya',                 dial: '254', flag: '🇰🇪' },
  { iso: 'KH', name: 'Cambodia',              dial: '855', flag: '🇰🇭' },
  { iso: 'KR', name: 'South Korea',           dial: '82',  flag: '🇰🇷' },
  { iso: 'KW', name: 'Kuwait',                dial: '965', flag: '🇰🇼' },
  { iso: 'LK', name: 'Sri Lanka',             dial: '94',  flag: '🇱🇰' },
  { iso: 'MM', name: 'Myanmar',               dial: '95',  flag: '🇲🇲' },
  { iso: 'MV', name: 'Maldives',              dial: '960', flag: '🇲🇻' },
  { iso: 'MX', name: 'Mexico',                dial: '52',  flag: '🇲🇽' },
  { iso: 'MY', name: 'Malaysia',              dial: '60',  flag: '🇲🇾' },
  { iso: 'NG', name: 'Nigeria',               dial: '234', flag: '🇳🇬' },
  { iso: 'NL', name: 'Netherlands',           dial: '31',  flag: '🇳🇱' },
  { iso: 'NO', name: 'Norway',                dial: '47',  flag: '🇳🇴' },
  { iso: 'NP', name: 'Nepal',                 dial: '977', flag: '🇳🇵' },
  { iso: 'NZ', name: 'New Zealand',           dial: '64',  flag: '🇳🇿' },
  { iso: 'OM', name: 'Oman',                  dial: '968', flag: '🇴🇲' },
  { iso: 'PH', name: 'Philippines',           dial: '63',  flag: '🇵🇭' },
  { iso: 'PK', name: 'Pakistan',              dial: '92',  flag: '🇵🇰' },
  { iso: 'PL', name: 'Poland',                dial: '48',  flag: '🇵🇱' },
  { iso: 'PT', name: 'Portugal',              dial: '351', flag: '🇵🇹' },
  { iso: 'QA', name: 'Qatar',                 dial: '974', flag: '🇶🇦' },
  { iso: 'RO', name: 'Romania',               dial: '40',  flag: '🇷🇴' },
  { iso: 'RU', name: 'Russia',                dial: '7',   flag: '🇷🇺' },
  { iso: 'SA', name: 'Saudi Arabia',          dial: '966', flag: '🇸🇦' },
  { iso: 'SE', name: 'Sweden',                dial: '46',  flag: '🇸🇪' },
  { iso: 'SG', name: 'Singapore',             dial: '65',  flag: '🇸🇬' },
  { iso: 'TH', name: 'Thailand',              dial: '66',  flag: '🇹🇭' },
  { iso: 'TR', name: 'Turkey',                dial: '90',  flag: '🇹🇷' },
  { iso: 'TW', name: 'Taiwan',                dial: '886', flag: '🇹🇼' },
  { iso: 'TZ', name: 'Tanzania',              dial: '255', flag: '🇹🇿' },
  { iso: 'UG', name: 'Uganda',                dial: '256', flag: '🇺🇬' },
  { iso: 'US', name: 'United States',         dial: '1',   flag: '🇺🇸' },
  { iso: 'VN', name: 'Vietnam',               dial: '84',  flag: '🇻🇳' },
  { iso: 'YE', name: 'Yemen',                 dial: '967', flag: '🇾🇪' },
  { iso: 'ZA', name: 'South Africa',          dial: '27',  flag: '🇿🇦' },
];

export const DEFAULT_COUNTRY: Country = COUNTRIES[0]; // India

export function findCountryByIso(iso: string): Country | undefined {
  return COUNTRIES.find((c) => c.iso === iso);
}

export function findCountryByDial(dial: string): Country | undefined {
  const clean = dial.replace(/\D/g, '');
  return COUNTRIES.find((c) => c.dial === clean);
}

type Props = {
  value: Country;
  onChange: (c: Country) => void;
  disabled?: boolean;
  testID?: string;
};

export function CountryCodePicker({ value, onChange, disabled, testID }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase().includes(q) ||
        c.dial.includes(q.replace(/\D/g, ''))
    );
  }, [query]);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.pill, disabled && { opacity: 0.5 }]}
        testID={testID || 'country-code-picker'}
      >
        <Text style={styles.flag}>{value.flag}</Text>
        <Text style={styles.dial}>+{value.dial}</Text>
        <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Select country</Text>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={COLORS.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search country or code"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(it) => it.iso}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            ListEmptyComponent={
              <Text style={{ ...FONTS.body, color: COLORS.textSecondary, padding: 20, textAlign: 'center' }}>
                No country found
              </Text>
            }
            renderItem={({ item }) => {
              const active = item.iso === value.iso;
              return (
                <TouchableOpacity
                  style={[styles.row, active && { backgroundColor: COLORS.primary + '12' }]}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <Text style={styles.rowFlag}>{item.flag}</Text>
                  <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rowDial}>+{item.dial}</Text>
                  {active && <Ionicons name="checkmark" size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
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
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  flag: { fontSize: 18 },
  dial: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginBottom: 10, fontSize: 17 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    margin: 0,
    ...FONTS.body,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  rowFlag: { fontSize: 22 },
  rowName: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  rowDial: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 13, marginRight: 6 },
});
