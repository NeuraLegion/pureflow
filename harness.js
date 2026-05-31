const express = require('express');
require('reflect-metadata');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

function sendText(res, status, body) {
  res.status(status);

  if (body && typeof body === 'object' && body.content && Buffer.isBuffer(body.content)) {
    res.set('Content-Type', body.contentType || 'application/octet-stream');
    return res.send(body.content);
  }

  res.set('Content-Type', 'text/plain');
  if (body === undefined || body === null) return res.send('');
  if (Buffer.isBuffer(body)) return res.send(body.toString('utf8'));
  if (typeof body === 'string') return res.send(body);
  return res.send(typeof body === 'object' ? JSON.stringify(body) : String(body));
}

function parseMaybeJSON(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function getParam(req, name, fallback) {
  if (req.body && req.body[name] !== undefined) return req.body[name];
  if (req.query && req.query[name] !== undefined) return req.query[name];
  return fallback;
}

function createMockLogger() {
  return {
    log() {},
    debug() {},
    warn() {},
    error() {},
    verbose() {}
  };
}

function createConnectionStub() {
  return {
    async execute(query, params) {
      const sql = String(query || '');

      if (/select\s+\*\s+from\s+testimonial/i.test(sql)) {
        return [
          { id: 1, created_at: new Date().toISOString() },
          { id: 2, created_at: new Date().toISOString() },
          { id: 3, created_at: new Date().toISOString() },
          { id: 4, created_at: new Date().toISOString() },
          { id: 5, created_at: new Date().toISOString() }
        ];
      }

      if (/delete\s+from\s+testimonial\s+where\s+id\s+not\s+in/i.test(sql)) {
        return { affectedRows: Array.isArray(params && params[0]) ? params[0].length : 0 };
      }

      if (/select\s+count/i.test(sql)) {
        return [{ count: 1 }];
      }

      if (/^\s*update\b/i.test(sql)) {
        return { affectedRows: 1 };
      }

      return [{ ok: true }];
    }
  };
}

function createEntityManagerStub() {
  const connection = createConnectionStub();
  return {
    getConnection() {
      return connection;
    },
    async persistAndFlush(entity) {
      if (entity && entity.id == null) entity.id = 1;
      if (entity && entity.createdAt == null) entity.createdAt = new Date();
      return entity;
    }
  };
}

function createUsersRepoStub() {
  const users = [
    {
      id: 1,
      email: 'john.doe@example.com',
      firstName: 'john',
      lastName: 'doe',
      isAdmin: false,
      company: 'Acme',
      cardNumber: '4111111111111111',
      phoneNumber: '123456789',
      isBasic: true
    },
    {
      id: 2,
      email: 'jane@example.com',
      firstName: 'jane',
      lastName: 'roe',
      isAdmin: true,
      company: 'Beta',
      cardNumber: '5555555555554444',
      phoneNumber: '987654321',
      isBasic: false
    },
    {
      id: 3,
      email: 'johnny@example.com',
      firstName: 'johnny',
      lastName: 'tester',
      isAdmin: false,
      company: 'Gamma',
      cardNumber: '4000000000000002',
      phoneNumber: '5551234',
      isBasic: true
    }
  ];

  return {
    async find(where, options = {}) {
      let result = users.slice();

      if (where && where.firstName && where.firstName.$like !== undefined) {
        const prefix = String(where.firstName.$like).replace(/%$/, '');
        result = result.filter((u) => String(u.firstName).startsWith(prefix));
      }

      if (where && where.email && where.email.$like !== undefined) {
        const prefix = String(where.email.$like).replace(/%$/, '');
        result = result.filter((u) => String(u.email).startsWith(prefix));
      }

      if (options && Number.isFinite(options.limit)) {
        result = result.slice(0, options.limit);
      }

      return result;
    },
    async findOne(where) {
      if (where && where.email !== undefined) {
        return users.find((u) => u.email === where.email) || null;
      }
      if (where && where.id !== undefined) {
        return users.find((u) => u.id === where.id) || null;
      }
      return null;
    }
  };
}

function createGenericRepoStub() {
  return {
    async findAll() {
      return [];
    },
    async find() {
      return [];
    },
    async findOne() {
      return null;
    }
  };
}

function createLocalHttpResponse(url, method, data) {
  const u = String(url || '');

  if (u.startsWith('http://127.0.0.1:8080/') || u.startsWith('http://localhost:8080/')) {
    const path = new URL(u).pathname;

    if (path === '/metadata') {
      return {
        status: 200,
        data: { service: 'metadata', ok: true, method },
        headers: { 'content-type': 'application/json' }
      };
    }

    if (path === '/api') {
      return {
        status: method === 'POST' ? 201 : 200,
        data: method === 'POST' ? { ok: true, received: data } : { ok: true, method: 'GET' },
        headers: { 'content-type': 'application/json' }
      };
    }

    if (path === '/file.txt') {
      return {
        status: 200,
        data: Buffer.from('sample text file'),
        headers: { 'content-type': 'text/plain' }
      };
    }

    if (path === '/file.bin') {
      return {
        status: 200,
        data: Buffer.from([0x41, 0x42, 0x43, 0x44]),
        headers: { 'content-type': 'application/octet-stream' }
      };
    }
  }

  return null;
}

class FileServiceHarness {
  constructor() {
    this.logger = createMockLogger();
    this.cloudProviders = {
      async get(providerUrl) {
        const GOOGLE = 'http://metadata.google.internal/computeMetadata/v1/';
        const AZURE = 'http://169.254.169.254/metadata/instance';
        const DIGITAL_OCEAN = 'http://169.254.169.254/metadata/v1';
        const AWS = 'http://169.254.169.254/latest/meta-data/';

        if (String(providerUrl).startsWith(GOOGLE)) {
          return ['instance/', 'oslogin/', 'project/'].join('\n');
        }
        if (String(providerUrl).startsWith(DIGITAL_OCEAN)) {
          return ['id', 'hostname', 'user-data', 'vendor-data', 'public-keys'].join('\n');
        }
        if (String(providerUrl).startsWith(AWS)) {
          return ['ami-id', 'hostname', 'instance-id', 'local-ipv4', 'public-ipv4'].join('\n');
        }
        if (String(providerUrl).startsWith(AZURE)) {
          return JSON.stringify({ compute: { name: 'examplevmname', location: 'westus' } });
        }

        const axios = require('axios');
        const { data } = await axios(providerUrl, {
          timeout: 5000,
          responseType: 'text'
        });
        return data;
      }
    };
  }

  async getFile(file) {
    const fs = require('fs');
    const path = require('path');
    const { Readable } = require('stream');
    const { R_OK } = require('constants');

    this.logger.log(`Reading file: ${file}`);

    if (file.startsWith('/')) {
      await fs.promises.access(file, R_OK);
      return fs.createReadStream(file);
    } else if (file.startsWith('http')) {
      const content = await this.cloudProviders.get(file);
      if (content) {
        return Readable.from(content);
      }
      throw new Error(`no such file or directory, access '${file}'`);
    } else {
      const resolved = path.resolve(process.cwd(), file);
      await fs.promises.access(resolved, R_OK);
      return fs.createReadStream(resolved);
    }
  }

  async deleteFile(file) {
    const fs = require('fs');
    const path = require('path');

    if (file.startsWith('/')) {
      throw new Error('cannot delete file from this location');
    } else if (file.startsWith('http')) {
      throw new Error('cannot delete file from this location');
    } else {
      const resolved = path.resolve(process.cwd(), file);

      try {
        await fs.promises.unlink(resolved);
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
          await fs.promises.writeFile(resolved, '');
          await fs.promises.unlink(resolved);
        } else {
          throw err;
        }
      }

      return true;
    }
  }
}

