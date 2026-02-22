---
title: OmniInspector (AI Diagnostics)
---

# AI-Powered OmniInspector

The OmniInspector is Xenon's premier tool for interactive mobile element exploration and test code generation. It leverages advanced AI heuristics to guide you toward the most stable and performant locator strategies for Appium 2.x.

---

## Smart Locator Stability Scoring

When you select an element, OmniInspector automatically evaluates all possible Appium locator strategies. Unlike basic inspectors that just list XPaths, OmniInspector **ranks** and **scores** them based on their reliability and speed in production environments.

### Strategy Priority (Appium 2.x Standard)
Following official Appium performance benchmarks, we rank strategies in this order:

| Priority | Strategy | Why? |
|----------|----------|------|
| **#1** | `Accessibility ID` | Fast and portable across Android (content-desc) and iOS (name). |
| **#2** | `Resource ID / ID` | High performance and generally stable within a platform. |
| **#3** | `Native (Predicate/UiAuto)` | High precision but platform-specific. |
| **#4** | `XPath` | **Last Resort.** Slow (10x slower on iOS) and often brittle. |

### Stability Levels
- 🛡️ **Stable**: High confidence, portable across releases.
- ⚠️ **Moderate**: Good for quick tests, may need review.
- 🟡 **Fragile**: Brittle. Likely to break on layout changes.
- 🛑 **Very Fragile**: **Avoid.** Specifically flags Absolute XPaths (`/hierarchy/...`) and Index-based XPaths (`[n]`).

---

## AI Element Insight

Selecting an element triggers the Xenon AI Engine to perform a **Multimodal Analysis**. The AI reasons over the screenshot and page source to provide:
- **Functional Role**: (e.g., "This is a primary Login CTA").
- **Interactability Check**: Verifies if the element is actually clickable based on its bounding box and enabled state.
- **Proactive Suggestions**: Identifies common pitfalls (e.g., "This element has no accessibility ID, using text-based matching instead").

---

## Universal Code Generator

Once you select a stable locator, OmniInspector can generate ready-to-use boilerplate for your test suite. It supports the latest **Appium 2.x / Selenium 4** syntax for four major frameworks:

- **☕ Java**: Appium Java Client 9.x using `AppiumBy`.
- **🐍 Python**: Appium-Python-Client 4.x.
- **🔷 WebdriverIO**: Version 9.x with native mobile selector shorthands (`~` for Accessibility ID).
- **🟨 JavaScript**: Standalone Appium-WebDriver patterns.

---

## Smart Search

Use natural language to find elements within a dense UI hierarchy.
- **Query**: "login button"
- **AI Action**: Filters the tree and highlights the elements that semantically match, even if the underlying `resource-id` or `text` is slightly different.

:::tip
Combine **Smart Search** with **AI Insight** to find and verify elements that aren't easily targetable through traditional DOM queries.
:::
