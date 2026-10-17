export class SeededRandom {
  private seed: number;

  constructor(seedStr: string) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
    }
    this.seed = h;
  }

  next(): number {
    this.seed = Math.imul(1525251, this.seed) + 12345 | 0;
    return (this.seed >>> 0) / 0xffffffff;
  }
}
