import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { InspectorService, InspectorNode } from '../../src/services/InspectorService';
import { SessionManager } from '../../src/sessions/SessionManager';

/**
 * The inspector has to read two different Android hierarchies as one thing.
 *
 *   `uiautomator dump`  ->  <hierarchy><node class="android.widget.Button" …>
 *   Appium page source  ->  <hierarchy><android.widget.Button class="…" …>
 *
 * Only the first was ever parsed, and only the second is obtainable while a
 * session holds the device — Android allows one UiAutomator instrumentation at
 * a time, so the dump is killed while uiautomator2 is running. That is why
 * inspecting a device under test produced an empty tree.
 */

// Real shape, trimmed: two sibling roots (an app window and an IME window),
// duplicate resource-id, and same-class siblings.
const DUMP_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.x" content-desc="" bounds="[0,0][1080,2094]">
    <node index="0" text="Sign in" resource-id="com.x:id/title" class="android.widget.TextView" package="com.x" content-desc="" bounds="[0,0][1080,200]" />
    <node index="1" text="Go" resource-id="com.x:id/dup" class="android.widget.Button" package="com.x" content-desc="go-btn" bounds="[0,200][540,400]" />
    <node index="2" text="Stop" resource-id="com.x:id/dup" class="android.widget.Button" package="com.x" content-desc="" bounds="[540,200][1080,400]" />
  </node>
  <node index="1" text="" resource-id="" class="android.inputmethodservice.SoftInputWindow" package="com.ime" content-desc="" bounds="[0,1500][1080,2094]" />
</hierarchy>`;

// The same screen as Appium serves it: class names as tags. `index` is the
// child's position under its parent — the only thing that survives
// fast-xml-parser grouping same-named tags together.
const APPIUM_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2094">
  <android.widget.FrameLayout index="0" package="com.x" class="android.widget.FrameLayout" text="" content-desc="" bounds="[0,0][1080,2094]" displayed="true">
    <android.widget.TextView index="0" package="com.x" class="android.widget.TextView" text="Sign in" resource-id="com.x:id/title" content-desc="" bounds="[0,0][1080,200]" />
    <android.widget.Button index="1" package="com.x" class="android.widget.Button" text="Go" resource-id="com.x:id/dup" content-desc="go-btn" bounds="[0,200][540,400]" />
    <android.widget.Button index="3" package="com.x" class="android.widget.Button" text="Stop" resource-id="com.x:id/dup" content-desc="" bounds="[540,200][1080,400]" />
    <android.widget.ImageView index="2" package="com.x" class="android.widget.ImageView" text="" content-desc="logo" bounds="[0,400][200,600]" />
  </android.widget.FrameLayout>
</hierarchy>`;

const IOS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" x="0" y="0" width="390" height="844">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="done" label="Done" x="10" y="20" width="100" height="40" />
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

function makeService(): any {
  return new InspectorService(null as any);
}

function parse(xml: string, platform: string): InspectorNode {
  return makeService().parseXmlHierarchy(xml, platform);
}

