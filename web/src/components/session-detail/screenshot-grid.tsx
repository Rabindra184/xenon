import React from 'react';
import XenonApiService from '../../api-service';
import { screenshotsOf, type CommandLog } from './commands';
import { logTimestamp } from './log-derive';

interface Props {
  commands: CommandLog[];
}

/** The screenshots the session's commands kept, oldest first; each opens full size. */
export const ScreenshotGrid: React.FC<Props> = ({ commands }) => {
  const shots = screenshotsOf(commands);
  if (shots.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
        No screenshots were kept. A failed command keeps one unless{' '}
        <code className="font-mono">xe:options.screenshotOnFailure</code> is false; set{' '}
        <code className="font-mono">xe:options.screenshotOnEveryCommand</code> to keep one for every
        command.
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 p-3">
      {shots.map((s, i) => {
        const url = XenonApiService.getAssetUrl(s.path);
        const time = logTimestamp({ timestamp: s.at ?? null });
        return (
          <li key={s.id ?? i}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={`block rounded-md border overflow-hidden hover:border-[var(--border-strong)] ${
                s.failed ? 'border-[var(--color-danger)]' : 'border-[var(--border)]'
              }`}
            >
              <img
                src={url}
                alt={`${s.command} at ${time}`}
                loading="lazy"
                // The tint is the image's alone: under the caption it would
                // take the red of a failed command's name below 4.5:1.
                className="block w-full aspect-[9/16] object-contain bg-[rgb(var(--rgb-fg)/0.03)]"
              />
              <span className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
                <span
                  className={`truncate font-mono ${s.failed ? 'text-[var(--color-danger)]' : 'text-[var(--text)]'}`}
                >
                  {s.command}
                </span>
                <span className="tabular-nums text-[var(--text-dim)] shrink-0">{time}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
};
