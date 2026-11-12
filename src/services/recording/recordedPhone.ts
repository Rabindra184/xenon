/**
 * A phone a recording reads: its udid and the host its Device row is filed
 * under. A udid alone doesn't name a phone: an emulator's repeats across
 * servers (a hub's emulator-5554 and its node's), so a recording, its hold,
 * its busy check and its source all go by both.
 */
export interface RecordedPhone {
  udid: string;
  host: string;
}

/** The key a recorded phone has in a map: `udid@host`. */
export function phoneKey(phone: Pick<RecordedPhone, 'udid' | 'host'>): string {
  return `${phone.udid}@${phone.host}`;
}
