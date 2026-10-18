import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

// PropertiesController/Service, DTO validation, visibility policy, explicit
// serializers, creation approval workflow and floor/requested-property mapping.
@Module({
  imports: [ContactsModule, FilesModule, NotificationsModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
