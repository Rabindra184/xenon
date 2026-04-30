---
title: Omni-Vision
---

# Omni-Vision (Visual Intelligence)

Omni-Vision is Xenon's visual intelligence layer. It enables **coordinate-free element interaction** and **visual assertions** — testing your app as a human sees it, not as the DOM describes it.

The implementation is **OCR-first**: every screen is run through Tesseract.js (with image preprocessing via `sharp` to clean small fonts and low-contrast text) to produce a list of on-screen text + bounding boxes. For matches that OCR can't disambiguate — visual descriptions, icon recognition, complex assertions — the configured LLM provider (Gemini / OpenAI / Anthropic) is used as a fallback over the same screenshot.

For interactive exploration and code generation powered by Omni-Vision, see the [OmniInspector](omni-inspector.md).

---

## Capabilities

### Visual Element Detection

Instead of fragile XPath or accessibility selectors, describe what you want to interact with:

```javascript
// Traditional approach (breaks when DOM changes):
driver.findElement(By.xpath("//XCUIElementTypeButton[@name='Submit Order']"));

// Omni-Vision approach (resilient to UI changes):
// Xenon exposes Omni-Vision as session-scoped plugin endpoints.
// Use the AI locator test endpoint with a custom strategy:
//
// POST /session/:sessionId/xenon/test-locator
// Body: { "strategy": "-custom:ai-icon", "selector": "the green Submit Order button at the bottom of the screen" }
//
// Returns: an array of matches with rect + confidence (virtual elements).
```

The returned coordinates are mapped to the device's actual screen resolution, accounting for DPI scaling and viewport offsets.

### Visual Assertions

Verify screen state using natural language instead of element queries:

```javascript
// Assert that a success message is visible
//
// POST /session/:sessionId/xenon/assert
// Body: { "instruction": "A green success toast message is visible at the top" }
//
// Returns: { "result": true/false, "message": "..." }
```

### Smart Interaction (Enterprise)

Omni‑Vision integrates with Xenon’s Omni‑Interaction layer:

- **`smartTap`**: `POST /session/:sessionId/xenon/smart-tap` — OCR-driven tap by visible text
- **`uiInventory`**: `POST /session/:sessionId/xenon/ui-inventory` — export UI metadata derived from OCR + lightweight heuristics

These commands can also be invoked via `executeScript` from any Appium client:

```java
// Java: Smart Tap
driver.executeScript("xe:smartTap", Map.of("text", "Submit", "index", 1, "takeANewScreenShot", true));

// Java: UI Inventory
driver.executeScript("xe:uiInventory", Map.of("maxItems", 200, "takeANewScreenShot", true));
```

**Aliases**: `xe:omniClick` → `smartTap`, `xe:uiScanExport` → `uiInventory`

---

## Architecture

```mermaid
graph LR
    A["Test Script"] --> B["Xenon Plugin"]
    B --> C["OmniVisionService"]
    C --> D1["Tesseract.js OCR"]
    C --> D2["AI Vision Fallback\n(Gemini/OpenAI/Anthropic)"]
    D1 --> E["Coordinate Mapping"]
    D2 --> E
    E --> F["Device Interaction"]
    C --> G["VisionAssertionService"]
    G --> D2
```

**OmniVisionService** handles:
- Screenshot capture and preprocessing (`sharp` — contrast adjustment, conditional upscaling)
- Tesseract.js OCR with a shared worker
- AI-vision fallback through the configured LLM provider for ambiguous cases
- Coordinate mapping from OCR/model output to device screen coordinates
- DPI and viewport offset correction
- A short-lived UI-lens cache (10 s TTL) to avoid repeated OCR on rapid calls

**VisionAssertionService** handles:
- Natural language assertion parsing
- Confidence scoring
- Pass/fail determination with explanation

---

## Integration with Self-Healing

Omni-Vision powers **Tier 4** of the [Self-Healing Engine](self-healing.md). When structural matching (Tiers 1–3) fails to find a broken element, the healing orchestrator falls back to visual detection:

1. Captures a screenshot of the current screen
2. Runs Tesseract.js OCR over the preprocessed screenshot
3. Tries to match the broken element's expected text against the OCR results
4. If OCR can't pin a unique match (or the element has no useful text), falls back to the AI-vision provider for description-based grounding
5. Returns coordinates for interaction

This makes Xenon's self-healing resilient even when the DOM changes completely — as long as the element is visually present on screen.

---

## Requirements

- **Tesseract.js** is bundled with the plugin — OCR works out of the box, no setup needed.
- **AI-vision fallback** requires a configured LLM provider. Set `XENON_AI_PROVIDER` and the matching API key (see [AI Features](ai-features.md)). Without this, Omni-Vision still works for OCR-driven flows but gracefully degrades on visually ambiguous matches.
- Screenshot capabilities must be enabled on the session.
- Works with both iOS and Android devices.

:::tip
Omni-Vision works best for elements with distinctive visual characteristics (unique text, icons, colors). For visually ambiguous elements (plain list items, generic buttons), structural matching in Tiers 1–3 is more reliable.
:::
