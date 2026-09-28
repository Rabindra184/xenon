import { expect } from 'chai';
import { extractTeamCap } from '../../src/XenonCapabilityManager';
import { ISessionCapability } from '../../src/interfaces/ISessionCapability';

// The team a session asks to be placed in. Documented as xe:options.team;
// xenon:options is read as its alias, through the same precedence helper as
// every other Xenon option. The flat Xenon-prefixed caps older clients send
// (xenon:team, xe:teamId, ...) still work, below the options. df: is never
// read.

const always = (alwaysMatch: Record<string, unknown>) =>
  ({ alwaysMatch, firstMatch: [{}] }) as unknown as ISessionCapability;

describe('extractTeamCap', () => {
  it('reads xe:options.team, the documented form', () => {
    expect(extractTeamCap(always({ 'xe:options': { team: 'team_a' } }))).to.equal('team_a');
  });

  it('reads xe:options.teamId', () => {
    expect(extractTeamCap(always({ 'xe:options': { teamId: 'team_a' } }))).to.equal('team_a');
  });

  it('still reads the xenon:options alias alone', () => {
    expect(extractTeamCap(always({ 'xenon:options': { team: 'team_a' } }))).to.equal('team_a');
    expect(extractTeamCap(always({ 'xenon:options': { teamId: 'team_a' } }))).to.equal('team_a');
  });

  it('lets xe:options win over xenon:options', () => {
    expect(
      extractTeamCap(
        always({ 'xenon:options': { team: 'team_old' }, 'xe:options': { team: 'team_new' } }),
      ),
    ).to.equal('team_new');
    // Across alwaysMatch and firstMatch, as allocation merges them.
    expect(
      extractTeamCap({
        alwaysMatch: { 'xenon:options': { teamId: 'team_old' } },
        firstMatch: [{ 'xe:options': { teamId: 'team_new' } }],
      } as unknown as ISessionCapability),
    ).to.equal('team_new');
  });

  it('lets an options field win over a flat cap', () => {
    for (const flat of ['xenon:team', 'xenon:teamId', 'xe:team', 'xe:teamId', 'appium:team']) {
      expect(
        extractTeamCap(always({ [flat]: 'team_flat', 'xe:options': { team: 'team_opt' } })),
        flat,
      ).to.equal('team_opt');
      expect(
        extractTeamCap(always({ [flat]: 'team_flat', 'xenon:options': { teamId: 'team_opt' } })),
        flat,
      ).to.equal('team_opt');
    }
  });

  it('keeps every flat form working when no option is set', () => {
    for (const prefix of ['xenon:', 'xe:', 'appium:', '']) {
      for (const name of ['teamId', 'team_id', 'team']) {
        const key = `${prefix}${name}`;
        expect(extractTeamCap(always({ [key]: 'team_flat' })), key).to.equal('team_flat');
      }
    }
  });

  it('falls back to a flat cap when the option is empty or not a string', () => {
    for (const team of ['', 7, null, { id: 'team_x' }]) {
      expect(
        extractTeamCap(always({ 'xe:options': { team }, 'xenon:team': 'team_flat' })),
        JSON.stringify(team),
      ).to.equal('team_flat');
    }
  });

  it('never reads df:', () => {
    for (const caps of [
      { 'df:options': { team: 'team_df' } },
      { 'df:options': { teamId: 'team_df' } },
      { 'xenon:df:options': { team: 'team_df' } },
      { 'appium:df:options': { team: 'team_df' } },
      { 'df:team': 'team_df' },
      { 'df:teamId': 'team_df' },
    ]) {
      expect(extractTeamCap(always(caps)), JSON.stringify(caps)).to.equal(undefined);
    }
  });

  it('is undefined when nothing asks for a team', () => {
    expect(extractTeamCap(always({}))).to.equal(undefined);
    expect(extractTeamCap({} as ISessionCapability)).to.equal(undefined);
  });
});
