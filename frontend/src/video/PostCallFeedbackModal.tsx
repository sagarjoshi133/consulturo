/*
 * PostCallFeedbackModal — shown to the patient right after they
 * leave the video call. 1-tap 5-star rating + optional comment.
 * Dismissible (skip = no submission).
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';

type Props = {
  visible: boolean;
  bookingId: string;
  onClose: () => void;
};

export default function PostCallFeedbackModal({ visible, bookingId, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await api.post(`/video/bookings/${bookingId}/feedback`, {
        rating,
        comment: comment.trim() || null,
      });
      setDone(true);
      // Auto-close after a brief success state
      setTimeout(() => {
        setDone(false); setRating(0); setComment('');
        onClose();
      }, 1300);
    } catch {
      // Even on failure, close gracefully — feedback is non-blocking.
      onClose();
    } finally { setSubmitting(false); }
  }, [bookingId, rating, comment, onClose]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable style={styles.backdropPress} onPress={onClose} />
        <View style={styles.card}>
          {done ? (
            <View style={styles.doneWrap}>
              <View style={styles.doneIcon}>
                <Ionicons name="checkmark" size={28} color="#fff" />
              </View>
              <Text style={styles.doneTitle}>Thank you!</Text>
              <Text style={styles.doneSub}>Your feedback helps us improve.</Text>
            </View>
          ) : (
            <>
              <View style={styles.headRow}>
                <Text style={styles.title}>How was your consultation?</Text>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Ionicons name="close" size={20} color="#8FA4A8" />
                </TouchableOpacity>
              </View>
              <Text style={styles.subtitle}>
                Tap to rate. Your honest feedback is anonymous to other patients.
              </Text>

              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setRating(n)}
                    hitSlop={6}
                    testID={`feedback-star-${n}`}
                  >
                    <Ionicons
                      name={n <= rating ? 'star' : 'star-outline'}
                      size={36}
                      color={n <= rating ? '#F5B400' : '#C4D2D6'}
                      style={{ marginHorizontal: 4 }}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              {rating > 0 ? (
                <Text style={styles.ratingLabel}>{LABELS[rating - 1]}</Text>
              ) : null}

              <TextInput
                style={styles.input}
                placeholder="Add a comment (optional)…"
                placeholderTextColor="#9AAFB3"
                value={comment}
                onChangeText={setComment}
                multiline
                maxLength={1000}
              />

              <TouchableOpacity
                style={[styles.submitBtn, !rating && styles.submitDisabled]}
                onPress={submit}
                disabled={!rating || submitting}
                testID="feedback-submit"
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Submit feedback</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.skipBtn} testID="feedback-skip">
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const LABELS = ['Poor', 'Below average', 'Average', 'Good', 'Excellent'];

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  backdropPress: { ...StyleSheet.absoluteFillObject },
  card: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 22,
    borderWidth: 1, borderColor: '#E2ECEC',
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { ...FONTS.h3, color: COLORS.primaryDark, fontSize: 17, flex: 1, paddingRight: 12 },
  subtitle: { color: '#5E7C81', fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 22 },
  ratingLabel: { textAlign: 'center', color: COLORS.primaryDark, fontWeight: '700', fontSize: 13, marginBottom: 12 },
  input: {
    backgroundColor: '#F4F9F9', borderRadius: RADIUS.md, padding: 12,
    minHeight: 68, textAlignVertical: 'top', fontSize: 13.5, color: COLORS.textPrimary,
    borderWidth: 1, borderColor: '#DDEAEE',
  },
  submitBtn: {
    marginTop: 14, paddingVertical: 14, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary, alignItems: 'center',
  },
  submitDisabled: { backgroundColor: '#A8C7CC' },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipBtn: { marginTop: 8, paddingVertical: 10, alignItems: 'center' },
  skipText: { color: COLORS.textSecondary, fontSize: 13 },

  doneWrap: { alignItems: 'center', paddingVertical: 12 },
  doneIcon: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  doneTitle: { ...FONTS.h3, color: COLORS.primaryDark, fontSize: 18 },
  doneSub: { color: '#5E7C81', fontSize: 13, marginTop: 4 },
});
