import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { FilesService } from './files.service';

// Private local image storage + FileAsset metadata. The StorageService abstraction
// isolates the filesystem so it can later be replaced by an S3-compatible backend.
@Module({
  providers: [StorageService, FilesService],
  exports: [StorageService, FilesService],
})
export class FilesModule {}
