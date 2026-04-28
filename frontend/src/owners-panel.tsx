/**
 * Owners & Partners Management Panel
 *
 * Surfaces three role-management UIs on a single screen:
 *
 *  1. **Primary Owners** (visible to super_owner ONLY)
 *     Add / list / demote primary owners. Used by the platform admin
 *     to install or remove senior clinic owners.
 *
 *  2. **Partners** (visible to primary_owner + super_owner)
 *     Add / list / demote partners. Partners get full admin & clinical
 *     powers except for managing other partners or primary owners.
 *
 *  3. **Audit Trail** (visible to owner-tier — informational)
 *     Recent role-change actions so the team can see who promoted whom
 *     and when. (Reads from /api/audit-log if available; gracefully
 *     hides if the endpoint isn't implemented yet.)
 *
 * Mounted inside the existing Permission Manager screen as a top
 * section so all admin role mgmt lives in one place.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { useTier, roleLabel, roleEmoji } from './tier';

type Person = {
  user_id?: string;
  email?: string;
  name?: string;
  role?: string;
  picture?: string;
  can_create_blog?: boolean;
  dashboard_full_access?: boolean;
};

export default function OwnersPanel() {
  const tier = useTier();
  const [partners, setPartners] = useState<Person[]>([]);
  const [primaryOwners, setPrimaryOwners] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [demos, setDemos] = useState<Person[]>([]);
  const [demoEmail, setDemoEmail] = useState('');
  const [demoName, setDemoName] = useState('');
  const [demoRole, setDemoRole] = useState<'primary_owner' | 'patient'>('primary_owner');
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    if (!tier.isOwnerTier) return;
    setLoading(true);
    try {
      const [pa, po, dm] = await Promise.all([
        api.get('/admin/partners').catch(() => ({ data: { items: [] } })),
        api.get('/admin/primary-owners').catch(() => ({ data: { items: [] } })),
        tier.isSuperOwner
          ? api.get('/admin/demo').catch(() => ({ data: { items: [] } }))
          : Promise.resolve({ data: { items: [] } }),
      ]);
      setPartners(Array.isArray(pa.data?.items) ? pa.data.items : []);
      setPrimaryOwners(Array.isArray(po.data?.items) ? po.data.items : []);
      setDemos(Array.isArray((dm as any).data?.items) ? (dm as any).data.items : []);
    } finally {
      setLoading(false);
    }
  }, [tier.isOwnerTier, tier.isSuperOwner]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const promotePartner = async () => {
    const email = partnerEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      alertX('Invalid email', 'Please enter a valid email address.');
      return;
    }
    confirmX(
      'Promote to Partner?',
      `${email} will be granted Partner-level access — they will have admin and clinical powers equal to a Primary Owner, except for managing partners themselves.`,
      async () => {
        setBusy(true);
        try {
          await api.post('/admin/partners/promote', { email });
          setPartnerEmail('');
          await loadAll();
          alertX('Done', `${email} is now a Partner.`);
        } catch (e: any) {
          alertX('Failed', e?.response?.data?.detail || 'Could not promote partner');
        } finally {
          setBusy(false);
        }
      },
    );
  };

  const demotePartner = (p: Person) => {
    // For pending invites (not signed in yet) we revoke by email.
    const id = p.user_id || (p.email ? `pending:${p.email.toLowerCase()}` : null);
    if (!id) return;
    const isPending = !p.user_id;
    confirmX(
      isPending ? 'Revoke Partner Invite?' : 'Demote Partner?',
      isPending
        ? `${p.email} will be removed from your Partner list. They will not become a Partner if they sign in later.`
        : `${p.name || p.email} will be demoted from Partner to a regular Doctor role. They will lose admin powers immediately.`,
      async () => {
        setBusy(true);
        try {
          await api.delete(`/admin/partners/${encodeURIComponent(id)}`);
          await loadAll();
        } catch (e: any) {
          alertX('Failed', e?.response?.data?.detail || 'Could not demote partner');
        } finally {
          setBusy(false);
        }
      },
      true, // destructive
    );
  };

  const promotePrimary = async () => {
    const email = primaryEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      alertX('Invalid email', 'Please enter a valid email address.');
      return;
    }
    confirmX(
      'Promote to Primary Owner?',
      `${email} will be granted Primary-Owner-level access — including the ability to add/remove Partners. Only the Super Owner can revoke this.`,
      async () => {
        setBusy(true);
        try {
          await api.post('/admin/primary-owners/promote', { email });
          setPrimaryEmail('');
          await loadAll();
          alertX('Done', `${email} is now a Primary Owner.`);
        } catch (e: any) {
          alertX('Failed', e?.response?.data?.detail || 'Could not promote primary owner');
        } finally {
          setBusy(false);
        }
      },
    );
  };

  const deletePrimary = (p: Person) => {
    if (!p.user_id) return;
    if (p.role === 'super_owner') {
      alertX('Not allowed', 'The Super Owner cannot be removed from this screen.');
      return;
    }
    confirmX(
      'Delete Primary Owner?',
      `${p.name || p.email} will be removed as a Primary Owner of the platform. Their clinical workflow inside the clinic is unaffected — internal team demotions/promotions are managed by the clinic itself.`,
      async () => {
        setBusy(true);
        try {
          await api.delete(`/admin/primary-owners/${p.user_id}`);
          await loadAll();
        } catch (e: any) {
          alertX('Failed', e?.response?.data?.detail || 'Could not delete primary owner');
        } finally {
          setBusy(false);
        }
      },
      true,
    );
  };

  if (!tier.isOwnerTier) return null;

  return (
    <View style={styles.root}>
      {/* ── PRIMARY OWNERS — super_owner only edits, owner-tier can view ── */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
          <Text style={styles.sectionTitle}>Primary Owners</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{primaryOwners.length}</Text>
          </View>
        </View>
        <Text style={styles.sectionSub}>
          {tier.canManagePrimaryOwners
            ? 'Add or remove Primary Owners. Primary Owners run the practice and can manage Partners + staff.'
            : 'Only the Super Owner can promote or demote Primary Owners.'}
        </Text>

        {tier.canManagePrimaryOwners && (
          <View style={styles.addRow}>
            <TextInput
              value={primaryEmail}
              onChangeText={setPrimaryEmail}
              placeholder="email@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              testID="promote-primary-input"
            />
            <TouchableOpacity
              onPress={promotePrimary}
              style={[styles.addBtn, busy && { opacity: 0.5 }]}
              disabled={busy}
              testID="promote-primary-btn"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Promote</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
        ) : primaryOwners.length === 0 ? (
          <Text style={styles.empty}>No Primary Owners yet.</Text>
        ) : (
          primaryOwners.map((p) => (
            <PersonRow
              key={p.user_id || p.email}
              p={p}
              actionLabel={tier.canManagePrimaryOwners && p.role !== 'super_owner' ? 'Delete' : undefined}
              onAction={() => deletePrimary(p)}
              dashboardToggle={
                tier.isSuperOwner
                  ? {
                      value: p.role === 'super_owner' ? true : (p.dashboard_full_access !== false),
                      disabled: p.role === 'super_owner',
                      onChange: async (v: boolean) => {
                        if (!p.user_id || p.role === 'super_owner') return;
                        setBusy(true);
                        try {
                          await api.patch(`/admin/primary-owners/${p.user_id}/dashboard-perm`, { dashboard_full_access: v });
                          await loadAll();
                        } catch (e: any) {
                          alertX('Failed', e?.response?.data?.detail || 'Could not update dashboard access');
                        } finally { setBusy(false); }
                      },
                    }
                  : undefined
              }
              blogToggle={
                tier.isSuperOwner
                  ? {
                      value: !!p.can_create_blog || p.role === 'super_owner',
                      disabled: p.role === 'super_owner',
                      onChange: async (v: boolean) => {
                        if (!p.user_id || p.role === 'super_owner') return;
                        setBusy(true);
                        try {
                          await api.patch(`/admin/primary-owners/${p.user_id}/blog-perm`, { can_create_blog: v });
                          await loadAll();
                        } catch (e: any) {
                          alertX('Failed', e?.response?.data?.detail || 'Could not update blog access');
                        } finally { setBusy(false); }
                      },
                    }
                  : undefined
              }
            />
          ))
        )}
      </View>

      {/* ── PARTNERS — primary_owner+ can manage ── */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="star" size={18} color={COLORS.accent} />
          <Text style={styles.sectionTitle}>Partners</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{partners.length}</Text>
          </View>
        </View>
        <Text style={styles.sectionSub}>
          {tier.canManagePartners
            ? 'Promote senior staff to Partner. Partners have admin and clinical powers equal to a Primary Owner, except they cannot manage Partners themselves.'
            : 'Primary Owners and the Super Owner can promote / demote Partners.'}
        </Text>

        {tier.canManagePartners && (
          <View style={styles.addRow}>
            <TextInput
              value={partnerEmail}
              onChangeText={setPartnerEmail}
              placeholder="email@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={promotePartner}
              blurOnSubmit={false}
              style={styles.input}
              testID="promote-partner-input"
            />
            <TouchableOpacity
              onPress={promotePartner}
              style={[styles.addBtn, { backgroundColor: COLORS.accent }, busy && { opacity: 0.5 }]}
              disabled={busy}
              testID="promote-partner-btn"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Promote</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
        ) : partners.length === 0 ? (
          <Text style={styles.empty}>No Partners yet.</Text>
        ) : (
          partners.map((p) => {
            const isPending = !p.user_id;
            return (
              <PersonRow
                key={p.user_id || p.email}
                p={{ ...p, name: p.name ? `${p.name}${isPending ? ' (pending sign-in)' : ''}` : p.email }}
                actionLabel={tier.canManagePartners ? (isPending ? 'Revoke' : 'Demote') : undefined}
                onAction={() => demotePartner(p)}
              />
            );
          })
        )}
      </View>

      {/* ── DEMO ACCOUNTS — super_owner only ── */}
      {tier.isSuperOwner && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Ionicons name="film" size={18} color="#D97706" />
            <Text style={styles.sectionTitle}>Demo Accounts</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{demos.length}</Text>
            </View>
          </View>
          <Text style={styles.sectionSub}>
            Read-only accounts for sales / onboarding demos. The user can browse the entire app but every write is blocked. Choose <Text style={{ fontWeight: '700' }}>Primary Owner</Text> for staff-side demos or <Text style={{ fontWeight: '700' }}>Patient</Text> to showcase the patient experience (auto-seeded with sample bookings, Rx & IPSS).
          </Text>

          {/* Role chips */}
          <View style={[styles.addRow, { marginBottom: 6 }]}>
            {(['primary_owner', 'patient'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setDemoRole(r)}
                style={[
                  styles.roleChip,
                  demoRole === r && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                ]}
              >
                <Ionicons
                  name={r === 'primary_owner' ? 'shield' : 'person'}
                  size={13}
                  color={demoRole === r ? '#fff' : COLORS.primary}
                />
                <Text style={[styles.roleChipText, demoRole === r && { color: '#fff' }]}>
                  {r === 'primary_owner' ? 'Primary Owner' : 'Patient (with sample data)'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.addRow}>
            <TextInput
              value={demoEmail}
              onChangeText={setDemoEmail}
              placeholder="demo-email@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
          </View>
          <View style={styles.addRow}>
            <TextInput
              value={demoName}
              onChangeText={setDemoName}
              placeholder="Display name (optional)"
              style={styles.input}
            />
            <TouchableOpacity
              onPress={async () => {
                const email = demoEmail.trim().toLowerCase();
                if (!email || !email.includes('@')) { alertX('Invalid email'); return; }
                setBusy(true);
                try {
                  await api.post('/admin/demo/create', {
                    email,
                    name: demoName.trim() || undefined,
                    role: demoRole,
                    seed_sample_data: true,
                  });
                  setDemoEmail(''); setDemoName('');
                  await loadAll();
                  alertX(
                    'Demo created',
                    demoRole === 'patient'
                      ? `${email} is now a read-only Patient with sample bookings, prescription & IPSS.`
                      : `${email} is now a read-only Primary Owner.`
                  );
                } catch (e: any) {
                  alertX('Failed', e?.response?.data?.detail || 'Could not create demo');
                } finally { setBusy(false); }
              }}
              style={[styles.addBtn, { backgroundColor: '#D97706' }, busy && { opacity: 0.5 }]}
              disabled={busy}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Create Demo</Text>
            </TouchableOpacity>
          </View>
          {demos.length === 0 ? (
            <Text style={styles.empty}>No demo accounts yet.</Text>
          ) : (
            demos.map((p) => {
              // `user_id` is null for invites the demo user hasn't
              // signed into yet. We still render them (so the admin
              // sees their pending demos) and allow revoke by email
              // via the `pending:<email>` path.
              const pendingId = p.user_id ? undefined : `pending:${(p.email || '').toLowerCase()}`;
              const isPending = !p.user_id;
              return (
                <PersonRow
                  key={p.user_id || p.email}
                  p={{ ...p, name: p.name ? `${p.name}${isPending ? ' (pending sign-in)' : ''}` : p.email }}
                  actionLabel="Revoke"
                  onAction={() => {
                    const id = p.user_id || pendingId;
                    if (!id) return;
                    confirmX(
                      'Revoke Demo Account?',
                      isPending
                        ? `${p.email} (pending) will be removed from the demo list.`
                        : `${p.email} will be demoted to a regular patient account.`,
                      async () => {
                        setBusy(true);
                        try {
                          await api.delete(`/admin/demo/${encodeURIComponent(id)}`);
                          await loadAll();
                        } finally { setBusy(false); }
                      },
                      true,
                    );
                  }}
                />
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

function PersonRow({
  p,
  actionLabel,
  onAction,
  blogToggle,
  dashboardToggle,
}: {
  p: Person;
  actionLabel?: string;
  onAction?: () => void;
  blogToggle?: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  dashboardToggle?: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean };
}) {
  return (
    <View>
      <View style={styles.row}>
        {p.picture ? (
          <Image source={{ uri: p.picture }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: COLORS.primary, fontFamily: 'Manrope_700Bold' }}>
              {(p.name || p.email || '?').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowName} numberOfLines={1}>
            {roleEmoji(p.role)} {p.name || p.email || '—'}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {p.email} · {roleLabel(p.role)}
          </Text>
        </View>
        {actionLabel && onAction && (
          <TouchableOpacity onPress={onAction} style={styles.demoteBtn}>
            <Text style={styles.demoteBtnText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
      {dashboardToggle && (
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>
            <Ionicons name="grid-outline" size={11} /> Full dashboard access (all admin tabs)
          </Text>
          <TouchableOpacity
            onPress={() => !dashboardToggle.disabled && dashboardToggle.onChange(!dashboardToggle.value)}
            style={[styles.permToggle, dashboardToggle.value && styles.permToggleOn, dashboardToggle.disabled && { opacity: 0.5 }]}
            disabled={!!dashboardToggle.disabled}
          >
            <View style={[styles.permDot, dashboardToggle.value && styles.permDotOn]} />
          </TouchableOpacity>
        </View>
      )}
      {blogToggle && (
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>
            <Ionicons name="newspaper-outline" size={11} /> In-app Blog editor access
          </Text>
          <TouchableOpacity
            onPress={() => !blogToggle.disabled && blogToggle.onChange(!blogToggle.value)}
            style={[styles.permToggle, blogToggle.value && styles.permToggleOn, blogToggle.disabled && { opacity: 0.5 }]}
            disabled={!!blogToggle.disabled}
          >
            <View style={[styles.permDot, blogToggle.value && styles.permDotOn]} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Cross-platform alert / confirm helpers — Alert.alert hangs on web.
function alertX(title: string, body?: string) {
  if (Platform.OS === 'web') {
    window.alert(body ? `${title}\n\n${body}` : title);
  } else {
    Alert.alert(title, body);
  }
}

function confirmX(title: string, body: string, onYes: () => void, destructive = false) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${body}`)) onYes();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: destructive ? 'Demote' : 'Promote', style: destructive ? 'destructive' : 'default', onPress: onYes },
  ]);
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  section: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14 },
  sectionSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 10 },
  countBadge: {
    marginLeft: 4,
    minWidth: 22,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: COLORS.primary, fontSize: 11, fontFamily: 'Manrope_700Bold' },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontFamily: 'Manrope_700Bold' },
  empty: { color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  rowName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  rowMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  demoteBtn: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoteBtnText: { color: '#991B1B', fontSize: 11, fontFamily: 'Manrope_700Bold' },
  roleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.primary + '55',
    backgroundColor: '#fff',
  },
  roleChipText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  permRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, paddingHorizontal: 6, gap: 8,
  },
  permLabel: { color: COLORS.textSecondary, fontSize: 11, flex: 1 },
  permToggle: { width: 38, height: 22, borderRadius: 11, backgroundColor: '#E5E7EB', padding: 2, justifyContent: 'center' },
  permToggleOn: { backgroundColor: COLORS.primary },
  permDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  permDotOn: { transform: [{ translateX: 16 }] },
});
