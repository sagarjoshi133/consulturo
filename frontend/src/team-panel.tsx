import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton, SecondaryButton } from './components';
import { useResponsive } from './responsive';

type Role = { slug: string; label: string; category: 'doctor' | 'staff' | 'patient'; builtin?: boolean };

type Member = {
  email: string;
  name?: string;
  role: string;
  can_approve_bookings?: boolean;
  can_approve_broadcasts?: boolean;
  can_prescribe?: boolean;
  can_manage_surgeries?: boolean;
  can_manage_availability?: boolean;
  /** Owner-granted: gives the same dashboard tabs as the doctor */
  dashboard_full_access?: boolean;
  status: 'invited' | 'active';
  picture?: string | null;
  user_id?: string;
};

export function TeamPanelV2() {
  const { isWebDesktop } = useResponsive();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [newRole, setNewRole] = useState<string>('assistant');
  const [canApproveBookings, setCanApproveBookings] = useState(false);
  const [canApproveBroadcasts, setCanApproveBroadcasts] = useState(false);
  const [canPrescribe, setCanPrescribe] = useState(false);
  const [canManageSurgeries, setCanManageSurgeries] = useState(false);
  const [canManageAvailability, setCanManageAvailability] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Edit modal
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState<string>('assistant');
  const [editCanBook, setEditCanBook] = useState(false);
  const [editCanBc, setEditCanBc] = useState(false);
  const [editCanPrescribe, setEditCanPrescribe] = useState(false);
  const [editCanSurgery, setEditCanSurgery] = useState(false);
  const [editCanAvailability, setEditCanAvailability] = useState(false);
  const [editFullAccess, setEditFullAccess] = useState(false);
  // Selected dashboard tabs when access mode = 'custom'
  const [editTabs, setEditTabs] = useState<string[]>([]);

  // Roles modal
  const [showRoles, setShowRoles] = useState(false);
  // Collapsible invite form — closed by default so the team list shows first
  const [showInvite, setShowInvite] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<'staff' | 'doctor'>('staff');
  const [rolesBusy, setRolesBusy] = useState(false);
  const [rolesErr, setRolesErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        api.get('/team'),
        api.get('/team/roles').catch(() => ({ data: { roles: [] } })),
      ]);
      setMembers(m.data || []);
      setRoles(r.data?.roles || []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const roleLabelFor = useCallback(
    (slug: string) => {
      if (slug === 'owner') return 'Owner';
      const r = roles.find((x) => x.slug === slug);
      return r?.label || slug;
    },
    [roles]
  );

  // NOTE: `isDoctorLike` was previously used to auto-grant approval
  // flags whenever the role was "doctor" (or a custom doctor-category
  // slug). That behaviour has been REMOVED — the doctor role is now
  // a regular team-member label. Prescriber / approver / broadcast
  // rights must be explicitly toggled by a Primary Owner / Partner,
  // same as for nursing / reception / assistant. The helper is kept
  // around (returns false) only to avoid touching call-sites that
  // still reference it elsewhere in this file.
  const isDoctorLike = (_slug: string) => false;

  // Hierarchy order for displaying team members. Owner first, partner/doctor
  // class next, then clinical staff, then operations/marketing/admin.
  // Unknown roles (custom slugs) drop to the end.
  const ROLE_ORDER: string[] = [
    'owner',
    'partner',
    'doctor',
    'nursing',
    'ot_technician', 'ot-technician', 'ot',
    'marketing',
    'reception',
    'assistant',
  ];
  const orderedMembers = React.useMemo(() => {
    const idxOf = (slug: string) => {
      const lc = (slug || '').toLowerCase();
      const i = ROLE_ORDER.indexOf(lc);
      // doctor-category roles that aren't builtin "doctor" — bucket near doctor
      if (i < 0 && isDoctorLike(slug)) return 2.5;
      return i < 0 ? 99 : i;
    };
    return [...members].sort((a, b) => {
      const da = idxOf(a.role);
      const db = idxOf(b.role);
      if (da !== db) return da - db;
      // within same role, sort active before invited, then by name
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
  }, [members, roles]);

  const invite = async () => {
    setErr('');
    if (!email.includes('@')) {
      setErr('Valid email required');
      return;
    }
    setBusy(true);
    try {
      await api.post('/team/invites', {
        email: email.toLowerCase(),
        name: name || undefined,
        role: newRole,
        can_approve_bookings: canApproveBookings,
        can_approve_broadcasts: canApproveBroadcasts,
        can_prescribe: canPrescribe,
        can_manage_surgeries: canManageSurgeries,
        can_manage_availability: canManageAvailability,
      });
      setEmail('');
      setName('');
      setCanApproveBookings(false);
      setCanApproveBroadcasts(false);
      setCanPrescribe(false);
      setCanManageSurgeries(false);
      setCanManageAvailability(false);
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not invite');
    } finally {
      setBusy(false);
    }
  };

  const remove = (em: string) => {
    const doRemove = async () => {
      try {
        await api.delete(`/team/${em}`);
        load();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not remove';
        Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${em} from the team?`)) doRemove();
    } else {
      Alert.alert('Confirm', `Remove ${em} from the team?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doRemove },
      ]);
    }
  };

  const openEdit = (m: Member) => {
    setEditing(m);
    setEditRole(m.role);
    setEditCanBook(!!m.can_approve_bookings);
    setEditCanBc(!!m.can_approve_broadcasts);
    setEditCanPrescribe(!!m.can_prescribe);
    setEditCanSurgery(!!m.can_manage_surgeries);
    setEditCanAvailability(!!m.can_manage_availability);
    setEditFullAccess(!!m.dashboard_full_access);
    setEditTabs(Array.isArray((m as any).dashboard_tabs) ? (m as any).dashboard_tabs : []);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.patch(`/team/${editing.email}`, {
        role: editRole,
        can_approve_bookings: editCanBook,
        can_approve_broadcasts: editCanBc,
        can_prescribe: editCanPrescribe,
        can_manage_surgeries: editCanSurgery,
        can_manage_availability: editCanAvailability,
        dashboard_full_access: editFullAccess,
        // Sending [] when full-access is on keeps the data clean (full-
        // access supersedes the per-tab list anyway).
        dashboard_tabs: editFullAccess ? [] : editTabs,
      });
      setEditing(null);
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    }
  };

  const addRole = async () => {
    setRolesErr('');
    const label = newLabel.trim();
    if (!label) {
      setRolesErr('Enter a label');
      return;
    }
    setRolesBusy(true);
    try {
      await api.post('/team/roles', { label, category: newCategory });
      setNewLabel('');
      setNewCategory('staff');
      const r = await api.get('/team/roles');
      setRoles(r.data?.roles || []);
    } catch (e: any) {
      setRolesErr(e?.response?.data?.detail || 'Could not add');
    } finally {
      setRolesBusy(false);
    }
  };

  const deleteRole = async (slug: string) => {
    const doDel = async () => {
      try {
        await api.delete(`/team/roles/${slug}`);
        const r = await api.get('/team/roles');
        setRoles(r.data?.roles || []);
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete role "${slug}"?`)) doDel();
    } else {
      Alert.alert('Confirm', `Delete role "${slug}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDel },
      ]);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;

  // Note: prescriber / approver flags are no longer auto-derived from
  // role — they're explicit per-user toggles. The `isDoctorLike` helper
  // (now a no-op) is left for back-compat in non-toggle UI bits.

  return (
    <>
      {/* TEAM LIST FIRST — most-used info at top */}
      <View style={styles.teamHeaderRow}>
        <Text style={styles.sectionTitle}>Current team ({members.length})</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity
            onPress={() => setShowInvite((v) => !v)}
            style={[styles.miniBtn, showInvite && styles.miniBtnActive]}
            testID="team-toggle-invite"
          >
            <Ionicons
              name={showInvite ? 'close' : 'person-add'}
              size={13}
              color={showInvite ? '#fff' : COLORS.primary}
            />
            <Text style={[styles.miniBtnText, showInvite && { color: '#fff' }]}>
              {showInvite ? 'Cancel' : 'Invite'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowRoles(true)}
            style={styles.miniBtn}
            testID="team-manage-roles"
          >
            <Ionicons name="pricetags" size={13} color={COLORS.primary} />
            <Text style={styles.miniBtnText}>Roles</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Invite form — collapsible. Hidden by default; tap "Invite" to expand. */}
      {showInvite && (
      <View style={[styles.formCard, { marginBottom: 14 }]}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="team@example.com"
          placeholderTextColor={COLORS.textDisabled}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
          testID="team-invite-email"
        />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name (optional)"
          placeholderTextColor={COLORS.textDisabled}
          style={[styles.input, { marginTop: 8 }]}
          testID="team-invite-name"
        />

        <Text style={styles.smallLabel}>Role</Text>
        <View style={styles.roleRow}>
          {roles.map((r) => (
            <TouchableOpacity
              key={r.slug}
              onPress={() => setNewRole(r.slug)}
              style={[styles.roleChip, newRole === r.slug && styles.roleChipActive]}
              testID={`team-role-${r.slug}`}
            >
              {r.category === 'doctor' && <Ionicons name="medkit" size={10} color={newRole === r.slug ? '#fff' : COLORS.primary} />}
              <Text style={[styles.roleText, newRole === r.slug && { color: '#fff' }]}>{r.label}</Text>
              {!r.builtin && (
                <Ionicons name="sparkles" size={10} color={newRole === r.slug ? '#fff' : COLORS.textSecondary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <PermCheck
          label="Can approve / reschedule appointments"
          description="Enable to let this team member confirm or reschedule booking requests."
          value={canApproveBookings}
          onToggle={() => setCanApproveBookings((v) => !v)}
          testID="team-approver-bookings"
        />
        <PermCheck
          label="Can approve push broadcasts"
          description="Let this member approve broadcast notifications (otherwise only owner can approve)."
          value={canApproveBroadcasts}
          onToggle={() => setCanApproveBroadcasts((v) => !v)}
          testID="team-approver-broadcasts"
        />
        <PermCheck
          label="Can prescribe (write Rx, medicines)"
          description="Enable for clinicians who write prescriptions — also unlocks reg-no overrides, the medicine catalogue, and referrer management."
          value={canPrescribe}
          onToggle={() => setCanPrescribe((v) => !v)}
          testID="team-prescribe"
        />
        <PermCheck
          label="Can manage surgeries"
          description="Add, edit, import, and export surgery / OT logbook records."
          value={canManageSurgeries}
          onToggle={() => setCanManageSurgeries((v) => !v)}
          testID="team-surgeries"
        />
        <PermCheck
          label="Can manage availability"
          description="Edit own weekly schedule and add holidays / time-off rules."
          value={canManageAvailability}
          onToggle={() => setCanManageAvailability((v) => !v)}
          testID="team-availability"
        />

        {err ? <Text style={{ color: COLORS.accent, ...FONTS.body, marginTop: 6 }}>{err}</Text> : null}
        <PrimaryButton
          title={busy ? 'Inviting…' : 'Send invite'}
          onPress={invite}
          disabled={busy}
          style={{ marginTop: 12 }}
          icon={<Ionicons name="person-add" size={18} color="#fff" />}
          testID="team-invite-submit"
        />
        <Text style={styles.note}>
          Once invited, the person signs in with Google using this email — the role is applied automatically.
        </Text>
      </View>
      )}

      {members.length === 0 ? (
        <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginTop: 10 }}>No team members yet.</Text>
      ) : (
        <View style={isWebDesktop ? styles.tmGrid : undefined}>
        {orderedMembers.map((m) => (
          <View key={m.email} style={[styles.tmCard, isWebDesktop && styles.tmCardDesktop]}>
            {m.picture ? (
              <Image source={{ uri: m.picture }} style={styles.tmAvatar} />
            ) : (
              <View style={[styles.tmAvatar, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="person" size={18} color={COLORS.primary} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.tmName}>{m.name || m.email}</Text>
              <Text style={styles.tmEmail}>{m.email}</Text>
              <View style={styles.tmTagRow}>
                <View style={[styles.tmRole, m.role === 'owner' && { backgroundColor: COLORS.accent + '22' }]}>
                  <Text style={[styles.tmRoleText, m.role === 'owner' && { color: COLORS.accent }]}>
                    {roleLabelFor(m.role)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.tmStatus,
                    m.status === 'active' ? { backgroundColor: COLORS.success + '22' } : { backgroundColor: COLORS.warning + '22' },
                  ]}
                >
                  <Text style={[styles.tmStatusText, { color: m.status === 'active' ? COLORS.success : COLORS.warning }]}>
                    {m.status === 'active' ? 'Active' : 'Invited'}
                  </Text>
                </View>
                {m.role === 'owner' ? null : m.dashboard_full_access ? (
                  <View style={styles.tmFullAccess}>
                    <Ionicons name="shield-checkmark" size={10} color="#5C3D00" />
                    <Text style={styles.tmFullAccessText}>Full Access</Text>
                  </View>
                ) : (Array.isArray((m as any).dashboard_tabs) && (m as any).dashboard_tabs.length > 0) ? (
                  <View style={styles.tmPartialAccess}>
                    <Ionicons name="shield-half" size={10} color={COLORS.primaryDark} />
                    <Text style={styles.tmPartialText}>Partial · {(m as any).dashboard_tabs.length}</Text>
                  </View>
                ) : null}
                {m.can_approve_bookings && (
                  <View style={styles.tmPerm}>
                    <Ionicons name="checkmark-circle" size={10} color={COLORS.primary} />
                    <Text style={styles.tmPermText}>Bookings</Text>
                  </View>
                )}
                {m.can_approve_broadcasts && (
                  <View style={styles.tmPerm}>
                    <Ionicons name="megaphone" size={10} color={COLORS.primary} />
                    <Text style={styles.tmPermText}>Broadcasts</Text>
                  </View>
                )}
              </View>
            </View>
            {m.role !== 'owner' && (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TouchableOpacity onPress={() => openEdit(m)} style={styles.tmIcon} testID={`team-edit-${m.email}`}>
                  <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(m.email)} style={styles.tmIcon} testID={`team-remove-${m.email}`}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        </View>
      )}

      {/* Edit modal */}
      <Modal
        visible={!!editing}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.modalBackdrop} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
            style={{ width: '100%', flex: 1, justifyContent: 'flex-end' }}
          >
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.editCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editTitle}>Edit role & permissions</Text>
                <Text style={styles.editSub}>{editing?.email}</Text>
              </View>
              <TouchableOpacity onPress={() => setEditing(null)}>
                <Ionicons name="close" size={22} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.smallLabel}>Role</Text>
            <View style={styles.roleRow}>
              {roles.map((r) => (
                <TouchableOpacity
                  key={r.slug}
                  onPress={() => setEditRole(r.slug)}
                  style={[styles.roleChip, editRole === r.slug && styles.roleChipActive]}
                  testID={`team-edit-role-${r.slug}`}
                >
                  {r.category === 'doctor' && <Ionicons name="medkit" size={10} color={editRole === r.slug ? '#fff' : COLORS.primary} />}
                  <Text style={[styles.roleText, editRole === r.slug && { color: '#fff' }]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <PermCheck
              label="Can approve bookings"
              description="Confirm / reschedule appointments."
              value={editCanBook}
              onToggle={() => setEditCanBook((v) => !v)}
              testID="team-edit-approver-bookings"
            />
            <PermCheck
              label="Can approve broadcasts"
              description="Approve push notifications (otherwise only owner)."
              value={editCanBc}
              onToggle={() => setEditCanBc((v) => !v)}
              testID="team-edit-approver-broadcasts"
            />
            <PermCheck
              label="Can prescribe (Rx, medicines)"
              description="Write prescriptions, reg-no overrides, medicine catalogue, referrers."
              value={editCanPrescribe}
              onToggle={() => setEditCanPrescribe((v) => !v)}
              testID="team-edit-prescribe"
            />
            <PermCheck
              label="Can manage surgeries"
              description="Add / edit / import / export surgery & OT records."
              value={editCanSurgery}
              onToggle={() => setEditCanSurgery((v) => !v)}
              testID="team-edit-surgeries"
            />
            <PermCheck
              label="Can manage availability"
              description="Edit own weekly schedule and holiday / time-off rules."
              value={editCanAvailability}
              onToggle={() => setEditCanAvailability((v) => !v)}
              testID="team-edit-availability"
            />
            <PermCheck
              label="Full Dashboard Access"
              description="Same dashboard tabs and powers as the owner — every tab unlocked."
              value={editFullAccess}
              onToggle={() => setEditFullAccess((v) => !v)}
              testID="team-edit-full-access"
            />

            {/* Custom per-tab access — only meaningful when Full Access is OFF. */}
            {!editFullAccess && (
              <View style={styles.customAccessBox}>
                <Text style={styles.customAccessTitle}>Custom dashboard access</Text>
                <Text style={styles.customAccessSub}>
                  Pick which tabs this team member can see in the dashboard. Leave all unchecked for "no dashboard tabs".
                </Text>
                <View style={styles.tabChipsRow}>
                  {[
                    { id: 'bookings', label: 'Bookings' },
                    { id: 'consultations', label: 'Consultations' },
                    { id: 'rx', label: 'Rx' },
                    { id: 'availability', label: 'Availability' },
                    { id: 'team', label: 'Team' },
                    { id: 'push', label: 'Notifs' },
                    { id: 'backups', label: 'Backups' },
                  ].map((t) => {
                    const on = editTabs.includes(t.id);
                    return (
                      <TouchableOpacity
                        key={t.id}
                        onPress={() =>
                          setEditTabs((prev) =>
                            on ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                          )
                        }
                        style={[styles.tabChip, on && styles.tabChipActive]}
                        testID={`team-edit-tab-${t.id}`}
                      >
                        <Ionicons
                          name={on ? 'checkmark-circle' : 'ellipse-outline'}
                          size={12}
                          color={on ? '#fff' : COLORS.textSecondary}
                        />
                        <Text style={[styles.tabChipText, on && { color: '#fff' }]}>{t.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <SecondaryButton title="Cancel" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <PrimaryButton title="Save" onPress={saveEdit} style={{ flex: 1 }} testID="team-edit-save" />
            </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Manage roles modal */}
      <Modal visible={showRoles} animationType="slide" onRequestClose={() => setShowRoles(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top', 'bottom']}>
          <View style={styles.rolesHeader}>
            <TouchableOpacity onPress={() => setShowRoles(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.editTitle}>Manage role labels</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            <Text style={styles.sub}>
              Add custom titles like "OT Technician" or "Clinical Fellow" and assign them to team members.
              Doctor-category roles automatically get approver powers.
            </Text>

            <Text style={styles.smallLabel}>New role label</Text>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="e.g. OT Technician"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              testID="team-new-role-label"
              maxLength={40}
            />
            <Text style={styles.smallLabel}>Category</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              {(['staff', 'doctor'] as const).map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setNewCategory(c)}
                  style={[styles.catChip, newCategory === c && styles.catChipActive]}
                >
                  <Ionicons name={c === 'doctor' ? 'medkit' : 'briefcase'} size={12} color={newCategory === c ? '#fff' : COLORS.primary} />
                  <Text style={[styles.catChipText, newCategory === c && { color: '#fff' }]}>
                    {c === 'doctor' ? 'Doctor-level' : 'Support staff'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {rolesErr ? <Text style={{ color: COLORS.accent, ...FONTS.body, marginTop: 6 }}>{rolesErr}</Text> : null}
            <PrimaryButton
              title={rolesBusy ? 'Adding…' : 'Add role'}
              onPress={addRole}
              disabled={rolesBusy}
              icon={<Ionicons name="add" size={16} color="#fff" />}
              style={{ marginTop: 12 }}
              testID="team-add-role"
            />

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>All roles</Text>
            {roles.map((r) => (
              <View key={r.slug} style={styles.roleListRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleListLabel}>{r.label}</Text>
                  <Text style={styles.roleListSub}>
                    {r.builtin ? 'Built-in' : 'Custom'} · {r.category === 'doctor' ? 'Doctor-level' : 'Support staff'} · slug: {r.slug}
                  </Text>
                </View>
                {!r.builtin && (
                  <TouchableOpacity onPress={() => deleteRole(r.slug)} testID={`team-del-role-${r.slug}`} style={styles.tmIcon}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function PermCheck({
  label,
  description,
  value,
  onToggle,
  locked,
  testID,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
  locked?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.approveRow, locked && { opacity: 0.55 }]}
      onPress={() => !locked && onToggle()}
      disabled={locked}
      testID={testID}
      activeOpacity={0.8}
    >
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={value ? COLORS.primary : COLORS.textDisabled} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.approveLbl}>{label}</Text>
        <Text style={styles.approveSub}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  teamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: '#fff',
  },
  miniBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  miniBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  sectionTitle: { ...FONTS.label, color: COLORS.primary, marginTop: 8, marginBottom: 8, textTransform: 'uppercase' },
  pillBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff' },
  pillBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  formCard: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },

  smallLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginTop: 12 },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  roleChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  roleText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  approveRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12, padding: 10, borderRadius: RADIUS.md, backgroundColor: '#F9FCFC', borderWidth: 1, borderColor: COLORS.border },
  approveLbl: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  approveSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 16 },
  note: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 10, lineHeight: 16 },

  tmCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, alignItems: 'center' },
  tmGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  tmCardDesktop: { width: '49%', marginBottom: 0 },
  tmAvatar: { width: 44, height: 44, borderRadius: 22 },
  tmName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  tmEmail: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  tmTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tmRole: { backgroundColor: COLORS.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill },
  tmRoleText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 9 },
  tmStatus: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill },
  tmStatusText: { ...FONTS.bodyMedium, fontSize: 9 },
  tmPerm: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary + '0F' },
  tmPermText: { ...FONTS.body, color: COLORS.primary, fontSize: 9 },
  tmFullAccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: '#F5C26B',
  },
  tmFullAccessText: { ...FONTS.label, color: '#5C3D00', fontSize: 9, letterSpacing: 0.3 },
  customAccessBox: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  customAccessTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  customAccessSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4, lineHeight: 15 },
  tabChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabChipText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  tmPartialAccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '18',
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
  },
  tmPartialText: { ...FONTS.label, color: COLORS.primaryDark, fontSize: 9, letterSpacing: 0.3 },
  tmIcon: { padding: 8 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editCard: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  editTitle: { ...FONTS.h4, color: COLORS.textPrimary },
  editSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  rolesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingTop: Platform.OS === 'ios' ? 50 : 16 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  roleListRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: 6 },
  roleListLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  roleListSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
});
