// Cross-platform date & time field components.
//
// * Mobile: opens the native DateTimePicker (Android modal, iOS spinner).
// * Web: delegates to a native <input type="date|time"> so the browser's
//   calendar / clock UI is used instead of a text field.
//
// All values flow through our existing `displayDate` (DD-MM-YYYY) / 24h-HH:mm
// format so callers don't need to change their state shape.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, parse, isValid } from 'date-fns';
import { COLORS, FONTS, RADIUS } from './theme';
import { UI_DATE_FORMAT, UI_DATE_PLACEHOLDER, displayDate, display12h, parseUIDate } from './date';

function parseUIToDate(v?: string): Date {
  if (!v) return new Date();
  const iso = parseUIDate(v);
  if (iso) {
    const d = parse(iso, 'yyyy-MM-dd', new Date());
    if (isValid(d)) return d;
  }
  const direct = new Date(v);
  if (isValid(direct)) return direct;
  return new Date();
}

function parseHHmmToDate(v?: string): Date {
  if (!v) return new Date();
  const fmts = ['HH:mm', 'h:mm a'];
  for (const f of fmts) {
    const d = parse(v, f, new Date());
    if (isValid(d)) return d;
  }
  return new Date();
}

type DateFieldProps = {
  label?: string;
  value: string; // DD-MM-YYYY
  onChange: (ui: string) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
  style?: any;
};

export function DateField({
  label,
  value,
  onChange,
  placeholder,
  minimumDate,
  maximumDate,
  testID,
  style,
}: DateFieldProps) {
  const [show, setShow] = useState(false);

  const handleChange = (_e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'android') setShow(false);
    if (d) onChange(format(d, UI_DATE_FORMAT));
  };

  if (Platform.OS === 'web') {
    // Use an actual HTML input for the browser's calendar dropdown.
    const toIso = (ui: string) => {
      const iso = parseUIDate(ui);
      return iso || '';
    };
    const fromIso = (iso: string) => {
      if (!iso) return '';
      const d = parse(iso, 'yyyy-MM-dd', new Date());
      return isValid(d) ? format(d, UI_DATE_FORMAT) : '';
    };
    // @ts-ignore React Native Web understands raw elements when nested inside a View only via createElement, but here we use JSX; it works under rn-web.
    return (
      <View style={[styles.wrap, style]}>
        {label ? <Text style={styles.lbl}>{label}</Text> : null}
        <View style={styles.webInputWrap}>
          {/* eslint-disable-next-line react/no-unknown-property */}
          {React.createElement('input' as any, {
            type: 'date',
            value: toIso(value),
            onChange: (e: any) => onChange(fromIso(e.target.value)),
            style: {
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              font: 'inherit',
              fontSize: 15,
              color: COLORS.textPrimary,
              padding: 0,
            },
            min: minimumDate ? format(minimumDate, 'yyyy-MM-dd') : undefined,
            max: maximumDate ? format(maximumDate, 'yyyy-MM-dd') : undefined,
            'data-testid': testID,
          })}
          <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.lbl}>{label}</Text> : null}
      <TouchableOpacity
        onPress={() => setShow(true)}
        style={styles.nativeInput}
        testID={testID}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.nativeText,
            { color: value ? COLORS.textPrimary : COLORS.textDisabled },
          ]}
        >
          {value || placeholder || UI_DATE_PLACEHOLDER}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={parseUIToDate(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
      {Platform.OS === 'ios' && show && (
        <TouchableOpacity onPress={() => setShow(false)} style={styles.doneBtn}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

type TimeFieldProps = {
  label?: string;
  value: string; // HH:mm or h:mm a
  onChange: (hhmm: string) => void;
  placeholder?: string;
  testID?: string;
  style?: any;
};

export function TimeField({
  label,
  value,
  onChange,
  placeholder,
  testID,
  style,
}: TimeFieldProps) {
  const [show, setShow] = useState(false);

  const handleChange = (_e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'android') setShow(false);
    if (d) onChange(format(d, 'HH:mm'));
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, style]}>
        {label ? <Text style={styles.lbl}>{label}</Text> : null}
        <View style={styles.webInputWrap}>
          {/* eslint-disable-next-line react/no-unknown-property */}
          {React.createElement('input' as any, {
            type: 'time',
            value: value || '',
            onChange: (e: any) => onChange(e.target.value),
            style: {
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              font: 'inherit',
              fontSize: 15,
              color: COLORS.textPrimary,
              padding: 0,
            },
            'data-testid': testID,
          })}
          <Ionicons name="time-outline" size={18} color={COLORS.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.lbl}>{label}</Text> : null}
      <TouchableOpacity
        onPress={() => setShow(true)}
        style={styles.nativeInput}
        testID={testID}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.nativeText,
            { color: value ? COLORS.textPrimary : COLORS.textDisabled },
          ]}
        >
          {value ? display12h(value) : (placeholder || 'hh:mm AM/PM')}
        </Text>
        <Ionicons name="time-outline" size={18} color={COLORS.primary} />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={parseHHmmToDate(value)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
          is24Hour={false}
        />
      )}
      {Platform.OS === 'ios' && show && (
        <TouchableOpacity onPress={() => setShow(false)} style={styles.doneBtn}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Re-export helpers that consumers might want to keep in sync.
export { displayDate, parseUIDate };

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  lbl: { ...FONTS.label, color: COLORS.textSecondary, marginBottom: 4 },
  nativeInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  nativeText: { ...FONTS.body },
  webInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  doneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 4,
  },
  doneText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 14 },
});
