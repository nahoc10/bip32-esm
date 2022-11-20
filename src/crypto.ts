import createHash from 'create-hash';
import createHmac from 'create-hmac';

export const hash160 = (buffer: Buffer): Buffer => {
  const sha256Hash = createHash('sha256').update(buffer).digest();
  try {
    return createHash('rmd160').update(sha256Hash).digest();
  } catch (err) {
    return createHash('ripemd160').update(sha256Hash).digest();
  }
};

export const hmacSHA512 = (key: Buffer, data: Buffer): Buffer =>
  createHmac('sha512', key).update(data).digest();
