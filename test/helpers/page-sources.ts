import { DOMParser } from '@xmldom/xmldom';
// @ts-ignore
import { select as xpathSelect } from 'xpath';

/**
 * Page sources shaped like the drivers' own (UiAutomator2's `hierarchy`,
 * XCUITest's `AppiumAUT`), and a driver that answers finds by running the
 * XPath on them, as the real drivers do, for specs that check which element a
 * healed locator selects. No phone.
 */

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

const attrs = (o: Record<string, string | number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

function androidNode(
  tag: string,
  index: number,
  bounds: string,
  extra: Record<string, string> = {},
  children?: string,
) {
  const a = attrs({
    index,
    package: 'com.example.shop',
    class: tag,
    text: '',
    'resource-id': '',
    'content-desc': '',
    checkable: 'false',
    checked: 'false',
    clickable: 'false',
    enabled: 'true',
    focusable: 'false',
    focused: 'false',
    'long-clickable': 'false',
    password: 'false',
    scrollable: 'false',
    selected: 'false',
    bounds,
    displayed: 'true',
    ...extra,
  });
  return children === undefined ? `<${tag} ${a} />` : `<${tag} ${a}>${children}</${tag}>`;
}

export const android = {
  button: (index: number, id: string, text: string, bounds: string) =>
    androidNode('android.widget.Button', index, bounds, {
      'resource-id': `com.example.shop:id/${id}`,
      text,
      'content-desc': text,
      clickable: 'true',
      focusable: 'true',
    }),
  field: (index: number, id: string, text: string, bounds: string) =>
    androidNode('android.widget.EditText', index, bounds, {
      'resource-id': `com.example.shop:id/${id}`,
      text,
      clickable: 'true',
      focusable: 'true',
    }),
  layout: (index: number, id: string, bounds: string, children: string) =>
    androidNode(
      'android.widget.LinearLayout',
      index,
      bounds,
      { 'resource-id': id ? `com.example.shop:id/${id}` : '' },
      children,
    ),
  page: (children: string) =>
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>` +
    `<hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2220">` +
    androidNode('android.widget.FrameLayout', 0, '[0,0][1080,2220]', {}, children) +
    `</hierarchy>`,
};

function iosNode(type: string, a: Record<string, string | number>, children = '') {
  return `<${type} ${attrs({ type, enabled: 'true', visible: 'true', accessible: 'true', ...a })}>${children}</${type}>`;
}

export const ios = {
  button: (name: string, label: string, y: number) =>
    iosNode('XCUIElementTypeButton', { name, label, x: 20, y, width: 350, height: 44 }),
  field: (name: string, value: string, y: number) =>
    iosNode('XCUIElementTypeTextField', { name, value, x: 20, y, width: 350, height: 44 }),
  group: (children: string) =>
    iosNode('XCUIElementTypeOther', { x: 0, y: 100, width: 390, height: 600 }, children),
  page: (children: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><AppiumAUT>` +
    iosNode(
      'XCUIElementTypeApplication',
      { name: 'Shop', label: 'Shop', x: 0, y: 0, width: 390, height: 844 },
      iosNode('XCUIElementTypeWindow', { x: 0, y: 0, width: 390, height: 844 }, children),
    ) +
    `</AppiumAUT>`,
};

/** The element id the fake driver gives an element: its resource-id or name. */
export function elementIdOf(el: Element): string {
  return `el:${el.getAttribute('resource-id') || el.getAttribute('name') || el.tagName}`;
}

/**
 * A driver showing `pageSource`: finds run the XPath on it and answer the
 * first match, attributes and rects are the element's own. `show` changes the
 * screen.
 */
export function pageDriver(pageSource: string) {
  let doc = new DOMParser().parseFromString(pageSource, 'text/xml');
  let source = pageSource;
  const known = new Map<string, Element>();
  const select = (using: string, value: string): Element[] => {
    if (using !== 'xpath') throw new Error(`unsupported locator strategy ${using}`);
    return (xpathSelect(value, doc as any) as Element[]).filter((n) => n.nodeType === 1);
  };
  const ref = (el: Element) => {
    const id = elementIdOf(el);
    known.set(id, el);
    return { ELEMENT: id, [W3C_ELEMENT_KEY]: id };
  };
  const element = (id: string) => {
    const el = known.get(id);
    if (!el) throw new Error(`no element ${id}`);
    return el;
  };
  return {
    show(next: string) {
      source = next;
      doc = new DOMParser().parseFromString(next, 'text/xml');
    },
    async getPageSource() {
      return source;
    },
    async findElement(using: string, value: string) {
      const [first] = select(using, value);
      if (!first) {
        throw Object.assign(new Error('NoSuchElement: An element could not be located'), {
          name: 'NoSuchElementError',
        });
      }
      return ref(first);
    },
    async findElements(using: string, value: string) {
      return select(using, value).map(ref);
    },
    async getElementAttribute(id: string, name: string) {
      const value = element(id).getAttribute(name);
      return value === '' ? null : value;
    },
    async getName(id: string) {
      return element(id).tagName;
    },
    async getElementRect(id: string) {
      const el = element(id);
      const bounds = el.getAttribute('bounds');
      if (bounds) {
        const [x1, y1, x2, y2] = (bounds.match(/\d+/g) ?? []).map(Number);
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      }
      return {
        x: Number(el.getAttribute('x')),
        y: Number(el.getAttribute('y')),
        width: Number(el.getAttribute('width')),
        height: Number(el.getAttribute('height')),
      };
    },
  };
}
