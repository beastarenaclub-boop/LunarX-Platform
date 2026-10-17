import type { Sport, SportId } from './catalog.mjs';
export interface MatchFixture { id:string; sport:SportId; teams:string[]; tags:string[]; colors:string[]; venue:string; competition:string; }
export const FIXTURES:MatchFixture[];
export function fixtureById(sport:SportId,id?:string):MatchFixture|undefined;
export function sportForFixture(fixture:MatchFixture):Sport;
