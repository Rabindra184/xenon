// Shared by the guard test and its baseline generator.
export const COLOR_LITERAL =
  /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g;

/** Files that may hold raw colours by design. Everything else should use tokens. */
export const EXEMPT: Record<string, string> = {
  'src/tokens.css': 'defines the tokens',
  'src/components/mosaic/AnnotationOverlay.tsx': 'canvas 2D API cannot read CSS variables',
  'src/components/mosaic/recording-group-store.ts': 'default annotation colour is persisted data',
  'src/components/device-control/logcat/tagColor.ts': 'categorical data palette for log tags',
};

export function countColorLiterals(source: string): number {
  // Comments often quote colours ("#7a837f is 5.0:1"); they are not styling.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (code.match(COLOR_LITERAL) ?? []).length;
}
