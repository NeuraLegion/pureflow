import {
  Logger,
  UnauthorizedException,
  InternalServerErrorException
} from '@nestjs/common';
import * as jose from 'jose';
import { JwtTokenProcessor as JwtTokenProcessor } from './jwt.token.processor';

export class JwtTokenWithJWKProcessor extends JwtTokenProcessor {
  constructor(
    private key: string,
    private jwk: jose.JWK
  ) {
    super(new Logger(JwtTokenWithJWKProcessor.name));
  }

  async validateToken(token: string): Promise<unknown> {
    this.log.debug('Call validateToken');
    const [header, payload] = this.parse(token);

    if (!header.jwk) {
      throw new UnauthorizedException('Invalid token');
    }

    if (!header.jwk.kty) {
      return payload;
    }

    try {
      const keyLike = await jose.importJWK(header.jwk);
      const res = await jose.jwtVerify(token, keyLike);

      if (res) {
        return payload;
      }
    } catch (error) {
      this.log.warn(`JWT validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new UnauthorizedException('Invalid token');
    }

    throw new InternalServerErrorException('An internal error has occurred.');
  }

  async createToken(payload: jose.JWTPayload): Promise<string> {
    this.log.debug('Call createToken');
    const pkcs8 = await jose.importPKCS8(this.key, 'RS256');
    return new jose.SignJWT(payload)
      .setProtectedHeader({
        typ: 'JWT',
        alg: 'RS256',
        jwk: this.jwk
      })
      .sign(pkcs8);
  }
}
