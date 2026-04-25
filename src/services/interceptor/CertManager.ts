import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { pki, md } from 'node-forge';

export interface CaBundle {
  certPath: string;
  keyPath: string;
  subjectHash: string;
}

export class CertManager {
  constructor(private readonly dir: string) {}

  get sslCaDir(): string {
    return this.dir;
  }

  get certPath(): string {
    return path.join(this.dir, 'certs', 'ca.pem');
  }

  get keyPath(): string {
    return path.join(this.dir, 'keys', 'ca.private.key');
  }

  get publicKeyPath(): string {
    return path.join(this.dir, 'keys', 'ca.public.key');
  }

  async ensure(): Promise<CaBundle> {
    fs.mkdirSync(path.join(this.dir, 'certs'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'keys'), { recursive: true });

    if (!fs.existsSync(this.certPath) || !fs.existsSync(this.keyPath)) {
      this.generateCa();
    }
    const subjectHash = this.computeAndroidHash(this.certPath);
    return { certPath: this.certPath, keyPath: this.keyPath, subjectHash };
  }

  androidCertFilename(): string {
    const hash = this.computeAndroidHash(this.certPath);
    return `${hash}.0`;
  }

  private generateCa(): void {
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Date.now().toString(16).padStart(16, '0');

    const now = new Date();
    cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    cert.validity.notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);

    const attrs = [
      { name: 'commonName', value: 'Xenon MITM Root CA' },
      { name: 'organizationName', value: 'Xenon' },
      { name: 'organizationalUnitName', value: 'Network Interceptor' },
      { name: 'countryName', value: 'US' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      {
        name: 'keyUsage',
        critical: true,
        keyCertSign: true,
        cRLSign: true,
        digitalSignature: true,
      },
      { name: 'subjectKeyIdentifier' },
    ]);

    cert.sign(keys.privateKey, md.sha256.create());

    fs.writeFileSync(this.certPath, pki.certificateToPem(cert), 'utf8');
    fs.writeFileSync(this.keyPath, pki.privateKeyToPem(keys.privateKey), 'utf8');
    fs.writeFileSync(this.publicKeyPath, pki.publicKeyToPem(keys.publicKey), 'utf8');
  }

  private computeAndroidHash(certPath: string): string {
    try {
      const out = execSync(`openssl x509 -inform PEM -subject_hash_old -noout -in "${certPath}"`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (/^[0-9a-f]{8}$/.test(out)) return out;
    } catch (e) {
      /* openssl unavailable — fall through */
    }
    const pem = fs.readFileSync(certPath, 'utf8');
    return createHash('sha1').update(pem).digest('hex').slice(0, 8);
  }
}
