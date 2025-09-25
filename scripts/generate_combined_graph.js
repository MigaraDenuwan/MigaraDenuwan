#!/usr/bin/env node
// Node 18+ required (global fetch available)
const fs = require('fs');

const TOKEN = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
if(!TOKEN) console.warn('Warning: no GH token found in env. You may be rate-limited or private contributions won\'t appear.');

const USERNAMES = (process.env.USERNAMES || 'migaradenuwan,MigaraDenuwan-Tokyo')
  .split(',').map(s=>s.trim()).filter(Boolean);

const DAYS = Number(process.env.DAYS || 365);

const today = new Date();
today.setUTCHours(0,0,0,0);
const fromDate = new Date(today);
fromDate.setUTCDate(fromDate.getUTCDate() - (DAYS - 1));
const toDate = today;

const GRAPHQL = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}
`;

async function doFetch(login){
  const url = 'https://api.github.com/graphql';
  const headers = {'Content-Type': 'application/json'};
  if(TOKEN) headers['Authorization'] = `bearer ${TOKEN}`;
  const body = JSON.stringify({
    query: GRAPHQL,
    variables: { login, from: fromDate.toISOString(), to: toDate.toISOString() }
  });
  const resp = await fetch(url, { method: 'POST', headers, body });
  const j = await resp.json();
  if(j.errors) throw new Error(`GraphQL error for ${login}: ${JSON.stringify(j.errors)}`);
  const weeks = j.data.user.contributionsCollection.contributionCalendar.weeks || [];
  const days = [];
  for(const w of weeks){
    for(const d of w.contributionDays){
      days.push({ date: d.date.slice(0,10), count: d.contributionCount });
    }
  }
  return days;
}

function isoToDate(iso){
  const t = new Date(iso + 'T00:00:00Z');
  return t;
}

(async ()=>{
  // ensure fetch exists (Node 18+ expected)
  if(typeof fetch !== 'function'){
    console.error('This script requires Node 18+ (global fetch).');
    process.exit(1);
  }

  const aggregated = {}; // isoDate -> totalCount
  for(const user of USERNAMES){
    console.log('Fetching contributions for', user);
    try{
      const days = await doFetch(user);
      for(const d of days){
        aggregated[d.date] = (aggregated[d.date] || 0) + d.count;
      }
    }catch(err){
      console.error('Failed to fetch for', user, err.message);
      process.exitCode = 2;
    }
  }

  // Build grid (start from the Sunday before fromDate, end to Saturday after toDate)
  const start = new Date(fromDate);
  const startDay = start.getUTCDay(); // 0 = Sunday
  start.setUTCDate(start.getUTCDate() - startDay);

  const end = new Date(toDate);
  const endDay = end.getUTCDay();
  end.setUTCDate(end.getUTCDate() + (6 - endDay));

  const oneDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((end - start) / oneDay) + 1;
  const weeks = Math.ceil(totalDays / 7);

  const dates = [];
  for(let i=0;i<totalDays;i++){
    const d = new Date(start.getTime() + i * oneDay);
    const iso = d.toISOString().slice(0,10);
    dates.push({ date: d, iso, count: aggregated[iso] || 0 });
  }

  const max = Math.max(0, ...dates.map(d=>d.count));
  const colors = ['#ebedf0','#9be9a8','#40c463','#30a14e','#216e39']; // GitHub-like steps
  const colorFor = (cnt) => {
    if(!cnt) return colors[0];
    if(max === 0) return colors[0];
    const level = Math.ceil((cnt / max) * (colors.length - 1));
    return colors[Math.min(level, colors.length - 1)];
  };

  const cell = Number(process.env.CELL_SIZE || 12);
  const gap = Number(process.env.GAP || 3);
  const leftPad = 20;
  const topPad = 12;
  const svgW = weeks * (cell + gap) + leftPad + 10;
  const svgH = 7 * (cell + gap) + topPad + 10;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">\n`;
  svg += `<rect width="100%" height="100%" fill="transparent"/>\n`;

  for(let i=0;i<dates.length;i++){
    const entry = dates[i];
    const weekday = entry.date.getUTCDay(); // 0..6
    const weekIndex = Math.floor(i / 7);
    const x = leftPad + weekIndex * (cell + gap);
    const y = topPad + weekday * (cell + gap);
    const fill = colorFor(entry.count);
    svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" ry="3" fill="${fill}">`;
    svg += `<title>${entry.iso}: ${entry.count} contribution${entry.count!==1?'s':''}</title>`;
    svg += `</rect>\n`;
  }

  svg += `</svg>\n`;

  fs.writeFileSync('combined-graph.svg', svg, 'utf8');
  console.log('combined-graph.svg written (days:', dates.length, 'weeks:', weeks, ')');
})();
