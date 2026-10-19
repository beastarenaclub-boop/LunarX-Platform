import optimized from "./optimized-media.json";

type MediaAsset = { src: string; width: number; height: number; mobile?: { src: string; width: number; height: number } };
const root = `${import.meta.env.BASE_URL}media/b2c/`;
export const b2cMedia = (name: keyof typeof optimized) => root + optimized[name].src;
export function b2cBanner(name: keyof typeof optimized) {
  const asset: MediaAsset = optimized[name];
  return {
    src: root + asset.src,
    width: asset.width,
    height: asset.height,
    srcSet: asset.mobile ? `${root}${asset.mobile.src} ${asset.mobile.width}w, ${root}${asset.src} ${asset.width}w` : undefined,
  };
}
