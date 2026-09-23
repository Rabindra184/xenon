/**
 * Send with any request whose body carries a secret: a password, a reset
 * token, an API key.
 *
 * Appium logs every request body to the server log (`[HTTP] --> POST … {…}`)
 * — Xenon's routes included, since they share Appium's Express app. Bodies
 * are logged in full unless the request carries this header, in which case
 * Appium's logger substitutes a placeholder. Without it, every dashboard
 * sign-in wrote the user's password to the log in plaintext.
 *
 * This only covers requests the dashboard makes. Scripted clients calling
 * these endpoints must send the header themselves, or the operator can add a
 * redaction rule with Appium's `logFilters` server option.
 */
export const SENSITIVE_BODY = { 'X-Appium-Is-Sensitive': 'true' } as const;