class HttpClientServiceHarness {
  constructor() {
    this.log = createMockLogger();
  }

  async loadJSON(url) {
    const stub = createLocalHttpResponse(url, 'GET');
    if (stub) {
      if (stub.status != 200) {
        throw new Error(`Failed to load url: ${url}. Status ${stub.status}`);
      }
      this.log.debug(
        `Loaded: ${typeof stub.data === 'string' ? stub.data : JSON.stringify(stub.data)}`
      );
      return stub.data;
    }

    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'json' });
    if (resp.status != 200) {
      throw new Error(`Failed to load url: ${url}. Status ${resp.status}`);
    }
    this.log.debug(
      `Loaded: ${typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)}`
    );
    return resp.data;
  }

  async post(url, data, config) {
    const stub = createLocalHttpResponse(url, 'POST', data);
    if (stub) {
      if (![200, 201].includes(+stub.status)) {
        throw new Error(`Failed to load url: ${url}. Status ${stub.status}`);
      }
      this.log.debug(`Loaded: ${JSON.stringify(stub.data)}`);
      return stub.data;
    }

    const axios = require('axios');
    const resp = await axios.post(url, data, config);
    if (![200, 201].includes(+resp.status)) {
      throw new Error(`Failed to load url: ${url}. Status ${resp.status}`);
    }
    this.log.debug(`Loaded: ${resp.data}`);
    return resp.data;
  }

  async get(url, config) {
    const stub = createLocalHttpResponse(url, 'GET');
    if (stub) {
      if (![200, 201].includes(+stub.status)) {
        throw new Error(`Failed to load url: ${url}. Status ${stub.status}`);
      }
      this.log.debug(`Loaded: ${JSON.stringify(stub.data)}`);
      return stub.data;
    }

    const axios = require('axios');
    const resp = await axios.get(url, config);
    if (![200, 201].includes(+resp.status)) {
      throw new Error(`Failed to load url: ${url}. Status ${resp.status}`);
    }
    this.log.debug(`Loaded: ${resp.data}`);
    return resp.data;
  }

  async loadPlain(url) {
    const stub = createLocalHttpResponse(url, 'GET');
    if (stub) {
      if (stub.status != 200) {
        throw new Error(`Failed to load url: ${url}. Status ${stub.status}`);
      }
      const buffer = Buffer.isBuffer(stub.data) ? stub.data : Buffer.from(String(stub.data));
      const text = buffer.toString();
      this.log.debug(`Loaded: ${text}`);
      return text;
    }

    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'arraybuffer' });

    if (resp.status != 200) {
      throw new Error(`Failed to load url: ${url}. Status ${resp.status}`);
    }

    const buffer = Buffer.from(resp.data);
    const text = buffer.toString();
    this.log.debug(`Loaded: ${text}`);
    return text;
  }

  async loadAny(url) {
    const stub = createLocalHttpResponse(url, 'GET');
    if (stub) {
      if (stub.status != 200) {
        throw new Error(`Failed to load url: ${url}. Status ${stub.status}`);
      }

      const buffer = Buffer.isBuffer(stub.data) ? stub.data : Buffer.from(String(stub.data));

      return {
        content: buffer,
        contentType: stub.headers['content-type']
      };
    }

    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'arraybuffer' });

    if (resp.status != 200) {
      throw new Error(`Failed to load url: ${url}. Status ${resp.status}`);
    }

    const buffer = Buffer.from(resp.data);

    return {
      content: buffer,
      contentType: resp.headers['content-type']
    };
  }
}

