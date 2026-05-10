import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('chats')
  getChats() {
    return this.appService.getChats();
  }

  @Get('qr')
  getQR() {
    return {
      qr: this.appService.getQR(),
    };
  }

  @Get('status')
  getStatus() {
    return this.appService.getStatus();
  }

  @Get('avatar/:id')
  async getAvatar(@Param('id') id: string) {
    return {
      avatar: await this.appService.getAvatar(id),
    };
  }

  @Post('chat/:id/messages')
  getMessages(@Param('id') id: string, @Body() model: any) {
    return this.appService.getMessages(id, model);
  }

  @Get('chat/:id')
  getChat(@Param('id') id: string) {
    return this.appService.getChat(id);
  }

  @Post('chat/:id/search')
  searchMessages(@Param('id') id: string, @Body() model: any) {
    model.chatId = id;
    return this.appService.searchMessages(model);
  }

  @Post('chat/:id/send-message')
  sendMessage(@Param('id') id: string, @Body() model: any) {
    return this.appService.sendMessage(id, model);
  }

  @Post('chat/:id/mark-read')
  markChatAsRead(@Param('id') id: string) {
    return this.appService.markChatAsRead(id);
  }

  @Get('statuses')
  async getStatuses() {
    return this.appService.getCollectedStatuses();
  }
}
