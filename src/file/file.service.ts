import { Injectable, Logger } from '@nestjs/common';
import { Readable, Stream } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { CloudProvidersMetaData } from './cloud.providers.metadata';
import { R_OK } from 'constants';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private cloudProviders = new CloudProvidersMetaData();

  async getFile(file: string): Promise<Stream> {
    this.logger.log(`Reading file: ${file}`);

    if (file.startsWith('http')) {
      const content = await this.cloudProviders.get(file);

      if (content) {
        return Readable.from(content);
      } else {
        throw new Error(`no such file or directory, access '${file}'`);
      }
    }

    const resolvedFile = path.resolve(process.cwd(), file);
    const relativeFile = path.relative(process.cwd(), resolvedFile);

    if (path.isAbsolute(file) || relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
      throw new Error('invalid file path');
    }

    await fs.promises.access(resolvedFile, R_OK);

    return fs.createReadStream(resolvedFile);
  }

  async deleteFile(file: string): Promise<boolean> {
    if (file.startsWith('http')) {
      throw new Error('cannot delete file from this location');
    }

    const resolvedFile = path.resolve(process.cwd(), file);
    const relativeFile = path.relative(process.cwd(), resolvedFile);

    if (path.isAbsolute(file) || relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
      throw new Error('cannot delete file from this location');
    }

    await fs.promises.unlink(resolvedFile);
    return true;
  }
}
