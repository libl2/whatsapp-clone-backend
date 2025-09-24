import { Module } from '@nestjs/common';
import { SocketModule } from './socket/socket.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { AppModule } from './app/app.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [SocketModule, MediaModule, AppModule, WhatsAppModule],
})
export class WhatsappCloneModule {}
