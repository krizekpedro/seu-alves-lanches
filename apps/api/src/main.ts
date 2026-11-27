import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  console.log(`API do Seu Alves ouvindo na porta ${port}`);
}
bootstrap();
