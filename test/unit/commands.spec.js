import commands from '../../src/commands';
import { XenonPlugin } from '../../src/plugin';
import { expect } from 'chai';

describe('Plugin commands', () => {
  it('Should handle empty or populated commands list', () => {
    expect(Object.keys(commands).length).to.be.at.least(0);
  });

  it('Should register commands to plugin', async () => {
    for (var [name, command] of Object.entries(commands)) {
      expect(XenonPlugin.prototype[name]).to.equal(command);
    }
  });
});
