export function makeRuntimeEnv(database, rooms, social, sourceEnv = process.env) {
  return {
    DB: database,
    GOMOKU_ROOMS: rooms,
    GOMOKU_SOCIAL: social,
    GITHUB_READ_TOKEN: sourceEnv.GITHUB_READ_TOKEN || '',
    UPDATE_TICKET_SECRET: sourceEnv.UPDATE_TICKET_SECRET || '',
    UPDATE_TICKET_ENFORCED: sourceEnv.UPDATE_TICKET_ENFORCED || '1',
    TURN_KEY_ID: sourceEnv.TURN_KEY_ID || '',
    TURN_KEY_API_TOKEN: sourceEnv.TURN_KEY_API_TOKEN || '',
    PREMIUM_PAYMENT_MODE: sourceEnv.PREMIUM_PAYMENT_MODE || 'disabled',
    PRIVATE_GAME_MODE: sourceEnv.PRIVATE_GAME_MODE || '1',
    PRIVATE_GAME_USERNAMES: sourceEnv.PRIVATE_GAME_USERNAMES || ''
  };
}
