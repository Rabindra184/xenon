import React, { useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Language, snippet } from '../../utils/snippet-generator';
import { Button } from '../ui/button';

const LANG_OPTIONS: Array<{ value: Language; short: string; label: string }> = [
  { value: 'javascript', short: 'JS', label: 'JavaScript (WebdriverIO)' },
  { value: 'java', short: 'Java', label: 'Java (Appium-Java)' },
  { value: 'python', short: 'Py', label: 'Python (Appium-Python)' },
  { value: 'csharp', short: 'C#', label: 'C# (.NET)' },
  { value: 'ruby', short: 'Rb', label: 'Ruby' },
];

const STORAGE_KEY = 'xenon.copyLang';

export function getStoredLanguage(): Language | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if (LANG_OPTIONS.find((o) => o.value === raw)) return raw as Language;
    return null;
  } catch {
    // localStorage can throw in privacy-restricted contexts; degrade silently.
    return null;
  }
}

export function setStoredLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* swallow */
  }
}

function shortLabel(lang: Language): string {
  return LANG_OPTIONS.find((o) => o.value === lang)?.short ?? lang;
}

interface ModalProps {
  open: boolean;
  initialLang?: Language;
  strategy: string;
  value: string;
  onCopy: (lang: Language, code: string) => void;
  onClose: () => void;
}

export function CopyLanguageModal({
  open,
  initialLang,
  strategy,
  value,
  onCopy,
  onClose,
}: ModalProps) {
  const [lang, setLang] = useState<Language>(initialLang ?? 'javascript');
  const [remember, setRemember] = useState(true);

  const code = snippet(lang, strategy, value);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* no clipboard permission — caller's onCopy still fires */
    }
    if (remember) setStoredLanguage(lang);
    onCopy(lang, code);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose your default copy language"
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCopy}>Copy as {shortLabel(lang)}</Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Snippets will be copied in this language until you change it.
      </p>
      <ul className="mb-3 space-y-1">
        {LANG_OPTIONS.map((opt) => (
          <li key={opt.value}>
            <label className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="radio"
                name="copy-lang"
                value={opt.value}
                checked={lang === opt.value}
                onChange={() => setLang(opt.value)}
              />
              {opt.label}
            </label>
          </li>
        ))}
      </ul>
      <div className="mb-1 text-[11px] font-semibold text-[var(--text-dim)]">Preview</div>
      <pre className="mb-3 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-[11px] text-[var(--text)]">
        <code>{code}</code>
      </pre>
      <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Remember my choice
      </label>
    </Modal>
  );
}

interface ButtonProps {
  /** The fix's strategy, e.g. "xpath". */
  strategy: string;
  /** The fix's selector. */
  value: string;
  onCopied: (lang: Language) => void;
}

// Two-mode copy button: a stored language enables a direct one-click copy
// (and shows the language as the label); the chevron always opens the
// modal so users can switch language anytime. First-time use opens the
// modal automatically because there's no stored language to bias toward.
export function CopyButton({ strategy, value, onCopied }: ButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const stored = getStoredLanguage();
  // A Visual AI heal is a place on screen, not a selector: there's no code to copy.
  const isVisual = strategy === 'xenon:visual';

  const directCopy = async () => {
    if (!stored) {
      setModalOpen(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet(stored, strategy, value));
    } catch {
      /* no clipboard permission */
    }
    setJustCopied(true);
    onCopied(stored);
    setTimeout(() => setJustCopied(false), 1500);
  };

  const label = stored ? `Copy as ${shortLabel(stored)}` : 'Copy as code';
  return (
    <span className="inline-flex shrink-0">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="rounded-r-none"
        onClick={(e) => {
          e.stopPropagation();
          void directCopy();
        }}
        disabled={isVisual && !value}
        aria-label={label}
        title={isVisual ? 'Found by its place on screen: there is no selector to copy' : label}
      >
        {justCopied ? <Check size={12} /> : <Copy size={12} />}
        <span>{justCopied ? 'Copied' : stored ? label : 'Copy as…'}</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="rounded-l-none border-l-0 px-1.5"
        onClick={(e) => {
          e.stopPropagation();
          setModalOpen(true);
        }}
        title="Choose copy language"
        aria-label="Choose copy language"
      >
        <ChevronDown size={12} />
      </Button>
      <CopyLanguageModal
        open={modalOpen}
        initialLang={stored ?? undefined}
        strategy={strategy}
        value={value}
        onCopy={(lang) => {
          setJustCopied(true);
          onCopied(lang);
          setTimeout(() => setJustCopied(false), 1500);
        }}
        onClose={() => setModalOpen(false)}
      />
    </span>
  );
}
