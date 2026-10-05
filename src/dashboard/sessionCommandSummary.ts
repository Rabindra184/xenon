/**
 * The fields of a command's record that leave its session: the live
 * `session_command` event and the event log carry these and nothing else.
 * Which command ran in which session, how it went and how it healed. The rest
 * stays in the session's SessionLog, which goes with the session: the
 * record's `body` is the command's arguments (the text `setValue` typed) and
 * its `response` the command's answer (a page source, a screenshot's base64).
 * Named one by one, so a field added to the record later goes nowhere until
 * it is listed here.
 */
export const SESSION_COMMAND_SUMMARY_FIELDS = [
  'session_id',
  'command_name',
  'method',
  'is_success',
  'is_error',
  'is_healed',
  'original_strategy',
  'original_selector',
  'healed_strategy',
  'healed_selector',
  'healing_confidence',
  'healing_tier',
  'duration',
  'span_id',
  'trace_id',
] as const;

export function sessionCommandSummary(record: any): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const field of SESSION_COMMAND_SUMMARY_FIELDS) {
    if (record?.[field] !== undefined) summary[field] = record[field];
  }
  return summary;
}
