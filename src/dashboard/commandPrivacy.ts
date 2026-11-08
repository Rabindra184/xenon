/**
 * What Xenon keeps of a command that typed something, or that its client
 * marked sensitive.
 *
 * Xenon's command log (SessionLog: the session page, bug reports) keeps each
 * command's request body, and on a hub or standalone server the command's
 * span carries its arguments (`xenon.command.args`, exported over OTLP).
 * Through 2.20 both kept the text a test typed, a password included, also
 * when the client hid it from its own logs.
 *
 * - **A sensitive command** is one sent with `X-Appium-Is-Sensitive: true`
 *   (`isSensitiveHeaderValue`, Appium's own test), which already keeps its
 *   body out of Appium's log. Xenon then keeps neither its arguments nor its
 *   answer, only the error code of a failure, and takes no screenshot for it.
 * - **Masked input** (`xe:options.maskInput`, or the server's `maskInput`
 *   option): the text of every command that types (`INPUT_COMMANDS`, and the
 *   drivers' typing scripts in `TYPING_SCRIPT_FIELDS`) is kept as
 *   `[masked]`, with the rest of the command as it was, so the log still
 *   says which element was typed into.
 */

/** What stands in for what wasn't kept. */
export const MASKED = '[masked]';

export interface CommandPrivacy {
  /** The client marked the request `X-Appium-Is-Sensitive`. */
  sensitive?: boolean;
  /** The session, or the server, masks typed text. */
  maskInput?: boolean;
}

/** Appium's own reading of `X-Appium-Is-Sensitive` (base-driver's handleLogContext). */
export function isSensitiveHeaderValue(value: unknown): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && ['true', '1', 'yes'].includes(first.toLowerCase());
}

/** A capability or option that turns masking on: `true` or `"true"`. */
export function isOn(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

/**
 * Whether typed text is masked for a session: the server's `maskInput`
 * option or the session's own. Either turns it on; a session can't turn the
 * server's off.
 */
export function inputMasked(serverOption: unknown, sessionOption: unknown): boolean {
  return isOn(serverOption) || isOn(sessionOption);
}

/** The WebDriver commands that type: their text is masked. */
export const INPUT_COMMANDS = new Set(['setValue', 'replaceValue', 'keys', 'performActions']);

/** The drivers' `execute` scripts that type, and the argument that holds the text. */
export const TYPING_SCRIPT_FIELDS: Record<string, readonly string[]> = {
  // UiAutomator2
  'mobile: type': ['text'],
  'mobile: replaceElementValue': ['text'],
  // XCUITest
  'mobile: keys': ['keys'],
};

function maskFields(value: unknown, fields: readonly string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of fields) if (field in out) out[field] = MASKED;
  return out;
}

/** W3C action sources with each key action's `value` masked; pointer and wheel actions as they were. */
function maskActions(actions: unknown): unknown {
  if (!Array.isArray(actions)) return actions;
  return actions.map((source) => {
    if (!source || typeof source !== 'object' || (source as any).type !== 'key') return source;
    const steps = (source as any).actions;
    return {
      ...source,
      actions: Array.isArray(steps)
        ? steps.map((step: any) =>
            step && typeof step === 'object' && 'value' in step ? { ...step, value: MASKED } : step,
          )
        : steps,
    };
  });
}

/**
 * The request body with its typed text masked. `requestBody` is the client's
 * W3C body (a hub's forwarded command: `{ text, value }`, `{ value }`,
 * `{ actions }`, `{ script, args }`) or, from CommandInterceptor, the
 * command's arguments as Appium hands them to the plugin (`[text,
 * elementId, ...]`, `[actions, ...]`, `[script, args, ...]`).
 */
export function maskTypedText(commandName: string | undefined, requestBody: unknown): unknown {
  const fromCommand = Array.isArray(requestBody);
  if (commandName === 'execute' || commandName === 'executeAsync') {
    const script = fromCommand ? requestBody[0] : (requestBody as any)?.script;
    const fields = typeof script === 'string' ? TYPING_SCRIPT_FIELDS[script] : undefined;
    if (!fields) return requestBody;
    const args = fromCommand ? requestBody[1] : (requestBody as any)?.args;
    const masked = Array.isArray(args)
      ? args.map((a) => maskFields(a, fields))
      : maskFields(args, fields);
    return fromCommand
      ? [requestBody[0], masked, ...requestBody.slice(2)]
      : { ...(requestBody as object), args: masked };
  }
  if (!commandName || !INPUT_COMMANDS.has(commandName)) return requestBody;
  if (commandName === 'performActions') {
    return fromCommand
      ? [maskActions(requestBody[0]), ...requestBody.slice(1)]
      : { ...(requestBody as object), actions: maskActions((requestBody as any)?.actions) };
  }
  // setValue (text, elementId), replaceValue (value, elementId), keys (value).
  if (fromCommand) return [MASKED, ...requestBody.slice(1)];
  return maskFields(requestBody, ['text', 'value']);
}

/**
 * The answer a sensitive command's record keeps: none, or for a failure its
 * W3C error code alone, so the session's failure category still reads it
 * (failureCategories.ts) while a message that may quote what was sent is not
 * kept.
 */
export function sensitiveResponse(responseBody: string, isSuccess: boolean): string {
  if (isSuccess) return JSON.stringify({ value: MASKED });
  let error: unknown;
  try {
    error = JSON.parse(responseBody)?.value?.error;
  } catch {
    error = undefined;
  }
  return JSON.stringify({
    value: { error: typeof error === 'string' ? error : 'unknown error', message: MASKED },
  });
}
