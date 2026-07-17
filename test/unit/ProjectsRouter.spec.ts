import { expect } from 'chai';
import sinon from 'sinon';
import { listProjects, createProject } from '../../src/app/routers/projects';

describe('projects handlers', () => {
  function db() {
    return { project: { findMany: sinon.stub().resolves([{ id: 'p1', name: 'App A', teamId: 't1' }]), create: sinon.stub().resolves({ id: 'p2', name: 'New', teamId: null }) } };
  }

  it('lists projects scoped to the caller teamIds when narrowed', async () => {
    const client = db();
    const out = await listProjects(client as any, ['t1']);
    expect(out).to.have.length(1);
    expect(client.project.findMany.firstCall.args[0].where).to.deep.equal({ OR: [{ teamId: { in: ['t1'] } }, { teamId: null }] });
  });

  it('lists all projects for unscoped (admin) callers', async () => {
    const client = db();
    await listProjects(client as any, undefined);
    expect(client.project.findMany.firstCall.args[0]).to.deep.equal({});
  });

  it('creates a project with a required name', async () => {
    const client = db();
    const p = await createProject(client as any, { name: 'New' });
    expect(p.id).to.equal('p2');
    try { await createProject(client as any, { name: '' }); expect.fail('should throw'); }
    catch (e: any) { expect(e.message).to.match(/name/); }
  });
});
