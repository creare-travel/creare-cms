export default {
  routes: [
    {
      method: 'GET',
      path: '/health',
      handler: 'health.health',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/ready',
      handler: 'health.ready',
      config: {
        auth: false,
      },
    },
  ],
};
