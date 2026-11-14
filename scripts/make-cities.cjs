// Laver public/byer.txt: byer til at give billeder et stednavn på telefonen (uden net).
// Data: GeoNames (CC BY 4.0, https://www.geonames.org) via npm-pakken all-the-cities.
// Køres med: node scripts/make-cities.cjs
const fs = require('fs');
const cities = require('all-the-cities');
// Hele Danmark og nabolandene med små byer; resten af verden byer over 10.000 indbyggere
const NEAR = new Set(['DK', 'SE', 'NO', 'DE', 'FO', 'GL', 'IS']);
const keep = cities.filter((c) => c.featureCode !== 'PPLX' && (NEAR.has(c.country) ? c.population >= (c.country === 'DK' ? 1000 : 5000) : c.population >= 10000));
const lines = keep.map((c) => `${c.name.replace(/[|\n]/g, ' ')}|${c.country}|${c.loc.coordinates[1].toFixed(3)}|${c.loc.coordinates[0].toFixed(3)}|${c.population}`);
fs.writeFileSync('public/byer.txt', `# GeoNames (CC BY 4.0) · navn|land|bredde|længde|indbyggere\n${lines.join('\n')}\n`);
console.log(`${keep.length} byer`);
