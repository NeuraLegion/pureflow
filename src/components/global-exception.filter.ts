import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { GqlContextType } from '@nestjs/graphql';

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
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

    if (exception instanceof HttpException) {
      const sanitizedException = this.sanitizeHttpException(exception);

      this.logger.warn(
        `HTTP exception intercepted with status ${exception.getStatus()}`
      );

      if (gql) {
        throw sanitizedException;
      }

      return super.catch(sanitizedException, host);
    }

    const unprocessableException = new InternalServerErrorException({
      error: 'An internal error has occurred.'
    });

    this.logger.error(
      'Unhandled exception intercepted',
      exception instanceof Error ? exception.stack : undefined
    );

    if (gql) {
      throw unprocessableException;
    }

    const applicationRef =
      this.applicationRef ||
      (this.httpAdapterHost && this.httpAdapterHost.httpAdapter);

    return applicationRef.reply(
      host.getArgByIndex(1),
      unprocessableException.getResponse(),
      unprocessableException.getStatus()
    );
  }
}
