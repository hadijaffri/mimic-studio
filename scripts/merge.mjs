#!/usr/bin/env node
/**
 * Rebuilds the shared dataset.json from every file in contributions/.
 * No dependencies — runs on a stock Node.js (used by the GitHub Action).
 *
 *   node scripts/merge.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "contributions";
const out = { gestures: {}, speech: [], motion: [] };
const contributors = new Set();

let files = [];
try { files = readdirSync(DIR); } catch { files = []; }

for (const f of files) {
  if (!f.endsWith(".json")) continue;            // skip README.md, .gitkeep, etc.
  let d;
  try { d = JSON.parse(readFileSync(join(DIR, f), "utf8")); }
  catch (e) { console.error(`skip ${f}: ${e.message}`); continue; }

  const by = (d.meta && d.meta.contributor) || f.replace(/\.json$/, "");
  contributors.add(by);

  for (const label in (d.gestures || {})) {
    (out.gestures[label] = out.gestures[label] || []);
    for (const s of d.gestures[label]) out.gestures[label].push({ ...s, by });
  }
  for (const s of (d.speech  || [])) out.speech.push({ ...s, by });
  for (const s of (d.motion  || [])) out.motion.push({ ...s, by });
}

const gestures = Object.values(out.gestures).reduce((n, a) => n + a.length, 0);
const dataset = {
  meta: {
    app: "Mimic Studio",
    version: 1,
    generated: new Date().toISOString(),
    contributors: contributors.size,
    counts: {
      categories: Object.keys(out.gestures).length,
      gestures, speech: out.speech.length, motion: out.motion.length
    },
    schema: "gestures[label]=[{vec:63 normalized xyz, hand, by, t}]; speech=[{text,label,by,t}]; motion=[{acc,rot,ori,label,by,t}]",
    note: "Auto-generated from contributions/ by scripts/merge.mjs. Do NOT edit by hand."
  },
  ...out
};

writeFileSync("dataset.json", JSON.stringify(dataset, null, 2) + "\n");
console.log(`dataset.json -> ${dataset.meta.counts.categories} categories, ${gestures} gesture samples, ${contributors.size} contributors`);
