# Xenon Brand Guidelines

<p align="center">
  <img src="assets/xenon-logo.png" alt="Xenon Logo" width="200">
</p>

---

## Brand Overview

**Xenon** is a noble gas - element 54 on the periodic table. Known for its **stability**, **reliability**, and its characteristic **blue-white glow** when electrified. These properties perfectly represent our platform:

- **Stable** - Rock-solid infrastructure that doesn't fail
- **Reliable** - Consistent device orchestration you can trust
- **Intelligent** - AI-powered self-healing and diagnostics
- **Luminous** - Clear visibility into your entire device lab (Green glow of efficiency)

---

## Logo

### Primary Logo
The Xenon logo features a stylized "X" with orbital electron paths, referencing the atomic structure of Xenon gas. The green glow represents the characteristic stability and efficiency of our platform.

### Usage Guidelines
| ✅ Do | ❌ Don't |
|-------|----------|
| Use on dark backgrounds | Place on busy imagery |
| Maintain clear space around logo | Distort or stretch |
| Use official color variants | Change colors arbitrarily |

---

## Color Palette

### Primary Colors

| Name | Hex | Use |
|------|-----|-----|
| **Xenon Green** | `#22C55E` | Primary brand color, CTAs, links |
| **Xenon Glow** | `#4ADE80` | Hover states, active elements |
| **Xenon Emerald** | `#15803D` | Headers, emphasis |

### Background Colors

| Name | Hex | Use |
|------|-----|-----|
| **Xenon Dark** | `#0F172A` | Primary dark background |
| **Xenon Void** | `#020617` | Deep OLED backgrounds |
| **Xenon Slate** | `#1E293B` | Card backgrounds, surfaces |

### Text Colors

| Name | Hex | Use |
|------|-----|-----|
| **Text Primary** | `#F8FAFC` | Main body text |
| **Text Muted** | `#94A3B8` | Secondary, less important text |
| **Text Dim** | `#64748B` | Tertiary, meta information |

### Status Colors

| Name | Hex | Meaning |
|------|-----|---------|
| **Success** | `#22C55E` | Healthy, passed, online |
| **Warning** | `#F59E0B` | Busy, running, attention |
| **Error** | `#EF4444` | Failed, offline, critical |
| **AI/Intelligence** | `#8B5CF6` | AI features, smart actions |

---

## Typography

### Font Stack

```css
/* Headings & Brand */
font-family: 'Outfit', sans-serif;

/* Body Text */
font-family: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Code & Technical */
font-family: 'JetBrains Mono', 'Fira Code', monospace;
```

### Type Scale

| Element | Font | Size | Weight |
|---------|------|------|--------|
| H1 | Outfit | 48px | 700 |
| H2 | Outfit | 32px | 700 |
| H3 | Outfit | 24px | 600 |
| Body | Fira Sans | 16px | 400 |
| Small | Fira Sans | 14px | 400 |
| Code | JetBrains Mono | 14px | 400 |

---

## Voice & Tone

### Personality
- **Intelligent** - We speak with expertise but approachably
- **Confident** - We solve hard problems, and we know it
- **Direct** - No fluff, no marketing speak
- **Helpful** - Developer-first, problem-solving focus

### Writing Guidelines

| ✅ Do | ❌ Don't |
|-------|----------|
| "Device automatically recovered" | "Our revolutionary AI healed it" |
| "Test failed: Element not found" | "Oops! Something went wrong!" |
| "Queue position: 3, ETA: 2 min" | "Please wait, you'll be connected soon!" |
| "Health check: Battery 85%" | "Your device is feeling great!" |

---

## CSS Variables

```css
:root {
  /* --- Xenon Brand Palette --- */
  --xenon-green: #22C55E;
  --xenon-glow: #4ADE80;
  --xenon-emerald: #15803D;
  
  /* --- Backgrounds --- */
  --bg-void: #020617;
  --bg-dark: #0F172A;
  --bg-slate: #1E293B;
  --bg-glass: rgba(15, 23, 42, 0.7);
  
  /* --- Text --- */
  --text-primary: #F8FAFC;
  --text-muted: #94A3B8;
  --text-dim: #64748B;
  
  /* --- Status --- */
  --status-success: #22C55E;
  --status-warning: #F59E0B;
  --status-error: #EF4444;
  --status-ai: #8B5CF6;
  
  /* --- Effects --- */
  --shadow-glow: 0 0 15px rgba(59, 130, 246, 0.3);
  --border-subtle: rgba(255, 255, 255, 0.05);
}
```

---

## Taglines

### Primary
> **Xenon - Intelligent Mobile Infrastructure**

### Alternatives
- "Devices That Heal Themselves"
- "Your Mobile Lab, Anywhere"
- "Zero-Downtime Device Operations"
- "Stable. Reliable. Intelligent."

---

## Application

### Dashboard Header
- Logo: Atom icon (Lucide) with blue gradient
- Brand name: "Xenon" in Outfit font
- Colors: Green gradient on dark background

### Marketing
- Lead with "Intelligent Mobile Infrastructure"
- Emphasize self-healing and stability
- Use the noble gas / element 54 story for memorability

---

*Xenon Brand Guidelines v1.0*
*Last Updated: 2026-01-30*
