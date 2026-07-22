import './setupTimezone';
import { ensureFirebaseAdminReady } from './config/firebase';
import app from './app';
import { logger } from './lib/logger';
import { publishPressAuthorsService } from './services/publishPressAuthors.service';

const PORT = Number(process.env.PORT) || 3000;

try {
  ensureFirebaseAdminReady();
} catch (err) {
  logger.error({ err }, 'Refusing to start: Firebase Admin is not configured');
  process.exit(1);
}

publishPressAuthorsService.ensureAuthorRolePpmaCapability().catch((err) => {
  logger.warn({ err }, 'Failed to ensure author role ppma_edit_own_profile capability');
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server listening');
});
