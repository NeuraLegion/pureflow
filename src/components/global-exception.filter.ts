import {
  ArgumentsHost,
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { GqlContextType } from '@nestjs/graphql';

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost) {
    const gql = host.getType<GqlContextType>() === 'graphql';

    this.logger.error('Unhandled exception', exception as any);

    if (gql) {
      throw new InternalServerErrorException('An internal error has occurred.');
    }

    const safeException =
      exception instanceof HttpException
        ? new InternalServerErrorException('An internal error has occurred.')
        : new InternalServerErrorException('An internal error has occurred.');

    const applicationRef =
      this.applicationRef ||
      (this.httpAdapterHost && this.httpAdapterHost.httpAdapter);

    return applicationRef.reply(
      host.getArgByIndex(1),
      safeException.getResponse(),
      safeException.getStatus()
    );
  }
}
