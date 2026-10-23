// Kryptering: én tilfældig datanøgle (DEK) krypterer alle poster med AES-GCM.
// DEK'en "pakkes" med en nøgle afledt af låsekoden (PBKDF2) og evt. med en
// nøgle afledt af en passkey/Face ID (WebAuthn PRF + HKDF).

const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_ITERATIONS = 600_000;

export interface Sealed {
  iv: string;
  ct: string;
}

export interface PinWrap {
  salt: string;
  iterations: number;
  wrapped: Sealed;
}

export interface BioWrap {
  credentialId: string;
  prfSalt: string;
  wrapped: Sealed;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function sealBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function openBytes(key: CryptoKey, sealed: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv) },
    key,
    fromB64(sealed.ct),
  );
  return new Uint8Array(pt);
}

export async function sealJSON(key: CryptoKey, value: unknown): Promise<Sealed> {
  return sealBytes(key, enc.encode(JSON.stringify(value)));
}

export async function openJSON<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  return JSON.parse(dec.decode(await openBytes(key, sealed))) as T;
}

async function pinKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importDek(raw: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function createDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapWithPin(dek: CryptoKey, pin: string): Promise<PinWrap> {
  const salt = randomBytes(16);
  const kek = await pinKey(pin, salt, PBKDF2_ITERATIONS);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
  return { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, wrapped: await sealBytes(kek, raw) };
}

/** Kaster en fejl hvis koden er forkert. */
export async function unwrapWithPin(w: PinWrap, pin: string): Promise<CryptoKey> {
  const kek = await pinKey(pin, fromB64(w.salt), w.iterations);
  return importDek(await openBytes(kek, w.wrapped));
}

// ---------- Face ID / passkey via WebAuthn PRF ----------

async function prfKey(prfOutput: ArrayBuffer) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('dagbog-bio'), info: enc.encode('dek-wrap') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function biometricsAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext;
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

async function evalPrf(credentialId: Uint8Array<ArrayBuffer>, prfSalt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Ingen godkendelse');
  const out = cred.getClientExtensionResults() as PrfResults;
  const first = out.prf?.results?.first;
  if (!first) throw new Error('PRF_UNSUPPORTED');
  return first;
}

export async function enrollBiometrics(dek: CryptoKey): Promise<BioWrap> {
  const prfSalt = randomBytes(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Dagbog' },
      user: { id: randomBytes(16), name: 'dagbog', displayName: 'Dagbog' },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Oprettelse afbrudt');
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf && ext.prf.enabled === false) throw new Error('PRF_UNSUPPORTED');
  const credentialId = new Uint8Array(cred.rawId);
  const prf = await evalPrf(credentialId, prfSalt);
  const kek = await prfKey(prf);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
  return { credentialId: toB64(credentialId), prfSalt: toB64(prfSalt), wrapped: await sealBytes(kek, raw) };
}

export async function unwrapWithBiometrics(w: BioWrap): Promise<CryptoKey> {
  const prf = await evalPrf(fromB64(w.credentialId), fromB64(w.prfSalt));
  const kek = await prfKey(prf);
  return importDek(await openBytes(kek, w.wrapped));
}

// ---------- Indbakke til optageren ----------
// Optager-appen kan gemme tekst, uden at dagbogen er låst op: den krypterer med
// en offentlig nøgle (RSA-OAEP), og kun dagbogen har den private nøgle, som er
// krypteret med DEK'en. Selve teksten krypteres med en ny AES-nøgle pr. gang.

export interface InboxSealed {
  key: string; // AES-nøglen, krypteret med den offentlige nøgle
  iv: string;
  ct: string;
}

export async function createInboxKeys(): Promise<{ publicJwk: JsonWebKey; privatePkcs8: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privatePkcs8: toB64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  };
}

export async function importInboxPrivate(pkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', fromB64(pkcs8), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

export async function sealForInbox(publicJwk: JsonWebKey, value: unknown): Promise<InboxSealed> {
  const pub = await crypto.subtle.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const sealed = await sealJSON(aes, value);
  const raw = await crypto.subtle.exportKey('raw', aes);
  return { key: toB64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw)), ...sealed };
}

export async function openInbox<T>(privateKey: CryptoKey, sealed: InboxSealed): Promise<T> {
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromB64(sealed.key));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return openJSON<T>(aes, sealed);
}
