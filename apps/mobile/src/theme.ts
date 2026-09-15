import { StyleSheet } from 'react-native';

/**
 * Design tokens, mirroring `apps/web/app/globals.css`.
 *
 * Tokens are shared between web and mobile; components are not (docs/12 §10).
 * A common component layer would hold both platforms back, while common tokens
 * keep them looking like one product for almost nothing.
 */
export const colors = {
  bg: '#fbfaf8',
  surface: '#ffffff',
  surface2: '#f4f2ee',
  border: '#e3ded6',
  text: '#1c1a17',
  muted: '#6b655c',
  accent: '#b8510f',
  ok: '#2f7d4f',
  pending: '#a8852c',
  idle: '#9a938a',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },

  h1: { fontSize: 24, fontWeight: '600', color: colors.text, letterSpacing: -0.4 },
  h2: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: spacing.lg },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  mono: { fontFamily: 'Courier', letterSpacing: 1 },

  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.lg,
    gap: spacing.sm,
  },

  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    // 44pt minimum touch target (docs/11 §9).
    minHeight: 44,
  },

  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  buttonTextSecondary: { color: colors.text },
  buttonDisabled: { opacity: 0.55 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },

  banner: { padding: spacing.md, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  bannerOk: { borderColor: colors.ok, backgroundColor: '#eef6f1' },
  bannerWarn: { borderColor: colors.pending, backgroundColor: '#faf5e8' },
  bannerError: { borderColor: colors.accent, backgroundColor: '#fbefe7' },

  pill: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillActive: { borderColor: colors.ok },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  price: { fontSize: 18, fontWeight: '600', color: colors.text },
  code: { fontSize: 30, letterSpacing: 6, textAlign: 'center', color: colors.text },
});
