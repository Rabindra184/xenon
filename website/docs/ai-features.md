---
title: AI Features
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# AI-Powered Intelligence

Xenon integrates large language models directly into the testing lifecycle — from **diagnosing failures** to **healing broken locators** to **finding elements by description**. Every AI feature is optional, requires zero code changes, and works with your existing test suites.

---

## LLM Provider Architecture

Xenon supports four LLM providers through a unified `LLMProvider` interface. Each provider supports multimodal analysis (screenshots + text), except Ollama which is text-only.

| Provider | Default Model | Multimodal | Environment Variable |
|----------|---------------|:----------:|---------------------|
| **Google Gemini** | `gemini-3-flash-preview` | [Yes] | `GEMINI_API_KEY` or `XENON_GEMINI_API_KEY` |
| **OpenAI** | `gpt-4o` | [Yes] | `OPENAI_API_KEY` or `XENON_OPENAI_API_KEY` |
| **Anthropic** | `claude-sonnet-4-6` | [Yes] | `ANTHROPIC_API_KEY` or `XENON_ANTHROPIC_API_KEY` |
| **Ollama** | `llama3` | [Model Dependent] | — (runs locally) |

### Configuration

<Tabs>
<TabItem value="env" label="Environment Variables" default>

```bash
# Choose your provider
export XENON_AI_PROVIDER=gemini        # gemini | openai | anthropic | ollama

# Set model (optional — defaults shown above)
export XENON_AI_MODEL=gemini-3-flash-preview

# Set API key for your chosen provider
export GEMINI_API_KEY=your-api-key

# For Ollama: set the base URL
export XENON_AI_BASE_URL=http://localhost:11434
```

</TabItem>
<TabItem value="config" label="Config File">

```yaml
server:
  plugin:
    xenon:
      aiProvider: gemini
      aiModel: gemini-3-flash-preview
      # aiBaseUrl: http://localhost:11434  # For Ollama
```

</TabItem>
<TabItem value="cli" label="CLI Flags">

```bash
appium server --use-plugins=xenon \
  --plugin-xenon-ai-provider=openai \
  --plugin-xenon-ai-model=gpt-4o
```

</TabItem>
</Tabs>

### Ollama Model Recommendations

When using Ollama locally, select a model based on your requirements:

| Model | Type | Best For | Requirement |
|-------|------|----------|-------------|
| **llava** | Multimodal | **Screen analysis**, Root-Cause Diagnosis, Omni-Vision | `ollama pull llava` |
| **llama3** | Text-Only | High-quality log reasoning and page source analysis | `ollama pull llama3` |
| **mistral** | Text-Only | Faster performance on low-resource machines | `ollama pull mistral` |

:::important
To use **Visual Find** or **Root-Cause Diagnosis** with Ollama, you MUST use a multimodal model like **llava**. Standard models like `llama3` will not be able to process screenshots.
:::


---

## AI Root-Cause Diagnosis

When a test session fails, Xenon's AI engine performs **multimodal analysis** by reasoning over:

- **Screenshots** — Detects system dialogs, permission prompts, crash screens
- **Command Logs** — Identifies race conditions, timing issues, wrong selectors
- **Device Logs** — Finds kernel panics, thermal warnings, memory pressure

The analysis produces a structured report with:
1. **Root cause** — What went wrong
2. **Evidence** — Specific log lines, visual indicators
3. **Recommendation** — Actionable fix

:::tip
The AI doesn't just pattern-match on error messages. It reasons across all data sources to identify the *underlying* cause — like a system dialog blocking your tap, or a thermal throttle causing timeouts.
:::

### Requirements

- At least one API key configured (see table above)
- `xe:record_video` and `xe:save_device_logs` capabilities enabled for richer analysis

---

## AI Visual Find

Locate elements on screen by **natural language description** instead of selectors:

```javascript
// Instead of fragile XPath:
// driver.findElement(By.xpath("//XCUIElementTypeButton[@name='Login']"))

// Use visual description:
const result = await xenon.visualFind(screenshot, "the blue Login button at the bottom");
// Returns: { x: 187, y: 634 }
```

This powers the **Tier 4** of the [Self-Healing Engine](self-healing.md) — when structural and text-based methods fail, Xenon falls back to visual AI to find the element.

---

## AI Locator Healing

When all other healing tiers fail, the AI performs **deep reasoning** over the page source and screenshot to suggest a new locator:

```json
{
  "recommendedXpath": "//android.widget.Button[@resource-id='com.app:id/login_btn']",
  "reason": "The original locator used class-based matching which is ambiguous. The resource-id selector is unique and stable across layouts."
}
```

This is the **Tier 5** of the [Self-Healing Engine](self-healing.md) and is only invoked when all cheaper methods have failed.

## AI OmniInspector (Diagnostic Exploration)

The OmniInspector is the flagship tool for interactive debugging. It runs the Xenon AI Engine on every element selection to provide:

- **Smart Stability Scoring**: Ranks locators by protocol performance and layout robustness.
- **AI Insights**: Explains *why* an element might be difficult to target and suggests fixes.
- **Code Generation**: Instant boilerplate for Java, Python, and WebdriverIO using Appium 2.x standards.

See the [OmniInspector Guide](omni-inspector.md) for full details.

---

## Dashboard Settings

You can configure and test AI providers directly from the Xenon Dashboard:

1. Navigate to **Settings → AI Configuration**
2. Select your provider and enter your API key
3. Click **Test Connection** to verify
4. Save — changes take effect immediately (no restart required)

:::info
The Dashboard uses the `testConnection()` API to validate your credentials. If you see a failure, check:
- API key is valid and has sufficient quota
- For Ollama: ensure the model is pulled and the server is running
:::
