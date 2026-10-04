import 'reflect-metadata';
import { expect } from 'chai';
import { HealingTier } from '../../src/services/healing/types';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { ResilioTreeHealingProvider } from '../../src/services/healing/ResilioTreeHealingProvider';
import { DOMParser } from '@xmldom/xmldom';
import { resilioPathOf } from '../../src/services/healing/resilioPath';

describe('ResilioTreeHealingProvider', () => {
  let provider: ResilioTreeHealingProvider;
  let mockEtalonService: any;

  const sourceXml = `
        <hierarchy>
            <android.widget.FrameLayout index="0">
                <android.widget.LinearLayout index="0">
                    <android.widget.Button index="0" text="Submit" resource-id="com.example:id/submit_btn" />
                    <android.widget.TextView index="1" text="Hello" />
                </android.widget.LinearLayout>
            </android.widget.FrameLayout>
        </hierarchy>
    `;

  const brokenXml = `
        <hierarchy>
            <android.widget.FrameLayout index="0">
                <android.widget.LinearLayout index="0">
                    <android.widget.Button index="0" text="Send" resource-id="com.example:id/send_btn" />
                    <android.widget.TextView index="1" text="Hello World" />
                </android.widget.LinearLayout>
            </android.widget.FrameLayout>
        </hierarchy>
    `;

  beforeEach(() => {
    mockEtalonService = {
      getSignature: async () => null,
    };
    provider = new ResilioTreeHealingProvider(mockEtalonService as HealEtalonService);
  });

  // The button's id and text both changed, so it is another element as far as
  // its path can tell: Resilio leaves it to Fuzzy XML rather than guess. (This
  // test used to expect a heal, from a path made by an HTML parse and a driver
  // stub that accepted any XPath, including the lowercase one Resilio wrote,
  // which no real driver matches. See resilio-path-healing.spec.ts.)
  it('leaves an element whose id and text changed to the next tier', async () => {
    const doc = new DOMParser().parseFromString(sourceXml, 'text/xml');
    const button = doc.getElementsByTagName('android.widget.Button')[0];

    mockEtalonService.getSignature = async () => ({
      selector: "//android.widget.Button[@text='Submit']",
      strategy: 'xpath',
      attributes: { text: 'Submit', 'resource-id': 'com.example:id/submit_btn' },
      nodeName: 'android.widget.Button',
      path: resilioPathOf(button, sourceXml),
      lastSeen: Date.now(),
    });

    const mockDriver = {
      findElement: async () => ({ ELEMENT: 'any-element' }),
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: "//android.widget.Button[@text='Submit']",
      pageSource: brokenXml,
    };

    expect(await provider.heal(context as any)).to.equal(null);
  });

  it('heals the same element after the page changed around it', async () => {
    const doc = new DOMParser().parseFromString(sourceXml, 'text/xml');
    const button = doc.getElementsByTagName('android.widget.Button')[0];
    mockEtalonService.getSignature = async () => ({
      selector: "//android.widget.Button[@text='Submit']",
      strategy: 'xpath',
      attributes: {},
      nodeName: 'android.widget.Button',
      path: resilioPathOf(button, sourceXml),
      lastSeen: Date.now(),
    });
    // The button moved into a new row; it is still "Submit".
    const movedXml = sourceXml
      .replace(
        '<android.widget.Button index="0"',
        '<android.widget.LinearLayout index="0"><android.widget.Button index="0"',
      )
      .replace(
        'resource-id="com.example:id/submit_btn" />',
        'resource-id="com.example:id/submit_btn" /></android.widget.LinearLayout>',
      );
    const asked: string[] = [];
    const result = await provider.heal({
      sessionId: 'test-session',
      driver: {
        findElement: async (_using: string, selector: string) => {
          asked.push(selector);
          return { ELEMENT: 'healed-element-123' };
        },
      },
      strategy: 'xpath',
      selector: "//android.widget.Button[@text='Submit']",
      pageSource: movedXml,
    } as any);

    expect(result?.id).to.equal('healed-element-123');
    expect(result?.tier).to.equal(HealingTier.TIER_1_RECOVERY);
    expect(result?.message).to.contain('ResilioTree');
    // The element's own id, which it kept.
    expect(asked[0]).to.equal("//*[@resource-id='com.example:id/submit_btn']");
  });

  it('should return null if no signature/path is found', async () => {
    const context = {
      sessionId: 'test-session',
      driver: {},
      strategy: 'xpath',
      selector: '//unknown',
      pageSource: brokenXml,
    };

    const result = await provider.heal(context as any);
    expect(result).to.be.null;
  });
});