function find(root: InspectorNode, predicate: (n: InspectorNode) => boolean): InspectorNode[] {
  const out: InspectorNode[] = [];
  const walk = (n: InspectorNode) => {
    if (predicate(n)) out.push(n);
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

function locator(node: InspectorNode, strategy: string) {
  return node.suggestedLocators.find((l) => l.strategy === strategy);
}

describe('InspectorService hierarchy parsing', () => {
  describe('Android — Appium page source shape', () => {
    it('reads class-named tags as elements instead of collapsing to one node', () => {
      const root = parse(APPIUM_XML, 'android');
      const buttons = find(root, (n) => n.type === 'android.widget.Button');
      expect(buttons.map((b) => b.text)).to.deep.equal(['Go', 'Stop']);
    });

    it('orders siblings by document position, not by the tag grouping the parser applies', () => {
      const root = parse(APPIUM_XML, 'android');
      const frame = root.children[0];
      // The parser hands back {Button: [Go, Stop], ImageView: logo}; ImageView
      // sits at index 2, between the two buttons, and has to land there.
      expect(frame.children.map((c) => c.type)).to.deep.equal([
        'android.widget.TextView',
        'android.widget.Button',
        'android.widget.ImageView',
        'android.widget.Button',
      ]);
    });

    it('numbers positional xpath per class, following that document order', () => {
      const root = parse(APPIUM_XML, 'android');
      const stop = find(root, (n) => n.text === 'Stop')[0];
      expect(stop.xpath).to.equal(
        '/hierarchy[1]/android.widget.FrameLayout[1]/android.widget.Button[2]',
      );
    });
  });

  describe('Android — uiautomator dump shape', () => {
    it('still parses the dump the device produces when no session is running', () => {
      const root = parse(DUMP_XML, 'android');
      const buttons = find(root, (n) => n.type === 'android.widget.Button');
      expect(buttons.map((b) => b.text)).to.deep.equal(['Go', 'Stop']);
    });

    it('keeps every window, not just the first', () => {
      // A dialog or an open IME makes the dump multi-rooted. Anchoring on the
      // first root silently hid the rest.
      const root = parse(DUMP_XML, 'android');
      expect(root.children.map((c) => c.type)).to.deep.equal([
        'android.widget.FrameLayout',
        'android.inputmethodservice.SoftInputWindow',
      ]);
    });

    it('produces the same tree the Appium source does', () => {
      const shapes = [parse(DUMP_XML, 'android'), parse(APPIUM_XML, 'android')];
      const paths = shapes.map((root) => find(root, (n) => n.text === 'Go')[0].xpath);
      expect(paths[0]).to.equal(paths[1]);
    });
  });

  describe('generated locators', () => {
    it('roots the absolute xpath at the document element Appium evaluates against', () => {
      const root = parse(APPIUM_XML, 'android');
      expect(root.xpath).to.equal('/hierarchy[1]');
      expect(root.children[0].xpath).to.equal('/hierarchy[1]/android.widget.FrameLayout[1]');
    });

    it('uses the fully-qualified class as the xpath tag, not its last segment', () => {
      const root = parse(APPIUM_XML, 'android');
      const title = find(root, (n) => n.text === 'Sign in')[0];
      // `//TextView[...]` matches nothing in Appium's document.
      expect(locator(title, 'xpath')!.value).to.equal(
        '//android.widget.TextView[@resource-id="com.x:id/title"]',
      );
    });

    it('offers no locator for the document root', () => {
      // `/hierarchy[1]` resolves to 0 elements through a real driver — the
      // document element is not selectable. Suggesting it, badged unique, is
      // a claim the Verify button contradicts every time.
      [parse(APPIUM_XML, 'android'), parse(DUMP_XML, 'android')].forEach((root) => {
        expect(root.type).to.equal('hierarchy');
        expect(root.suggestedLocators).to.deep.equal([]);
        expect(root.suggestedActions).to.deep.equal([]);
      });
    });

    it('still offers locators for every element beneath it', () => {
      const root = parse(APPIUM_XML, 'android');
      const elements = find(root, (n) => n !== root);
      expect(elements.length).to.be.greaterThan(0);
      elements.forEach((n) => expect(n.suggestedLocators.length).to.be.greaterThan(0));
    });

    it('marks a resource-id shared by two elements as not unique', () => {
      const root = parse(APPIUM_XML, 'android');
      const go = find(root, (n) => n.text === 'Go')[0];
      expect(locator(go, 'id')!.value).to.equal('com.x:id/dup');
      expect(locator(go, 'id')!.unique).to.equal(false);
      expect(locator(go, '-android uiautomator')!.unique).to.equal(false);
    });

    it('marks a resource-id held by exactly one element as unique', () => {
      const root = parse(APPIUM_XML, 'android');
      const title = find(root, (n) => n.text === 'Sign in')[0];
      expect(locator(title, 'id')!.unique).to.equal(true);
    });

    it('counts uniqueness identically whichever shape the tree arrived in', () => {
      const fromDump = find(parse(DUMP_XML, 'android'), (n) => n.text === 'Go')[0];
      const fromAppium = find(parse(APPIUM_XML, 'android'), (n) => n.text === 'Go')[0];
      expect(locator(fromDump, 'id')!.unique).to.equal(locator(fromAppium, 'id')!.unique);
      expect(locator(fromDump, 'accessibility id')!.unique).to.equal(
        locator(fromAppium, 'accessibility id')!.unique,
      );
    });
  });

  describe('attribute typing', () => {
    // The parser runs with parseAttributeValue, so text="22" arrives as the
    // number 22. Every consumer treats text and name as strings — the tree
    // view slices them — and a lock-screen clock was enough to crash the
    // panel with `text.slice is not a function`.
    const NUMERIC_TEXT = `<hierarchy rotation="0">
      <node index="0" class="android.widget.FrameLayout" bounds="[0,0][1080,2094]">
        <node index="0" text="22" resource-id="" class="android.widget.TextView" bounds="[0,0][100,50]" />
        <node index="1" text="0" resource-id="" class="android.widget.TextView" bounds="[0,50][100,100]" />
      </node>
    </hierarchy>`;

    it('hands back text as a string even when the value looks numeric', () => {
      const root = parse(NUMERIC_TEXT, 'android');
      const texts = find(root, (n) => n.type === 'android.widget.TextView').map((n) => n.text);
      expect(texts).to.deep.equal(['22', '0']);
      texts.forEach((t) => expect(t).to.be.a('string'));
    });

    it('hands back name as a string too', () => {
      const root = parse(NUMERIC_TEXT, 'android');
      find(root, (n) => n.type === 'android.widget.TextView').forEach((n) =>
        expect(n.name).to.be.a('string'),
      );
    });

    it('coerces iOS label and value the same way', () => {
      const xml = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="1" label="22" x="0" y="0" width="10" height="10" /></AppiumAUT>`;
      const root = parse(xml, 'ios');
      expect(root.text).to.equal('22');
      expect(root.name).to.equal('1');
    });
  });

  describe('iOS', () => {
    it('parses the XCUIElementType tree unchanged', () => {
      const root = parse(IOS_XML, 'ios');
      expect(root.type).to.equal('XCUIElementTypeApplication');
      expect(root.xpath).to.equal('/XCUIElementTypeApplication[1]');
      const button = find(root, (n) => n.type === 'XCUIElementTypeButton')[0];
      expect(button.xpath).to.equal(
        '/XCUIElementTypeApplication[1]/XCUIElementTypeWindow[1]/XCUIElementTypeButton[1]',
      );
      expect(locator(button, 'accessibility id')!.value).to.equal('done');
      expect(locator(button, 'accessibility id')!.unique).to.equal(true);
    });
  });
});

describe('InspectorService page source origin', () => {
  const originalSessionManager = Container.get(SessionManager);

  function stubSessions(sessions: Record<string, any>) {
    Container.set(SessionManager, {
      getSession: (id: string) => sessions[id],
    } as any);
  }

  afterEach(() => {
    Container.set(SessionManager, originalSessionManager);
  });

  function managerReturning(xml: string, calls: string[]) {
    return {
      getPageSource: async (udid: string) => {
        calls.push(udid);
        return xml;
      },
    } as any;
  }

  it('prefers the live session, and never touches the device when it answers', async () => {
    const calls: string[] = [];
    stubSessions({
      'sess-1': { getId: () => 'sess-1', getPageSource: async () => APPIUM_XML },
    });
    const result = await makeService().capturePageSource(
      'udid-1',
      { session_id: 'sess-1' },
      managerReturning(DUMP_XML, calls),
    );
    expect(result.origin).to.equal('appium-session');
    expect(result.sessionId).to.equal('sess-1');
    expect(result.xml).to.equal(APPIUM_XML);
    expect(calls).to.deep.equal([]);
  });

  it('falls back to the device when the session throws', async () => {
    const calls: string[] = [];
    stubSessions({
      'sess-1': {
        getId: () => 'sess-1',
        getPageSource: async () => {
          throw new Error('driver gone');
        },
      },
    });
    const result = await makeService().capturePageSource(
      'udid-1',
      { session_id: 'sess-1' },
      managerReturning(DUMP_XML, calls),
    );
    expect(result.origin).to.equal('device');
    expect(result.sessionId).to.equal(null);
    expect(calls).to.deep.equal(['udid-1']);
  });

  it('falls back to the device when the session answers with nothing', async () => {
    const calls: string[] = [];
    stubSessions({ 'sess-1': { getId: () => 'sess-1', getPageSource: async () => '' } });
    const result = await makeService().capturePageSource(
      'udid-1',
      { session_id: 'sess-1' },
      managerReturning(DUMP_XML, calls),
    );
    expect(result.origin).to.equal('device');
    expect(calls).to.deep.equal(['udid-1']);
  });

  it('does not mistake the dashboard manual lock for a driver', async () => {
    const calls: string[] = [];
    // A manual lock is the dashboard holding the device for preview or
    // recording. Looking it up as a session would find nothing; asking it for
    // a page source is meaningless.
    stubSessions({
      manual_user1_udid1: { getId: () => 'x', getPageSource: async () => APPIUM_XML },
    });
    const result = await makeService().capturePageSource(
      'udid-1',
      { session_id: 'manual_user1_udid1' },
      managerReturning(DUMP_XML, calls),
    );
    expect(result.origin).to.equal('device');
    expect(calls).to.deep.equal(['udid-1']);
  });

  it('raises the blocked-dump reason rather than returning an empty tree', async () => {
    stubSessions({
      'sess-1': {
        getId: () => 'sess-1',
        getPageSource: async () => {
          throw new Error('driver gone');
        },
      },
    });
    let message = '';
    try {
      await makeService().capturePageSource(
        'udid-1',
        { session_id: 'sess-1' },
        managerReturning('', []),
      );
    } catch (err: any) {
      message = err.message;
    }
    expect(message).to.contain('UiAutomator instrumentation');
  });

  it('explains an empty device read when no session is involved', async () => {
    stubSessions({});
    let message = '';
    try {
      await makeService().capturePageSource(
        'udid-1',
        { session_id: null },
        managerReturning('', []),
      );
    } catch (err: any) {
      message = err.message;
    }
    expect(message).to.contain('FLAG_SECURE');
  });
});
