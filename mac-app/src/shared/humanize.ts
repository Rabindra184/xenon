// Proper nouns / initialisms that naive Title-Casing would mangle ("Ios", "Adb"…).
const PROPER_NOUNS: Record<string, string> = {
  ios: 'iOS',
  ip: 'IP',
  adb: 'ADB',
  ai: 'AI',
  api: 'API',
  url: 'URL',
  tls: 'TLS',
  json: 'JSON',
  db: 'DB',
  id: 'ID'
};

/** A setting key as a label: "bindHostOrIp" → "Bind Host Or IP". */
export function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word, i) => {
      const proper = PROPER_NOUNS[word.toLowerCase()];
      if (proper) return proper;
      if (word === 'Ms' && i > 0) return '(ms)';
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}
