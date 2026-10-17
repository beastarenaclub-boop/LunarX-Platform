export const DURATIONS: readonly number[];
export function hash(value: string): string;
export function colorsFor(number: number): string[];
export function multiplierFor(pick: string, number: number, version?: number): number;
export function commitmentFor(period: string, number: number, secret: string): string;
