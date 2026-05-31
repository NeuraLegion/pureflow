const express = require('express');
require('reflect-metadata');

let tsNodeRegistered = false;
try {
  require('ts-node/register/transpile-only');
  tsNodeRegistered = true;
} catch (err) {
  console.warn(
    `[harness] failed to register ts-node: ${err && err.stack ? err.stack : err}`
  );
}

function sendPlain(res, status, body) {
  res.status(status);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  if (body === undefined || body === null) return res.send('');
  if (Buffer.isBuffer(body)) return res.send(body);
  if (typeof body === 'string') return res.send(body);
  return res.send(String(body));
}

function sendJSON(res, status, body) {
  res.status(status);
  res.set('Content-Type', 'application/json; charset=utf-8');
  return res.send(JSON.stringify(body));
}

function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

function installNestAndLibraryStubs() {
  const Module = require('module');
  const originalLoad = Module._load;

  function decoratorNoop() {
    return function () {};
  }

  class Logger {
    constructor(context) {
      this.context = context;
    }
    log() {}
    debug() {}
    warn() {}
    error() {}
    verbose() {}
  }

  class InternalServerErrorException extends Error {
    constructor(message) {
      super(message || 'Internal Server Error');
      this.name = 'InternalServerErrorException';
      this.status = 500;
    }
  }

  class UnauthorizedException extends Error {
    constructor(message) {
      super(message || 'Unauthorized');
      this.name = 'UnauthorizedException';
      this.status = 401;
    }
  }

  class ConfigService {
    get(key) {
      return process.env[key];
    }
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@nestjs/common') {
      return {
        Injectable: decoratorNoop,
        Logger,
        InternalServerErrorException,
        UnauthorizedException,
        OnModuleInit: class OnModuleInit {}
      };
    }

    if (request === '@nestjs/config') {
      return {
        ConfigService
      };
    }

    if (request === 'jwk-to-pem') {
      const fn = function jwkToPem() {
        return '-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----';
      };
      fn.default = fn;
      return fn;
    }

    if (request === 'jsonwebtoken') {
      return {
        verify(token) {
          return { token };
        }
      };
    }

    return originalLoad.apply(this, arguments);
  };
}

installNestAndLibraryStubs();

function safeRequire(modulePath) {
  try {
    return { mod: require(modulePath), error: null };
  } catch (err) {
    console.warn(
      `[harness] failed to load ${modulePath}: ${err && err.stack ? err.stack : err}`
    );
    return { mod: null, error: err };
  }
}

function firstExport(mod, preferredName) {
  if (!mod) return null;
  if (preferredName && mod[preferredName]) return mod[preferredName];
  if (typeof mod === 'function') return mod;
  if (mod.default && typeof mod.default === 'function') return mod.default;
  for (const v of Object.values(mod)) {
    if (typeof v === 'function') return v;
  }
  return null;
}

function instantiate(TClass, deps = []) {
  try {
    return { instance: new TClass(...deps), error: null };
  } catch (err) {
    return { instance: null, error: err };
  }
}

function loadTsModule(basePath, preferredName) {
  const attempts = [basePath, `${basePath}.ts`, `${basePath}.js`];
  let lastError = null;

  for (const p of attempts) {
    const { mod, error } = safeRequire(p);
    if (mod) {
      return {
        mod,
        exportValue: firstExport(mod, preferredName),
        path: p,
        error: null
      };
    }
    lastError = error;
  }

  return { mod: null, exportValue: null, path: null, error: lastError };
}

function getBodyValue(req, key, fallback = '') {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
    return req.body[key];
  }
  return fallback;
}

function valueToString(v, fallback = '') {
  if (v === undefined || v === null) return fallback;
  if (Array.isArray(v)) return valueToString(v[0], fallback);
  return String(v);
}

function valueToObject(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch (_) {
    return undefined;
  }
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
    );
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => sendPlain(res, 200, tsNodeRegistered ? 'ok' : 'ok'));

const loaded = {};

