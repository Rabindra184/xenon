import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { X509Certificate } from 'crypto';
import * as sinon from 'sinon';
import { pki, md } from 'node-forge';
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

  describe('serial number', () => {
    // The serial was Date.now() in hex padded to 16 digits: always 00 00 01 ...,
    // an INTEGER with illegal leading zeros. OpenSSL 3 (Node's included), Go
    // and BoringSSL refuse such a certificate outright.
    it('is a CA OpenSSL can load', async () => {
      const ca = await new CertManager(dir).ensure();
      expect(() => new X509Certificate(fs.readFileSync(ca.certPath))).to.not.throw();
    });

    it('is positive, minimally encoded and at least 64 random bits', async () => {
      const ca = await new CertManager(dir).ensure();
      const serial = new X509Certificate(fs.readFileSync(ca.certPath)).serialNumber;
      const first = parseInt(serial.slice(0, 2), 16);
      expect(first, 'no leading zero byte').to.be.greaterThan(0);
      expect(first, 'not negative').to.be.lessThan(0x80);
      expect(serial.length / 2)
        .to.be.at.least(8)
        .and.at.most(20);
    });

    it('differs between two CAs generated in the same millisecond', async () => {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-cert-'));
      const clock = sinon.useFakeTimers({ now: 1_760_000_000_000, toFake: ['Date'] });
      try {
        const a = await new CertManager(dir).ensure();
        const b = await new CertManager(other).ensure();
        expect(new X509Certificate(fs.readFileSync(a.certPath)).serialNumber).to.not.equal(
          new X509Certificate(fs.readFileSync(b.certPath)).serialNumber,
        );
      } finally {
        clock.restore();
        fs.rmSync(other, { recursive: true, force: true });
      }
    });

    it('replaces a CA an earlier version wrote with the bad serial', async () => {
      writeCa(dir, '000001a10d75af19');
      const ca = await new CertManager(dir).ensure();
      expect(() => new X509Certificate(fs.readFileSync(ca.certPath))).to.not.throw();
    });

    it('keeps a CA OpenSSL can load', async () => {
      writeCa(dir, '1a10d75af19a2b3c');
      const before = fs.readFileSync(path.join(dir, 'certs', 'ca.pem'), 'utf8');
      await new CertManager(dir).ensure();
      expect(fs.readFileSync(path.join(dir, 'certs', 'ca.pem'), 'utf8')).to.equal(before);
    });
  });

  describe('Android file name', () => {
    // Android looks a system CA up by <subject_hash_old>.0. The name was
    // openssl's, else a SHA-1 of the PEM, which names no certificate: with the
    // bad serial openssl couldn't load the CA, so the fallback always ran.
    it("is OpenSSL's subject_hash_old, with no openssl binary on the PATH", async function () {
      try {
        execFileSync('openssl', ['version'], { stdio: 'ignore' });
      } catch {
        this.skip();
      }
      const ca = await new CertManager(dir).ensure();
      const expected = execFileSync(
        'openssl',
        ['x509', '-inform', 'PEM', '-subject_hash_old', '-noout', '-in', ca.certPath],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      expect(ca.subjectHash).to.equal(expected);

      const pathBefore = process.env.PATH;
      process.env.PATH = '';
      try {
        expect(new CertManager(dir).androidCertFilename()).to.equal(`${expected}.0`);
      } finally {
        process.env.PATH = pathBefore;
      }
    });
  });
});

function writeCa(dir: string, serialHex: string): void {
  fs.mkdirSync(path.join(dir, 'certs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
  const keys = pki.rsa.generateKeyPair(1024);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serialHex;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600_000);
  const attrs = [{ name: 'commonName', value: 'Xenon MITM Root CA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }]);
  cert.sign(keys.privateKey, md.sha256.create());
  fs.writeFileSync(path.join(dir, 'certs', 'ca.pem'), pki.certificateToPem(cert), 'utf8');
  fs.writeFileSync(path.join(dir, 'keys', 'ca.private.key'), pki.privateKeyToPem(keys.privateKey));
}
