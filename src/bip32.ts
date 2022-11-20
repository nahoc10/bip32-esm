// @ts-nocheck

import { hash160, hmacSHA512 } from './crypto';
import { encode, decode } from 'bs58check';
import {
  pointFromScalar,
  isPrivate,
  isPoint,
  privateAdd,
  sign,
  signWithEntropy,
  verify,
} from '@noble/secp256k1';
import typeforce from 'typeforce';

interface Network {
  wif: number;
  bip32: {
    public: number;
    private: number;
  };
  messagePrefix?: string;
  bech32?: string;
  pubKeyHash?: number;
  scriptHash?: number;
}
export interface Signer {
  publicKey: Buffer;
  lowR: boolean;
  sign(hash: Buffer, lowR?: boolean): Buffer;
  verify(hash: Buffer, signature: Buffer): boolean;
  signSchnorr(hash: Buffer): Buffer;
  verifySchnorr(hash: Buffer, signature: Buffer): boolean;
}
export interface BIP32Interface extends Signer {
  chainCode: Buffer;
  network: Network;
  depth: number;
  index: number;
  parentFingerprint: number;
  privateKey?: Buffer;
  identifier: Buffer;
  fingerprint: Buffer;
  isNeutered(): boolean;
  neutered(): BIP32Interface;
  toBase58(): string;
  toWIF(): string;
  derive(index: number): BIP32Interface;
  deriveHardened(index: number): BIP32Interface;
  derivePath(path: string): BIP32Interface;
  tweak(t: Buffer): Signer;
}

export interface BIP32API {
  fromSeed(seed: Buffer, network?: Network): BIP32Interface;
  fromBase58(inString: string, network?: Network): BIP32Interface;
  fromPublicKey(
    publicKey: Buffer,
    chainCode: Buffer,
    network?: Network,
  ): BIP32Interface;
  fromPrivateKey(
    privateKey: Buffer,
    chainCode: Buffer,
    network?: Network,
  ): BIP32Interface;
}

interface XOnlyPointAddTweakResult {
  parity: 1 | 0;
  xOnlyPubkey: Uint8Array;
}

export interface TinySecp256k1Interface {
  isPoint(p: Uint8Array): boolean;
  isPrivate(d: Uint8Array): boolean;
  pointFromScalar(d: Uint8Array, compressed?: boolean): Uint8Array | null;
  pointAddScalar(
    p: Uint8Array,
    tweak: Uint8Array,
    compressed?: boolean,
  ): Uint8Array | null;
  privateAdd(d: Uint8Array, tweak: Uint8Array): Uint8Array | null;
  sign(h: Uint8Array, d: Uint8Array, e?: Uint8Array): Uint8Array;
  signSchnorr?(h: Uint8Array, d: Uint8Array, e?: Uint8Array): Uint8Array;
  verify(
    h: Uint8Array,
    Q: Uint8Array,
    signature: Uint8Array,
    strict?: boolean,
  ): boolean;
  verifySchnorr?(h: Uint8Array, Q: Uint8Array, signature: Uint8Array): boolean;
  xOnlyPointAddTweak(
    p: Uint8Array,
    tweak: Uint8Array,
  ): XOnlyPointAddTweakResult | null;
  privateNegate(d: Uint8Array): Uint8Array;
}

function wifEncodeRaw(version, privateKey, compressed) {
  var result = new Buffer(compressed ? 34 : 33);

  result.writeUInt8(version, 0);
  privateKey.copy(result, 1);

  if (compressed) {
    result[33] = 0x01;
  }

  return result;
}

function wifEncode(version, privateKey, compressed) {
  if (typeof version === 'number')
    return encode(wifEncodeRaw(version, privateKey, compressed));

  return bs58check.encode(
    encodeRaw(version.version, version.privateKey, version.compressed)
  );
}

const UINT256_TYPE = typeforce.BufferN(32);
const NETWORK_TYPE = typeforce.compile({
  wif: typeforce.UInt8,
  bip32: {
    public: typeforce.UInt32,
    private: typeforce.UInt32,
  },
});
const BITCOIN = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'bc',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};
const HIGHEST_BIT = 0x80000000;
const UINT31_MAX = Math.pow(2, 31) - 1;

