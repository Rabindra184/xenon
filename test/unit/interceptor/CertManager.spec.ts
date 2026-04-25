import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pki } from 'node-forge';
import { CertManager } from '../../../src/services/interceptor/CertManager';

describe('CertManager', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-cert-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('generates a CA cert and key in http-mitm-proxy layout on first ensure()', async () => {
    const mgr = new CertManager(dir);
    const ca = await mgr.ensure();
    expect(ca.certPath).to.equal(path.join(dir, 'certs', 'ca.pem'));
    expect(ca.keyPath).to.equal(path.join(dir, 'keys', 'ca.private.key'));
    expect(fs.existsSync(ca.certPath)).to.equal(true);
    expect(fs.existsSync(ca.keyPath)).to.equal(true);
    const pem = fs.readFileSync(ca.certPath, 'utf8');
    expect(pem).to.match(/BEGIN CERTIFICATE/);
  });

  it('exposes sslCaDir for http-mitm-proxy integration', async () => {
    const mgr = new CertManager(dir);
    await mgr.ensure();
    expect(mgr.sslCaDir).to.equal(dir);
  });

  it('reuses existing CA on second ensure() (idempotent)', async () => {
    const mgr = new CertManager(dir);
    const first = await mgr.ensure();
    const firstMtime = fs.statSync(first.certPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    const second = await mgr.ensure();
    const secondMtime = fs.statSync(second.certPath).mtimeMs;
    expect(secondMtime).to.equal(firstMtime);
    expect(second.certPath).to.equal(first.certPath);
  });

  it('produces a self-signed CA suitable for MITM', async () => {
    const mgr = new CertManager(dir);
    const ca = await mgr.ensure();
    const pem = fs.readFileSync(ca.certPath, 'utf8');
    const cert = pki.certificateFromPem(pem);
    const isCA = cert.extensions.find((e: any) => e.name === 'basicConstraints' && e.cA);
    expect(isCA).to.not.equal(undefined);
    expect(cert.subject.getField('CN')?.value).to.match(/Xenon/i);
  });

  it('exposes an Android-compatible cert hash filename', async () => {
    const mgr = new CertManager(dir);
    const ca = await mgr.ensure();
    const fname = mgr.androidCertFilename();
    expect(fname).to.match(/^[0-9a-f]{8}\.0$/);
    expect(typeof ca.subjectHash).to.equal('string');
  });
});
