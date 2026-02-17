import crypto from 'crypto';
import os from 'os';
import { Service } from 'typedi';
import log from '../logger';

@Service()
export class SecurityService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly ivLength = 12;
    private readonly saltLength = 16;
    private readonly tagLength = 16;
    private readonly keyLength = 32;
    private readonly iterations = 10000;
    private encryptionKey: Buffer | null = null;

    constructor() { }

    /**
     * Derives a machine-unique encryption key.
     * Uses hostname and MAC addresses to create a stable, unique seed.
     */
    private getMachineSecret(): string {
        const interfaces = os.networkInterfaces();
        const macs = Object.values(interfaces)
            .flat()
            .filter((iface) => iface && !iface.internal)
            .map((iface) => iface!.mac)
            .sort()
            .join(':');

        return `${os.hostname()}-${macs}-xenon-v1`;
    }

    private async getEncryptionKey(salt: Buffer): Promise<Buffer> {
        if (this.encryptionKey && salt.length === 0) return this.encryptionKey;

        return new Promise((resolve, reject) => {
            crypto.pbkdf2(
                this.getMachineSecret(),
                salt as any,
                this.iterations,
                this.keyLength,
                'sha256',
                (err, derivedKey) => {
                    if (err) reject(err);
                    else resolve(derivedKey);
                }
            );
        });
    }

    public async encrypt(text: string): Promise<string> {
        try {
            if (!text) return text;

            const salt = crypto.randomBytes(this.saltLength);
            const iv = crypto.randomBytes(this.ivLength);
            const key = await this.getEncryptionKey(salt);

            const cipher = crypto.createCipheriv(this.algorithm, key as any, iv as any) as crypto.CipherGCM;
            const encrypted = Buffer.concat([cipher.update(text, 'utf8') as any, cipher.final() as any]);
            const tag = cipher.getAuthTag();

            // Format: salt:iv:tag:encrypted
            return Buffer.concat([salt, iv, tag, encrypted] as any[]).toString('base64');
        } catch (err: any) {
            log.error(`Encryption failed: ${err.message}`);
            throw new Error('Security Error: Failed to encrypt sensitive data.');
        }
    }

    public async decrypt(data: string): Promise<string> {
        try {
            if (!data || (!data.includes('==') && data.length < 50)) return data; // Primitive check if it's already plain text

            const buffer = Buffer.from(data, 'base64');

            const salt = buffer.subarray(0, this.saltLength);
            const iv = buffer.subarray(this.saltLength, this.saltLength + this.ivLength);
            const tag = buffer.subarray(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.tagLength);
            const encrypted = buffer.subarray(this.saltLength + this.ivLength + this.tagLength);

            const key = await this.getEncryptionKey(salt);
            const decipher = crypto.createDecipheriv(this.algorithm, key as any, iv as any) as crypto.DecipherGCM;
            decipher.setAuthTag(tag as any);

            const decrypted = Buffer.concat([decipher.update(encrypted as any) as any, decipher.final() as any]);
            return decrypted.toString('utf8');
        } catch (err: any) {
            // If decryption fails, it might be legacy plain text.
            // In production, we should log this but maybe return the original for migration?
            // For now, let's assume if it fails it's either corrupt or plain text.
            log.debug(`Decryption failed (possibly plain text): ${err.message}`);
            return data;
        }
    }
}
