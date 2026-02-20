import { expect } from 'chai';
import { HealingTier } from '../../src/services/healing/types';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { FuzzyXmlHealingProvider } from '../../src/services/healing/FuzzyXmlHealingProvider';
import { Container } from 'typedi';
import { HealedLocatorGenerator } from '../../src/services/healing/HealedLocatorGenerator';

// Ensure DI container has the generator registered
Container.set(HealedLocatorGenerator, new HealedLocatorGenerator());

describe('FuzzyXmlHealingProvider', () => {
  let provider: FuzzyXmlHealingProvider;
  let mockEtalonService: any;

  // iOS page source: "Truck" button has been renamed to "Fleet"
  const iosPageSource = `<?xml version="1.0" encoding="UTF-8"?>
    <AppiumAUT>
      <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Food Truck" label="Food Truck" enabled="true" visible="true" accessible="false" x="0" y="0" width="428" height="926">
        <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" accessible="false" x="0" y="0" width="428" height="926">
          <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" accessible="false" x="0" y="0" width="428" height="926">
            <XCUIElementTypeButton type="XCUIElementTypeButton" name="Fleet" label="Fleet" enabled="true" visible="true" accessible="true" x="20" y="161" width="388" height="44" />
            <XCUIElementTypeButton type="XCUIElementTypeButton" name="Deliveries" label="Deliveries" enabled="true" visible="true" accessible="true" x="20" y="205" width="388" height="44" />
            <XCUIElementTypeButton type="XCUIElementTypeButton" name="Social Feed" label="Social Feed" enabled="true" visible="true" accessible="true" x="20" y="249" width="388" height="44" />
            <XCUIElementTypeImage type="XCUIElementTypeImage" name="truck.box" label="truck.box" enabled="true" visible="true" accessible="false" x="36" y="215" width="20" height="20" />
            <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Deliveries" label="Deliveries" enabled="true" visible="true" accessible="false" x="72" y="205" width="300" height="44" />
          </XCUIElementTypeOther>
        </XCUIElementTypeWindow>
      </XCUIElementTypeApplication>
    </AppiumAUT>`;

  // Android page source: "Submit" button renamed to "Send"
  const androidPageSource = `<?xml version="1.0" encoding="UTF-8"?>
    <hierarchy>
      <android.widget.FrameLayout index="0" bounds="[0,0][1080,1920]">
        <android.widget.LinearLayout index="0" bounds="[0,0][1080,1920]">
          <android.widget.Button index="0" text="Send" resource-id="com.example:id/submit_btn" content-desc="Send action" bounds="[48,1584][1032,1680]" />
          <android.widget.TextView index="1" text="Hello World" bounds="[48,1700][1032,1750]" />
          <android.widget.ImageView index="2" content-desc="Logo" bounds="[400,100][680,300]" />
        </android.widget.LinearLayout>
      </android.widget.FrameLayout>
    </hierarchy>`;

  beforeEach(() => {
    mockEtalonService = {
      getSignature: async (_selector: string) => null,
      saveSignature: async () => {},
    };
    provider = new FuzzyXmlHealingProvider(mockEtalonService as HealEtalonService);
  });

  // ============================================================
  // TEST 1: First candidate fails, second candidate succeeds (Fallback)
  // ============================================================
  it('should fall back to second candidate when first candidate fails', async () => {
    // Etalon: We knew this element as "Orders" at position (20, 205)
    mockEtalonService.getSignature = async () => ({
      selector: " //XCUIElementTypeButton[@name='Orders']",
      strategy: 'xpath',
      attributes: {
        name: 'Orders',
        label: 'Orders',
        x: '20',
        y: '205',
        width: '388',
        height: '44',
      },
      nodeName: 'XCUIElementTypeButton',
      lastSeen: Date.now(),
    });

    const triedCandidates: string[] = [];

    const mockDriver = {
      findElement: async (_strategy: string, selector: string) => {
        triedCandidates.push(selector);

        // FIRST candidate fails (simulating a locator that doesn't resolve)
        if (triedCandidates.length === 1) {
          throw new Error('no such element');
        }

        // SECOND candidate succeeds
        return { ELEMENT: 'healed-via-fallback-123' };
      },
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: " //XCUIElementTypeButton[@name='Orders']",
      pageSource: iosPageSource,
    };

    const result = await provider.heal(context as any);

    // Verify healing succeeded
    expect(result).to.not.be.null;
    expect(result?.id).to.equal('healed-via-fallback-123');
    expect(result?.tier).to.equal(HealingTier.TIER_2_FUZZY_XML);

    // Verify that at least 2 candidates were tried (first failed, second succeeded)
    expect(triedCandidates.length).to.be.greaterThanOrEqual(2);
    console.log(`    ✓ Tried ${triedCandidates.length} candidates before success:`);
    triedCandidates.forEach((c, i) => console.log(`      ${i + 1}. ${c}`));
  });

  // ============================================================
  // TEST 2: Tag gate rejects wrong element types
  // ============================================================
  it('should reject wrong element types via tag gate (XCUIElementTypeImage should not match XCUIElementTypeButton)', async () => {
    // Etalon: We're looking for a Button
    mockEtalonService.getSignature = async () => ({
      selector: " //XCUIElementTypeButton[@name='Orders']",
      strategy: 'xpath',
      attributes: {
        name: 'Orders',
        label: 'Orders',
        x: '20',
        y: '205',
      },
      nodeName: 'XCUIElementTypeButton',
      lastSeen: Date.now(),
    });

    let resolvedSelector = '';

    const mockDriver = {
      findElement: async (_strategy: string, selector: string) => {
        resolvedSelector = selector;
        return { ELEMENT: 'correct-button-456' };
      },
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: " //XCUIElementTypeButton[@name='Orders']",
      pageSource: iosPageSource,
    };

    const result = await provider.heal(context as any);

    expect(result).to.not.be.null;
    // The resolved element should be a Button (Deliveries), NOT an Image (truck.box)
    if (resolvedSelector) {
      expect(resolvedSelector).to.not.contain('truck.box');
      expect(resolvedSelector).to.not.contain('XCUIElementTypeImage');
      console.log(`    ✓ Resolved to: ${resolvedSelector} (not truck.box image)`);
    }
  });

  // ============================================================
  // TEST 3: Spatial matching picks correct element at same position
  // ============================================================
  it('should select Deliveries (at Y=205) over Fleet (at Y=161) based on spatial match', async () => {
    // Etalon: "Orders" was at (20, 205) — Deliveries is at the same position
    mockEtalonService.getSignature = async () => ({
      selector: " //XCUIElementTypeButton[@name='Orders']",
      strategy: 'xpath',
      attributes: {
        name: 'Orders',
        label: 'Orders',
        x: '20',
        y: '205',
        width: '388',
        height: '44',
      },
      nodeName: 'XCUIElementTypeButton',
      lastSeen: Date.now(),
    });

    let resolvedSelector = '';

    const mockDriver = {
      findElement: async (_strategy: string, selector: string) => {
        resolvedSelector = selector;
        return { ELEMENT: 'deliveries-789' };
      },
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: " //XCUIElementTypeButton[@name='Orders']",
      pageSource: iosPageSource,
    };

    const result = await provider.heal(context as any);

    expect(result).to.not.be.null;
    expect(result?.id).to.equal('deliveries-789');

    // Should resolve to Deliveries, NOT Fleet
    expect(resolvedSelector).to.contain('Deliveries');
    expect(resolvedSelector).to.not.contain('Fleet');
    console.log(`    ✓ Spatial match selected: ${resolvedSelector} (correct position)`);
  });

  // ============================================================
  // TEST 4: Android bounds format parsing works for spatial matching
  // ============================================================
  it('should parse Android bounds="[x1,y1][x2,y2]" format for spatial matching', async () => {
    // Etalon: "Submit" was at (48, 1584) on Android
    mockEtalonService.getSignature = async () => ({
      selector: "//android.widget.Button[@text='Submit']",
      strategy: 'xpath',
      attributes: {
        text: 'Submit',
        'resource-id': 'com.example:id/submit_btn',
        x: '48',
        y: '1584',
        width: '984',
        height: '96',
      },
      nodeName: 'android.widget.Button',
      lastSeen: Date.now(),
    });

    let resolvedSelector = '';

    const mockDriver = {
      findElement: async (_strategy: string, selector: string) => {
        resolvedSelector = selector;
        return { ELEMENT: 'android-healed-101' };
      },
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: "//android.widget.Button[@text='Submit']",
      pageSource: androidPageSource,
    };

    const result = await provider.heal(context as any);

    expect(result).to.not.be.null;
    expect(result?.id).to.equal('android-healed-101');
    // Should NOT match ImageView (Logo at y=100) — tag gate eliminates it
    expect(resolvedSelector).to.not.contain('ImageView');
    console.log(`    ✓ Android spatial match resolved: ${resolvedSelector}`);
  });

  // ============================================================
  // TEST 5: All candidates fail returns null
  // ============================================================
  it('should return null when ALL candidate locators fail', async () => {
    mockEtalonService.getSignature = async () => ({
      selector: " //XCUIElementTypeButton[@name='Orders']",
      strategy: 'xpath',
      attributes: {
        name: 'Orders',
        label: 'Orders',
        x: '20',
        y: '205',
      },
      nodeName: 'XCUIElementTypeButton',
      lastSeen: Date.now(),
    });

    let attemptCount = 0;

    const mockDriver = {
      findElement: async () => {
        attemptCount++;
        throw new Error('no such element');
      },
    };

    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: " //XCUIElementTypeButton[@name='Orders']",
      pageSource: iosPageSource,
    };

    const result = await provider.heal(context as any);

    expect(result).to.be.null;
    // Should have tried multiple candidates before giving up
    expect(attemptCount).to.be.greaterThan(1);
    console.log(`    ✓ Tried ${attemptCount} candidates, all failed → returned null correctly`);
  });

  // ============================================================
  // TEST 6: No etalon — keyword-only fallback works
  // ============================================================
  it('should work without etalon using keyword-only fuzzy matching', async () => {
    // No etalon stored — pure keyword matching
    mockEtalonService.getSignature = async () => null;

    const mockDriver = {
      findElement: async (_strategy: string, _selector: string) => {
        return { ELEMENT: 'keyword-match-202' };
      },
    };

    // Looking for something with "Deliveries" as a keyword
    const context = {
      sessionId: 'test-session',
      driver: mockDriver,
      strategy: 'xpath',
      selector: "//XCUIElementTypeButton[@name='Deliveries']",
      pageSource: iosPageSource,
    };

    const result = await provider.heal(context as any);

    expect(result).to.not.be.null;
    expect(result?.id).to.equal('keyword-match-202');
    console.log(`    ✓ Keyword-only match succeeded: ${result?.recommendedSelector}`);
  });
});
