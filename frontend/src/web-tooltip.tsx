/**
 * web-tooltip.tsx
 *
 * Lightweight hover-tooltip for WEB only. React Native Web does NOT
 * forward a `title` prop to the underlying DOM node, so we grab the DOM
 * node via a View ref and set `.title` directly — this yields the native
 * browser tooltip on hover. On native it's a transparent pass-through
 * (renders a plain View wrapper), so callers can use it everywhere.
 */
import React, { useEffect, useRef } from 'react';
import { Platform, View, StyleProp, ViewStyle } from 'react-native';

export function WebTooltip({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS === 'web' && ref.current && label) {
      try {
        // RN-Web View ref === the host <div>; set the native title attr.
        ref.current.title = label;
        if (ref.current.setAttribute) ref.current.setAttribute('title', label);
      } catch {}
    }
  }, [label]);
  return (
    <View ref={ref} style={style}>
      {children}
    </View>
  );
}
