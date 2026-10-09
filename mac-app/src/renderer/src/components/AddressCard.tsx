import { useEffect, useId, useState } from 'react';
import type { ShareAddresses } from '@shared/types';
import { Copy } from 'lucide-react';
import { HOME } from '../copy/home';
import { shownColleaguesAddress, type AddressSource } from '../addresses';
import { Button } from './ui/Button';
import { toast } from './ui/toastStore';

const A = HOME.address;

/** Puts an address on the clipboard and says so, or says it could not. */
export async function copyAddress(text: string): Promise<void> {
  try {
    await window.xenon.share.copy(text);
    toast(A.copied);
  } catch {
    toast(A.copyFailed, 'error');
  }
}

/**
 * The addresses for a port and base path, worked out in main (which knows the
 * Mac's name). Null while they are being read, and when there are none: main
 * refuses a port that is not one, and that is no address, not an error.
 */
export function useShareAddresses(source: AddressSource | null): ShareAddresses | null {
  const key = source === null ? null : JSON.stringify([source.port, source.basePath]);
  const [read, setRead] = useState<{ key: string; addresses: ShareAddresses | null } | null>(null);
  useEffect(() => {
    if (source === null || key === null) return;
    let live = true;
    window.xenon.share.addresses({ server: source }).then(
      (addresses) => {
        if (live) setRead({ key, addresses });
      },
      () => {
        if (live) setRead({ key, addresses: null });
      }
    );
    return () => {
      live = false;
    };
    // `key` is the port and base path; `source` is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return read !== null && read.key === key ? read.addresses : null;
}

/**
 * Where tests connect to the running server: the test address, in the mono
 * face, with Copy, and under it the address colleagues on the same network use,
 * with its own Copy. The colleagues' line is left out when the Mac has no name
 * on the network, and the whole card when there is no address.
 */
export function AddressCard({ source }: { source: AddressSource | null }) {
  const addresses = useShareAddresses(source);
  const headingId = useId();
  if (addresses === null) return null;
  const colleagues = shownColleaguesAddress(addresses.colleagues);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="address-card"
      className="rounded-lg border border-line bg-surface px-4 py-3"
    >
      <h2 id={headingId} className="text-xs font-medium text-muted">
        {A.test}
      </h2>
      <div className="mt-1 flex items-center gap-3">
        <p className="min-w-0 flex-1 break-all font-mono text-md text-ink">{addresses.test}</p>
        <Button
          size="sm"
          data-testid="copy-test-address"
          aria-label={A.copyTest}
          icon={<Copy size={14} aria-hidden="true" />}
          onClick={() => void copyAddress(addresses.test)}
        >
          {A.copy}
        </Button>
      </div>
      {colleagues !== null && (
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-sm text-muted">
            {A.colleagues} <span className="break-all font-mono text-ink">{colleagues}</span>
          </p>
          <Button
            size="sm"
            data-testid="copy-colleague-address"
            aria-label={A.copyColleagues}
            icon={<Copy size={14} aria-hidden="true" />}
            onClick={() => void copyAddress(colleagues)}
          >
            {A.copy}
          </Button>
        </div>
      )}
    </section>
  );
}
