import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    WhatsAppModule,
    MediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppService],
})
export class AppModule {}