class TestimonialEntity {
  constructor() {
    this.id = undefined;
    this.createdAt = undefined;
    this.name = undefined;
    this.title = undefined;
    this.message = undefined;
  }
}

class TestimonialsServiceHarness {
  constructor(testimonialsRepository, em) {
    this.MAX_LIMIT = 5;
    this.logger = createMockLogger();
    this.testimonialsRepository = testimonialsRepository;
    this.em = em;
  }

  async createTestimonial(message, name, title) {
    this.logger.debug(
      `Create a testimonial. Name: ${message}, title: ${title}, message: ${message}`
    );

    const connection = this.em.getConnection();
    const legacyTestimonials = await connection.execute(
      `select * from testimonial where id is not null order by created_at`
    );

    if (legacyTestimonials?.length >= this.MAX_LIMIT) {
      const ids = legacyTestimonials
        .splice(-1 * (this.MAX_LIMIT - 1))
        .map((x) => x.id);

      await connection.execute('delete from testimonial where id not in(?)', [ids]);
    }

    const t = new TestimonialEntity();
    t.message = message;
    t.name = name;
    t.title = title;

    await this.em.persistAndFlush(t);
    this.logger.debug(`Saved new testimonial`);

    return t;
  }

  async count(query) {
    try {
      this.logger.debug(`Saved new testimonial`);
      return (await this.em.getConnection().execute(query))[0].count;
    } catch (err) {
      this.logger.warn(`Failed to execute query. Error: ${err.message}`);
      return err.message;
    }
  }
}

