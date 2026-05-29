import {
  BadRequestException,
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  Header,
  HttpException,
  InternalServerErrorException,
  Logger,
  Options,
  Param,
  Post,
  Query,
  Redirect,
  SerializeOptions,
  UseGuards,
  UseInterceptors,
  ParseIntPipe,
  DefaultValuePipe,
  HttpStatus
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import * as dotT from 'dot';
import { parseXml } from 'libxmljs';
import { AppConfig } from './app.config.api';
import {
  API_DESC_CONFIG_SERVER,
  API_DESC_LAUNCH_COMMAND,
  API_DESC_OPTIONS_REQUEST,
  API_DESC_REDIRECT_REQUEST,
  API_DESC_RENDER_REQUEST,
  API_DESC_XML_METADATA,
  SWAGGER_DESC_SECRETS,
  SWAGGER_DESC_NESTED_JSON
} from './app.controller.swagger.desc';
import { AuthGuard } from './auth/auth.guard';
import { JwtType } from './auth/jwt/jwt.type.decorator';
import { JwtProcessorType } from './auth/auth.service';
import { AppService } from './app.service';
import { BASIC_USER_INFO, UserDto } from './users/api/UserDto';
import { SWAGGER_DESC_FIND_USER } from './users/users.controller.swagger.desc';

@Controller('/api')
@ApiTags('App controller')
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) {}

  @Post('render')
  @ApiProduces('text/plain')
  @ApiConsumes('text/plain')
  @ApiOperation({
    description: API_DESC_RENDER_REQUEST
  })
  @ApiBody({ description: 'Write your text here' })
  @ApiCreatedResponse({
    description: 'Rendered result'
  })
  async renderTemplate(@Body() raw): Promise<string> {
    if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) {
      throw new BadRequestException('Request body must be plain text');
    }

    const text = raw.toString().trim();
    const templates: Record<string, string> = {
      hello: 'Hello, world!',
      status: 'Template rendering is safe.'
    };

    const template = templates[text];
    if (!template) {
      throw new BadRequestException('Unsupported template requested');
    }

    this.logger.debug(`Rendered template: ${template}`);
    return template;
  }

  @Get('goto')
  @ApiQuery({ name: 'url', example: 'https://google.com', required: true })
  @ApiOperation({
    description: API_DESC_REDIRECT_REQUEST
  })
  @ApiOkResponse({
    description: 'Redirected'
  })
  @Redirect()
  async redirect(@Query('url') url: string) {
    return { url };
  }

  @Post('metadata')
  @ApiProduces('text/plain')
  @ApiConsumes('text/plain')
  @ApiBody({
    type: String,
    examples: {
      xml_doc: {
        summary: 'XML doc',
        value: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 915 585"><g stroke-width="3.45" fill="none"><path stroke="#000" d="M11.8 11.8h411v411l-411 .01v-411z"/><path stroke="#448" d="M489 11.7h415v411H489v-411z"/></g></svg>`
      }
    }
  })
  @ApiOperation({
    description: API_DESC_XML_METADATA
  })
  @ApiInternalServerErrorResponse({
    description: 'Invalid data'
  })
  @ApiCreatedResponse({
    description: 'XML passed successfully'
  })
  @Header('content-type', 'text/xml')
  async xml(@Body() xml: string): Promise<string> {
    const xmlDoc = parseXml(decodeURIComponent(xml), {
      noent: true,
      dtdvalid: true,
      recover: true
    });
    this.logger.debug(xmlDoc);
    this.logger.debug(xmlDoc.getDtd());

    return xmlDoc.toString(true);
  }

  @Options()
  @ApiOperation({
    description: API_DESC_OPTIONS_REQUEST
  })
  @Header('allow', 'OPTIONS, GET, HEAD, POST')
  async getTestOptions(): Promise<void> {
    this.logger.debug('Test OPTIONS');
  }

  @Get('spawn')
  @ApiQuery({ name: 'command', example: 'ls -la', required: true })
  @ApiOperation({
    description: API_DESC_LAUNCH_COMMAND
  })
  @ApiOkResponse({
    type: String
  })
  @ApiInternalServerErrorResponse({
    schema: {
      type: 'object',
      properties: { location: { type: 'string' } }
    }
  })
  async getCommandResult(@Query('command') command: string): Promise<string> {
    this.logger.debug(`launch ${command} command`);
    try {
      return await this.appService.launchCommand(command);
    } catch (err) {
      throw new InternalServerErrorException({
        error: err.message || err,
        location: __filename
      });
    }
  }

  @Get('/config')
  @UseGuards(AuthGuard)
  @ApiOperation({
    description: API_DESC_CONFIG_SERVER
  })
  @ApiOkResponse({
    type: AppConfig
  })
  getConfig(): AppConfig {
    return this.appService.getConfig();
  }

  @Get('/v1/userinfo/:email')
  @ApiQuery({ name: 'email', example: 'john.doe@example.com', required: true })
  @UseInterceptors(ClassSerializerInterceptor)
  @SerializeOptions({ groups: [BASIC_USER_INFO] })
  @ApiOperation({
    description: SWAGGER_DESC_FIND_USER
  })
  @ApiOkResponse({
    type: UserDto,
    description: 'Returns basic user info if it exists'
  })
  @ApiNotFoundResponse({
    description: 'User not found',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number' },
        message: { type: 'string' }
      }
    }
  })
  async getUserInfo(@Param('email') email: string): Promise<UserDto> {
    try {
      return await this.appService.getUserInfo(email);
    } catch (err) {
      throw new HttpException(err.message, err.status);
    }
  }

  @Get('/v2/userinfo/:email')
  @ApiQuery({ name: 'email', example: 'john.doe@example.com', required: true })
  @UseGuards(AuthGuard)
  @JwtType(JwtProcessorType.RSA)
  @UseInterceptors(ClassSerializerInterceptor)
  @SerializeOptions({ groups: [BASIC_USER_INFO] })
  @ApiOperation({
    description: SWAGGER_DESC_FIND_USER
  })
  @ApiOkResponse({
    type: UserDto,
    description: 'Returns basic user info if it exists'
  })
  @ApiNotFoundResponse({
    description: 'User not found',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number' },
        message: { type: 'string' }
      }
    }
  })
  async getUserInfoV2(@Param('email') email: string): Promise<UserDto> {
    try {
      return await this.appService.getUserInfo(email);
    } catch (err) {
      throw new HttpException(err.message, err.status);
    }
  }

  @Get('nestedJson')
  @ApiOperation({
    description: SWAGGER_DESC_NESTED_JSON
  })
  @Header('content-type', 'application/json')
  async getNestedJson(
    @Query(
      'depth',
      new DefaultValuePipe(1),
      new ParseIntPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })
    )
    depth: number
  ): Promise<string> {
    if (depth < 1) {
      throw new HttpException(
        'JSON nesting depth is invalid',
        HttpStatus.BAD_REQUEST
      );
    }

    this.logger.debug(`Creating a JSON with a nesting depth of ${depth}`);

    let tmpObj = {};
    let jsonObj: Record<string, string> = { '0': 'Leaf' };
    for (let i = 1; i < depth; i++) {
      tmpObj = {};
      tmpObj[i.toString()] = Object.assign({}, jsonObj);
      jsonObj = Object.assign({}, tmpObj);
    }

    return JSON.stringify(jsonObj);
  }
}
