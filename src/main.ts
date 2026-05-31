import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HeadersConfiguratorInterceptor } from './components/headers.configurator.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import session from '@fastify/session';
import { GlobalExceptionFilter } from './components/global-exception.filter';
import { existsSync, readFileSync, readFile, readdirSync } from 'fs';
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
import { join, dirname } from 'path';
import rawbody from 'raw-body';

const renderDirList: ListRender = (dirs, files) => {
  const currDir = dirname((dirs[0] || files[0]).href);
  const parentDir = dirname(currDir);
  return `
    <head><title>Index of ${currDir}/</title></head>
    <html><body>
      <h1>Index of ${currDir}/</h1>
      <hr>
      <table style="width: max(450px, 50%);">
        <tr>
          <td>
            <a href="${parentDir}">../</a>
          </td>
          <td></td><td></td>
        </tr>
        ${dirs.map(
          (dir) =>
            `<tr>
              <td>
                <a href="${dir.href}">${dir.name}</a>
              </td>
              <td>
                ${dir.stats.ctime.toLocaleString()}
              </td>
              <td>
                -
              </td>
            </tr>`
        )}
        <br/>
        ${files.map(
          (file) =>
            `<tr>
              <td>
                <a href="${file.href}">${file.name}</a>
              </td>
              <td>
                ${file.stats.ctime.toLocaleString()}
              </td>
              <td>
                ${file.stats.size}
              </td>
            </tr>`
        )}
      </table>
      <hr>
    </body></html>
  `;
};

async function bootstrap() {
  http.globalAgent.maxSockets = Infinity;
  https.globalAgent.maxSockets = Infinity;

  const certPath = '/etc/letsencrypt/live/pureflow.com/fullchain.pem';
  const keyPath = '/etc/letsencrypt/live/pureflow.com/privkey.pem';
  const useHttps =
    process.env.NODE_ENV === 'production' &&
    existsSync(certPath) &&
    existsSync(keyPath);

  const server = fastify({
    logger:
      process.env.FASTIFY_LOGGER === 'true'
        ? { level: process.env.FASTIFY_LOG_LEVEL || 'warn' }
        : false,
    trustProxy: true,
    onProtoPoisoning: 'ignore',
    connectionTimeout: 0,
    requestTimeout: 0,
    keepAliveTimeout: 0,
    bodyLimit: 104857600,
    https: useHttps
      ? {
          cert: readFileSync(certPath),
          key: readFileSync(keyPath)
        }
      : null
  });

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

  await server.register(fastifyStatic, {
    root: join(__dirname, '..', 'client', 'dist'),
    prefix: `/`,
    decorateReply: false,
    redirect: false,
    wildcard: false,
    serveDotFiles: false,
    allowedPath: (path) => !path.split('/').some((segment) => segment.startsWith('.'))
  });

  // Do not expose VCS metadata or working-copy artifacts over HTTP.

  await server.register(fastifyStatic, {
    root: join(__dirname, '..', 'client', 'dist', 'vendor'),
    prefix: `/vendor`,
    decorateReply: false,
    redirect: true,
    index: false,
    list: {
      format: 'html',
      render: renderDirList
    },
    serveDotFiles: false
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
  server.addContentTypeParser('*', (req) => rawbody(req.raw));

  const httpAdapter = app.getHttpAdapter();

  app
    .useGlobalInterceptors(new HeadersConfiguratorInterceptor())
    .useGlobalFilters(new GlobalExceptionFilter(httpAdapter));

  const options = new DocumentBuilder()
    .setTitle('Pure Flow')
    .setDescription('Pure Flow API')
    .setVersion('1.0')
    .addServer(process.env.URL)
    .build();
  const document = SwaggerModule.createDocument(app, options);

  SwaggerModule.setup('swagger', app, document);

  await app.listen(3000, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
