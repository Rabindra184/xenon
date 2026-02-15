import { expect } from 'chai';
import { HealingTier } from '../../src/services/healing/types';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { ResilioTreeHealingProvider } from '../../src/services/healing/ResilioTreeHealingProvider';
const { JSDOMParser, Path } = require('resiliotree');

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

  it('should heal an element when a ResilioTree path exists', async () => {
    const parser = new JSDOMParser();
    const root = parser.parse(sourceXml);

    // Find the button in source
    const bodyNode = root.children[0];
    const hierarchyNode = bodyNode.children[0];
    const frameLayout = hierarchyNode.children[0];
    const linearLayout = frameLayout.children[0];
    const buttonNode = linearLayout.children[0];

    const path = new Path([root, bodyNode, hierarchyNode, frameLayout, linearLayout, buttonNode]);

    mockEtalonService.getSignature = async () => ({
      selector: "//android.widget.Button[@text='Submit']",
      strategy: 'xpath',
      attributes: { text: 'Submit', 'resource-id': 'com.example:id/submit_btn' },
      nodeName: 'android.widget.Button',
      path: path.toJSON(),
      lastSeen: Date.now(),
    });

    const mockDriver = {
      findElement: async (strategy: string, selector: string) => {
        expect(strategy).to.equal('xpath');
        expect(selector.toLowerCase()).to.contain('android.widget.button');
        return { ELEMENT: 'healed-element-123' };
      },
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: "//android.widget.Button[@text='Submit']",
      pageSource: brokenXml,
    };

    const result = await provider.heal(context as any);

    expect(result).to.not.be.null;
    expect(result?.id).to.equal('healed-element-123');
    expect(result?.tier).to.equal(HealingTier.TIER_1_RECOVERY);
    expect(result?.message).to.contain('ResilioTree');
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
