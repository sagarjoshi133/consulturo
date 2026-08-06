/**
 * Bed Transfer modal. Self-contained — loads its own bed inventory
 * from /api/ipd/beds so the dropdown only shows AVAILABLE beds tied
 * to clinic_settings, then PATCHes via /api/ipd/admissions/.../transfer-bed.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api';
import { COLORS } from '../theme';
import { useToast } from '../toast';
import { ipdStyles as styles } from './styles';
import type { Bed, Admission } from './types';

const PRESET_REASONS = [
  'Hemodynamic instability',
  'Post-op recovery',
  'Room upgrade',
  'Patient request',
  'Isolation needed',
  'Step-down from ICU',
];

export default function TransferModal({
  visible, admission, admissionId, onClose, onTransferred,
}: {
  visible: boolean;
  admission: Admission;
  admissionId: string;
  onClose: () => void;
  onTransferred: () => Promise<void> | void;
}) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<Bed[]>([]);
  const [draft, setDraft] = useState<{ new_ward: string; new_bed_id: string; reason: string }>({
    new_ward: '', new_bed_id: '', reason: '',
  });

  useEffect(() => {
    if (!visible) return;
    setDraft({ new_ward: '', new_bed_id: '', reason: '' });
    setBedsLoading(true);
    (async () => {
      try {
        const r = await api.get('/ipd/beds');
        setAvailableBeds((r.data?.items || []) as Bed[]);
      } catch {
        setAvailableBeds([]);
      } finally {
        setBedsLoading(false);
      }
    })();
  }, [visible]);

  const free = availableBeds.filter((b) => b.status !== 'occupied' && b.id !== admission.bed_id);
  const grouped: Record<string, Bed[]> = {};
  free.forEach((b) => { (grouped[b.ward || 'General'] = grouped[b.ward || 'General'] || []).push(b); });

  const submit = async () => {
    if (!draft.new_bed_id || !draft.reason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/ipd/admissions/${admissionId}/transfer-bed`, {
        new_ward: draft.new_ward.trim(),
        new_bed_id: draft.new_bed_id.trim() || null,
        reason: draft.reason.trim() || null,
      });
      toast.success('Patient transferred.');
      onClose();
      await onTransferred();
    } catch (e: any) {
      Alert.alert('Transfer failed', e?.response?.data?.detail || 'Unknown');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.transferBackdrop}>
        <View style={[styles.transferCard, { paddingBottom: 24 + insets.bottom }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={[styles.actionIcon, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="swap-horizontal" size={18} color="#D97706" />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.transferTitle}>Transfer Bed / Ward</Text>
              <Text style={styles.transferSubtitle}>
                From <Text style={{ fontWeight: '700' }}>{admission.ward || 'General'}{admission.bed_id ? ` · ${admission.bed_id}` : ''}</Text>
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 4 }}>
            <Text style={styles.fieldLabel}>Select target bed (available only)</Text>
            {bedsLoading ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : free.length === 0 ? (
              <View style={styles.transferEmpty}>
                <Ionicons name="bed-outline" size={28} color={COLORS.textTertiary} />
                <Text style={styles.transferEmptyText}>
                  No free beds available in your bed inventory.{'\n'}
                  Configure beds under <Text style={{ fontWeight: '700' }}>Manage Beds</Text> first.
                </Text>
              </View>
            ) : (
              Object.keys(grouped).sort().map((ward) => (
                <View key={ward} style={{ marginTop: 10 }}>
                  <Text style={styles.transferWardHeading}>{ward} <Text style={{ color: COLORS.textTertiary, fontWeight: '500' }}>· {grouped[ward].length} free</Text></Text>
                  <View style={styles.transferBedGrid}>
                    {grouped[ward].map((b) => {
                      const selected = draft.new_bed_id === b.id;
                      return (
                        <TouchableOpacity
                          key={b.id}
                          onPress={() => setDraft({ ...draft, new_bed_id: b.id, new_ward: b.ward })}
                          style={[styles.transferBedTile, selected && styles.transferBedTileOn]}
                          activeOpacity={0.85}
                          testID={`ipd-transfer-bed-${b.id}`}
                        >
                          <MaterialCommunityIcons name="bed-empty" size={18} color={selected ? '#fff' : '#16a34a'} />
                          <Text style={[styles.transferBedNo, selected && { color: '#fff' }]}>{b.bed_no}</Text>
                          <Text style={[styles.transferBedWard, selected && { color: 'rgba(255,255,255,0.85)' }]}>{b.ward}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))
            )}

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Reason for transfer *</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
              {PRESET_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setDraft({ ...draft, reason: r })}
                  style={[styles.chip, draft.reason === r && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
                >
                  <Text style={[styles.chipText, draft.reason === r && { color: '#fff' }]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={draft.reason}
              onChangeText={(v) => setDraft({ ...draft, reason: v })}
              placeholder="Or type a custom reason — recorded in transfer history"
              placeholderTextColor={COLORS.textSecondary}
              multiline
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top', paddingTop: 8 }]}
            />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { opacity: !draft.new_bed_id || !draft.reason.trim() ? 0.5 : 1 },
              ]}
              disabled={!draft.new_bed_id || !draft.reason.trim() || busy}
              onPress={submit}
              testID="ipd-transfer-save"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle" size={16} color="#fff" />}
              <Text style={styles.primaryBtnText}>Confirm Transfer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
