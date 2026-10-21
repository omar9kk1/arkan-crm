import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

// ContactsController/Service, DTO validation and row-level contact authorization.
@Module({
  imports: [NotificationsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
