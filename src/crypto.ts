import createHash from 'create-hash'
import createHmac from 'create-hmac'

export function hash160(buffer) {
    const sha256Hash = createHash('sha256')
        .update(buffer)
        .digest();
    try {
        return createHash('rmd160')
            .update(sha256Hash)
            .digest();
    }
    catch (err) {
        return createHash('ripemd160')
            .update(sha256Hash)
            .digest();
    }
}

export function hmacSHA512(key, data) {
    return createHmac('sha512', key)
        .update(data)
        .digest();
}

