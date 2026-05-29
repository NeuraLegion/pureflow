import { ApiProperty } from '@nestjs/swagger';

export class AppConfig {
  @ApiProperty({ description: 'Public Google Maps configuration value' })
  googlemaps: string;
}
