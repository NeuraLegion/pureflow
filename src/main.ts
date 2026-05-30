import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HeadersConfiguratorInterceptor } from './components/headers.configurator.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import session from '@fastify/session';
import { GlobalExceptionFilter } from './components/global-exception.filter';
import * as os from 'os';
import { readFileSync, readFile } from 'fs';
import cluster from 'cluster';
import {
  FastifyAdapter,
  NestFastifyApplication
} from '@nestjs/platform-fastify';
import fmp from '@fastify/multipart';
import { randomBytes } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import fastify from 'fastify';
import { fastifyStatic, ListRender } from '@fastify/static';
import { join } from 'path';

const renderDirList: ListRender = () => {
  return '<html><body><h1>Not Found</h1></body></html>';
};

const toSafeErrorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const statusCode = (err as { statusCode?: unknown }).statusCode;

    if (statusCode === 400) {
      return 'Bad Request';
    }

    if (statusCode === 401) {
      return 'Unauthorized';
    }

    if (statusCode === 403) {
      return 'Forbidden';
    }

    if (statusCode === 404) {
      return 'Not Found';
    }
  }

  return 'Internal Server Error';
};

const toSafeClientMessage = (_error: unknown, statusCode: number): string => {
  if (statusCode === 400) {
    return 'Bad Request';
  }

  if (statusCode === 401) {
    return 'Unauthorized';
  }

  if (statusCode === 403) {
    return 'Forbidden';
  }

  if (statusCode === 404) {
    return 'Not Found';
  }

  return statusCode >= 500 ? 'Internal Server Error' : 'Request failed';
};

