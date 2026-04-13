module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET') || 'fallback-secret',
  },
  apiToken: {
    salt: env('API_TOKEN_SALT') || 'fallback-salt',
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT') || 'fallback-transfer',
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY') || 'fallback-encryption',
  },
});
