import * as React from 'react';
import { Check, Copy, Keyboard, Loader2 } from 'lucide-react';
import XenonApiService from '../../../api-service';
import { Button } from '../../ui/button';
import { useToast } from '../../ui/toast';
import { clipboardError, failed } from '../actionMessages';
import { COPY_BLOCKED, copyText } from './copyText';

interface Props {
  udid: string;
  platform: string;
}

/** Typing into the phone's focused field, and its clipboard both ways. */
export function TextClipboardSection({ udid, platform }: Props) {
  const { toast } = useToast();
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [clip, setClip] = React.useState('');
  const [busy, setBusy] = React.useState<'read' | 'write' | null>(null);
  const [status, setStatus] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const clipRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(''), 2000);
    return () => clearTimeout(t);
  }, [status]);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await XenonApiService.typeText(udid, text);
      setText('');
      setStatus('Sent');
    } catch (err) {
      toast(failed('send the text', err), 'error');
    } finally {
      setSending(false);
    }
  };

  const read = async () => {
    setBusy('read');
    try {
      const result = await XenonApiService.getClipboard(udid);
      const content = typeof result?.content === 'string' ? result.content : '';
      setClip(content);
      if (!content) setStatus('The device clipboard is empty');
    } catch (err) {
      toast(clipboardError(platform, err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    if (!clip) return;
    setBusy('write');
    try {
      await XenonApiService.setClipboard(udid, clip);
      setStatus('Written to the device');
    } catch (err) {
      toast(failed('write the clipboard', err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (await copyText(clip)) {
      setCopied(true);
      return;
    }
    clipRef.current?.select();
    toast(COPY_BLOCKED, 'info');
  };

  return (
    <section className="actions-section" aria-labelledby="actions-text-title">
      <h4 id="actions-text-title" className="actions-section-title">
        <Keyboard size={15} aria-hidden="true" /> Text and clipboard
      </h4>
      <div className="actions-field-row">
        <label className="actions-field-label" htmlFor="actions-send-text">
          Send text
        </label>
        <input
          id="actions-send-text"
          type="text"
          className="type-input-field compact"
          placeholder="Type text for the focused field…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="secondary" size="md" onClick={send} disabled={!text.trim() || sending}>
          {sending && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
          Send
        </Button>
      </div>
      <div className="actions-field-row">
        <label className="actions-field-label" htmlFor="actions-clipboard">
          Clipboard
        </label>
        <input
          id="actions-clipboard"
          ref={clipRef}
          type="text"
          className="type-input-field compact"
          placeholder="Read the device clipboard, or type text to write"
          value={clip}
          onChange={(e) => setClip(e.target.value)}
        />
        <Button variant="secondary" size="md" onClick={read} disabled={busy !== null}>
          {busy === 'read' && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
          Read
        </Button>
        <Button variant="secondary" size="md" onClick={write} disabled={!clip || busy !== null}>
          {busy === 'write' && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
          Write to device
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? 'Copied' : 'Copy clipboard text'}
          title={copied ? 'Copied' : 'Copy to your clipboard'}
          onClick={copy}
          disabled={!clip}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </Button>
      </div>
      <p className="actions-status" role="status">
        {status}
      </p>
    </section>
  );
}
