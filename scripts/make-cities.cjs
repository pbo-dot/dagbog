// Laver public/byer.txt: byer til at give billeder et stednavn på telefonen (uden net).
// Data: GeoNames (CC BY 4.0, https://www.geonames.org) via npm-pakken all-the-cities, og for Danmark
// GeoNames' fulde landefil DK.txt (alle byer og landsbyer, også uden indbyggertal, fx Sønderho).
// Køres med: node scripts/make-cities.cjs [sti/til/DK.txt]   (DK.txt fra download.geonames.org/export/dump/DK.zip)
const fs = require('fs');
const cities = require('all-the-cities');
const dkFile = process.argv[2];
// Nabolandene med små byer; resten af verden byer over 10.000 indbyggere
const NEAR = new Set(['DK', 'SE', 'NO', 'DE', 'FO', 'GL', 'IS']);
const line = (name, cc, lat, lng, pop) => `${name.replace(/[|\n]/g, ' ')}|${cc}|${lat.toFixed(3)}|${lng.toFixed(3)}|${pop}`;
const keep = cities.filter((c) => c.featureCode !== 'PPLX' && !(dkFile && c.country === 'DK')
  && (NEAR.has(c.country) ? c.population >= (c.country === 'DK' ? 1000 : 5000) : c.population >= 10000));
const lines = keep.map((c) => line(c.name, c.country, c.loc.coordinates[1], c.loc.coordinates[0], c.population));
let dk = 0;
if (dkFile) {
  // Kun byer og landsbyer (ikke bydele PPLX eller forladte steder)
  const CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLC', 'PPLS']);
  for (const row of fs.readFileSync(dkFile, 'utf8').split('\n')) {
    const f = row.split('\t');
    if (f.length < 15 || f[6] !== 'P' || !CODES.has(f[7]) || f[8] !== 'DK') continue;
    lines.push(line(f[1], 'DK', Number(f[4]), Number(f[5]), Number(f[14]) || 0));
    dk++;
  }
}
fs.writeFileSync('public/byer.txt', `# GeoNames (CC BY 4.0) · navn|land|bredde|længde|indbyggere\n${lines.join('\n')}\n`);
console.log(`${lines.length} byer${dkFile ? `, heraf ${dk} i Danmark fra DK.txt` : ''}`);