// FileService
{
  const fileServiceLoad = loadTsModule('/app/src/file/file.service', 'FileService');
  const FileService = fileServiceLoad.exportValue;

  if (FileService) {
    const { instance, error } = instantiate(FileService);
    if (instance) {
      loaded.fileService = instance;

      app.get('/harness/fileservice-getfile', async (req, res) => {
        try {
          const file = valueToString(req.query.file, valueToString(req.query.path, ''));
          const out = await loaded.fileService.getFile(file);

          if (out && typeof out.on === 'function') {
            const buf = await streamToBuffer(out);
            return sendPlain(res, 200, buf);
          }

          sendPlain(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });

      app.delete('/harness/fileservice-deletefile', async (req, res) => {
        try {
          const file = valueToString(
            req.query.file,
            valueToString(req.query.path, getBodyValue(req, 'file', getBodyValue(req, 'path', '')))
          );
          const out = await loaded.fileService.deleteFile(file);
          sendPlain(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });
    } else {
      console.warn(`[harness] could not instantiate FileService: ${errMessage(error)}`);
    }
  } else {
    console.warn(
      `[harness] FileService not loaded from ${fileServiceLoad.path || '/app/src/file/file.service'}`
    );
  }
}

// HttpClientService
{
  const httpLoad = loadTsModule('/app/src/httpclient/httpclient.service', 'HttpClientService');
  const HttpClientService = httpLoad.exportValue;

  if (HttpClientService) {
    const { instance, error } = instantiate(HttpClientService);
    if (instance) {
      loaded.httpClientService = instance;

      app.get('/harness/httpclientservice-loadjson', async (req, res) => {
        try {
          const out = await loaded.httpClientService.loadJSON(
            valueToString(req.query.url, '')
          );
          if (typeof out === 'string') return sendPlain(res, 200, out);
          return sendJSON(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });

      app.post('/harness/httpclientservice-post', async (req, res) => {
        try {
          const url = valueToString(req.query.url, getBodyValue(req, 'url', ''));
          const data = Object.prototype.hasOwnProperty.call(req.body || {}, 'data')
            ? req.body.data
            : req.body;
          const config =
            valueToObject(req.query.config) ||
            valueToObject(getBodyValue(req, 'config', undefined));

          const out = await loaded.httpClientService.post(url, data, config);
          if (typeof out === 'string') return sendPlain(res, 200, out);
          return sendJSON(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });

      app.get('/harness/httpclientservice-get', async (req, res) => {
        try {
          const config =
            valueToObject(req.query.config) ||
            valueToObject(getBodyValue(req, 'config', undefined));
          const out = await loaded.httpClientService.get(
            valueToString(req.query.url, ''),
            config
          );
          if (typeof out === 'string') return sendPlain(res, 200, out);
          return sendJSON(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });

      app.get('/harness/httpclientservice-loadplain', async (req, res) => {
        try {
          const out = await loaded.httpClientService.loadPlain(
            valueToString(req.query.url, '')
          );
          sendPlain(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });

      app.get('/harness/httpclientservice-loadany', async (req, res) => {
        try {
          const out = await loaded.httpClientService.loadAny(
            valueToString(req.query.url, '')
          );
          if (out && Object.prototype.hasOwnProperty.call(out, 'content')) {
            res.status(200);
            res.set(
              'Content-Type',
              out.contentType ? String(out.contentType) : 'application/octet-stream'
            );
            if (out.contentType) res.set('X-Content-Type', String(out.contentType));
            return res.send(
              Buffer.isBuffer(out.content) ? out.content : Buffer.from(out.content)
            );
          }
          if (typeof out === 'string') return sendPlain(res, 200, out);
          return sendJSON(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });
    } else {
      console.warn(
        `[harness] could not instantiate HttpClientService: ${errMessage(error)}`
      );
    }
  } else {
    console.warn(
      `[harness] HttpClientService not loaded from ${httpLoad.path || '/app/src/httpclient/httpclient.service'}`
    );
  }
}

// PartnersService
{
  const partnersLoad = loadTsModule('/app/src/partners/partners.service', 'PartnersService');
  const PartnersService = partnersLoad.exportValue;

  if (PartnersService) {
    const { instance, error } = instantiate(PartnersService);
    if (instance) {
      loaded.partnersService = instance;

      app.get('/harness/partnersservice-getpartnersproperties', async (req, res) => {
        try {
          const out = loaded.partnersService.getPartnersProperties(
            valueToString(req.query.xpathExpression, valueToString(req.query.xpath, ''))
          );
          sendPlain(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });
    } else {
      console.warn(
        `[harness] could not instantiate PartnersService: ${errMessage(error)}`
      );
    }
  } else {
    console.warn(
      `[harness] PartnersService not loaded from ${partnersLoad.path || '/app/src/partners/partners.service'}`
    );
  }
}

// KeyCloakService
{
  const keycloakLoad = loadTsModule('/app/src/keycloak/keycloak.service', 'KeyCloakService');
  const httpLoad = loadTsModule('/app/src/httpclient/httpclient.service', 'HttpClientService');
  const configLoad = loadTsModule(
    '/app/src/keycloak/keycloak.config.properties',
    'KeyCloakConfigProperties'
  );

  const KeyCloakService = keycloakLoad.exportValue;
  const HttpClientService = httpLoad.exportValue;
  const KeyCloakConfigProperties =
    (configLoad.mod && configLoad.mod.KeyCloakConfigProperties) || configLoad.exportValue || {};

  if (KeyCloakService && HttpClientService) {
    const { instance: httpClientInstance, error: httpErr } = instantiate(HttpClientService);

    if (!httpClientInstance) {
      console.warn(
        `[harness] could not instantiate HttpClientService for KeyCloakService: ${errMessage(httpErr)}`
      );
    } else {
      const fakeConfigService = {
        get: (key) => {
          const defaults = {
            [KeyCloakConfigProperties.ENV_KEYCLOAK_SERVER_URI || 'KEYCLOAK_SERVER_URI']:
              process.env.KEYCLOAK_SERVER_URI || 'http://127.0.0.1:8080',
            [KeyCloakConfigProperties.ENV_KEYCLOAK_REALM || 'KEYCLOAK_REALM']:
              process.env.KEYCLOAK_REALM || 'realm',
            [KeyCloakConfigProperties.ENV_KEYCLOAK_PUBLIC_CLIENT_ID ||
            'KEYCLOAK_PUBLIC_CLIENT_ID']:
              process.env.KEYCLOAK_PUBLIC_CLIENT_ID || 'public',
            [KeyCloakConfigProperties.ENV_KEYCLOAK_PUBLIC_CLIENT_SECRET ||
            'KEYCLOAK_PUBLIC_CLIENT_SECRET']:
              process.env.KEYCLOAK_PUBLIC_CLIENT_SECRET || 'public-secret',
            [KeyCloakConfigProperties.ENV_KEYCLOAK_ADMIN_CLIENT_ID ||
            'KEYCLOAK_ADMIN_CLIENT_ID']:
              process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'admin',
            [KeyCloakConfigProperties.ENV_KEYCLOAK_ADMIN_CLIENT_SECRET ||
            'KEYCLOAK_ADMIN_CLIENT_SECRET']:
              process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || 'admin-secret'
          };
          return Object.prototype.hasOwnProperty.call(defaults, key)
            ? defaults[key]
            : process.env[key];
        }
      };

      try {
        const kc = new KeyCloakService(fakeConfigService, httpClientInstance);
        loaded.keycloakService = kc;

        app.get('/harness/keycloakservice-loadjson', async (req, res) => {
          try {
            const out = await loaded.keycloakService.httpClient.loadJSON(
              valueToString(req.query.url, '')
            );
            if (typeof out === 'string') return sendPlain(res, 200, out);
            return sendJSON(res, 200, out);
          } catch (err) {
            sendPlain(res, 500, errMessage(err));
          }
        });
      } catch (err) {
        console.warn(`[harness] could not instantiate KeyCloakService: ${errMessage(err)}`);
      }
    }
  } else {
    console.warn('[harness] KeyCloakService or dependency not loaded from source files');
  }
}

// LdapQueryHandler
{
  const ldapLoad = loadTsModule('/app/src/users/ldap.query.handler', 'LdapQueryHandler');
  const LdapQueryHandler = ldapLoad.exportValue;

  if (LdapQueryHandler) {
    try {
      const handler = new LdapQueryHandler();
      loaded.ldapQueryHandler = handler;

      app.get('/harness/ldapqueryhandler-parsequery', async (req, res) => {
        try {
          const out = loaded.ldapQueryHandler.parseQuery(
            valueToString(req.query.query, '')
          );
          sendPlain(res, 200, out);
        } catch (err) {
          sendPlain(res, 500, errMessage(err));
        }
      });
    } catch (err) {
      console.warn(
        `[harness] could not instantiate LdapQueryHandler: ${errMessage(err)}`
      );
    }
  } else {
    console.warn(
      `[harness] LdapQueryHandler not loaded from ${ldapLoad.path || '/app/src/users/ldap.query.handler'}`
    );
  }
}

app.use((req, res) => sendPlain(res, 404, 'not found'));

const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`[harness] listening on ${port}`);
});
