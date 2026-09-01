import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // The repository root, one above this file, and not the app directory Turbopack's own warning
  // suggests: pages here import shared types straight out of `electron/`, so a root at
  // `renderer/` cannot resolve them. Named rather than left to be inferred because there are two
  // lockfiles above this file and Turbopack, which builds by default since Next 16, picks its
  // root from them.
  turbopack: { root: join(import.meta.dirname, '..') },
};

export default nextConfig;
