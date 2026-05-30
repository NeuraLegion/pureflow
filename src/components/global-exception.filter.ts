import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ExceptionFilter
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { GqlContextType } from '@nestjs/graphql';

@Catch()
export class GlobalExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  private sanitizeHttpException(exception: HttpException): HttpException {
    const status = exception.getStatus();

    if (status >= 500) {
      return new InternalServerErrorException({
        error: 'An internal error has occurred.'
      });
    }

    if (status === 401) {
      return new UnauthorizedException({
        error: 'Unauthorized'
      });
    }

    if (status === 403) {
      return new ForbiddenException({
        error: 'Forbidden'
      });
    }

    if (status === 404) {
      return new NotFoundException({
        error: 'Not Found'
      });
    }

    if (status === 400) {
      return new BadRequestException({
        error: 'Bad Request'
      });
    }

    return new HttpException(
      {
        error: 'Request failed'
      },
      status
    );
  }

  public catch(exception: unknown, host: ArgumentsHost) {
    const gql = host.getType<GqlContextType>() === 'graphql';
    const request = host.switchToHttp().getRequest<{ url?: string }>();
    const requestPath =
      typeof request?.url === 'string' ? request.url.split('?')[0] : '';
    const isJwtValidationRequest = requestPath.startsWith('/api/auth/jwt/');

    if (exception instanceof HttpException) {
      const sanitizedException = isJwtValidationRequest
        ? new UnauthorizedException({ error: 'Unauthorized' })
        : this.sanitizeHttpException(exception);

      this.logger.warn(
        `HTTP exception intercepted with status ${exception.getStatus()}`
      );

      if (gql) {
        throw sanitizedException;
      }

      const ctx = host.switchToHttp();
      const response = ctx.getResponse();

      if (response && typeof response.status === 'function') {
        const status = sanitizedException.getStatus();
        const message = isJwtValidationRequest
          ? 'Unauthorized'
          : status === 400
            ? 'Bad Request'
            : status === 401
              ? 'Unauthorized'
              : status === 403
                ? 'Forbidden'
                : status === 404
                  ? 'Not Found'
                  : status >= 500
                    ? 'Internal Server Error'
                    : 'Request failed';

        return response.status(status).json({
          success: false,
          error: {
            kind: status >= 500 ? 'internal' : 'user_input',
            message
          }
        });
      }

      return super.catch(sanitizedException, host);
    }

    const unprocessableException = new InternalServerErrorException({
      error: 'An internal error has occurred.'
    });

    this.logger.error('Unhandled exception intercepted');

    if (gql) {
      throw unprocessableException;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (response && typeof response.status === 'function') {
      return response.status(unprocessableException.getStatus()).json({
        success: false,
        error: {
          kind: 'internal',
          message: 'Internal Server Error'
        }
      });
    }

    const applicationRef =
      this.applicationRef ||
      (this.httpAdapterHost && this.httpAdapterHost.httpAdapter);

    return applicationRef.reply(
      host.getArgByIndex(1),
      {
        success: false,
        error: {
          kind: 'internal',
          message: 'Internal Server Error'
        }
      },
      unprocessableException.getStatus()
    );
  }
}
