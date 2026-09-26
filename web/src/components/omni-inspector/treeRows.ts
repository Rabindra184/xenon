import type { InspectorNode } from './OmniInspector';

// =====================================================================
// Search: plain-language matching over types, text and ids
// =====================================================================
export function smartSearch(node: InspectorNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();

  // Semantic role mappings
  const semanticMap: Record<string, string[]> = {
    button: ['button', 'btn', 'clickable', 'tapable'],
    input: ['edittext', 'input', 'field', 'textfield', 'textinput', 'edit'],
    image: ['image', 'imageview', 'img', 'picture', 'photo', 'icon'],
    text: ['textview', 'label', 'text', 'statictext'],
    list: ['listview', 'recyclerview', 'scrollview', 'tableview', 'collectionview', 'scroll'],
    toggle: ['switch', 'checkbox', 'toggle', 'radiobutton'],
    nav: ['toolbar', 'navigationbar', 'tabbar', 'actionbar', 'navbar'],
  };

  const typeStr = (node.type || '').toLowerCase();
  const textStr = (node.text || node.label || node.value || '').toLowerCase();
  const nameStr = (node.name || '').toLowerCase();
  const attrsStr = Object.values(node.attributes || {})
    .join(' ')
    .toLowerCase();

  // Check semantic aliases
  for (const [alias, variants] of Object.entries(semanticMap)) {
    if (q.includes(alias) && variants.some((v) => typeStr.includes(v))) {
      return true;
    }
  }

  // Direct match on type, text, name, or attributes
  return typeStr.includes(q) || textStr.includes(q) || nameStr.includes(q) || attrsStr.includes(q);
}