function BIP32Path(value: any) {
  return (
    typeforce.String(value) && value.match(/^(m\/)?(\d+'?\/)*\d+'?$/) !== null
  );
}
function UInt31(value: any) {
  return typeforce.UInt32(value) && value <= UINT31_MAX;
}
class BIP32 {
  constructor(
    __D,
    __Q,
    chainCode,
    network,
    __DEPTH = 0,
    __INDEX = 0,
    __PARENT_FINGERPRINT = 0x00000000
  ) {
    this.__D = __D;
    this.__Q = __Q;
    this.chainCode = chainCode;
    this.network = network;
    this.__DEPTH = __DEPTH;
    this.__INDEX = __INDEX;
    this.__PARENT_FINGERPRINT = __PARENT_FINGERPRINT;
    typeforce(NETWORK_TYPE, network);
    this.lowR = false;
  }
  get depth() {
    return this.__DEPTH;
  }
  get index() {
    return this.__INDEX;
  }
  get parentFingerprint() {
    return this.__PARENT_FINGERPRINT;
  }
  get publicKey() {
    if (this.__Q === undefined) this.__Q = pointFromScalar(this.__D, true);
    return this.__Q;
  }
  get privateKey() {
    return this.__D;
  }
  get identifier() {
    return hash160(this.publicKey);
  }
  get fingerprint() {
    return this.identifier.slice(0, 4);
  }
  get compressed() {
    return true;
  }
  // Private === not neutered
  // Public === neutered
  isNeutered() {
    return this.__D === undefined;
  }
  neutered() {
    return fromPublicKeyLocal(
      this.publicKey,
      this.chainCode,
      this.network,
      this.depth,
      this.index,
      this.parentFingerprint
    );
  }
  toBase58() {
    const network = this.network;
    const version = !this.isNeutered()
      ? network.bip32.private
      : network.bip32.public;
    const buffer = Buffer.allocUnsafe(78);
    // 4 bytes: version bytes
    buffer.writeUInt32BE(version, 0);
    // 1 byte: depth: 0x00 for master nodes, 0x01 for level-1 descendants, ....
    buffer.writeUInt8(this.depth, 4);
    // 4 bytes: the fingerprint of the parent's key (0x00000000 if master key)
    buffer.writeUInt32BE(this.parentFingerprint, 5);
    // 4 bytes: child number. This is the number i in xi = xpar/i, with xi the key being serialized.
    // This is encoded in big endian. (0x00000000 if master key)
    buffer.writeUInt32BE(this.index, 9);
    // 32 bytes: the chain code
    this.chainCode.copy(buffer, 13);
    // 33 bytes: the public key or private key data
    if (!this.isNeutered()) {
      // 0x00 + k for private keys
      buffer.writeUInt8(0, 45);
      this.privateKey.copy(buffer, 46);
      // 33 bytes: the public key
    } else {
      // X9.62 encoding for public keys
      this.publicKey.copy(buffer, 45);
    }
    return encode(buffer);
  }
  toWIF() {
    if (!this.privateKey) throw new TypeError('Missing private key');
    return wifEncode(this.network.wif, this.privateKey, true);
  }
  // https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#child-key-derivation-ckd-functions
  derive(index) {
    typeforce(typeforce.UInt32, index);
    const isHardened = index >= HIGHEST_BIT;
    const data = Buffer.allocUnsafe(37);
    // Hardened child
    if (isHardened) {
      if (this.isNeutered())
        throw new TypeError('Missing private key for hardened child key');
      // data = 0x00 || ser256(kpar) || ser32(index)
      data[0] = 0x00;
      this.privateKey.copy(data, 1);
      data.writeUInt32BE(index, 33);
      // Normal child
    } else {
      // data = serP(point(kpar)) || ser32(index)
      //      = serP(Kpar) || ser32(index)
      this.publicKey.copy(data, 0);
      data.writeUInt32BE(index, 33);
    }
    const I = hmacSHA512(this.chainCode, data);
    const IL = I.slice(0, 32);
    const IR = I.slice(32);
    // if parse256(IL) >= n, proceed with the next value for i
    if (!isPrivate(IL)) return this.derive(index + 1);
    // Private parent key -> private child key
    let hd;
    if (!this.isNeutered()) {
      // ki = parse256(IL) + kpar (mod n)
      const ki = privateAdd(this.privateKey, IL);
      // In case ki == 0, proceed with the next value for i
      if (ki == null) return this.derive(index + 1);
      hd = fromPrivateKeyLocal(
        ki,
        IR,
        this.network,
        this.depth + 1,
        index,
        this.fingerprint.readUInt32BE(0)
      );
      // Public parent key -> public child key
    } else {
      // Ki = point(parse256(IL)) + Kpar
      //    = G*IL + Kpar
      const Ki = pointAddScalar(this.publicKey, IL, true);
      // In case Ki is the point at infinity, proceed with the next value for i
      if (Ki === null) return this.derive(index + 1);
      hd = fromPublicKeyLocal(
        Ki,
        IR,
        this.network,
        this.depth + 1,
        index,
        this.fingerprint.readUInt32BE(0)
      );
    }
    return hd;
  }
  deriveHardened(index) {
    typeforce(UInt31, index);
    // Only derives hardened private keys by default
    return this.derive(index + HIGHEST_BIT);
  }
  derivePath(path) {
    typeforce(BIP32Path, path);
    let splitPath = path.split('/');
    if (splitPath[0] === 'm') {
      if (this.parentFingerprint)
        throw new TypeError('Expected master, got child');
      splitPath = splitPath.slice(1);
    }
    return splitPath.reduce((prevHd, indexStr) => {
      let index;
      if (indexStr.slice(-1) === `'`) {
        index = parseInt(indexStr.slice(0, -1), 10);
        return prevHd.deriveHardened(index);
      } else {
        index = parseInt(indexStr, 10);
        return prevHd.derive(index);
      }
    }, this);
  }
  sign(hash, lowR) {
    if (!this.privateKey) throw new Error('Missing private key');
    if (lowR === undefined) lowR = this.lowR;
    if (lowR === false) {
      return sign(hash, this.privateKey);
    } else {
      let sig = sign(hash, this.privateKey);
      const extraData = Buffer.alloc(32, 0);
      let counter = 0;
      // if first try is lowR, skip the loop
      // for second try and on, add extra entropy counting up
      while (sig[0] > 0x7f) {
        counter++;
        extraData.writeUIntLE(counter, 0, 6);
        sig = signWithEntropy(hash, this.privateKey, extraData);
      }
      return sig;
    }
  }
  verify(hash, signature) {
    return verify(hash, this.publicKey, signature);
  }
}

export function fromBase58(inString: any, network?: any) {
  const buffer = decode(inString);
  if (buffer.length !== 78) throw new TypeError('Invalid buffer length');
  network = network || BITCOIN;
  // 4 bytes: version bytes
  const version = buffer.readUInt32BE(0);
  if (version !== network.bip32.private && version !== network.bip32.public)
    throw new TypeError('Invalid network version');
  // 1 byte: depth: 0x00 for master nodes, 0x01 for level-1 descendants, ...
  const depth = buffer[4];
  // 4 bytes: the fingerprint of the parent's key (0x00000000 if master key)
  const parentFingerprint = buffer.readUInt32BE(5);
  if (depth === 0) {
    if (parentFingerprint !== 0x00000000)
      throw new TypeError('Invalid parent fingerprint');
  }
  // 4 bytes: child number. This is the number i in xi = xpar/i, with xi the key being serialized.
  // This is encoded in MSB order. (0x00000000 if master key)
  const index = buffer.readUInt32BE(9);
  if (depth === 0 && index !== 0) throw new TypeError('Invalid index');
  // 32 bytes: the chain code
  const chainCode = buffer.slice(13, 45);
  let hd;
  // 33 bytes: private key data (0x00 + k)
  if (version === network.bip32.private) {
    if (buffer.readUInt8(45) !== 0x00)
      throw new TypeError('Invalid private key');
    const k = buffer.slice(46, 78);
    hd = fromPrivateKeyLocal(
      k,
      chainCode,
      network,
      depth,
      index,
      parentFingerprint
    );
    // 33 bytes: public key data (0x02 + X or 0x03 + X)
  } else {
    const X = buffer.slice(45, 78);
    hd = fromPublicKeyLocal(
      X,
      chainCode,
      network,
      depth,
      index,
      parentFingerprint
    );
  }
  return hd;
}

export function fromPrivateKey(privateKey, chainCode, network) {
  return fromPrivateKeyLocal(privateKey, chainCode, network);
}

export function fromPrivateKeyLocal(
  privateKey,
  chainCode,
  network,
  depth,
  index,
  parentFingerprint
) {
  typeforce(
    {
      privateKey: UINT256_TYPE,
      chainCode: UINT256_TYPE,
    },
    { privateKey, chainCode }
  );
  network = network || BITCOIN;
  if (!isPrivate(privateKey))
    throw new TypeError('Private key not in range [1, n)');
  return new BIP32(
    privateKey,
    undefined,
    chainCode,
    network,
    depth,
    index,
    parentFingerprint
  );
}

export function fromPublicKey(publicKey: any, chainCode: any, network?: any) {
  return fromPublicKeyLocal(publicKey, chainCode, network);
}

export function fromPublicKeyLocal(
  publicKey,
  chainCode,
  network,
  depth,
  index,
  parentFingerprint
) {
  typeforce(
    {
      publicKey: typeforce.BufferN(33),
      chainCode: UINT256_TYPE,
    },
    { publicKey, chainCode }
  );
  network = network || BITCOIN;
  // verify the X coordinate is a point on the curve
  if (!isPoint(publicKey)) throw new TypeError('Point is not on the curve');
  return new BIP32(
    undefined,
    publicKey,
    chainCode,
    network,
    depth,
    index,
    parentFingerprint
  );
}

export function fromSeed(seed: any, network?: any) {
  typeforce(typeforce.Buffer, seed);
  if (seed.length < 16) throw new TypeError('Seed should be at least 128 bits');
  if (seed.length > 64) throw new TypeError('Seed should be at most 512 bits');
  network = network || BITCOIN;
  const I = hmacSHA512(Buffer.from('Bitcoin seed', 'utf8'), seed);
  const IL = I.slice(0, 32);
  const IR = I.slice(32);
  return fromPrivateKey(IL, IR, network);
}
