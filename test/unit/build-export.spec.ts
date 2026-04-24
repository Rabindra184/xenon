import { expect } from 'chai';
import { sessionsToJson, sessionsToCsv } from '../../src/app/routers/build-export';

const FIXTURE = [
  {
    id: 'orphan-fresh-sess-001',
    build_id: 'b1',
    status: 'failed',
    failure_category: 'hub_restart',
    failure_reason: 'Session heartbeat timeout',
    device_platform: 'android',
    device_version: '13',
    device_name: 'Pixel 6',
    node_id: 'node-a',
    startTime: '2026-04-23T06:53:25.000Z',
    endTime: '2026-04-23T13:00:38.000Z',
    name: null,
  },
  {
    id: 'orphan-stale-sess-001',
    build_id: 'b1',
    status: 'ended',
    failure_category: null,
    failure_reason: null,
    device_platform: 'ios',
    device_version: '17.4',
    device_name: "Rabindra's iPhone",
    node_id: 'node-b',
    startTime: '2026-04-23T00:00:00.000Z',
    endTime: '2026-04-23T01:00:00.000Z',
    name: 'smoke-login',
  },
] as any[];

describe('sessionsToJson', () => {
  it('returns a pretty-printed JSON array', () => {
    const out = sessionsToJson(FIXTURE);
    const parsed = JSON.parse(out);
    expect(parsed).to.have.lengthOf(2);
    expect(parsed[0].id).to.equal('orphan-fresh-sess-001');
  });

  it('is stable — identical input produces identical output', () => {
    expect(sessionsToJson(FIXTURE)).to.equal(sessionsToJson(FIXTURE));
  });
});

describe('sessionsToCsv', () => {
  it('emits a header row matching the schema', () => {
    const csv = sessionsToCsv(FIXTURE);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).to.equal(
      'id,build_id,status,failure_category,failure_reason,device_platform,device_version,device_name,node_id,startTime,endTime,name',
    );
  });

  it('emits one row per session', () => {
    const csv = sessionsToCsv(FIXTURE);
    const lines = csv.trim().split('\n');
    expect(lines).to.have.lengthOf(3); // header + 2 rows
  });

  it('escapes quotes, commas, and newlines in cell values', () => {
    const tricky = [
      {
        id: 's1',
        build_id: 'b1',
        status: 'failed',
        failure_category: null,
        failure_reason: 'line1\nline2 with "quotes" and, commas',
        device_platform: 'android',
        device_version: '13',
        device_name: null,
        node_id: 'node-a',
        startTime: '2026-04-23T00:00:00.000Z',
        endTime: null,
        name: null,
      },
    ] as any[];
    const csv = sessionsToCsv(tricky);
    const dataRow = csv.split('\n').slice(1).join('\n');
    // The tricky cell contains a real newline, so it spans lines but remains
    // wrapped in the same pair of quotes.
    expect(dataRow).to.include('"line1\nline2 with ""quotes"" and, commas"');
  });

  it('renders null as empty cell', () => {
    const csv = sessionsToCsv(FIXTURE);
    const row2 = csv.split('\n')[2]; // second data row
    // FIXTURE[1] has failure_category = null; 4th column should be empty
    const cells = row2.split(',');
    expect(cells[3]).to.equal('');
  });

  it('ends with a single trailing newline', () => {
    const csv = sessionsToCsv(FIXTURE);
    expect(csv.endsWith('\n')).to.equal(true);
    expect(csv.endsWith('\n\n')).to.equal(false);
  });
});
