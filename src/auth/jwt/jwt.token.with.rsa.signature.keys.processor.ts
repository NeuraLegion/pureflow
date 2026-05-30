import { Logger } from '@nestjs/common';
import { createPublicKey, createVerify } from 'crypto';
import { encode } from 'jwt-simple';
import { JwtTokenProcessor as JwtTokenProcessor } from './jwt.token.processor';

export class JwtTokenWithRSASignatureKeysProcessor extends JwtTokenProcessor {
  constructor(
    private publicKey: string,
    private privateKey: string
  ) {
    super(new Logger(JwtTokenWithRSASignatureKeysProcessor.name));
  }

  async validateToken(token: string): Promise<unknown> {
    this.log.debug('Call validateToken');

    const [header, payload] = this.parse(token);
    if (header.alg !== 'RS256') {
      throw new Error('Invalid JWT algorithm');
    }

    const parts = token.split('.');
    if (parts.length !== 3 || !parts[2]) {
      throw new Error('Invalid JWT signature');
    }

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();

    const isValid = verifier.verify(
      createPublicKey(this.publicKey),
      Buffer.from(parts[2], 'base64url')
    );

    if (!isValid) {
      throw new Error('Invalid JWT signature');
    }

    return payload;
  }

  async createToken(payload: unknown): Promise<string> {
    this.log.debug('Call createToken');

    const token = encode(payload, this.privateKey, 'RS256');
    return token;
  }
}
