/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@autoparts/core', '@autoparts/api-client', '@autoparts/i18n'],
};
export default nextConfig;
