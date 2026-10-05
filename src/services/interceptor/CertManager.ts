import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes, X509Certificate } from 'crypto';
import { asn1, pki, md } from 'node-forge';
import log from '../../logger';

const logger = log.scope('CertManager');

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
    } else if (!loadsInOpenSsl(this.certPath)) {
      // Through 2.15 the serial had illegal leading zeros, so OpenSSL, Go and
      // a phone's BoringSSL refused the CA. It never worked; make a new one.
      logger.warn(`Replacing the interceptor CA at ${this.certPath}: it can't be loaded`);
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
    cert.serialNumber = caSerialNumber();

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
    return subjectHashOld(fs.readFileSync(certPath, 'utf8'));
  }
}

/**
 * 16 random bytes, positive and minimally encoded as DER wants: the first
 * byte is 0x01..0x7f (no leading zero, no sign bit), as node-forge writes the
 * hex as the INTEGER's bytes unchanged.
 */
export function caSerialNumber(): string {
  const bytes = randomBytes(16);
  bytes[0] = bytes[0] & 0x7f || 0x01;
  return bytes.toString('hex');
}

function loadsInOpenSsl(certPath: string): boolean {
  try {
    new X509Certificate(fs.readFileSync(certPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * OpenSSL's `x509 -subject_hash_old`, the name Android files a system CA
 * under: MD5 of the subject's DER as the certificate holds it, the first four
 * bytes read little-endian.
 */
export function subjectHashOld(pem: string): string {
  const der = pki.pemToDer(pem).getBytes();
  const tbs = asn1.fromDer(der).value[0] as asn1.Asn1;
  const fields = tbs.value as asn1.Asn1[];
  const hasVersion = fields[0].tagClass === asn1.Class.CONTEXT_SPECIFIC;
  const subject = fields[hasVersion ? 5 : 4];
  const digest = createHash('md5')
    .update(Buffer.from(asn1.toDer(subject).getBytes(), 'binary'))
    .digest();
  return digest.readUInt32LE(0).toString(16).padStart(8, '0');
}
