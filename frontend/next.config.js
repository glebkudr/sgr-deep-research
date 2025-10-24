/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/graphview",
        destination: "/graphview/index.html",
      },
    ];
  },
};

module.exports = nextConfig;
