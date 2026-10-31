/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  // Next only compiles our own code down to its browser target (Chrome 64+). These ship
  // newer syntax (`??=`, `||=`...) that breaks the whole relay chunk on smart TV browsers.
  transpilePackages: [
    "@nostr-dev-kit/ndk",
    "nostr-tools",
    "@noble/hashes",
    "@noble/curves",
    "@noble/ciphers",
    "@noble/secp256k1",
    "@scure/base",
    "@scure/bip32",
    "@scure/bip39",
    "tseep",
    "typescript-lru-cache",
    "light-bolt11-decoder",
  ],
};

export default nextConfig;
