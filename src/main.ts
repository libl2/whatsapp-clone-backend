import { NestFactory } from '@nestjs/core';
import { WhatsappCloneModule } from './whatsapp-clone.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(WhatsappCloneModule);

  // הוסף את השורה הבאה כדי להגיש את תיקיית המדיה כקבצים סטטיים
  // הנתיב: C:\Users\user\Documents\wa-web\WhatsppWeb-React\whatsapp-clone-backend\media
  // יהיה נגיש ב-frontend דרך /media
  app.useStaticAssets(join(__dirname, '..', 'media'), { prefix: '/media' }); 

  await app.listen(3100); // או הפורט בו האפליקציה שלך מאזינה
}
bootstrap();
