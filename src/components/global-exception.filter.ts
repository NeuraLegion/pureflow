import {
  ArgumentsHost,
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { GqlContextType } from '@nestjs/graphql';

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost) {
    const gql = host.getType<GqlContextType>() === 'graphql';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const sanitizedException =
        status >= 500
          ? new InternalServerErrorException({
              error: 'An internal error has occurred.'
            })
          : status === 401
          ? new UnauthorizedException({
              error: 'Unauthorized'
            })
          : exception;

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
      exception instanceof Error ? exception.message : 'Unknown error'
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
