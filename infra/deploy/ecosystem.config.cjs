/**
 * Process definitions for the demo deployment.
 *
 * Both listen on loopback only — nginx is the one thing bound to a public
 * interface, and it is what holds the password (see nginx.conf.template).
 */
module.exports = {
  apps: [
    {
      name: 'autoparts-api',
      cwd: '/srv/autoparts/apps/api',
      script: 'dist/main.js',
      env: {
        // `staging`, not `production`. There is no SMS gateway behind this
        // deployment, so the console stub and the echoed code are what make it
        // possible to sign in at all — and `loadConfig` refuses both under
        // `production`, deliberately. Calling this production would be a lie
        // that the config layer would then have to be talked out of.
        NODE_ENV: 'staging',
        HOST: '127.0.0.1',
      },
      max_memory_restart: '400M',
      time: true,
    },
    {
      name: 'autoparts-web',
      cwd: '/srv/autoparts/apps/web',
      script: 'pnpm',
      args: 'start',
      interpreter: 'none',
      env: {
        // Next builds and serves as production regardless; saying so keeps it
        // from warning about a NODE_ENV it does not recognise.
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
      },
      max_memory_restart: '500M',
      time: true,
    },
  ],
};
