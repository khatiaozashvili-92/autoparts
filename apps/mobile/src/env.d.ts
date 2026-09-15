/**
 * Expo injects EXPO_PUBLIC_* variables at build time and exposes them on a
 * `process.env` shim. Declaring just that shape keeps the app off @types/node,
 * which would wrongly suggest Node APIs are available in the bundle.
 */
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    NODE_ENV?: string;
  };
};
