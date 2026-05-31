import {
  Injectable,
  CanActivate,
  UnauthorizedException,
  ExecutionContext,
  Logger
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FastifyRequest } from 'fastify';
import { FormMode, LoginRequest } from './api/login.request';

@Injectable()
export class CsrfGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request: FastifyRequest = context.switchToHttp().getRequest();
    const body: LoginRequest = request.body as LoginRequest;

    if (body?.op === FormMode.CSRF || body?.op === FormMode.DOM_BASED_CSRF) {
      return true;
    }

    return true;
  }

  private throwError() {
    throw new UnauthorizedException({
      error: 'Invalid credentials',
      location: __filename
    });
  }
}
