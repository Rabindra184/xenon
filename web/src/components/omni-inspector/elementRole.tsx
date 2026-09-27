import React from 'react';
import {
  Box,
  Image as ImageIcon,
  Layers,
  MousePointerClick,
  PanelTop,
  ScrollText,
  TextCursorInput,
  ToggleLeft,
  Type,
} from 'lucide-react';
import type { InspectorNode } from './OmniInspector';

// =====================================================================
// Element role (for the summary's "By role" counts)
// =====================================================================
export type RoleKey =
  | 'button'
  | 'input'
  | 'image'
  | 'list'
  | 'text'
  | 'toggle'
  | 'nav'
  | 'container'
  | 'element';

export interface ElementRole {
  role: string;
  key: RoleKey;
}

/** What kind of element this looks like, from its type and flags. */
export function analyzeElement(node: InspectorNode): ElementRole {
  const type = (node.type || '').toLowerCase();
  const isClickable = node.attributes?.clickable === 'true' || node.attributes?.clickable === true;
  const isScrollable =
    node.attributes?.scrollable === 'true' || node.attributes?.scrollable === true;
  const childCount = node.children?.length || 0;

  if (type.includes('button') || type.includes('btn') || (isClickable && childCount === 0)) {
    return { role: 'Button', key: 'button' };
  }
  if (type.includes('edit') || type.includes('input') || type.includes('field')) {
    return { role: 'Text input', key: 'input' };
  }
  if (type.includes('image') || type.includes('img') || type.includes('imageview')) {
    return { role: 'Image', key: 'image' };
  }
  if (
    type.includes('scroll') ||
    type.includes('recyclerview') ||
    type.includes('listview') ||
    isScrollable
  ) {
    return { role: 'Scrollable list', key: 'list' };
  }
  if (type.includes('text') || type.includes('label')) return { role: 'Text label', key: 'text' };
  if (type.includes('switch') || type.includes('toggle') || type.includes('checkbox')) {
    return { role: 'Toggle or checkbox', key: 'toggle' };
  }
  if (type.includes('nav') || type.includes('toolbar') || type.includes('tabbar')) {
    return { role: 'Navigation bar', key: 'nav' };
  }
  if (childCount > 0) return { role: 'Container', key: 'container' };
  return { role: 'Element', key: 'element' };
}

export const ROLE_ICON: Record<RoleKey, React.ReactNode> = {
  button: <MousePointerClick size={13} />,
  input: <TextCursorInput size={13} />,
  image: <ImageIcon size={13} />,
  list: <ScrollText size={13} />,
  text: <Type size={13} />,
  toggle: <ToggleLeft size={13} />,
  nav: <PanelTop size={13} />,
  container: <Layers size={13} />,
  element: <Box size={13} />,
};
