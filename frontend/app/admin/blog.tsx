import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useTier } from '../../src/tier';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { PrimaryButton, SecondaryButton } from '../../src/components';
import { useResponsive } from '../../src/responsive';

const CATEGORIES = ['Kidney Health', "Men's Health", "Women's Urology", 'Surgical Care', 'Patient Education', 'News', 'Urology'];

export default function AdminBlog() {
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { user } = useAuth();
  const { isWebDesktop } = useResponsive();
  // Editorial gate (matches backend `require_blog_writer`):
  //   • super_owner — always allowed.
  //   • primary_owner — allowed only if `can_create_blog: true` (set
  //     via PATCH /api/admin/primary-owners/{id}/blog-perm by super-
  //     owner).
  // Everyone else (partner / doctor / staff / patient) is denied here
  // AND on the backend so unauthorised attempts can never succeed.
  const tier = useTier();
  const canEdit = !!user && tier.canCreateBlog;
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'compose'>(edit ? 'compose' : 'list');

  const [postId, setPostId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Urology');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [cover, setCover] = useState('');
  const [published, setPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending_review' | 'published' | 'draft' | 'rejected' | 'mine'>('all');

  // Editorial-power flag — anyone who passes the gate auto-publishes
  // (matches the backend behaviour after the editorial-gate refactor:
  // there's no longer a "pending review" workflow because authoring
  // is now editor-only).
  const isOwner = canEdit;

  const reset = () => {
    setPostId(null);
    setTitle('');
    setCategory('Urology');
    setExcerpt('');
    setContent('');
    setCover('');
    setPublished(true);
  };

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/blog');
      setPosts(data);
      if (edit) {
        const p = data.find((x: any) => x.post_id === edit);
        if (p) {
          setPostId(p.post_id);
          setTitle(p.title);
          setCategory(p.category);
          setExcerpt(p.excerpt || '');
          setContent(p.content || '');
          setCover(p.cover || '');
          setPublished(p.published);
          setMode('compose');
        }
      }
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [edit]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!canEdit) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Admin · Blog</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark" size={54} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>
            {tier.loading ? 'Loading…' : 'Editorial access required'}
          </Text>
          {!tier.loading && (
            <Text style={[styles.emptyTitle, { fontSize: 13, marginTop: 8, fontWeight: '400', textAlign: 'center', paddingHorizontal: 24 }]}>
              Blog editing is restricted to the Super Owner. Ask the Super Owner to grant blog access from the Permission Manager.
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const pickCover = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (!res.canceled && res.assets[0]) {
      const a = res.assets[0];
      if (a.base64) {
        setCover(`data:image/jpeg;base64,${a.base64}`);
      } else if (a.uri) {
        setCover(a.uri);
      }
    }
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      const msg = 'Please fill Title and Content';
      Platform.OS === 'web' ? (typeof window !== 'undefined' && window.alert(msg)) : Alert.alert('Missing', msg);
      return;
    }
    setSaving(true);
    try {
      const body = { title, category, excerpt, content, cover, published };
      if (postId) {
        await api.put(`/admin/blog/${postId}`, body);
      } else {
        await api.post('/admin/blog', body);
      }
      reset();
      setMode('list');
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save';
      Platform.OS === 'web' ? (typeof window !== 'undefined' && window.alert(msg)) : Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const edit_ = (p: any) => {
    setPostId(p.post_id);
    setTitle(p.title);
    setCategory(p.category);
    setExcerpt(p.excerpt || '');
    setContent(p.content || '');
    setCover(p.cover || '');
    setPublished(p.published);
    setMode('compose');
  };

  const review = async (p: any, status: string) => {
    try {
      await api.post(`/admin/blog/${p.post_id}/review`, { status });
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not update status';
      Platform.OS === 'web' ? (typeof window !== 'undefined' && window.alert(msg)) : Alert.alert('Error', msg);
    }
  };

  const displayedPosts = posts.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'mine') return p.author_user_id === user?.user_id;
    const s = p.status || (p.published ? 'published' : 'draft');
    return s === filter;
  });

  const pendingCount = posts.filter((p) => (p.status || '') === 'pending_review').length;

  const remove = async (p: any) => {
    const ok =
      Platform.OS === 'web' ? typeof window !== 'undefined' && window.confirm(`Delete "${p.title}"?`) : await new Promise((res) => Alert.alert('Delete', `Delete "${p.title}"?`, [{ text: 'Cancel', onPress: () => res(false), style: 'cancel' }, { text: 'Delete', onPress: () => res(true), style: 'destructive' }]));
    if (!ok) return;
    try {
      await api.delete(`/admin/blog/${p.post_id}`);
      load();
    } catch {}
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => (mode === 'compose' ? (reset(), setMode('list')) : router.back())} style={styles.backBtn} testID="admin-blog-back">
          <Ionicons name={mode === 'compose' ? 'close' : 'arrow-back'} size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{mode === 'compose' ? (postId ? 'Edit Post' : 'New Post') : 'Blog Admin'}</Text>
        {mode === 'list' && (
          <TouchableOpacity
            onPress={() => {
              reset();
              setMode('compose');
            }}
            style={styles.newBtn}
            testID="admin-blog-new"
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {mode === 'list' ? (
        <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: 60 }, isWebDesktop && { maxWidth: 1100, width: '100%', alignSelf: 'center', padding: 24 }]}>
          {/* Filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingBottom: 12, paddingRight: 20 }}>
            {([
              { id: 'all', label: `All (${posts.length})` },
              { id: 'pending_review', label: `Pending Review${pendingCount ? ` (${pendingCount})` : ''}` },
              { id: 'published', label: 'Published' },
              { id: 'draft', label: 'Draft' },
              { id: 'rejected', label: 'Rejected' },
              ...(isOwner ? [{ id: 'mine', label: 'Mine' }] : []),
            ] as const).map((f) => (
              <TouchableOpacity
                key={f.id}
                onPress={() => setFilter(f.id as any)}
                style={[styles.filterChip, filter === f.id && styles.filterChipActive]}
                testID={`admin-blog-filter-${f.id}`}
              >
                <Text style={[styles.filterText, filter === f.id && { color: '#fff' }]} numberOfLines={1}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : displayedPosts.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="newspaper-outline" size={54} color={COLORS.textDisabled} />
              <Text style={styles.emptyTitle}>{filter === 'all' ? 'No posts yet' : 'No posts match filter'}</Text>
              <Text style={styles.emptySub}>
                {isOwner
                  ? 'Doctors can submit posts for your review. You can compose and publish directly.'
                  : 'Write a draft or submit for owner review. Your approved posts appear in the public Blog tab.'}
              </Text>
              <PrimaryButton
                title="+ Compose new post"
                onPress={() => {
                  reset();
                  setMode('compose');
                }}
                style={{ marginTop: 20 }}
                icon={<Ionicons name="create" size={18} color="#fff" />}
                testID="admin-blog-first"
              />
            </View>
          ) : (
            <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12 } : undefined}>
            {displayedPosts.map((p) => {
              const status = p.status || (p.published ? 'published' : 'draft');
              const statusColor =
                status === 'published' ? COLORS.success :
                status === 'pending_review' ? COLORS.warning :
                status === 'rejected' ? COLORS.accent :
                COLORS.textSecondary;
              const canEditPost = isOwner || p.author_user_id === user?.user_id;
              return (
                <View key={p.post_id} style={[styles.postCard, isWebDesktop && { width: '49%', marginBottom: 0 }]}>
                  {p.cover ? <Image source={{ uri: p.cover }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: COLORS.primary + '18', alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="newspaper" size={28} color={COLORS.primary} /></View>}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.postTags}>
                      <View style={styles.catTag}><Text style={styles.catText}>{p.category}</Text></View>
                      <View style={[styles.statusTag, { backgroundColor: statusColor + '22' }]}>
                        <Text style={[styles.statusText, { color: statusColor }]}>
                          {status === 'pending_review' ? 'Pending Review' : status.charAt(0).toUpperCase() + status.slice(1)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.postTitle} numberOfLines={2}>{p.title}</Text>
                    {p.author_name && p.author_user_id !== user?.user_id ? (
                      <Text style={styles.authorLine}>By {p.author_name}</Text>
                    ) : null}
                    <Text style={styles.postDate}>{format(new Date(p.created_at), 'dd-MM-yyyy')}</Text>
                    {p.review_note ? <Text style={styles.reviewNote}>Review note: {p.review_note}</Text> : null}
                    <View style={styles.postActions}>
                      {canEditPost && (
                        <TouchableOpacity onPress={() => edit_(p)} style={styles.actBtn} testID={`admin-blog-edit-${p.post_id}`}>
                          <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                          <Text style={styles.actText}>Edit</Text>
                        </TouchableOpacity>
                      )}
                      {isOwner && status === 'pending_review' && (
                        <>
                          <TouchableOpacity onPress={() => review(p, 'published')} style={[styles.actBtn, { borderColor: COLORS.success }]} testID={`admin-blog-approve-${p.post_id}`}>
                            <Ionicons name="checkmark" size={14} color={COLORS.success} />
                            <Text style={[styles.actText, { color: COLORS.success }]}>Approve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => review(p, 'rejected')} style={[styles.actBtn, { borderColor: COLORS.accent }]} testID={`admin-blog-reject-${p.post_id}`}>
                            <Ionicons name="close" size={14} color={COLORS.accent} />
                            <Text style={[styles.actText, { color: COLORS.accent }]}>Reject</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      {isOwner && status === 'published' && (
                        <TouchableOpacity onPress={() => review(p, 'draft')} style={[styles.actBtn, { borderColor: COLORS.textSecondary }]}>
                          <Ionicons name="eye-off-outline" size={14} color={COLORS.textSecondary} />
                          <Text style={[styles.actText, { color: COLORS.textSecondary }]}>Unpublish</Text>
                        </TouchableOpacity>
                      )}
                      {canEditPost && (
                        <TouchableOpacity onPress={() => remove(p)} style={[styles.actBtn, { borderColor: COLORS.accent }]} testID={`admin-blog-del-${p.post_id}`}>
                          <Ionicons name="trash-outline" size={14} color={COLORS.accent} />
                          <Text style={[styles.actText, { color: COLORS.accent }]}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
            </View>
          )}
        </ScrollView>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: 60 }, isWebDesktop && { maxWidth: 860, width: '100%', alignSelf: 'center', padding: 28 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.lbl}>Cover Image</Text>
            <TouchableOpacity onPress={pickCover} style={styles.coverPicker} testID="admin-blog-pick-cover">
              {cover ? (
                <Image source={{ uri: cover }} style={styles.coverImg} />
              ) : (
                <View style={styles.coverPlaceholder}>
                  <Ionicons name="image-outline" size={36} color={COLORS.textSecondary} />
                  <Text style={styles.coverHint}>Tap to pick an image</Text>
                </View>
              )}
            </TouchableOpacity>
            {cover ? (
              <TouchableOpacity onPress={() => setCover('')} style={{ alignSelf: 'flex-end', padding: 6 }}>
                <Text style={{ color: COLORS.accent, ...FONTS.body }}>Remove</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.lbl}>Title *</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Post title" placeholderTextColor={COLORS.textDisabled} testID="admin-blog-title" />

            <Text style={styles.lbl}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.catChip, category === c && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}>
                  <Text style={[styles.catChipText, category === c && { color: '#fff' }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.lbl}>Excerpt (optional short summary)</Text>
            <TextInput value={excerpt} onChangeText={setExcerpt} style={[styles.input, { height: 60 }]} multiline placeholder="A one-line teaser…" placeholderTextColor={COLORS.textDisabled} testID="admin-blog-excerpt" />

            <Text style={styles.lbl}>Content *</Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              style={[styles.input, { height: 240, textAlignVertical: 'top' }]}
              multiline
              placeholder={'Write your post body here.\n\nSeparate paragraphs with a blank line — the app will format them automatically. You can paste basic HTML too.'}
              placeholderTextColor={COLORS.textDisabled}
              testID="admin-blog-content"
            />

            <View style={styles.publishRow}>
              <Ionicons name={published ? 'checkmark-circle' : 'radio-button-off'} size={22} color={published ? COLORS.success : COLORS.textDisabled} />
              <TouchableOpacity onPress={() => setPublished(!published)} style={{ flex: 1, marginLeft: 10 }} testID="admin-blog-publish-toggle">
                <Text style={styles.publishLbl}>
                  {published ? (isOwner ? 'Publish now' : 'Submit for owner review') : 'Save as draft'}
                </Text>
                <Text style={styles.publishSub}>
                  {published
                    ? isOwner
                      ? 'Visible in the Blog tab immediately.'
                      : 'Owner (Dr. Sagar Joshi) will review and publish. You will see status change once reviewed.'
                    : 'Hidden from everyone until you publish.'}
                </Text>
              </TouchableOpacity>
            </View>

            <PrimaryButton
              title={saving ? 'Saving…' : postId ? 'Update Post' : isOwner ? 'Publish Post' : published ? 'Submit for Review' : 'Save Draft'}
              onPress={save}
              disabled={saving}
              style={{ marginTop: 18 }}
              icon={<Ionicons name="send" size={18} color="#fff" />}
              testID="admin-blog-save"
            />
            <SecondaryButton
              title="Cancel"
              onPress={() => {
                reset();
                setMode('list');
              }}
              style={{ marginTop: 10 }}
              testID="admin-blog-cancel"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center' },
  postCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  thumb: { width: 70, height: 70, borderRadius: 10, backgroundColor: COLORS.bg },
  postTags: { flexDirection: 'row', gap: 6 },
  catTag: { backgroundColor: COLORS.primary + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  catText: { ...FONTS.label, color: COLORS.primary, fontSize: 9 },
  statusTag: { backgroundColor: COLORS.success + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statusText: { ...FONTS.label, color: COLORS.success, fontSize: 9 },
  postTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 5, fontSize: 13 },
  postDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, marginTop: 1 },
  postActions: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff' },
  actText: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  lbl: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  coverPicker: { width: '100%', aspectRatio: 16 / 9, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  coverHint: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6 },
  catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  catChipText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12 },
  publishRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', marginTop: 16 },
  publishLbl: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  publishSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, flexShrink: 0, alignSelf: 'flex-start' },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  authorLine: { ...FONTS.body, color: COLORS.primary, fontSize: 11, marginTop: 2 },
  reviewNote: { ...FONTS.body, color: COLORS.accent, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
});
