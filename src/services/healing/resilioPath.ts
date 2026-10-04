import { DOMParser } from '@xmldom/xmldom';
const {
  HeuristicNodeDistance,
  LCSPathDistance,
  NodeBuilder,
  Path,
  PathFinder,
} = require('resiliotree');

/**
 * The Resilio healing tier's view of a page source: an element's path from
 * the root of the driver's element tree, as resiliotree compares paths.
 *
 * The page source is parsed as the XML it is. Through 2.14 it went through
 * resiliotree's HTML parser, which lowercases every tag
 * (`android.widget.button`, which the drivers' XPath doesn't match) and nests
 * every element written `<x/>` around its next siblings.
 *
 * A path is stored with the selector's fingerprint (`LocatorEtalon.path`).
 * Each node keeps what resiliotree compares (tag, id, labels, index, other
 * attributes), not its children or text, so a path is a few kilobytes.
 */

/** Marks a path made here. A path without it (an HTML parse, before 2.15) is not used. */
export const RESILIO_PATH_FORMAT = 'page-source-1';

export interface ResilioPathJson {
  format: typeof RESILIO_PATH_FORMAT;
  nodes: Array<Record<string, unknown>>;
}

/**
 * How sure Resilio must be. An element that kept its id scores about 0.99
 * after moving anywhere in the tree; once its id changed, or it is gone, the
 * best element scores about 0.55, and a neighbour of the same type comes
 * within a few hundredths of it. Below this, or with a second element as
 * close as MIN_LEAD, the next tier decides.
 */
export const MIN_SCORE = 0.8;
export const MIN_LEAD = 0.05;

type Platform = 'android' | 'ios' | 'other';

function platformOf(pageSource: string): Platform {
  if (/<XCUIElementType/.test(pageSource)) return 'ios';
  if (/<hierarchy[\s>]/.test(pageSource)) return 'android';
  return 'other';
}

const isElement = (n: any): n is Element => !!n && n.nodeType === 1;

function childElements(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (isElement(c)) out.push(c);
  return out;
}

/**
 * One element as a resiliotree node, without children. The platform decides
 * what its id is: Android's resource-id, iOS's name, else `id`.
 */
function nodeBuilderFor(el: Element, index: number, platform: Platform) {
  const attributes = new Map<string, string>();
  for (let i = 0; i < el.attributes.length; i++) {
    attributes.set(el.attributes[i].name, el.attributes[i].value);
  }
  const builder = new NodeBuilder().setTag(el.tagName).setIndex(index);
  if (platform === 'android') builder.setAndroidAttributes(attributes);
  else if (platform === 'ios') builder.setIOSAttributes(attributes);
  else builder.setAttributes(attributes);
  return builder;
}

function parse(pageSource: string): Document {
  return new DOMParser({
    errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
  }).parseFromString(pageSource, 'text/xml');
}

/** The page source as a resiliotree tree, each node knowing its element. */
function treeOf(pageSource: string): { root: any; elementOf: Map<any, Element> } | null {
  const doc = parse(pageSource);
  const top = doc?.documentElement;
  if (!isElement(top)) return null;
  const platform = platformOf(pageSource);
  const elementOf = new Map<any, Element>();
  const build = (el: Element, index: number): any => {
    const builder = nodeBuilderFor(el, index, platform);
    childElements(el).forEach((child, i) => builder.addChild(build(child, i)));
    const node = builder.build();
    elementOf.set(node, el);
    return node;
  };
  return { root: build(top, 0), elementOf };
}

function compact(node: any): Record<string, unknown> {
  const { children: _children, innerText: _text, ...rest } = node.toJSON();
  return rest;
}

/**
 * The path of an element of a parsed page source (an xmldom Element, as the
 * Fuzzy XML and Resilio tiers find them), from the root of the page source.
 * `pageSource` decides the platform. Null for anything that isn't such an
 * element.
 */
export function resilioPathOf(element: unknown, pageSource: string): ResilioPathJson | null {
  if (!isElement(element)) return null;
  const platform = platformOf(pageSource);
  const lineage: Element[] = [];
  for (let el: any = element; isElement(el); el = el.parentNode) lineage.unshift(el);
  const nodes = lineage.map((el) => {
    const parent = el.parentNode;
    const index = isElement(parent) ? childElements(parent).indexOf(el) : 0;
    return compact(nodeBuilderFor(el, index, platform).build());
  });
  return { format: RESILIO_PATH_FORMAT, nodes };
}

/** Whether `path` is one made here (not an older HTML parse). */
export function isResilioPath(path: unknown): path is ResilioPathJson {
  return (
    !!path &&
    typeof path === 'object' &&
    (path as ResilioPathJson).format === RESILIO_PATH_FORMAT &&
    Array.isArray((path as ResilioPathJson).nodes) &&
    (path as ResilioPathJson).nodes.length > 0
  );
}

/**
 * The element of the page source that the driver found, from its tag and the
 * attributes Xenon read from it (`name`/`value` pairs: resource-id, text,
 * name, label, ..., and x, y, width, height). The element of that tag with
 * the most of them; null when none matches, or two match equally well.
 */
export function findLearntElement(
  pageSource: string,
  nodeName: string,
  attributes: Array<{ name: string; value: string }>,
): Element | null {
  const doc = parse(pageSource);
  if (!isElement(doc?.documentElement)) return null;
  const tag = (nodeName || '').toLowerCase();
  const anyTag = !tag || tag === 'xcuielementtypeany' || tag === 'unknown';
  const wanted = new Map(attributes.map((a) => [a.name.toLowerCase(), String(a.value)]));
  const rect = ['x', 'y', 'width', 'height'].map((k) => wanted.get(k));

  const matchesOf = (el: Element) => {
    let n = 0;
    for (const [name, value] of wanted) {
      if (el.getAttribute(name) === value) n++;
    }
    // Android writes a rect as bounds="[x1,y1][x2,y2]".
    const bounds = el.getAttribute('bounds');
    if (bounds && rect.every((v) => v !== undefined)) {
      const [x, y, w, h] = rect.map(Number);
      if (bounds === `[${x},${y}][${x + w},${y + h}]`) n++;
    }
    return n;
  };

  let best: Element | null = null;
  let bestCount = 0;
  let tie = false;
  const walk = (el: Element) => {
    if (anyTag || el.tagName.toLowerCase() === tag) {
      const n = matchesOf(el);
      if (n > bestCount) {
        best = el;
        bestCount = n;
        tie = false;
      } else if (n > 0 && n === bestCount) {
        tie = true;
      }
    }
    childElements(el).forEach(walk);
  };
  walk(doc.documentElement);
  return tie ? null : best;
}

/**
 * The element of `pageSource` at the end of the path most like `path`, and
 * how alike they are (0 to 1). Null when no element scores MIN_SCORE, or
 * another comes within MIN_LEAD of the best: Resilio then has no answer.
 */
export function nearestElement(
  path: ResilioPathJson,
  pageSource: string,
): { element: Element; score: number } | null {
  const tree = treeOf(pageSource);
  if (!tree) return null;
  const finder = new PathFinder(new LCSPathDistance(), new HeuristicNodeDistance());
  const [best, second] = finder.find(Path.fromJSON(path), tree.root, 2);
  if (!best || best.score < MIN_SCORE) return null;
  if (second && best.score - second.score < MIN_LEAD) return null;
  const element = tree.elementOf.get(best.value);
  return element ? { element, score: best.score } : null;
}
