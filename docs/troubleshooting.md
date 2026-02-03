---
title: Troubleshooting
hide:
  - navigation
---

### IOS


### Autonomous Triage with AI

If a session fails and you are unsure why, check the **AI Root-Cause Diagnosis** in the session dashboard. 

The AI looks at:
- **Screenshots**: To detect system dialogs or app crashes.
- **Logcat/Syslog**: To find stack traces or kernel errors.
- **Command Sequence**: To identify flaky selectors or timing issues.

If the AI is disabled, ensure your `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` is set on the server.

### Notes
1. If there is no activity on a session for more then 100 seconds, device allocated to respective session would be unblocked and made available for new session requests.