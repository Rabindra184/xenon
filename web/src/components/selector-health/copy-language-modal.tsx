import React, { useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Language, snippet } from '../../utils/snippet-generator';
import { IHealingHotspot } from '../../interfaces/IHealingEvent';

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
          <button type="button" className="sh-action-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sh-action-btn sh-action-btn--primary"
            onClick={handleCopy}
          >
            Copy as {shortLabel(lang)}
          </button>
        </>
      }
    >
      <p className="sh-copy-modal__hint">
        Snippets will be copied in this language until you change it.
      </p>
      <ul className="sh-copy-modal__lang-list">
        {LANG_OPTIONS.map((opt) => (
          <li key={opt.value}>
            <label className="sh-copy-modal__lang-row">
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
      <div className="sh-copy-modal__preview-label">Preview</div>
      <pre className="sh-copy-modal__preview">
        <code>{code}</code>
      </pre>
      <label className="sh-copy-modal__remember">
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
  hotspot: IHealingHotspot;
  onCopied: (lang: Language) => void;
}

// Two-mode copy button: a stored language enables a direct one-click copy
// (and shows the language hint as the label); the chevron always opens the
// modal so users can switch language anytime. First-time use opens the
// modal automatically because there's no stored language to bias toward.
export function CopyButton({ hotspot, onCopied }: ButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const stored = getStoredLanguage();

  // Prefer the suggested strategy (this is the strategy the healer landed
  // on); fall back to the original. xenon:visual heals produce a comment
  // placeholder rather than a snippet — see snippet-generator.
  const strategy = hotspot.suggestedStrategy ?? hotspot.originalStrategy ?? '';
  const value = hotspot.suggestedRewrite ?? '';
  const isVisual = strategy === 'xenon:visual';

  const directCopy = async () => {
    if (!stored) {
      setModalOpen(true);
      return;
    }
    const code = snippet(stored, strategy, value);
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* no clipboard permission */
    }
    setJustCopied(true);
    onCopied(stored);
    setTimeout(() => setJustCopied(false), 1500);
  };

  return (
    <span className="sh-copy-group">
      <button
        type="button"
        className={`sh-action-btn sh-copy-btn ${justCopied ? 'sh-copy-btn--copied' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          directCopy();
        }}
        disabled={isVisual && !value}
        title={
          isVisual
            ? 'Visual AI heals are coordinate-based — no portable Appium snippet'
            : stored
              ? `Copy as ${shortLabel(stored)}`
              : 'Pick a language and copy'
        }
      >
        {justCopied ? <Check size={11} /> : <Copy size={11} />}
        {stored && !justCopied && <span className="sh-copy-btn__lang">{shortLabel(stored)}</span>}
      </button>
      <button
        type="button"
        className="sh-action-btn sh-copy-chevron"
        onClick={(e) => {
          e.stopPropagation();
          setModalOpen(true);
        }}
        title="Choose copy language"
        aria-label="Choose copy language"
      >
        <ChevronDown size={11} />
      </button>
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