class ProductsServiceHarness {
  constructor(productsRepository, em) {
    this.logger = createMockLogger();
    this.productsRepository = productsRepository;
    this.em = em;
  }

  async updateProduct(query) {
    try {
      this.logger.debug(`Updating products table with query "${query}"`);
      await this.em.getConnection().execute(query);
      return;
    } catch (err) {
      this.logger.warn(`Failed to execute query. Error: ${err.message}`);
      throw new Error(err.message);
    }
  }
}

class UsersServiceHarness {
  constructor(usersRepository, em) {
    this.log = createMockLogger();
    this.usersRepository = usersRepository;
    this.em = em;
  }

  async searchByName(query, limit) {
    this.log.debug(`Called searchUsersByName`);
    return this.usersRepository.find(
      {
        firstName: { $like: query + '%' }
      },
      limit ? { limit } : {}
    );
  }

  async findByEmailPrefix(emailPrefix) {
    this.log.debug(`Called findByEmailPrefix ${emailPrefix}`);
    return this.usersRepository.find({ email: { $like: emailPrefix + '%' } });
  }
}

class PartnersServiceHarness {
  constructor() {
    this.logger = createMockLogger();
    this.XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
    this.XML_AUTHORS_STR = `${this.XML_HEADER}
    <partners>
      <partner>
        <name>Walter White</name>
        <age>50</age>
        <profession>Chemistry Teacher</profession>
        <residency country="US" state="New Mexico" city="Albuquerque" />
        <username>walter100</username>
        <password>Heisenberg123</password>
        <wealth>15M USD</wealth>
      </partner>

      <partner>
        <name>Jesse Pinkman</name>
        <age>25</age>
        <profession>Professional Product Distributer</profession>
        <residency country="US" state="New Mexico" city="Yo Moma" />
        <username>dapinkman69</username>
        <password>Yoyo1!</password>
        <wealth>5M USD</wealth>
      </partner>

      <partner>
        <name>Michael Ehrmantraut</name>
        <age>65</age>
        <profession>Personal Security Agent</profession>
        <residency country="US" state="New Mexico" city="Albuquerque" />
        <username>_safetyman_</username>
        <password>LittleKid777</password>
        <wealth>50M USD</wealth>
      </partner>

      <partner>
        <name>Gus Fring</name>
        <age>52</age>
        <profession>Restaurant Chain Owner</profession>
        <residency country="US" state="New Mexico" city="Albuquerque" />
        <username>ChickMan</username>
        <password>GoodChicken4U</password>
        <wealth>Too much USD</wealth>
      </partner>
    </partners>
  `;
  }

  getPartnersXMLObj() {
    const { DOMParser } = require('@xmldom/xmldom');
    return new DOMParser().parseFromString(this.XML_AUTHORS_STR, 'text/xml');
  }

