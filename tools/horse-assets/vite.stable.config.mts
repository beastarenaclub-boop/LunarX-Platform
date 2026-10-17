import base from '../../artifacts/3d-game/vite.config';
import path from 'node:path';
import type { ConfigEnv } from '../../artifacts/3d-game/node_modules/vite';

export default async (env: ConfigEnv) => {
  const config = await (base as (env: ConfigEnv) => Promise<any>)(env);
  return {
    ...config,
    build: {
      ...config.build,
      outDir: path.resolve(import.meta.dirname, '../../artifacts/3d-game/dist/horse-unity-v3-review'),
      emptyOutDir: false,
      copyPublicDir: false,
    },
  };
};
