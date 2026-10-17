import { SPORTS, sportById } from './catalog.mjs';

// Original virtual fixtures. Country names identify selectable sides; these
// are not real-world schedules, official squads, or live televised results.
const pair = (id, sport, teams, tags, colors, venue) => ({ id, sport, teams, tags, colors, venue, competition: 'Virtual international' });
export const FIXTURES = [
  ...SPORTS.map(s => ({ id: 'classic', sport: s.id, teams: s.teams, tags: s.tags, colors: s.colors, venue: s.venue, competition: 'Arena originals' })),
  pair('brazil-argentina','football',['Brazil','Argentina'],['BRA','ARG'],['#f6d743','#70c9f5'],'Estadio Arena'),
  pair('france-portugal','football',['France','Portugal'],['FRA','POR'],['#335cbb','#ce3039'],'Grand Stade'),
  pair('england-spain','football',['England','Spain'],['ENG','ESP'],['#edf2f8','#d6313b'],'Crown Stadium'),
  pair('india-australia','cricket',['India','Australia'],['IND','AUS'],['#2498ed','#efd044'],'Capital Oval'),
  pair('india-pakistan','cricket',['India','Pakistan'],['IND','PAK'],['#2498ed','#208b62'],'Royal Cricket Ground'),
  pair('england-southafrica','cricket',['England','South Africa'],['ENG','RSA'],['#e6454c','#197a55'],'Riverside Oval'),
  pair('usa-france','basketball',['USA','France'],['USA','FRA'],['#f3f2ed','#3a69d3'],'Metro Arena'),
  pair('spain-serbia','basketball',['Spain','Serbia'],['ESP','SRB'],['#df3c36','#426dca'],'Champions Arena'),
  pair('canada-germany','basketball',['Canada','Germany'],['CAN','GER'],['#dc3c48','#e9e4ce'],'North Arena'),
  pair('kato-alvarez','tennis',['R. Kato','D. Alvarez'],['KAT','ALV'],['#f5f2e8','#e7a0b7'],'Centre Court'),
  pair('marino-reed','tennis',['L. Marino','J. Reed'],['MAR','REE'],['#80d1ea','#e0d267'],'Garden Court'),
  {id:'grand-prix',sport:'formula',teams:['Apex Racing','Velocity','Nova Motorsport','Crimson GP'],tags:['APX','VEL','NOV','CRM'],colors:['#b8a1ff','#b6ef62','#65cfff','#ff706a'],venue:'Grand Prix Park',competition:'Virtual Grand Prix'},
];
export const fixtureById = (sport, id='classic') => FIXTURES.find(f => f.sport===sport && f.id===id);
export function sportForFixture(fixture) {
  const base=sportById(fixture.sport);
  return {...base,...fixture,id:base.id,selections:base.selections.length===3 ? [fixture.teams[0],base.selections[1],fixture.teams[1]] : fixture.teams};
}
