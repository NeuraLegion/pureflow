import { Logger } from '@nestjs/common';
import { decode, encode } from 'jwt-simple';
import { JwtTokenProcessor as JwtTokenProcessor } from './jwt.token.processor';
import { JwtHeader } from './jwt.header';

export class JwtTokenWithRSASignatureKeysProcessor extends JwtTokenProcessor {
  constructor(
    private readonly publicKey: string,
    private readonly privateKey: string
  ) {
    super(new Logger(JwtTokenWithRSASignatureKeysProcessor.name));
  }

  async validateToken(token: string): Promise<unknown> {
    this.log.debug('Call validateToken');

    const [header] = this.parse(token);

    if (!header || header.alg !== 'RS256') {
      throw new Error('Invalid JWT');
    }

    return decode(token, this.publicKey, false, 'RS256');
  }

  async createToken(payload: unknown): Promise<string> {
    this.log.debug('Call createToken');
    const header: JwtHeader = {
      alg: 'RS256',
      typ: 'JWT'
    };
    return encode(payload, this.privateKey, 'RS256', { header });
  }
}
