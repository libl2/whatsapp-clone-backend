import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { SocketModule } from '../socket/socket.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    SocketModule,
    MediaModule
  ],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
