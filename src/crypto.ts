import * as RipeMd160 from 'ripemd160';
import createHash from 'create-hash';
import createHmac from 'create-hmac';

export function hash160(buffer: Buffer): Buffer {
  const sha256Hash: Buffer = createHash('sha256')
    .update(buffer)
    .digest();
  try {
    return createHash('rmd160')
      .update(sha256Hash)
      .digest();
  } catch (err) {
    try {
      return createHash('ripemd160')
        .update(sha256Hash)
        .digest();
    } catch (err2) {
      return new RipeMd160().update(sha256Hash).digest();
    }
  }
}

export function hmacSHA512(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha512', key)
    .update(data)
    .digest();
}
