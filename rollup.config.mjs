import dts from 'rollup-plugin-dts';
import esbuild from 'rollup-plugin-esbuild';

// Always provide both CJS and ES exports
const sharedRollupConfig = [
  {
    input: `src/index.ts`,
    plugins: [esbuild()],
    output: [
      {
        dir: 'esm',
        format: 'esm',
        preserveModules: true,
      },
      {
        file: 'dist/index.js',
        format: 'cjs',
      },
    ],
    external: [
      'bs58check',
      'typeforce',
      'create-hash',
      'create-hmac',
      '@noble/secp256k1'
    ],
  },
  {
    input: `src/index.ts`,
    plugins: [dts()],
    output: [
      {
        dir: 'esm',
        format: 'esm',
        preserveModules: true,
      },
      {
        file: 'dist/index.d.ts',
        format: 'cjs',
      },
    ],
  },
];

export default sharedRollupConfig;
