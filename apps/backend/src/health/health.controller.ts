import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService } from './health.service';
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get() live() {
    return { status: 'ok', service: 'arkan-api' };
  }
  @Get('ready') ready() {
    return this.health.readiness();
  }
}
