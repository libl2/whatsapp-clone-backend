import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [SocketModule],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
