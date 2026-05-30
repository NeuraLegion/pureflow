import { Logger, UnauthorizedException } from '@nestjs/common';
import * as jose from 'jose';
import { HttpClientService } from '../../httpclient/httpclient.service';
import { JwtTokenProcessor as JwtTokenProcessor } from './jwt.token.processor';
export class JwtTokenWithX5UKeyProcessor extends JwtTokenProcessor {
  constructor(
    private key: string,
    private httpClient: HttpClientService,
    private x5uUrl: string
  ) {
    super(new Logger(JwtTokenWithX5UKeyProcessor.name));
  }

  async validateToken(token: string): Promise<unknown> {
    this.log.debug('Call validateToken');

    try {
      const [header] = this.parse(token);
      const url = header.x5u;

      if (!url || typeof url !== 'string') {
        throw new UnauthorizedException('Invalid JWT token');
      }

      this.log.debug('Loading key from configured x5u source');
      const crtPayload = await this.httpClient.loadPlain(url);
      const x509 = await jose.importX509(crtPayload, 'RS256');

      return await jose.jwtVerify(token, x509);
    } catch (error) {
      this.log.warn('X5U JWT validation failed');

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid JWT token');
    }
  }

  async createToken(payload: jose.JWTPayload): Promise<string> {
    this.log.debug('Call createToken');

    const pkcs8 = await jose.importPKCS8(this.key, 'RS256');
    return new jose.SignJWT(payload)
      .setProtectedHeader({
        typ: 'JWT',
        alg: 'RS256',
        x5u: this.x5uUrl
      })
      .sign(pkcs8);
  }
}
