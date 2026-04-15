module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_AUTH_SECRET') || 'myFallbackSecret123',
  },
  apiToken: {
    salt: env('API_TOKEN_SALT') || 'myFallbackSalt123',
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT') || 'myFallbackTransfer123',
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY') || 'myFallbackEncryption123',
  },
});
