import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Acceso remoto de prueba vía túneles rápidos de Cloudflare (la URL es aleatoria
  // por sesión; el comodín cubre cualquier intento de trycloudflare).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
