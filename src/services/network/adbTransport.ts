/**
 * Whether adb reaches the phone over the network, from its serial alone:
 * `adb connect <host>:<port>` names it `<host>:<port>`, and Android 11's
 * wireless debugging, found over mDNS, names it
 * `adb-<serial>-<id>._adb-tls-connect._tcp` (or `._adb._tcp`). A USB phone's
 * serial is its own, and an emulator this server drives is
 * `emulator-<port>`, whose adb runs over the emulator's own pipe, not its
 * Wi-Fi.
 *
 * Such a phone's adb usually rides its Wi-Fi, so turning Wi-Fi off cuts the
 * adb connection, and nothing Xenon sends afterwards (the undo included)
 * reaches it. A phone seen through a remote adb server (`adbRemoteHost`) is
 * judged the same way: that server's link to the phone is what its serial
 * says, USB for most.
 */
export function adbOverNetwork(serial: string | null | undefined): boolean {
  if (!serial) return false;
  if (/\._adb(-tls-connect)?\._tcp\.?$/i.test(serial)) return true;
  return /^(\[[0-9a-f:.%]+\]|[a-z0-9.-]+):\d{1,5}$/i.test(serial);
}
