import { serverLabel, udidRepeats, type PhoneRef } from '../../lib/phone';

/** "5 Jan 2026, 10:00": when a recording started, in the viewer's locale. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What the page calls one of a recording's phones: its name, followed by its
 * server (`on 10.0.0.2:4723`) when another of `phones` on another server has
 * its udid, as a hub's and a node's emulator-5554 do.
 */
export function phoneLabel(phone: PhoneRef & { name: string }, phones: PhoneRef[]): string {
  return udidRepeats(phones, phone.udid)
    ? `${phone.name} on ${serverLabel(phone.host)}`
    : phone.name;
}
