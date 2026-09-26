/** A build in the Apps library, as GET /apps returns it (the fields read here). */
export interface LibraryApp {
  id: string;
  name: string;
  platform?: string | null;
  version?: string | null;
  packageName?: string | null;
}

/** Sorted, then filtered by a case-insensitive substring. */
export function filterApps(apps: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return [...apps]
    .sort((a, b) => a.localeCompare(b))
    .filter((a) => !q || a.toLowerCase().includes(q));
}

// Android packages and iOS bundle ids: dot-separated, starting with a letter.
// Bundle ids may hold hyphens (com.example.my-app).
const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;

/** Whether typed text could be a package the list doesn't show (system apps). */
export function looksLikePackageId(text: string): boolean {
  return PACKAGE_ID.test(text.trim());
}

function libraryPlatform(platform: string | undefined): 'android' | 'ios' | null {
  const p = (platform || '').toLowerCase();
  if (p === 'android') return 'android';
  if (p === 'ios' || p === 'tvos') return 'ios';
  return null;
}

/** Android devices take Android builds; iOS and tvOS take the library's iOS builds. */
export function libraryAppsFor(library: LibraryApp[], platform: string | undefined): LibraryApp[] {
  const want = libraryPlatform(platform);
  return want ? library.filter((a) => (a.platform || '').toLowerCase() === want) : [];
}

/** "2.1 · com.shop", leaving out what the library doesn't know. */
export function libraryNote(app: Pick<LibraryApp, 'version' | 'packageName'>): string {
  return [app.version, app.packageName].filter(Boolean).join(' · ');
}

export function platformNoun(platform: string | undefined): 'Android' | 'iOS' {
  return libraryPlatform(platform) === 'android' ? 'Android' : 'iOS';
}

/** What the file chooser offers: the builds this device can install. */
export function uploadAccept(platform: string | undefined): string {
  return libraryPlatform(platform) === 'android' ? '.apk' : '.ipa,.app';
}
