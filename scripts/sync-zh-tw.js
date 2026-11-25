#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { convertZhCNToZhTW } = require('../src/i18n/zh-tw-converter.js');

const ROOT_DIR = path.resolve(__dirname, '..');

const SYNC_PAIRS = [
  ['i18n/zh-CN.json', 'i18n/zh-TW.json'],
  ['src/i18n/zh-CN.json', 'src/i18n/zh-TW.json'],
];

function convertPatternEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const next = { ...entry };
  if (typeof next.replacement === 'string') {
    next.replacement = convertZhCNToZhTW(next.replacement);
  }
  if (typeof next.to === 'string') {
    next.to = convertZhCNToZhTW(next.to);
  }
  return next;
}

function convertDictPayload(source) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'exact' && value && typeof value === 'object' && !Array.isArray(value)) {
      const exactOut = {};
      for (const [k, v] of Object.entries(value)) {
        exactOut[k] = typeof v === 'string' ? convertZhCNToZhTW(v) : v;
      }
      out.exact = exactOut;
    } else if (key === 'patterns' && Array.isArray(value)) {
      out.patterns = value.map(convertPatternEntry);
    } else if (key === 'locale') {
      out.locale = 'zh-TW';
    } else if (key === 'name') {
      out.name = '繁體中文（台灣）';
    } else if (typeof value === 'string') {
      out[key] = convertZhCNToZhTW(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function main() {
  for (const [srcRel, dstRel] of SYNC_PAIRS) {
    const srcPath = path.join(ROOT_DIR, srcRel);
    const dstPath = path.join(ROOT_DIR, dstRel);
    const source = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const converted = convertDictPayload(source);
    fs.writeFileSync(dstPath, JSON.stringify(converted, null, 2) + '\n', 'utf8');
    const exactCount = converted.exact ? Object.keys(converted.exact).length : 0;
    const patternCount = Array.isArray(converted.patterns) ? converted.patterns.length : 0;
    console.log(`[sync-zh-tw] ${srcRel} -> ${dstRel} (exact: ${exactCount}, patterns: ${patternCount})`);
  }
}

main();
