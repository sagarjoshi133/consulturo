/**
 * GoogleReviewBanner — Patient-side dismissable card that appears on
 * /my-records when the clinic has scheduled a review nudge for the
 * current user (booking_completed / rx_final / discharge / manual).
 *
 * Behaviour
 *   • Calls GET /api/review-requests/me/pending — returns null when
 *     nothing is owed, otherwise the active row.
 *   • Renders a teal/yellow "Loved your visit? Leave a Google review"
 *     card with two CTAs: "Leave review ⭐" → opens review_url in the
 *     browser AND fires POST /review-requests/:id/ack so the banner
 *     vanishes; "Maybe later" → just acks without opening.
 *   • Once acked, never re-renders for the same row.
 *
 * Fully self-contained — drop into any patient screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';

type Pending = {
  pending: boolean;
  request_id?: string;
  review_url?: string;
  message?: string;
  trigger?: string;
  sent_at?: string | null;
};

export default function GoogleReviewBanner() {
  const [data, setData] = useState<Pending | null>(null);
  const [hidden, setHidden] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/review-requests/me/pending');
      setData(r.data || null);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ack = useCallback(async () => {
    if (!data?.request_id) return;
    try {
      await api.post(`/review-requests/${data.request_id}/ack`);
    } catch {
      /* best-effort */
    }
    setHidden(true);
  }, [data?.request_id]);

  const openReview = useCallback(async () => {
    if (!data?.review_url) return;
    try { await Linking.openURL(data.review_url); } catch {}
    await ack();
  }, [data?.review_url, ack]);

  if (hidden || !data?.pending || !data?.review_url) return null;

  return (
    <View style={styles.card} testID="review-banner">
      <View style={styles.iconWrap}>
        <Ionicons name="star" size={22} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Loved your visit?</Text>
        <Text style={styles.sub}>
          A quick Google review takes 30 seconds and means the world to a small clinic. 🙏
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryBtn} onPress={openReview} testID="review-banner-leave">
            <Ionicons name="open-outline" size={14} color="#fff" />
            <Text style={styles.primaryBtnText}>Leave a review</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={ack} testID="review-banner-later">
            <Text style={styles.secondaryBtnText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity
        style={styles.closeBtn}
        onPress={ack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        testID="review-banner-dismiss"
      >
        <Ionicons name="close" size={16} color="#9a3412" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    padding: 14,
    backgroundColor: '#fff7ed',
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: '#fdba74',
    marginBottom: 12,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#f97316',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...FONTS.h3, color: '#9a3412', fontSize: 15 },
  sub: { ...FONTS.body, color: '#9a3412', marginTop: 4, fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  primaryBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: '#f97316', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  secondaryBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  secondaryBtnText: { color: '#9a3412', fontSize: 12.5, fontWeight: '600' },
  closeBtn: { padding: 4 },
});
