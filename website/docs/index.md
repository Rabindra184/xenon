---
title: Overview
hide:
  - navigation
---

# Xenon

**Xenon** is an autonomous mobile infrastructure platform that transforms standard Appium grids into self-healing, intelligent laboratories designed for high-density enterprise automation.

---

## Core Pillars

| Pillar | Description |
|--------|-------------|
| **[Self-Healing Engine](self-healing.md)** | 5-tier cascading locator repair: ResilioTree → FuzzyXML → OCR → Visual AI → LLM |
| **[AI Diagnostics](ai-features.md)** | Multimodal root-cause analysis with Gemini, OpenAI, Anthropic, or Ollama |
| **[Enterprise Observability](architecture.md#omniscient-observability-opentelemetry)** | Native OpenTelemetry integration for distributed tracing across nodes |
| **[Omni-Vision](omni-vision.md)** | Florence-2 powered visual element detection and assertion + Omni‑Interaction (`smartTap`, `uiInventory`) |
| **Live Streaming** | High-fidelity MJPEG streaming and hardware-accelerated video recording |
| **[Enterprise Security](enterprise-security.md)** | RBAC, OIDC/SAML, Visual PII masking for compliant labs |

---

## Platform Capabilities

- **Auto-Discovery** — Instant detection of Android devices, iOS Simulators, and Real devices
- **Smart Allocation** — Priority-based device allocation for parallel execution
- **[Network Conditioning](network-conditioning.md)** — Simulate 4G, 3G, Edge, and Offline conditions
- **[Webhook Notifications](notifications.md)** — Slack and HTTP alerts for device/session events
- **[Data Retention](retention.md)** — Automated cleanup with configurable policies
- **Runtime Elasticity** — Hot-reload configurations without disrupting live sessions

---

## Getting Started

1. **[Setup Guide](setup.md)** — Install Xenon
2. **[Configuration](server-args.md)** — Configure via File, CLI, or API
3. **[Deployment Guide](deployment.md)** — Standalone, Hub-Node, or Cloud
4. **[Capabilities](capabilities.md)** — Usage in tests
5. **[AI Features](ai-features.md)** — Enable AI diagnostics and self-healing
