import { base64url, CompactSign, compactVerify, importJWK, type JWK } from 'jose';
import { canonicalJson } from '../../../shared/canonical-json';
import type { CredentialCryptography } from '../application/ports';
import type { VerifiableCredential } from '../domain/certificate';

const encoder = new TextEncoder();

export class WebCryptoCredentials implements CredentialCryptography {
  private readonly publicKeys = new Map<string, Promise<CryptoKey>>();
  private privateKey: Promise<CryptoKey> | undefined;
  readonly jwks: { keys: JWK[] };

  constructor(
    public readonly activeKeyId: string,
    private readonly privateJwk: string | undefined,
    jwksJson: string,
    private readonly publicOrigin: string,
  ) {
    const jwks = JSON.parse(jwksJson) as { keys?: JWK[] };
    if (
      !Array.isArray(jwks.keys) ||
      jwks.keys.length < 1 ||
      jwks.keys.length > 10 ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(activeKeyId)
    )
      throw new Error('Invalid key configuration');
    this.jwks = {
      keys: jwks.keys.map((key) => {
        if (
          key.kty !== 'OKP' ||
          key.crv !== 'Ed25519' ||
          typeof key.x !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
          base64url.encode(base64url.decode(key.x)) !== key.x ||
          typeof key.kid !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(key.kid) ||
          key.d ||
          this.publicKeys.has(key.kid)
        )
          throw new Error('Invalid public key');
        this.publicKeys.set(
          key.kid,
          importJWK({ kty: key.kty, crv: key.crv, x: key.x }, 'EdDSA') as Promise<CryptoKey>,
        );
        return {
          kty: 'OKP',
          crv: 'Ed25519',
          x: key.x,
          alg: 'EdDSA',
          use: 'sig',
          kid: this.keyUrl(key.kid),
        };
      }),
    };
    if (!this.publicKeys.has(activeKeyId)) throw new Error('Active public key missing');
  }

  private keyUrl(keyId: string): string {
    return `${this.publicOrigin}/.well-known/jwks.json#${keyId}`;
  }

  private signingKey(): Promise<CryptoKey> {
    if (!this.privateKey) {
      if (!this.privateJwk) throw new Error('Signing key missing');
      const key = JSON.parse(this.privateJwk) as JWK;
      const expected = this.jwks.keys.find(
        (publicKey) => publicKey.kid === this.keyUrl(this.activeKeyId),
      );
      if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || !key.d || key.x !== expected?.x)
        throw new Error('Signing key does not match active public key');
      this.privateKey = importJWK(key, 'EdDSA') as Promise<CryptoKey>;
    }
    return this.privateKey;
  }

  async digest(value: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private hashBytes(hash: string): Uint8Array<ArrayBuffer> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid hash');
    return Uint8Array.from(hash.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  }

  async signHash(hash: string): Promise<string> {
    return base64url.encode(
      new Uint8Array(
        await crypto.subtle.sign('Ed25519', await this.signingKey(), this.hashBytes(hash)),
      ),
    );
  }

  async verifyHash(hash: string, signature: string, keyId: string): Promise<boolean> {
    try {
      const key = this.publicKeys.get(keyId);
      if (!key || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
      return await crypto.subtle.verify(
        'Ed25519',
        await key,
        base64url.decode(signature),
        this.hashBytes(hash),
      );
    } catch {
      return false;
    }
  }

  async signCredential(credential: VerifiableCredential): Promise<string> {
    return new CompactSign(encoder.encode(canonicalJson(credential)))
      .setProtectedHeader({ alg: 'EdDSA', typ: 'vc+jwt', kid: this.keyUrl(this.activeKeyId) })
      .sign(await this.signingKey());
  }

  async verifyCredential(jwt: string, keyId: string): Promise<unknown> {
    const key = this.publicKeys.get(keyId);
    if (!key) throw new Error('Unknown signing key');
    const { payload, protectedHeader } = await compactVerify(jwt, await key, {
      algorithms: ['EdDSA'],
    });
    if (protectedHeader.typ !== 'vc+jwt' || protectedHeader.kid !== this.keyUrl(keyId))
      throw new Error('Invalid credential header');
    return JSON.parse(new TextDecoder().decode(payload));
  }
}
