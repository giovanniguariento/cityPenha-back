/**
 * Compat shim — mantém o nome do módulo para imports legados; toda a lógica
 * vive em `./gamification/index.ts` (facade da nova engine data-driven).
 *
 * Novos consumidores devem importar diretamente de `./gamification`.
 */
export { gamificationFacade as gamificationService } from './gamification/index';
export { GamificationFacade as GamificationService } from './gamification/index';
