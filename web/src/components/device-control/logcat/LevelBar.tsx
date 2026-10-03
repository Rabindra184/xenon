import * as React from 'react';
import { Button } from '../../ui/button';
import { LEVEL_ORDER } from './logcatFilter';
import { chosenLevel, levelChoices, type LevelCounts, type LogPlatform } from './levelCounts';
import { formatCount } from './logFormat';

export interface LevelBarProps {
  platform: LogPlatform;
  /** Lines per level that pass the filter, minus its level term. */
  counts: LevelCounts;
  /** The filter's `level:` value, if any. */
  minLevel: string | undefined;
  shown: number;
  total: number;
  /** A level to show from, or '' for all levels. */
  onChoose(level: string): void;
}

/**
 * The thin row under the toolbar: All, then each level with its lines.
 *
 * It holds no state of its own. Choosing a level writes `level:` into the
 * filter text (the one source of truth), and what it presses is read back
 * from that text, so the bar and the field never disagree.
 */
export function LevelBar({ platform, counts, minLevel, shown, total, onChoose }: LevelBarProps) {
  const choices = levelChoices(platform, counts, minLevel);
  const chosen = chosenLevel(choices, minLevel);
  const from = chosen === null ? -1 : LEVEL_ORDER.indexOf(chosen);
  return (
    <div className="log-levels">
      <div className="log-level-buttons" role="group" aria-label="Log levels">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="log-level-btn"
          aria-label="All levels"
          aria-pressed={chosen === null}
          onClick={() => onChoose('')}
        >
          All
        </Button>
        {choices.map(({ level, name }) => {
          const n = counts[level];
          // F is the highest level: "and above" would describe nothing.
          const reach = level === 'F' ? 'only' : 'and above';
          const label = `${name} ${reach}, ${formatCount(n)} ${name.toLowerCase()} line${n === 1 ? '' : 's'}`;
          const included = from >= 0 && LEVEL_ORDER.indexOf(level) >= from;
          return (
            <Button
              key={level}
              type="button"
              variant="ghost"
              size="sm"
              className={`log-level-btn lvl-${level}${included ? ' is-included' : ''}${n ? ' has-lines' : ''}`}
              aria-label={label}
              aria-pressed={chosen === level}
              onClick={() => onChoose(chosen === level ? '' : level)}
            >
              {name}
              <span className="log-level-count">{formatCount(n)}</span>
            </Button>
          );
        })}
      </div>
      <span className="log-shown">
        {formatCount(shown)} of {formatCount(total)} shown
      </span>
    </div>
  );
}
