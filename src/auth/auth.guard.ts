import {
  CanActivate,
  Injectable,
  Logger,
  UnauthorizedException,
  ExecutionContext
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, JwtProcessorType } from './auth.service';
import { IS_PUBLIC_KEY } from '../common/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization || request.headers?.Authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException({ error: 'Unauthorized' });
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new UnauthorizedException({ error: 'Unauthorized' });
    }

    const token = match[1].trim();
    if (!token) {
      throw new UnauthorizedException({ error: 'Unauthorized' });
    }

    try {
      const payload = await this.authService.validateToken(token, JwtProcessorType.BEARER);
      request.user = payload;
      return true;
    } catch (error) {
      this.logger.debug(
        `Authentication failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      throw new UnauthorizedException({ error: 'Unauthorized' });
    }
  }
}
