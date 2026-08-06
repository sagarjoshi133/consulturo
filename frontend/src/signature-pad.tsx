/**
 * SignaturePad — stylus-friendly signature capture component.
 *
 * Wraps react-native-signature-canvas (which uses a WebView with HTML5
 * canvas under the hood) so the same component works on iOS, Android,
 * and Web (Vercel) without per-platform branching.
 *
 * UX choices:
 *   - Pen colour: dark navy (matches printed-pen feel, prints crisp).
 *   - Stroke width: 2.2 → fine enough to fit a small box, thick enough
 *     to render at 200 DPI in the consent PDF.
 *   - Pinch / tap-to-clear is delegated to the parent's "Clear" button
 *     (we expose `clearRef.current.clear()` via imperative handle for
 *     parents to wire up to a button — keeps gesture-handling out of
 *     the canvas surface itself, which avoids accidental clears mid-
 *     signature).
 *   - Output: base64 PNG dataURL (`data:image/png;base64,...`) so it
 *     can be stored verbatim in MongoDB and embedded in HTML for the
 *     PDF render endpoint.
 */
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SignatureScreen, {
  SignatureViewRef,
} from 'react-native-signature-canvas';
import { COLORS, FONTS, RADIUS } from './theme';

export interface SignaturePadHandle {
  /** Imperatively clear the pad. */
  clear: () => void;
  /** Returns the current signature as a PNG dataURL or null if blank. */
  getSignature: () => Promise<string | null>;
}

interface Props {
  /** Helper text under the box, e.g. "Patient signature". */
  label: string;
  /** Current value (PNG dataURL) — pad becomes "saved" preview if set. */
  value?: string | null;
  /** Called when the user signs and signature is captured. */
  onChange?: (dataURL: string | null) => void;
  /** Visual height of the pad in pixels. */
  height?: number;
}

/**
 * Imperative pad. The canvas itself does NOT render a visible "Save"
 * button — instead we capture on every stroke-end and bubble the
 * dataURL up via `onChange` so the parent owns the state. Cleaner UX
 * (no extra buttons cluttering the wizard) and matches react-hook-form
 * style controlled inputs.
 */
const SignaturePad = forwardRef(function SignaturePadInner(
  { label, value, onChange, height = 180 }: Props,
  ref: React.Ref<SignaturePadHandle>,
) {
  const sigRef = useRef<SignatureViewRef>(null);
  const [isEmpty, setIsEmpty] = useState<boolean>(!value);

  // The inner WebView's <style> override — removes their default
  // footer / "save / clear" toolbar (we render our own clear button)
  // and tightens padding so the drawing area fills the box.
  const webStyle = `
    .m-signature-pad { border: none; box-shadow: none; }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; margin: 0; }
    body, html { background-color: #ffffff; }
  `;

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        sigRef.current?.clearSignature();
        setIsEmpty(true);
        onChange?.(null);
      },
      getSignature: () =>
        new Promise<string | null>((resolve) => {
          if (isEmpty) {
            resolve(null);
            return;
          }
          // readSignature triggers onOK below.
          const cb = (dataURL: string) => resolve(dataURL || null);
          if (sigRef.current) {
            (sigRef.current as any)._onOKCB = cb;
          }
          sigRef.current?.readSignature();
        }),
    }),
    [isEmpty, onChange],
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.box, { height }]}>
        <SignatureScreen
          ref={sigRef}
          webStyle={webStyle}
          penColor="#0F1A2E"
          minWidth={1.6}
          maxWidth={2.6}
          // Captured automatically as the user lifts finger / stylus.
          onEnd={() => sigRef.current?.readSignature()}
          onOK={(dataURL) => {
            // sigRef carries an injected callback when getSignature()
            // races with the natural onEnd. Chain both.
            const injected = (sigRef.current as any)?._onOKCB as
              | ((s: string) => void)
              | undefined;
            if (injected) {
              injected(dataURL);
              (sigRef.current as any)._onOKCB = undefined;
            }
            setIsEmpty(false);
            onChange?.(dataURL);
          }}
          onEmpty={() => {
            setIsEmpty(true);
            onChange?.(null);
          }}
          // We disable the built-in trim transparent box so PDFs get
          // a consistent-aspect-ratio image (no jitter when re-signing).
          trimWhitespace={false}
          autoClear={false}
          descriptionText=""
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <TouchableOpacity
          onPress={() => {
            sigRef.current?.clearSignature();
            setIsEmpty(true);
            onChange?.(null);
          }}
          style={styles.clearBtn}
          testID="sigpad-clear"
        >
          <Ionicons name="refresh" size={14} color={COLORS.textSecondary} />
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? (
        <Text style={styles.hint}>
          Use your stylus or mouse to sign in the box above.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Sign in the box above using your finger or stylus.
        </Text>
      )}
    </View>
  );
});

export default SignaturePad;

const styles = StyleSheet.create({
  wrap: { marginVertical: 6 },
  box: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  label: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#F3F4F6',
  },
  clearText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12 },
  hint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
});
