import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/**
 * CRM clients domain: authorised listing/search, detail, creation, editing,
 * per-client follow-ups and the counter endpoint behind the summary cards.
 * Owner/broker records stay in `ContactsModule` — clients never read the
 * private contact payloads, only count authorised rows for the stats cards.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
