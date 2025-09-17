// C:\Users\user\Documents\wa-web\WhatsppWeb-React\whatsapp-clone-backend\src\app\app.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [
    forwardRef(() => WhatsAppModule), // שימוש ב-forwardRef
    SocketModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppService], // ייצא את AppService כדי ש-WhatsAppService יוכל להשתמש בו
})
export class AppModule {}