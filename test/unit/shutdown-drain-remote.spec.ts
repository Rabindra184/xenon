import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { ShutdownCoordinator } from '../../src/services/ShutdownCoordinator';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import SessionType from '../../src/enums/SessionType';

/**
 * A hub's graceful shutdown drains the sessions it knows. Its own (local)
 * sessions die with the process, so they are finalized: video archived, the
 * phone released, the row closed. A node's or a cloud provider's session keeps
 * running there, and the restarted hub routes it again from its database. The
 * drain used to finalize those too: the hub released the phone and closed the
 * row, recovery then found nothing to route, and the node kept a session no
 * client could reach, holding its phone until the idle timeout.
 */
describe('ShutdownCoordinator.drain', () => {
  let stop: sinon.SinonStub;

  const session = (id: string, type: SessionType) =>
    ({ getId: () => id, getType: () => type }) as any;

  beforeEach(() => {
    stop = sinon.stub(SessionLifecycleService.prototype, 'stopSessionForShutdown').resolves();
  });

  afterEach(() => sinon.restore());

  it("finalizes this server's own sessions and leaves the ones other servers run", async () => {
    sinon
      .stub(SESSION_MANAGER, 'getAllSessions')
      .returns([
        session('local-1', SessionType.LOCAL),
        session('remote-1', SessionType.REMOTE),
        session('cloud-1', SessionType.CLOUD),
      ]);

    const result = await new ShutdownCoordinator().drain(1_000, 500);

    expect(stop.args.map((args) => args[0])).to.deep.equal(['local-1']);
    expect(result).to.deep.equal({ attempted: 1, completed: 1 });
  });

  it('drains nothing on a hub whose only sessions run on nodes', async () => {
    sinon
      .stub(SESSION_MANAGER, 'getAllSessions')
      .returns([session('remote-1', SessionType.REMOTE)]);

    const result = await new ShutdownCoordinator().drain(1_000, 500);

    expect(stop.called).to.equal(false);
    expect(result).to.deep.equal({ attempted: 0, completed: 0 });
  });
});
