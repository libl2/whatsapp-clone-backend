import { Module } from '@nestjs/common';
import { SocketModule } from '../socket/socket.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// 1. ייבוא החבילות הנדרשות
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  // 2. הוספת המודול למערך הייבוא
  imports: [
    SocketModule,
    WhatsappModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'media'), // נתיב לתיקיית המדיה (מוודא שהוא יוצא שתי רמות אחורה מ-dist/app)
      serveRoot: '/media', // הכתובת הציבורית
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppService],
})
export class AppModule {}