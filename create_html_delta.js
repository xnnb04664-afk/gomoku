#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MIN_CHUNK = 2048;
const AVG_CHUNK = 8192;
const MAX_CHUNK = 32768;
const MAX_PATCH_BYTES = 8 * 1024 * 1024;

function makeGearTable() {
  let state = 0x4d595df4;
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    table[i] = state >>> 0;
  }
  return table;
}

const GEAR = makeGearTable();

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function splitChunks(buffer) {
  const chunks = [];
  let start = 0;
  while (start < buffer.length) {
    let end = Math.min(start + MIN_CHUNK, buffer.length);
    let hash = 0;
    while (end < buffer.length && end - start < MAX_CHUNK) {
      hash = ((hash << 1) + GEAR[buffer[end]]) >>> 0;
      end += 1;
      const span = end - start;
      const mask = span < AVG_CHUNK ? (AVG_CHUNK * 2 - 1) : (AVG_CHUNK - 1);
      if ((hash & mask) === 0) break;
    }
    chunks.push({ offset: start, bytes: buffer.subarray(start, end) });
    start = end;
  }
  return chunks;
}

function appendOperation(ops, type, offset, length) {
  const last = ops[ops.length - 1];
  if (last && last[0] === type && last[1] + last[2] === offset) {
    last[2] += length;
  } else {
    ops.push([type, offset, length]);
  }
}

function createDelta(base, target) {
  const baseChunks = splitChunks(base);
  const targetChunks = splitChunks(target);
  const index = new Map();
  for (const chunk of baseChunks) {
    const digest = sha256(chunk.bytes);
    const list = index.get(digest) || [];
    list.push(chunk);
    index.set(digest, list);
  }

  const operations = [];
  const insertParts = [];
  let insertBytes = 0;
  let reusedBytes = 0;
  for (const chunk of targetChunks) {
    const digest = sha256(chunk.bytes);
    const matches = index.get(digest) || [];
    const match = matches.find(candidate => candidate.bytes.equals(chunk.bytes));
    if (match) {
      appendOperation(operations, 'C', match.offset, chunk.bytes.length);
      reusedBytes += chunk.bytes.length;
    } else {
      appendOperation(operations, 'I', insertBytes, chunk.bytes.length);
      insertParts.push(chunk.bytes);
      insertBytes += chunk.bytes.length;
    }
  }

  const metadata = Buffer.from(JSON.stringify({
    version: 1,
    baseSha256: sha256(base),
    targetSha256: sha256(target),
    targetSize: target.length,
    operations
  }), 'utf8');
  const insertStream = zlib.deflateSync(Buffer.concat(insertParts, insertBytes), { level: 9 });
  const header = Buffer.alloc(8);
  header.write('GMD1', 0, 'ascii');
  header.writeUInt32BE(metadata.length, 4);
  const patch = Buffer.concat([header, metadata, insertStream]);

  return {
    patch,
    baseSha256: sha256(base),
    targetSha256: sha256(target),
    targetSize: target.length,
    baseChunks: baseChunks.length,
    targetChunks: targetChunks.length,
    reusedBytes,
    insertBytes,
    operations: operations.length
  };
}

function main() {
  const [basePath, targetPath, outputPath] = process.argv.slice(2);
  if (!basePath || !targetPath || !outputPath) {
    throw new Error('Usage: node create_html_delta.js <base.html> <target.html> <output.gmd>');
  }
  const base = fs.readFileSync(basePath);
  const target = fs.readFileSync(targetPath);
  const result = createDelta(base, target);
  const ratio = result.patch.length / Math.max(target.length, 1);
  const summary = {
    ...result,
    patchBytes: result.patch.length,
    ratioPercent: Number((ratio * 100).toFixed(2))
  };
  delete summary.patch;
  if (result.patch.length >= MAX_PATCH_BYTES || ratio >= 0.8) {
    process.stdout.write(`${JSON.stringify({ ...summary, created: false })}\n`);
    process.exitCode = 2;
    return;
  }
  fs.writeFileSync(outputPath, result.patch, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ...summary, created: true, outputPath })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
