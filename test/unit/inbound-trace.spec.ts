import { expect } from 'chai';
import { TraceFlags } from '@opentelemetry/api';
import {
  currentInboundTrace,
  currentTraceMalformed,
  readTraceContext,
  readTraceHeaders,
  runWithInboundTrace,
} from '../../src/services/tracing/inboundTrace';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';
const SAMPLED = `00-${TRACE}-${PARENT}-01`;

describe('inbound W3C trace context', () => {
  describe('readTraceContext', () => {
    it('reads a sampled traceparent', () => {
      const { context, malformed } = readTraceContext(SAMPLED);
      expect(malformed).to.equal(false);
      expect(context?.traceId).to.equal(TRACE);
      expect(context?.spanId).to.equal(PARENT);
      expect(context?.isRemote).to.equal(true);
      expect(context?.traceFlags).to.equal(TraceFlags.SAMPLED);
    });

    it('reads one that is not sampled', () => {
      const { context } = readTraceContext(`00-${TRACE}-${PARENT}-00`);
      expect(context?.traceFlags).to.equal(TraceFlags.NONE);
    });

    it('keeps tracestate, and joins one sent in several headers', () => {
      const { context } = readTraceContext(SAMPLED, ['rojo=00f067aa0ba902b7', 'congo=t61rcWkgMzE']);
      expect(context?.traceState?.get('rojo')).to.equal('00f067aa0ba902b7');
      expect(context?.traceState?.get('congo')).to.equal('t61rcWkgMzE');
    });

    it('drops a tracestate over 512 characters and keeps the context', () => {
      const { context } = readTraceContext(SAMPLED, `a=${'x'.repeat(600)}`);
      expect(context?.traceId).to.equal(TRACE);
      expect(context?.traceState?.get('a')).to.equal(undefined);
    });

    it('reads a later version by its first fields', () => {
      const { context } = readTraceContext(`01-${TRACE}-${PARENT}-01-whatever-comes-next`);
      expect(context?.traceId).to.equal(TRACE);
    });

    for (const [why, value] of [
      ['version ff', `ff-${TRACE}-${PARENT}-01`],
      ['an all-zero trace id', `00-${'0'.repeat(32)}-${PARENT}-01`],
      ['an all-zero parent id', `00-${TRACE}-${'0'.repeat(16)}-01`],
      ['upper-case hex', `00-${TRACE.toUpperCase()}-${PARENT}-01`],
      ['a short trace id', `00-${TRACE.slice(1)}-${PARENT}-01`],
      ['junk', 'not a traceparent'],
      ['an empty string', ''],
      ['a number', 42],
      ['two values', [SAMPLED, SAMPLED]],
    ] as const) {
      it(`takes ${why} for no context, and says it was malformed`, () => {
        const read = readTraceContext(value);
        expect(read.context).to.equal(undefined);
        expect(read.malformed).to.equal(true);
      });
    }

    it('takes nothing sent for no context, not a malformed one', () => {
      expect(readTraceContext(undefined)).to.deep.equal({ malformed: false });
      expect(readTraceContext(null)).to.deep.equal({ malformed: false });
    });
  });

  it('reads headers', () => {
    const { context } = readTraceHeaders({ traceparent: SAMPLED, tracestate: 'k=v' });
    expect(context?.traceId).to.equal(TRACE);
    expect(context?.traceState?.get('k')).to.equal('v');
    expect(readTraceHeaders(undefined)).to.deep.equal({ malformed: false });
  });

  describe('the request context', () => {
    it('holds the context across awaits, and none outside it', async () => {
      expect(currentInboundTrace()).to.equal(undefined);
      await runWithInboundTrace({ traceparent: SAMPLED }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(currentInboundTrace()?.traceId).to.equal(TRACE);
      });
      expect(currentInboundTrace()).to.equal(undefined);
    });

    it('a request without one runs with none, never the one around it', () => {
      runWithInboundTrace({ traceparent: SAMPLED }, () => {
        runWithInboundTrace({}, () => {
          expect(currentInboundTrace()).to.equal(undefined);
          expect(currentTraceMalformed()).to.equal(false);
        });
      });
    });

    it('says when the request sent one that could not be read', () => {
      runWithInboundTrace({ traceparent: 'nope' }, () => {
        expect(currentInboundTrace()).to.equal(undefined);
        expect(currentTraceMalformed()).to.equal(true);
      });
    });
  });
});
