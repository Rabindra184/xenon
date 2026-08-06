import { expect } from 'chai';
import { AnnotationRenderService } from '../../src/services/recording/annotation-render';

describe('AnnotationRenderService.buildFilterParts', () => {
  const svc = new AnnotationRenderService({} as any);

  it('emits drawbox for RECT', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'RECT',
        geometry: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
        color: '#ff0000',
        timecode_ms: 1500,
      },
    ]);
    expect(parts).to.have.length(2);
    expect(parts[0]).to.include('drawbox=');
    expect(parts[0]).to.include('0xff0000');
    expect(parts[0]).to.include('t=fill');
    expect(parts[1]).to.include("enable='gte(t\\,1.5)'");
  });

  it('emits drawbox for CIRCLE (drawellipse not assumed)', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'CIRCLE',
        geometry: JSON.stringify({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }),
        color: 'red',
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include('drawbox=');
    expect(parts[0]).to.include('iw*0.4000'); // 0.5 - 0.1
    expect(parts.length).to.equal(2);
  });

  it('emits bounding drawbox + tip for ARROW', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'ARROW',
        geometry: JSON.stringify({ x: 0.2, y: 0.2, w: 0.3, h: 0.1 }),
        color: 'yellow',
        timecode_ms: 0,
      },
    ]);
    expect(parts.length).to.be.at.least(3);
    expect(parts[0]).to.include('drawbox=');
    expect(parts[2]).to.include('t=fill');
  });

  it('emits drawtext for TEXT', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'TEXT',
        geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
        color: 'white',
        text: "bug: can't click",
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include('drawtext=');
    expect(parts[0]).to.include("text='bug\\: can\\'t click'");
  });

  it('skips malformed geometry', () => {
    const parts = svc.buildFilterParts([
      { shape: 'RECT', geometry: 'not-json', color: 'red', timecode_ms: 0 },
    ]);
    expect(parts).to.deep.equal([]);
  });
});