  selectPartnerPropertiesByXPATH(xpathExpression) {
    const xpath = require('xpath');
    const partnersXMLObj = this.getPartnersXMLObj();
    return xpath.select(xpathExpression, partnersXMLObj);
  }

  getFormattedXMLOutput(xmlNodes) {
    return `${this.XML_HEADER}\n<root>\n${xmlNodes.join('\n')}\n</root>`;
  }

  getPartnersProperties(xpathExpression) {
    let xmlNodes = this.selectPartnerPropertiesByXPATH(xpathExpression);

    if (!Array.isArray(xmlNodes)) {
      this.logger.debug(`xmlNodes's type wasn't 'Array', and it's value was: ${xmlNodes}`);
      xmlNodes = [];
    } else {
      this.logger.debug(`Raw xpath xmlNodes value is: ${xmlNodes}`);
    }

    return this.getFormattedXMLOutput(xmlNodes);
  }
}

class LdapQueryHandlerHarness {
  constructor() {
    this.log = createMockLogger();
  }

  parseQuery(query) {
    const PARSER = /\(&\(objectClass=person\)\(objectClass=user\)\(email=(.*)\)\)/;
    const LDAP_ERROR_RESPONSE = `
      Lookup failed: javax.naming.NamingException: 
      [LDAP: error code 1 - 000004DC: Lda pErr: DSID-0C0906DC, comment: context not found., data 0, v1db1 ]; 
      remaining name: 'OU=Users,O=pureflow'
    `;

    this.log.debug(`query: ${query}`);

    const res = query.match(PARSER);

    if (!res || res.length != 2 || !res[1]) {
      throw new Error(LDAP_ERROR_RESPONSE);
    } else {
      return res[1];
    }
  }
}

const emStub = createEntityManagerStub();

const fileServiceInstance = new FileServiceHarness();
const httpClientServiceInstance = new HttpClientServiceHarness();
const testimonialsServiceInstance = new TestimonialsServiceHarness(createGenericRepoStub(), emStub);
const productsServiceInstance = new ProductsServiceHarness(createGenericRepoStub(), emStub);
const usersServiceInstance = new UsersServiceHarness(createUsersRepoStub(), emStub);
const partnersServiceInstance = new PartnersServiceHarness();
const ldapQueryHandlerInstance = new LdapQueryHandlerHarness();

app.get('/health', (req, res) => sendText(res, 200, 'ok'));

