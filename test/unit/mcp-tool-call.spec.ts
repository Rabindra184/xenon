import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { answerOf, runTool, ToolRefusal } from '../../src/mcp/toolCall';
import type { McpCaller } from '../../src/mcp/mcpCredential';
import { EventLogService } from '../../src/services/EventLogService';

/**
 * runTool: what an agent gets back from a tool, and what the lab keeps of
 * the call (one event, no arguments, no answer).
 */
describe('runTool', () => {
  let append: sinon.SinonStub;
  // A new user per test, so each starts with a full tool budget.
  let seq = 0;

  function callerWith(rateLimit = 300): McpCaller {
    seq += 1;
    return {
      auth: {
        kind: 'bearer',
        userId: `tool-call-user-${Date.now()}-${seq}`,
        role: 'MEMBER',
        scopes: 'read',
        rateLimit,
        teamIds: [],
      },
    };
  }

  function textOf(result: { content: unknown[] }): any {
    return JSON.parse((result.content[0] as { text: string }).text);
  }

  beforeEach(() => {
    append = sinon.stub(Container.get(EventLogService), 'appendSafe');
  });

  afterEach(() => {
    sinon.restore();
  });

  it("answers the tool's result as JSON text", async () => {
    const result = await runTool('t', callerWith(), async () => ({ a: 1 }));
    expect(result.isError).to.not.equal(true);
    expect(textOf(result)).to.deep.equal({ a: 1 });
  });

  it("turns REST's refusal into a tool error with REST's code and message", async () => {
    const result = await runTool('t', callerWith(), async () =>
      answerOf({ status: 404, body: { error: true, message: 'Session with id s not found' } }),
    );
    expect(result.isError).to.equal(true);
    expect(textOf(result)).to.deep.equal({ error: true, message: 'Session with id s not found' });
    expect(append.firstCall.args[0].payload.outcome).to.equal('refused');
  });

  it('answers anything else that throws as internal, without its details', async () => {
    const result = await runTool('t', callerWith(), async () => {
      throw new Error('database file /secret/path is locked');
    });
    expect(result.isError).to.equal(true);
    const body = textOf(result);
    expect(body.error).to.equal('internal');
    expect(body.message).to.not.include('/secret/path');
    expect(append.firstCall.args[0].payload.outcome).to.equal('failed');
  });

  it("refuses a call past the user's per-minute budget, without running it", async () => {
    const caller = callerWith(1);
    const fn = sinon.stub().resolves('ran');
    await runTool('t', caller, fn);
    const second = await runTool('t', caller, fn);
    expect(fn.callCount).to.equal(1);
    expect(second.isError).to.equal(true);
    expect(textOf(second).error).to.equal('rate limit exceeded');
    expect(append.secondCall.args[0].payload.outcome).to.equal('rate_limited');
  });

  it('logs one event per call with the user, tool, outcome and duration only', async () => {
    const caller = callerWith();
    await runTool('xenon_list_devices', caller, async () => ['phone']);
    expect(append.callCount).to.equal(1);
    const entry = append.firstCall.args[0];
    expect(entry.type).to.equal('mcp_tool_call');
    expect(Object.keys(entry.payload).sort()).to.deep.equal([
      'durationMs',
      'outcome',
      'tool',
      'userId',
    ]);
    expect(entry.payload).to.include({
      userId: caller.auth.userId,
      tool: 'xenon_list_devices',
      outcome: 'ok',
    });
  });

  it('answerOf names the status when REST gave no code', () => {
    expect(() => answerOf({ status: 502, body: undefined }))
      .to.throw(ToolRefusal)
      .with.property('error', 'http_502');
  });
});
