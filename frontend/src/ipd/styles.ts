import { Platform, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS } from '../theme';

export const ipdStyles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  kpiTile: {
    flexGrow: 1, minWidth: '22%', backgroundColor: '#fff', padding: 12,
    borderRadius: RADIUS.card, borderLeftWidth: 4, borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  kpiVal: { ...FONTS.h2, color: COLORS.textPrimary, marginTop: 4, fontSize: 18 },
  kpiLbl: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },

  primaryBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.button, flex: 1,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.button,
    borderWidth: 1, borderColor: COLORS.primary, flex: 1,
  },
  secondaryBtnText: { color: COLORS.primary, fontWeight: '700' },

  sectionTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginBottom: 8, fontSize: 14 },
  subTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginVertical: 8, fontSize: 13 },
  empty: { color: COLORS.textTertiary, padding: 16, textAlign: 'center', fontSize: 12.5 },

  bedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bedTile: {
    width: '23%', minWidth: 92, padding: 12, borderRadius: RADIUS.card,
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'flex-start', gap: 3,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  bedTileOcc: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
    ...Platform.select({
      ios: { shadowColor: COLORS.primary, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  bedNo: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  bedWard: { color: COLORS.textSecondary, fontSize: 10 },
  bedOccName: { color: '#fff', fontSize: 10.5, marginTop: 2 },
  bedFree: { color: '#16a34a', fontSize: 10, fontWeight: '700', marginTop: 2 },

  filterRow: { flexDirection: 'row', gap: 4 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  filterChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 11, color: COLORS.textPrimary, fontWeight: '600' },

  searchInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input,
    paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    marginVertical: 8, backgroundColor: '#fff', fontSize: 12.5, color: COLORS.textPrimary,
  },
  admCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    backgroundColor: '#fff', borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  admIpdNo: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12.5 },
  admName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 2, fontSize: 13 },
  admDiag: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  admMeta: { color: COLORS.textTertiary, fontSize: 10.5, marginTop: 2 },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  statusActive: { backgroundColor: '#dcfce7' },
  statusDischarged: { backgroundColor: '#dbeafe' },
  statusText: { fontSize: 9, fontWeight: '700' },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalClose: { padding: 8 },
  modalTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 15 },

  bedChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  bedChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  bedChipText: { fontSize: 11, color: COLORS.textPrimary },

  fieldLabel: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 8, marginBottom: 4, fontWeight: '600' },
  helperTop: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginBottom: 8, lineHeight: 15 },
  lookupHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: -4, marginBottom: 8, fontStyle: 'italic' },

  aiInlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999, backgroundColor: COLORS.primary,
  },
  aiInlineBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 10.5 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input,
    paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    backgroundColor: '#fff', color: COLORS.textPrimary, fontSize: 13,
  },
  bedEditRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  delIcon: { padding: 6 },
  addBedBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    padding: 10, borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.primary, borderStyle: 'dashed', marginTop: 6,
  },
  addBedText: { color: COLORS.primary, fontWeight: '700' },

  detailHero: { paddingHorizontal: 8, paddingBottom: 14, paddingTop: 0 },
  detailHeroTitle: { color: '#fff', ...FONTS.h2, fontSize: 19, paddingHorizontal: 16, marginTop: 6 },
  detailHeroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, paddingHorizontal: 16, marginTop: 4 },
  detailHeroMetaRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 16, marginTop: 8,
  },
  detailHeroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  detailHeroChipActive: { backgroundColor: 'rgba(22,163,74,0.55)' },
  detailHeroChipDischarged: { backgroundColor: 'rgba(59,130,246,0.55)' },
  detailHeroChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  detailHeroDx: {
    color: 'rgba(255,255,255,0.95)', fontSize: 12.5,
    paddingHorizontal: 16, marginTop: 10, lineHeight: 17,
  },

  tabBar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    height: 58,
    flexGrow: 0,
    flexShrink: 0,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 0,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: '#fff',
  },
  tabBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tabBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 12.5 },
  tabBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  tabBadgeActive: { backgroundColor: '#fff' },
  tabBadgeText: { color: '#fff', fontWeight: '800', fontSize: 10 },

  detCard: {
    backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  noteTime: { color: COLORS.textTertiary, fontSize: 10.5 },
  noteAuthor: { color: COLORS.primary, fontSize: 11, fontWeight: '700', marginTop: 2 },
  noteText: { color: COLORS.textPrimary, fontSize: 12.5, marginTop: 4, lineHeight: 18 },

  actionsMenu: {
    backgroundColor: '#fff',
    marginHorizontal: 12, marginTop: 10,
    borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 4,
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  actionsBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.18)',
    zIndex: 90,
  },
  actionsMenuFloat: {
    position: 'absolute',
    top: 52,
    right: 8,
    width: 270,
    backgroundColor: '#fff',
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 4,
    zIndex: 100,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 12 },
      default: {},
    }),
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 12,
  },
  actionIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  actionSub: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 1 },

  smallPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.sm,
  },
  smallPrimaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  consentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  consentIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  consentTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  consentSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  medRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  medFormBubble: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  medName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13.5 },
  medSub: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2 },
  medNotes: { color: '#4B5563', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  stopBtn: { padding: 6 },

  privatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
  },
  privatePillText: { color: '#6B7280', fontSize: 10, fontWeight: '700' },

  transferRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 5, flexWrap: 'wrap',
  },
  transferText: { color: COLORS.textPrimary, fontSize: 12, flex: 1, minWidth: 200 },
  transferMeta: { color: COLORS.textSecondary, fontSize: 11 },
  transferBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  transferCard: {
    backgroundColor: '#fff',
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    maxHeight: '92%' as any,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  chipText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 12 },

  transferTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  transferSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  transferEmpty: {
    alignItems: 'center', paddingVertical: 20, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
    marginTop: 6,
  },
  transferEmptyText: {
    color: COLORS.textSecondary, fontSize: 12, marginTop: 8,
    textAlign: 'center', lineHeight: 18,
  },
  transferWardHeading: {
    color: COLORS.textPrimary, fontSize: 12, fontWeight: '800',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  transferBedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  transferBedTile: {
    width: '31%', minWidth: 92,
    backgroundColor: '#F0FDF4',
    borderWidth: 1, borderColor: '#86EFAC',
    borderRadius: RADIUS.card,
    paddingVertical: 10, paddingHorizontal: 8,
    alignItems: 'flex-start', gap: 3,
  },
  transferBedTileOn: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
    ...Platform.select({
      ios: { shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  transferBedNo: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  transferBedWard: { color: COLORS.textSecondary, fontSize: 10.5 },
});
