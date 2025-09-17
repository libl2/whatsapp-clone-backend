// C:\Users\user\Documents\wa-web\WhatsppWeb-React\whatsapp-clone-backend\src\whatsapp\whatsapp.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { SocketModule } from '../socket/socket.module';
import { AppModule } from '../app/app.module'; // ייבוא AppModule

@Module({
  imports: [
    SocketModule,
    forwardRef(() => AppModule) // שימוש ב-forwardRef
  ],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}