# Enterprise Security & Compliance

Xenon is engineered for high-compliance environments (FinTech, Healthcare, E-commerce) where data protection and access control are non-negotiable.

## Role-Based Access Control (RBAC)

Xenon provides granular control over who can interact with the device lab.

| Role | Permissions |
|------|-------------|
| **Admin** | Full system access, capacity planning, user management. |
| **Maintainer** | Hardware management, manual device resets, maintenance toggles. |
| **Developer** | Device reservation, test execution, log access. |
| **Viewer** | Read-only access to dashboard and session history. |

## Identity Management (OIDC/SAML)

Seamlessly integrate with your existing enterprise identity providers:
- **Okta**
- **Microsoft Entra ID (Azure AD)**
- **GitHub Enterprise**
- **Google Workspace**

Configuration is handled via the `security` section in `xenon.config.json` or through environment-level OIDC variables.

## Visual PII Masking (Autonomous Privacy)

To ensure compliance with GDPR, SOC2, and HIPAA, Xenon implements an autonomous visual masking layer.

- **Automated Detection**: Using lightweight Computer Vision (CV), Xenon automatically detects sensitive fields (e.g., Credit Cards, CVV, Password inputs) in the video stream.
- **Real-time Blur**: These regions are blurred in real-time *before* the assets are persisted to storage.
- **Compliant Logs**: Appium command logs are filtered to ensure session secrets (like `setValue` on password fields) are never stored in plain text.

## Network Security

- **mTLS**: Encrypted communication between Hub and Nodes.
- **API Keys**: Per-team API keys with configurable rate limits and scope.
- **Isolated VLANs**: Network conditioning allows tests to run in isolated segments, preventing cross-test interference.
