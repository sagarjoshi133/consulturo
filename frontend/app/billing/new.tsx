/**
 * Billing — record a payment (Phase 3.8).
 *
 * - Patient lookup via phone (auto-prefills name/email/reg-no)
 * - Line items (description + service type + qty + amount)
 * - Optional GST (off by default)
 * - Optional discount
 * - Payment mode (Cash / UPI / Card / Cheque / Other)
 * - Mode-specific reference (UPI ref, cheque #, etc.)
 * - "Save & print" / "Save" actions
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { DateField } from '../../src/date-picker';
import { parseUIDate, displayDate } from '../../src/date';
import { shareReceiptPdf } from '../../src/receipt-pdf';
import { fetchClinicSettings, type ClinicSettings } from '../../src/clinic-settings';

type FeeTemplate = {
  id: string;
  category: string;
  name: string;
  amount_inr: number;
  gst_pct?: number;
  description?: string;
  archived?: boolean;
};

type Item = { description: string; service_type: string; qty: string; amount: string };
const SERVICE_TYPES = ['Consultation', 'Procedure', 'Investigation', 'Surgery', 'Medication', 'Other'];
// Manual offline modes shown as chips. Razorpay-backed modes (UPI/Card/
// Wallet) are entered via the "Charge via Razorpay" CTA which routes
// to the gateway and auto-fills the mode + payment_ref after success.
const MODES = ['Cash', 'UPI (Direct)', 'Cheque', 'Other'];

function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export default function RecordPayment() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{
    patient_phone?: string;
    patient_name?: string;
    booking_id?: string;
    amount?: string;
    description?: string;
    service_type?: string;
  }>();

  const [phone, setPhone] = useState(params.patient_phone || '');
  const [name, setName] = useState(params.patient_name || '');
  const [email, setEmail] = useState('');
  const [regNo, setRegNo] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [date, setDate] = useState(todayIST());
  // booking_id present when this screen was opened from a "Settle now"
  // CTA on a pending-payment booking. We use it to flip the booking's
  // payment_status to "paid" after the receipt is saved.
  const [sourceBookingId] = useState<string>(params.booking_id || '');

  // Default consultation fee from clinic settings — fills the very
  // first line item so the doctor doesn't have to type ₹800 every
  // time. Updated once clinic settings load.
  const [defaultConsultFee, setDefaultConsultFee] = useState<number>(0);

  const seededAmount = params.amount && Number(params.amount) > 0 ? String(params.amount) : '';
  const seededDescription = (params.description || '').trim();
  const seededServiceType = (params.service_type || '').trim();

  const [items, setItems] = useState<Item[]>([
    {
      description: seededDescription || 'Consultation',
      service_type: seededServiceType || 'Consultation',
      qty: '1',
      amount: seededAmount,
    },
  ]);
  // Fee templates pulled live from clinic_settings.fee_catalog so the
  // Billing screen stays in sync with whatever the owner configured in
  // Settings → Billing Settings (Dr. Joshi spec 2026-06-01).
  const [templates, setTemplates] = useState<FeeTemplate[]>([]);
  const [tplPickerOpen, setTplPickerOpen] = useState(false);
  const [tplFilterCategory, setTplFilterCategory] = useState<string>('all');
  const [discount, setDiscount] = useState('');
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstPct, setGstPct] = useState('18');

  const [mode, setMode] = useState('Cash');
  const [paymentRef, setPaymentRef] = useState('');
  const [paid, setPaid] = useState(''); // optional override
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string>('');

  // Patient phone lookup → prefill
  const lookupPatient = useCallback(async (p: string) => {
    const digits = (p || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return;
    setLookupBusy(true);
    try {
      const r = await api.get('/patients/lookup', { params: { phone: digits } });
      const d = r.data || {};
      if (d.name && !name) setName(d.name);
      if (d.email && !email) setEmail(d.email);
      if (d.reg_no && !regNo) setRegNo(d.reg_no);
    } catch {
      // No existing patient — fine
    } finally {
      setLookupBusy(false);
    }
  }, [name, email, regNo]);

  useEffect(() => {
    if (phone && phone.length >= 10) lookupPatient(phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // Load fee templates + default fees fresh from server on every
  // mount (bypass the 5-min cache) so the catalogue and Quick-default
  // consultation fee stay in lock-step with whatever the owner just
  // saved in Settings → Billing Settings.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cs = await fetchClinicSettings(true);
        const raw = (cs?.fee_catalog as any[]) || [];
        if (!alive) return;
        const live = raw.filter((t: any) => !t.archived).map((t: any) => ({
          id: t.id, category: t.category || 'misc', name: t.name || '',
          amount_inr: Number(t.amount_inr || 0), gst_pct: t.gst_pct || 0,
          description: t.description || '',
        }));
        setTemplates(live);
        const defaultFee = Number(cs?.consultation_fee_inr || 0);
        setDefaultConsultFee(defaultFee);
        const defaultGstPct = Number(cs?.billing_gst_pct_default || 0);
        if (defaultGstPct > 0) {
          setGstPct(String(defaultGstPct));
        }
        // Seed the very first line item's amount with the saved
        // consultation default — but ONLY if nothing was passed in
        // via URL params and the user hasn't typed anything yet.
        if (!seededAmount && defaultFee > 0) {
          setItems((prev) => {
            if (prev.length !== 1) return prev;
            const it = prev[0];
            if (it.amount) return prev; // user already typed
            if ((it.description || '') !== 'Consultation') return prev;
            return [{ ...it, amount: String(defaultFee) }];
          });
        }
      } catch {
        // Non-fatal — billing still works with manual entry.
      }
    })();
    return () => { alive = false; };
  }, []);

  // Map fee_catalog category → our SERVICE_TYPES label.
  const mapCategoryToServiceType = (cat: string): string => {
    switch ((cat || '').toLowerCase()) {
      case 'consultation': return 'Consultation';
      case 'procedure': return 'Procedure';
      case 'investigation': return 'Investigation';
      case 'surgery': return 'Surgery';
      case 'medication': return 'Medication';
      default: return 'Other';
    }
  };

  const applyTemplate = (t: FeeTemplate, replaceIdx?: number) => {
    const newItem: Item = {
      description: t.name + (t.description ? ` — ${t.description}` : ''),
      service_type: mapCategoryToServiceType(t.category),
      qty: '1',
      amount: String(t.amount_inr || ''),
    };
    if (typeof replaceIdx === 'number') {
      setItems(prev => prev.map((it, idx) => idx === replaceIdx ? newItem : it));
    } else {
      // Replace the first row if it's still the empty default; else append.
      setItems(prev => {
        if (prev.length === 1 && !prev[0].amount && (prev[0].description === '' || prev[0].description === 'Consultation')) {
          return [newItem];
        }
        return [...prev, newItem];
      });
    }
    // GST inherits from template if not already on.
    if ((t.gst_pct || 0) > 0) {
      setGstEnabled(true);
      setGstPct(String(t.gst_pct));
    }
    setTplPickerOpen(false);
  };

  // Totals
  const computed = useMemo(() => {
    let subtotal = 0;
    items.forEach((it) => {
      const q = parseFloat(it.qty) || 0;
      const a = parseFloat(it.amount) || 0;
      subtotal += q * a;
    });
    const disc = parseFloat(discount) || 0;
    const afterDisc = Math.max(0, subtotal - disc);
    const gstPctNum = gstEnabled ? (parseFloat(gstPct) || 0) : 0;
    const gstAmount = gstEnabled ? (afterDisc * gstPctNum) / 100 : 0;
    const total = afterDisc + gstAmount;
    return {
      subtotal: Number(subtotal.toFixed(2)),
      discount: disc,
      gstAmount: Number(gstAmount.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }, [items, discount, gstEnabled, gstPct]);

  const paidNum = paid !== '' ? (parseFloat(paid) || 0) : computed.total;
  const balance = Math.max(0, computed.total - paidNum);

  const addItem = () => setItems((prev) => [...prev, { description: '', service_type: 'Other', qty: '1', amount: '' }]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof Item, value: string) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  };

  const canSave = phone.replace(/\D/g, '').length >= 10
    && name.trim().length > 0
    && items.every((it) => it.description.trim().length > 0 && parseFloat(it.amount) > 0)
    && computed.total > 0;

  const save = async (action: 'save' | 'print' | 'razorpay') => {
    setBusy(action);
    try {
      const payload: any = {
        patient_phone: phone,
        patient_name: name,
        patient_email: email || undefined,
        registration_no: regNo || undefined,
        items: items.map((it) => ({
          description: it.description,
          service_type: it.service_type,
          qty: parseFloat(it.qty) || 1,
          amount: parseFloat(it.amount) || 0,
        })),
        discount: parseFloat(discount) || 0,
        gst_enabled: gstEnabled,
        gst_pct: gstEnabled ? (parseFloat(gstPct) || 0) : 0,
        paid: action === 'razorpay' ? 0 : (paid !== '' ? (parseFloat(paid) || 0) : undefined),
        mode: action === 'razorpay' ? 'Pending Razorpay' : mode,
        payment_ref: paymentRef || undefined,
        notes: notes || undefined,
        receipt_date: date,
      };
      const r = await api.post('/receipts', payload);
      const receipt = r.data;
      toast.success(`Receipt ${receipt.receipt_no} saved`);

      // If we were launched from a pending-payment booking, flip the
      // booking's payment_status to 'paid' via the dedicated endpoint
      // so it no longer shows up in the Pending payments list.
      // (Skip when going via Razorpay — verify will mark it paid via
      // _mark_target_paid for the booking via target_kind=consultation.)
      if (sourceBookingId && action !== 'razorpay') {
        try {
          await api.post(`/bookings/${sourceBookingId}/mark-paid-offline`, {
            amount_inr: computed.total,
            mode: (mode || 'cash').toLowerCase(),
            notes: `Receipt ${receipt.receipt_no}${paymentRef ? ` · Ref ${paymentRef}` : ''}`,
          });
        } catch {
          // Non-fatal — receipt is saved; staff can settle manually.
        }
      }

      if (action === 'print') {
        try { await shareReceiptPdf(receipt); } catch (e: any) {
          // ignore — saved is the important thing
        }
      }

      if (action === 'razorpay') {
        // Route to the Razorpay checkout WebView. After successful
        // payment, /pay will call /api/payments/razorpay/verify which
        // auto-updates the receipt's mode/payment_ref/paid via the
        // _mark_target_paid backend helper.
        router.replace({
          pathname: '/pay',
          params: {
            amount_inr: String(computed.total),
            target_kind: 'receipt',
            target_id: receipt.receipt_id,
            description: `Receipt ${receipt.receipt_no} · ${name}`,
            returnTo: `/billing/${receipt.receipt_id}`,
          },
        } as any);
        return;
      }
      router.replace(`/billing/${receipt.receipt_id}` as any);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save receipt';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setBusy('');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>Record payment</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {/* Patient */}
          <View style={styles.card}>
            <Text style={styles.cardHdr}>Patient</Text>
            <Label>Mobile *</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="10-digit phone"
                placeholderTextColor={COLORS.textDisabled}
                maxLength={15}
                testID="bill-new-phone"
              />
              {lookupBusy ? <ActivityIndicator color={COLORS.primary} size="small" /> : null}
            </View>
            <Label>Name *</Label>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Patient name"
              placeholderTextColor={COLORS.textDisabled}
              testID="bill-new-name"
            />
            <Label>Email (optional)</Label>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="patient@example.com"
              placeholderTextColor={COLORS.textDisabled}
              testID="bill-new-email"
            />
            {!!regNo && (
              <View style={styles.regPill}>
                <Ionicons name="id-card-outline" size={12} color={COLORS.primary} />
                <Text style={styles.regPillText}>Reg. {regNo}</Text>
              </View>
            )}
          </View>

          {/* Date — capped at today so a receipt can't be issued for a
              future date (frequent user request). */}
          <View style={styles.card}>
            <Text style={styles.cardHdr}>Date</Text>
            <DateField
              value={displayDate(date)}
              onChange={(v) => {
                const iso = parseUIDate(v);
                if (!iso) return;
                const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
                if (iso > today) {
                  // Silently clamp + surface a friendly toast.
                  toast.error('Receipts cannot be dated in the future');
                  setDate(today);
                  return;
                }
                setDate(iso);
              }}
              maximumDate={new Date()}
            />
          </View>

          {/* Items */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.cardHdr, { flex: 1, marginBottom: 0 }]}>Line items</Text>
              {templates.length > 0 && (
                <TouchableOpacity
                  onPress={() => setTplPickerOpen(true)}
                  style={[styles.addItemBtn, { borderColor: '#16A34A', backgroundColor: '#16A34A0F', marginRight: 6 }]}
                  testID="bill-from-template"
                >
                  <Ionicons name="list" size={14} color="#16A34A" />
                  <Text style={[styles.addItemText, { color: '#16A34A' }]}>From template</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={addItem} style={styles.addItemBtn} testID="bill-add-item">
                <Ionicons name="add" size={14} color={COLORS.primary} />
                <Text style={styles.addItemText}>Add</Text>
              </TouchableOpacity>
            </View>
            {items.map((it, i) => (
              <View key={i} style={styles.itemCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={styles.itemIdx}>#{i + 1}</Text>
                  {items.length > 1 && (
                    <TouchableOpacity onPress={() => removeItem(i)} hitSlop={10} testID={`bill-rm-item-${i}`}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
                    </TouchableOpacity>
                  )}
                </View>
                <Label>Description *</Label>
                <TextInput
                  style={styles.input}
                  value={it.description}
                  onChangeText={(v) => updateItem(i, 'description', v)}
                  placeholder="e.g. URS for ureteric stone"
                  placeholderTextColor={COLORS.textDisabled}
                  testID={`bill-item-desc-${i}`}
                />
                <Label>Service type</Label>
                <View style={styles.chipRow}>
                  {SERVICE_TYPES.map((st) => (
                    <TouchableOpacity
                      key={st}
                      onPress={() => updateItem(i, 'service_type', st)}
                      style={[styles.chip, it.service_type === st && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, it.service_type === st && { color: '#fff' }]}>{st}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Label>Qty</Label>
                    <TextInput
                      style={styles.input}
                      value={it.qty}
                      onChangeText={(v) => updateItem(i, 'qty', v)}
                      keyboardType="decimal-pad"
                      placeholder="1"
                      placeholderTextColor={COLORS.textDisabled}
                      testID={`bill-item-qty-${i}`}
                    />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Label>Amount (₹) *</Label>
                    <TextInput
                      style={styles.input}
                      value={it.amount}
                      onChangeText={(v) => updateItem(i, 'amount', v)}
                      keyboardType="decimal-pad"
                      placeholder="500"
                      placeholderTextColor={COLORS.textDisabled}
                      testID={`bill-item-amt-${i}`}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* Discount + GST */}
          <View style={styles.card}>
            <Text style={styles.cardHdr}>Discount & tax</Text>
            <Label>Discount amount (₹)</Label>
            <TextInput
              style={styles.input}
              value={discount}
              onChangeText={setDiscount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textDisabled}
              testID="bill-discount"
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Add GST</Text>
              <Switch value={gstEnabled} onValueChange={setGstEnabled} testID="bill-gst-switch" />
            </View>
            {gstEnabled && (
              <>
                <Label>GST %</Label>
                <View style={styles.chipRow}>
                  {['5', '12', '18', '28'].map((g) => (
                    <TouchableOpacity
                      key={g}
                      onPress={() => setGstPct(g)}
                      style={[styles.chip, gstPct === g && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, gstPct === g && { color: '#fff' }]}>{g}%</Text>
                    </TouchableOpacity>
                  ))}
                  <TextInput
                    style={[styles.input, { flex: 1, marginTop: 0, minHeight: 32, paddingVertical: 6 }]}
                    value={gstPct}
                    onChangeText={setGstPct}
                    keyboardType="decimal-pad"
                    placeholder="18"
                    placeholderTextColor={COLORS.textDisabled}
                  />
                </View>
              </>
            )}
          </View>

          {/* Totals preview */}
          <View style={styles.totalsCard}>
            <Row k="Subtotal" v={`₹ ${computed.subtotal.toFixed(2)}`} />
            {computed.discount > 0 ? <Row k="Discount" v={`− ₹ ${computed.discount.toFixed(2)}`} /> : null}
            {gstEnabled && computed.gstAmount > 0 ? <Row k={`GST ${gstPct}%`} v={`₹ ${computed.gstAmount.toFixed(2)}`} /> : null}
            <View style={styles.totalDivider} />
            <Row k="Total" v={`₹ ${computed.total.toFixed(2)}`} big />
          </View>

          {/* Payment mode */}
          <View style={styles.card}>
            <Text style={styles.cardHdr}>Payment</Text>
            <Label>Mode *</Label>
            <View style={styles.chipRow}>
              {MODES.map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMode(m)}
                  style={[styles.chip, mode === m && styles.chipActive]}
                  testID={`bill-mode-${m}`}
                >
                  <Text style={[styles.chipText, mode === m && { color: '#fff' }]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {(mode === 'UPI' || mode === 'Card' || mode === 'Cheque') && (
              <>
                <Label>{mode === 'Cheque' ? 'Cheque number' : 'Reference'}</Label>
                <TextInput
                  style={styles.input}
                  value={paymentRef}
                  onChangeText={setPaymentRef}
                  placeholder={mode === 'Cheque' ? 'e.g. 123456' : 'Txn ID / last 4 digits'}
                  placeholderTextColor={COLORS.textDisabled}
                  testID="bill-payref"
                />
              </>
            )}
            <Label>Amount paid (defaults to total)</Label>
            <TextInput
              style={styles.input}
              value={paid}
              onChangeText={setPaid}
              keyboardType="decimal-pad"
              placeholder={`${computed.total.toFixed(2)}`}
              placeholderTextColor={COLORS.textDisabled}
              testID="bill-paid"
            />
            {balance > 0 && (
              <View style={styles.balanceCard}>
                <Ionicons name="warning" size={14} color={COLORS.warning} />
                <Text style={styles.balanceText}>Balance pending: ₹ {balance.toFixed(2)}</Text>
              </View>
            )}
            <Label>Notes (optional)</Label>
            <TextInput
              style={[styles.input, { minHeight: 60 }]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Any payment remarks"
              placeholderTextColor={COLORS.textDisabled}
              testID="bill-notes"
            />

            {/* Razorpay CTA — only meaningful when the form is valid.
                Creates the receipt first (mode=Pending Razorpay) so we
                have a target_id to hand to /pay; the verify endpoint
                then updates the mode/payment_ref/paid fields based on
                Razorpay's response (UPI / Card / Wallet). */}
            <View style={styles.razorpaySection}>
              <View style={styles.razorpayLabelRow}>
                <Ionicons name="card" size={14} color={COLORS.primary} />
                <Text style={styles.razorpayLabel}>Or take payment online</Text>
              </View>
              <Text style={styles.razorpayHelper}>
                Patient pays via UPI / Card / Wallet through Razorpay. Mode
                and reference are auto-filled on success.
              </Text>
              <TouchableOpacity
                onPress={() => save('razorpay')}
                disabled={!canSave || !!busy}
                style={[styles.razorpayBtn, (!canSave || !!busy) && styles.btnDisabled]}
                testID="bill-charge-razorpay"
              >
                {busy === 'razorpay' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name="flash" size={16} color="#fff" />
                )}
                <Text style={styles.razorpayBtnText}>
                  Charge ₹ {computed.total.toFixed(2)} via Razorpay
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* Footer actions */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => save('save')}
            disabled={!canSave || !!busy}
            style={[styles.secondaryBtn, (!canSave || !!busy) && styles.btnDisabled]}
            testID="bill-save"
          >
            {busy === 'save' ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="save-outline" size={16} color={COLORS.primary} />}
            <Text style={styles.secondaryText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => save('print')}
            disabled={!canSave || !!busy}
            style={[styles.primaryBtn, (!canSave || !!busy) && styles.btnDisabled]}
            testID="bill-save-print"
          >
            {busy === 'print' ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle" size={16} color="#fff" />}
            <Text style={styles.primaryText}>Record Payment</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Fee template picker ─────────────────────────────── */}
      <Modal
        visible={tplPickerOpen}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setTplPickerOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
          <View style={styles.tplBar}>
            <TouchableOpacity onPress={() => setTplPickerOpen(false)} style={styles.tplBackBtn}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.tplTitle}>Pick a fee template</Text>
            <View style={{ width: 40 }} />
          </View>
          {/* Category filter chips */}
          <View style={styles.tplFilterRow}>
            {['all', 'consultation', 'surgery', 'procedure', 'investigation', 'misc'].map((c) => {
              const count = c === 'all' ? templates.length : templates.filter(t => t.category === c).length;
              if (c !== 'all' && count === 0) return null;
              const active = tplFilterCategory === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setTplFilterCategory(c)}
                  style={[styles.tplChip, active && styles.tplChipActive]}
                  testID={`bill-tpl-cat-${c}`}
                >
                  <Text style={[styles.tplChipText, active && { color: '#fff' }]}>
                    {c.charAt(0).toUpperCase() + c.slice(1)} {c !== 'all' ? `(${count})` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            {(tplFilterCategory === 'all'
              ? templates
              : templates.filter(t => t.category === tplFilterCategory)
            ).map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => applyTemplate(t)}
                style={styles.tplCard}
                testID={`bill-tpl-${t.id}`}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplName}>{t.name}</Text>
                  {!!t.description && <Text style={styles.tplDesc}>{t.description}</Text>}
                  <Text style={styles.tplCat}>{t.category.toUpperCase()}{(t.gst_pct || 0) > 0 ? ` · GST ${t.gst_pct}%` : ''}</Text>
                </View>
                <Text style={styles.tplAmount}>{`Rs ${t.amount_inr.toLocaleString('en-IN')}`}</Text>
              </TouchableOpacity>
            ))}
            {templates.length === 0 && (
              <Text style={{ ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 30 }}>
                No fee templates configured yet. Owner can add them at Settings → Billing Settings.
              </Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}
function Row({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryK, big && { fontSize: 14, color: COLORS.textPrimary }]}>{k}</Text>
      <Text style={[styles.summaryV, big && { fontSize: 18, color: COLORS.primary, fontWeight: '700' }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },

  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  cardHdr: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginBottom: 8 },

  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 10, marginBottom: 4, fontSize: 11 },
  input: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 11, ...FONTS.body, color: COLORS.textPrimary, fontSize: 14 },

  regPill: { marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary + '12', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  regPillText: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },

  addItemBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: COLORS.primary + '0A' },
  addItemText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  // Fee template picker styles
  tplBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tplBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tplTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 15, flex: 1, textAlign: 'center' },
  tplFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tplChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  tplChipActive: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  tplChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.textPrimary },
  tplCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md,
    marginBottom: 8, borderWidth: 1, borderColor: COLORS.border,
  },
  tplName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  tplDesc: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  tplCat: { ...FONTS.body, color: '#16A34A', fontSize: 10, letterSpacing: 0.5, marginTop: 4 },
  tplAmount: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16, marginLeft: 12 },

  itemCard: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  itemIdx: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 11 },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingVertical: 6 },
  switchLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },

  totalsCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.primary },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryK: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  summaryV: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  totalDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 6 },

  balanceCard: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, padding: 8, backgroundColor: COLORS.warning + '14', borderRadius: RADIUS.md },
  balanceText: { ...FONTS.bodyMedium, color: COLORS.warning, fontSize: 12 },

  // Razorpay "charge online" section (Phase 5.10).
  razorpaySection: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#F0FDFA',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
    borderStyle: 'dashed',
  },
  razorpayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  razorpayLabel: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  razorpayHelper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, lineHeight: 15, marginBottom: 10 },
  razorpayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill,
  },
  razorpayBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  footer: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: '#fff' },
  primaryBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
  primaryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff' },
  secondaryText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
});