app.get('/harness/fileservice-getfile', async (req, res) => {
  try {
    if (!fileServiceInstance) return sendText(res, 500, 'FileService unavailable');
    const file = getParam(req, 'file', '../../etc/passwd');
    const out = await fileServiceInstance.getFile(String(file));
    if (out && typeof out.pipe === 'function') {
      const chunks = [];
      out.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
      out.on('end', () => sendText(res, 200, Buffer.concat(chunks)));
      out.on('error', (err) => sendText(res, 500, err.message));
    } else {
      sendText(res, 200, out);
    }
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.delete('/harness/fileservice-deletefile', async (req, res) => {
  try {
    if (!fileServiceInstance) return sendText(res, 500, 'FileService unavailable');
    const file = getParam(req, 'file', 'config/products/crystals/some_file.jpg');
    const out = await fileServiceInstance.deleteFile(String(file));
    sendText(res, 200, String(out));
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/httpclientservice-loadjson', async (req, res) => {
  try {
    if (!httpClientServiceInstance) return sendText(res, 500, 'HttpClientService unavailable');
    const url = getParam(req, 'url', 'http://127.0.0.1:8080/metadata');
    const out = await httpClientServiceInstance.loadJSON(String(url));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.post('/harness/httpclientservice-post', async (req, res) => {
  try {
    if (!httpClientServiceInstance) return sendText(res, 500, 'HttpClientService unavailable');
    const url = getParam(req, 'url', 'http://127.0.0.1:8080/api');
    const data = parseMaybeJSON(getParam(req, 'data', { a: 1 }));
    const out = await httpClientServiceInstance.post(String(url), data);
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/httpclientservice-get', async (req, res) => {
  try {
    if (!httpClientServiceInstance) return sendText(res, 500, 'HttpClientService unavailable');
    const url = getParam(req, 'url', 'http://127.0.0.1:8080/api');
    const out = await httpClientServiceInstance.get(String(url));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/httpclientservice-loadplain', async (req, res) => {
  try {
    if (!httpClientServiceInstance) return sendText(res, 500, 'HttpClientService unavailable');
    const url = getParam(req, 'url', 'http://127.0.0.1:8080/file.txt');
    const out = await httpClientServiceInstance.loadPlain(String(url));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/httpclientservice-loadany', async (req, res) => {
  try {
    if (!httpClientServiceInstance) return sendText(res, 500, 'HttpClientService unavailable');
    const url = getParam(req, 'url', 'http://127.0.0.1:8080/file.bin');
    const out = await httpClientServiceInstance.loadAny(String(url));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.post('/harness/testimonialsservice-createtestimonial', async (req, res) => {
  try {
    if (!testimonialsServiceInstance) return sendText(res, 500, 'TestimonialsService unavailable');
    const message = getParam(req, 'message', 'great product');
    const name = getParam(req, 'name', 'alice');
    const title = getParam(req, 'title', 'Engineer');
    const out = await testimonialsServiceInstance.createTestimonial(
      String(message),
      String(name),
      String(title)
    );
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/testimonialsservice-count', async (req, res) => {
  try {
    if (!testimonialsServiceInstance) return sendText(res, 500, 'TestimonialsService unavailable');
    const query = getParam(req, 'query', 'select count(*) as count from testimonial');
    const out = await testimonialsServiceInstance.count(String(query));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/productsservice-updateproduct', async (req, res) => {
  try {
    if (!productsServiceInstance) return sendText(res, 500, 'ProductsService unavailable');
    const query = getParam(
      req,
      'query',
      "UPDATE product SET views_count = views_count + 1 WHERE name = 'foo'"
    );
    const out = await productsServiceInstance.updateProduct(String(query));
    sendText(res, 200, out === undefined ? 'ok' : out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/usersservice-searchbyname', async (req, res) => {
  try {
    if (!usersServiceInstance) return sendText(res, 500, 'UsersService unavailable');
    const query = getParam(req, 'query', 'jo');
    const limit = getParam(req, 'limit', 10);
    const out = await usersServiceInstance.searchByName(String(query), Number(limit));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/usersservice-findbyemailprefix', async (req, res) => {
  try {
    if (!usersServiceInstance) return sendText(res, 500, 'UsersService unavailable');
    const emailPrefix = getParam(req, 'emailPrefix', 'john.doe@');
    const out = await usersServiceInstance.findByEmailPrefix(String(emailPrefix));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/partnersservice-getpartnersproperties', async (req, res) => {
  try {
    if (!partnersServiceInstance) return sendText(res, 500, 'PartnersService unavailable');
    const xpathExpression = getParam(req, 'xpathExpression', '/partners/partner/name');
    const out = await partnersServiceInstance.getPartnersProperties(String(xpathExpression));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

app.get('/harness/ldapqueryhandler-parsequery', async (req, res) => {
  try {
    if (!ldapQueryHandlerInstance) return sendText(res, 500, 'LdapQueryHandler unavailable');
    const query = getParam(
      req,
      'query',
      '(&(objectClass=person)(objectClass=user)(email=john@example.com))'
    );
    const out = await ldapQueryHandlerInstance.parseQuery(String(query));
    sendText(res, 200, out);
  } catch (err) {
    sendText(res, 500, err && err.message ? err.message : String(err));
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`harness listening on ${port}`);
});
