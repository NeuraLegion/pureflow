import { EntityManager } from '@mikro-orm/core';
import { Logger } from '@nestjs/common';
import { decode, encode } from 'jwt-simple';
import { JwtHeader } from './jwt.header';
import { JwtTokenProcessor as JwtTokenProcessor } from './jwt.token.processor';

export class JwtTokenWithSqlKIDProcessor extends JwtTokenProcessor {
  private static readonly KID: number = 0;

  constructor(
    private readonly em: EntityManager,
    private key: string
  ) {
    super(new Logger(JwtTokenWithSqlKIDProcessor.name));
  }

  async validateToken(token: string): Promise<unknown> {
    this.log.debug('Call validateToken');

    const [header] = this.parse(token);
    const kid = Number(header.kid);

    if (!Number.isInteger(kid)) {
      throw new Error('Invalid JWT');
    }

    const query =
      'select key from (select ? as key, ? as id) as keys where keys.id = ?';
    this.log.debug('Executing key fetching query');
    const keyRow = await this.em
      .getConnection()
      .execute(query, [this.key, JwtTokenWithSqlKIDProcessor.KID, kid], 'get');
    this.log.debug('Key fetched successfully');

    return decode(token, keyRow.key, false, 'HS256');
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
}
