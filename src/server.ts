import './setupTimezone';
import app from './app';
import { logger } from './lib/logger';
import { publishPressAuthorsService } from './services/publishPressAuthors.service';

const PORT = Number(process.env.PORT) || 3000;

publishPressAuthorsService.ensureAuthorRolePpmaCapability().catch((err) => {
  logger.warn({ err }, 'Failed to ensure author role ppma_edit_own_profile capability');
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server listening');
});
