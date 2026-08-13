import { describe, it, expect } from 'vitest';
import { iosSourceFilter, levelsAtOrAbove } from './iosSourceFilter';

/**
 * On iOS the filter box narrows the DEVICE stream, not just the view.
 * Measured on an idle iPhone 14: os_trace is 5,485 lines/sec at Debug — 97% of
 * all volume — against ~335/sec for everything above it, and ~115/sec for one
 * process at Debug. Without pushing the query down, the pane shows drop
 * markers.
 */
describe('iosSourceFilter', () => {
  it('leaves Debug out until it is asked for', () => {
    // The default view has to be readable; Debug device-wide is not.
    expect(levelsAtOrAbove(undefined)).to.not.include('Debug');
    expect(levelsAtOrAbove(undefined)).to.include('Info');
    expect(levelsAtOrAbove(undefined)).to.include('Error');
  });

  it('includes Debug once the dropdown asks for it', () => {
    expect(levelsAtOrAbove('D')).to.include('Debug');
  });

  it('treats the level as a minimum, as the grammar says', () => {
    expect(levelsAtOrAbove('E')).to.deep.equal(['Error', 'Fault']);
    expect(levelsAtOrAbove('F')).to.deep.equal(['Fault']);
  });

  it('asks for everything when the level is one iOS has no peer for', () => {
    // Android's V sits below Debug, so "V and above" is every os_log level.
    expect(levelsAtOrAbove('V')).to.include('Debug');
  });

  it('honours W as a minimum even though os_log has no Warning', () => {
    // Nothing on iOS sits at Android's W, so "at least a warning" is Error and
    // Fault. Collapsing W onto I would quietly widen the user's request.
    expect(levelsAtOrAbove('W')).to.deep.equal(['Error', 'Fault']);
    expect(levelsAtOrAbove('I')).to.include('Info');
  });

  it('keeps the process name in the case it was typed', () => {
    // It becomes `--process=…` on a command line, where `springboard` does not
    // select `SpringBoard`.
    expect(iosSourceFilter('package:SpringBoard').process).to.equal('SpringBoard');
  });

  it('pushes a package: term down as the process to stream', () => {
    // This is the app-specific case: one app at Debug is ~115 lines/sec.
    const f = iosSourceFilter('level:D package:SpringBoard');
    expect(f.process).to.equal('SpringBoard');
    expect(f.levels).to.include('Debug');
  });

  it('streams every process when no package is named', () => {
    expect(iosSourceFilter('some text').process).to.equal(undefined);
  });

  it('ignores free text, which is a view concern', () => {
    // Only level and package can be applied at the source; searching text
    // still happens in the browser over what arrived.
    expect(iosSourceFilter('crash')).to.deep.equal(iosSourceFilter(''));
  });
});
