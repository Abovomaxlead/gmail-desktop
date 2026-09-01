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
  // Off, or `next dev` writes an AGENTS.md and a CLAUDE.md into this directory on every start
  // and re-creates them when they are deleted. This repository keeps no such files, and a
  // dependency that writes instructions for whoever reads them next is not one either.
  agentRules: false,
};

export default nextConfig;
