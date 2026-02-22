---
title: Mission Control (Design System)
---

# Mission Control Design System

Xenon's UI follows the **Mission Control** aesthetic — an enterprise-grade, high-density dashboard language designed for professional mobile automation engineers. It prioritizes data density, clarity, and visual feedback without sacrificing modern aesthetics.

---

## Visual Philosophy

### High-Density Architecture
Unlike consumer-facing apps, Xenon is designed for multi-device monitoring. The Mission Control system uses:
- **Compact Layouts**: Small 12px/14px typography for maximum data visibility.
- **Glassmorphism**: Subtle translucency to provide a sense of depth and focus in complex dashboards.
- **Monospaced Accents**: Used for technical data (UDIDs, Class Names, Locators) to ensure alignment and readability.

### Professional Dark Mode
The dashboard is optimized for low-strain, long-session usage:
- **Base Color**: `--bg-surface` (Deep Navy/Black)
- **Primary Accent**: `--vibrant-primary` (Electric Blue)
- **Status Semantic Colors**:
  - 🟢 **Success**: Used for Passing sessions and Stable locators.
  - 🟡 **Warning**: Used for Retrying sessions and Moderate locators.
  - 🔴 **Danger**: Used for Failed sessions and Fragile locators.

---

## Design Tokens

The system is powered by a global registry of CSS variables. All components are audited to strictly adhere to these tokens, ensuring 100% theme parity across the application.

```css
:root {
  /* Surface colors */
  --bg-main: #0a0a0c;
  --bg-surface: #121216;
  --bg-surface-elevated: #1a1a20;

  /* Primary accents */
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  
  /* Borders & Dividers */
  --border-subtle: rgba(255, 255, 255, 0.08);
}
```

---

## Component Standards

### Device Tiles
The heart of the dashboard. Redesigned in 2025 for better density:
- **Status Indicators**: Real-time heartbeat pulses show device availability.
- **Quick Actions**: Inline buttons for Reboot, Shell, and Inspector access.
- **Visual Evidence**: Integrated preview frames for currently running sessions.

### OmniInspector UI
- **Split-Panel Layout**: Screenshot (Left), Tree (Center), AI Insights (Right).
- **Interactive Feedback**: Real-time hover highlights on the device stream synchronized with the source tree.
