// Cross-platform "Add to Calendar" helper for confirmed bookings.
//
// Strategy:
//   • Native (iOS/Android) — use expo-calendar to create a real event in
//     the user's default calendar (after requesting permission).
//   • Web — generate an .ics file and trigger a download; user can open
//     it to import into Google Calendar / Apple Calendar / Outlook.

import { Platform, Alert, Linking } from 'react-native';

export type BookingEvent = {
  booking_id: string;
  booking_date: string;   // 'YYYY-MM-DD'
  booking_time: string;   // 'HH:mm'
  patient_name?: string;
  mode?: string;          // 'in-person' | 'online'
  reason?: string;
};

const CLINIC_LOCATION = 'Sterling Hospitals, Race Course Road, Vadodara – 390007';
const DOCTOR = 'Dr. Sagar Joshi — Consultant Urologist';

// -------- helpers --------
function combine(dateStr: string, timeStr: string): Date {
  // Expect 'YYYY-MM-DD' and 'HH:mm'
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  const [hh, mm] = timeStr.split(':').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
}

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

function toIcsDate(d: Date) {
  // All-day UTC floating format: 20250704T103000
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function buildIcs(ev: BookingEvent): string {
  const start = combine(ev.booking_date, ev.booking_time);
  const end = new Date(start.getTime() + 30 * 60 * 1000); // 30-min slot
  const title = `Consultation with ${DOCTOR}`;
  const isOnline = ev.mode === 'online';
  const descr = [
    ev.patient_name ? `Patient: ${ev.patient_name}` : null,
    ev.reason ? `Reason: ${ev.reason}` : null,
    `Mode: ${isOnline ? 'Online (WhatsApp)' : 'In-person'}`,
    `Booking ID: ${ev.booking_id}`,
  ]
    .filter(Boolean)
    .join('\\n');

  const location = isOnline ? 'Online · WhatsApp' : CLINIC_LOCATION;
  const uid = `${ev.booking_id}@consulturo.app`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ConsultUro//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${descr}`,
    `LOCATION:${location}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Consultation in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Add the booking to the user's calendar.
 * Returns true on success (or user confirmation), false on failure/denial.
 */
export async function addBookingToCalendar(ev: BookingEvent): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      const ics = buildIcs(ev);
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ConsultUro-${ev.booking_id}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e: any) {
      alert(e?.message || 'Could not generate calendar file');
      return false;
    }
  }

  // Native: use expo-calendar
  let Calendar: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Calendar = require('expo-calendar');
  } catch {
    Alert.alert('Calendar unavailable', 'Calendar support is not available on this build.');
    return false;
  }

  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Allow Calendar access in settings to save this appointment.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }

    // Pick default calendar we can write into. Android often lists calendars
    // from Google account + local sources; we need the first one whose
    // accessLevel allows edits. If none exist we create a local fallback.
    const cals: any[] = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const isWritable = (c: any) =>
      c.allowsModifications !== false &&
      (c.accessLevel === undefined ||
        ['owner', 'editor', 'contributor'].includes(String(c.accessLevel).toLowerCase()));
    let defaultCal =
      cals.find((c: any) => c.source?.name === 'Default' && isWritable(c)) ||
      cals.find((c: any) => c.isPrimary && isWritable(c)) ||
      cals.find(isWritable);

    if (!defaultCal && Platform.OS === 'android') {
      // Last resort — create our own local calendar so we can save events.
      try {
        const localSrc =
          cals.find((c: any) => c.source?.name === 'Local' || c.source?.type === 'LOCAL')?.source ||
          (cals[0]?.source);
        const source = localSrc || { isLocalAccount: true, name: 'ConsultUro' };
        const newId = await Calendar.createCalendarAsync({
          title: 'ConsultUro',
          color: '#0E7C8B',
          entityType: Calendar.EntityTypes.EVENT,
          sourceId: (source as any).id,
          source,
          name: 'ConsultUro',
          ownerAccount: 'ConsultUro',
          accessLevel: Calendar.CalendarAccessLevel.OWNER,
        });
        defaultCal = { id: newId };
      } catch {
        /* swallow — handled below */
      }
    }

    if (!defaultCal) {
      Alert.alert(
        'No calendar available',
        'Please add a Google or other calendar account to your device and try again.'
      );
      return false;
    }

    const start = combine(ev.booking_date, ev.booking_time);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const isOnline = ev.mode === 'online';
    const title = `Consultation — Dr. Sagar Joshi`;
    const notes = [
      ev.patient_name ? `Patient: ${ev.patient_name}` : null,
      ev.reason ? `Reason: ${ev.reason}` : null,
      `Mode: ${isOnline ? 'Online (WhatsApp)' : 'In-person'}`,
      `Booking ID: ${ev.booking_id}`,
    ]
      .filter(Boolean)
      .join('\n');

    await Calendar.createEventAsync(defaultCal.id, {
      title,
      startDate: start,
      endDate: end,
      location: isOnline ? 'Online (WhatsApp)' : CLINIC_LOCATION,
      notes,
      alarms: [{ relativeOffset: -60 }], // 1 hr before
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    Alert.alert('Added to calendar', 'Your appointment has been saved with a 1-hour reminder.');
    return true;
  } catch (e: any) {
    Alert.alert('Could not save', e?.message || 'Please try again later.');
    return false;
  }
}
