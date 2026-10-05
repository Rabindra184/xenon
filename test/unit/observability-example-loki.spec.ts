import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * The example Loki config set `limits_config.retention_period: 24h`, but Loki
 * deletes nothing unless its compactor runs retention, so the logs it kept
 * grew for ever. Loki 3 also refuses to start with retention enabled and no
 * store for delete requests.
 */
describe('examples/observability/loki.yml', () => {
  const config = yaml.load(
    fs.readFileSync(path.join(__dirname, '../../examples/observability/loki.yml'), 'utf8'),
  ) as any;

  it('keeps logs for the retention period it sets', () => {
    expect(config.limits_config.retention_period).to.equal('24h');
    expect(config.compactor?.retention_enabled, 'compactor.retention_enabled').to.equal(true);
    expect(config.compactor?.delete_request_store, 'compactor.delete_request_store').to.equal(
      config.schema_config.configs[0].object_store,
    );
    expect(config.compactor?.working_directory, 'compactor.working_directory').to.be.a('string');
  });
});