async function bootstrap() {
  http.globalAgent.maxSockets = Infinity;
  https.globalAgent.maxSockets = Infinity;

  const server = fastify({
    logger:
      process.env.FASTIFY_LOGGER === 'true'
        ? { level: process.env.FASTIFY_LOG_LEVEL || 'warn' }
        : false,
    trustProxy: true,
    onProtoPoisoning: 'ignore',
    https:
      process.env.NODE_ENV === 'production' &&
      process.env.ENABLE_HTTPS === 'true'
        ? {
            cert: readFileSync(
              '/etc/letsencrypt/live/pureflow.com/fullchain.pem'
            ),
            key: readFileSync('/etc/letsencrypt/live/pureflow.com/privkey.pem')
          }
        : undefined
  });

  server.setErrorHandler((error, request, reply) => {
    const requestPath = normalizeRequestPath(request.url);
    const isJwtValidationRequest = requestPath.startsWith('/api/auth/jwt/');
    const rawStatusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : undefined;
    const statusCode = isJwtValidationRequest
      ? 401
      : rawStatusCode && rawStatusCode >= 400 && rawStatusCode < 500
        ? rawStatusCode
        : 500;

    request.log.error(
      {
        err,
        path: requestPath,
        method: request.method
      },
      'Unhandled request error'
    );

    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.status(statusCode).send({
      success: false,
      error: {
        kind: statusCode >= 500 ? 'internal' : 'user_input',
        message: isJwtValidationRequest
          ? 'Unauthorized'
          : toSafeClientMessage(undefined, statusCode)
      }
    });
  });

  const normalizeRequestPath = (url?: string): string => {
    const rawPath = url?.split('?')[0] ?? '';

    try {
      const decodedPath = decodeURIComponent(rawPath || '/');
      return decodedPath.replace(/\/+/g, '/').toLowerCase();
    } catch {
      return (rawPath || '/').replace(/\/+/g, '/').toLowerCase();
    }
  };

  const isSensitiveStaticPath = (url?: string): boolean => {
    const normalizedPath = normalizeRequestPath(url);
    const pathSegments = normalizedPath.split('/').filter(Boolean);
    const fileName = pathSegments[pathSegments.length - 1] ?? '';

    if (
      normalizedPath === '/config.js' ||
      normalizedPath === '/nginx.conf' ||
      normalizedPath === '/.env' ||
      normalizedPath.startsWith('/.git') ||
      normalizedPath.startsWith('/.hg') ||
      normalizedPath.startsWith('/.svn') ||
      (normalizedPath.startsWith('/.') && normalizedPath !== '/.well-known')
    ) {
      return true;
    }

    return fileName === 'nginx.conf';
  };

  server.setDefaultRoute((req, res) => {
    if (req.url && req.url.startsWith('/api')) {
      res.statusCode = 404;
      return res.end(
        JSON.stringify({
          success: false,
          error: {
            kind: 'user_input',
            message: 'Not Found'
          }
        })
      );
    }

    if (isSensitiveStaticPath(req.url)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          success: false,
          error: {
            kind: 'user_input',
            message: 'Not Found'
          }
        })
      );
    }

    readFile(
      join(__dirname, '..', 'client', 'dist', 'index.html'),
      'utf8',
      (err, data) => {
        if (err) {
          res.statusCode = 500;
          res.end('Internal Server Error');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(data);
      }
    );
  });

  const blockSensitiveStaticPaths = (req, reply, done) => {
    if (isSensitiveStaticPath(req.url)) {
      reply.code(404).send({
        success: false,
        error: { kind: 'user_input', message: 'Not Found' }
      });
      return;
    }

    done();
  };

  await server.register(fastifyStatic, {
    root: join(__dirname, '..', 'client', 'dist'),
    prefix: `/`,
    decorateReply: false,
    redirect: false,
    wildcard: false,
    serveDotFiles: false,
    preHandler: blockSensitiveStaticPaths
  });

  await server.register(fastifyStatic, {
    root: join(__dirname, '..', 'client', 'dist', 'vendor'),
    prefix: `/vendor`,
    decorateReply: false,
    redirect: false,
    index: false,
    list: false,
    serveDotFiles: false,
    renderList: renderDirList,
    preHandler: blockSensitiveStaticPaths
  });

  const app: NestFastifyApplication = await NestFactory.create(
    AppModule,
    new FastifyAdapter(server),
    {
      logger:
        process.env.NODE_ENV === 'production'
          ? ['error']
          : ['debug', 'log', 'warn', 'error']
    }
  );

  await server.register(fastifyCookie);
  await server.register(fmp);
  await server.register(session, {
    secret: randomBytes(32).toString('hex').slice(0, 32),
    cookieName: 'connect.sid',
    cookie: {
      secure: false,
      httpOnly: false
    }
  });

  const httpAdapter = app.getHttpAdapter();

  app.useGlobalInterceptors(new HeadersConfiguratorInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapter));

  const options = new DocumentBuilder()
    .setTitle('Pure Flow')
    .setDescription(
      `
  ![BC logo](/assets/img/logo_blue_small.png)

  This is the _Pure Flow_ REST API.

  _Pure Flow_ is a benchmark application that uses modern technologies and implements a set of common security vulnerabilities.

  ## Available endpoints

  * [App](#/App%20controller) - common operations

  * [Auth](#/Auth%20controller) - operations with authentication methods

  * [User](#/User%20controller) - operations with users(creation, searching)

  * [Files](#/Files%20controller) - operations with files

  * [Subscriptions](#/Subscriptions%20controller) - operations with subscriptions

  * [Testimonials](#/Testimonials%20controller) - operations with testimonials

  * [Products](#/Products%20controller) — operations with products

  * [Partners](#/Partners%20controller) — operations with partners

  * [Emails](#/Emails%20controller) — operations with emails
  
  * [Chat](#/Chat%20controller) — operations with chat


  `
    )
    .setVersion('1.0')
    .addServer(process.env.URL)
    .build();
  const document = SwaggerModule.createDocument(app, options);

  SwaggerModule.setup('swagger', app, document);

  await app.init();
  await server.listen({
    port: Number(process.env.PORT || 3000),
    host: '0.0.0.0'
  });
  console.log(`Application is listening on 0.0.0.0:${process.env.PORT || 3000}`);
}

process.on('unhandledRejection', (err) => {
  console.error(
    `Unhandled rejection during startup/runtime: ${toSafeErrorMessage(err)}`
  );
});

process.on('uncaughtException', (err) => {
  console.error(
    `Uncaught exception during startup/runtime: ${toSafeErrorMessage(err)}`
  );
});

if (
  cluster.isPrimary &&
  process.env.NODE_ENV === 'production' &&
  process.env.ENABLE_CLUSTER === 'true'
) {
  console.log(`Primary ${process.pid} is running`);

  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(
      `Worker ${worker.process.pid} died with code ${code} and signal ${signal}`
    );
    console.log('Starting a new worker');
    cluster.fork();
  });
} else {
  bootstrap().catch((err) => {
    console.error(`Bootstrap failed: ${toSafeErrorMessage(err)}`);
    process.exit(1);
  });
  console.log(`Worker ${process.pid} started`);
}
