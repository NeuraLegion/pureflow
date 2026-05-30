import { EntityManager } from '@mikro-orm/core';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { decode, encode } from 'jwt-simple';
import { JwtHeader } from './jwt.header';
import { JwtTokenProcessor as JwtTokenProcessor } from './jwt.token.processor';

export class JwtTokenWithSqlKIDProcessor extends JwtTokenProcessor {
  private static readonly KID: number = 0;
  private static readonly KID_FETCH_QUERY = () =>
    `select key from (select ? as key, ${JwtTokenWithSqlKIDProcessor.KID} as id) as keys where keys.id = ?`;

  constructor(
    private readonly em: EntityManager,
    private key: string
  ) {
    super(new Logger(JwtTokenWithSqlKIDProcessor.name));
  }

  async validateToken(token: string): Promise<unknown> {
    this.log.debug('Call validateToken');

    try {
      const [header] = this.parse(token);
      const kid = this.validateKid(header);
      const query = JwtTokenWithSqlKIDProcessor.KID_FETCH_QUERY();

      this.log.debug('Executing key fetching query');
      const keyRow: { key: string } | null = await this.em
        .getConnection()
        .execute(query, [this.key, kid], 'get');

      if (!keyRow?.key) {
        throw new UnauthorizedException({
          error: 'Unauthorized'
        });
      }

      return decode(token, keyRow.key, false, 'HS256');
    } catch (error) {
      this.log.warn(
        `JWT SQL KID validation failed: ${error instanceof Error ? error.name : 'UnknownError'}`
      );
      throw new UnauthorizedException({
        error: 'Unauthorized'
      });
    }
  }

  async createToken(payload: unknown): Promise<string> {
    this.log.debug('Call createToken');
    const header: JwtHeader = {
      alg: 'HS256',
      kid: `${JwtTokenWithSqlKIDProcessor.KID}`,
      typ: 'JWT'
    };
    const token = encode(payload, this.key, 'HS256', {
      header
    });
    return token;
  }

  private validateKid(header: JwtHeader): number {
    if (!header || typeof header.kid !== 'string' || !/^\d+$/.test(header.kid)) {
      throw new UnauthorizedException({
        error: 'Unauthorized'
      });
    }

    const kid = Number.parseInt(header.kid, 10);

    if (!Number.isSafeInteger(kid) || kid !== JwtTokenWithSqlKIDProcessor.KID) {
      throw new UnauthorizedException({
        error: 'Unauthorized'
      });
    }

    return kid;
  }
}
