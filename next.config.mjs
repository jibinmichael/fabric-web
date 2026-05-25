const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["fabricv3.vercel.app"]
    }
  }
};

export default nextConfig;
