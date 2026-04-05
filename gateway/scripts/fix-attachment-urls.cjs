#!/usr/bin/env node
const Database = require('better-sqlite3');
const pathMod = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const OL_URL = process.env.OL_URL || 'http://localhost:3000';
const OL_TOKEN = process.env.OL_TOKEN;
const DB_PATH = pathMod.join(__dirname, '..', 'gateway.db');
const UPLOADS_DIR = pathMod.join(__dirname, '..', 'uploads', 'files');

if (!OL_TOKEN) { console.error('Set OL_TOKEN'); process.exit(1); }
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(DB_PATH);

function downloadWithCurl(attId, destPath) {
  const url = `${OL_URL}/api/attachments.redirect?id=${attId}`;
  execSync(`curl -sL -o "${destPath}" -H "Authorization: Bearer ${OL_TOKEN}" "${url}"`, { timeout: 30000 });
}

function guessExt(filePath) {
  try {
    const out = execSync(`file --brief --mime-type "${filePath}"`, { encoding: 'utf8' }).trim();
    if (out.includes('png')) return '.png';
    if (out.includes('jpeg')) return '.jpg';
    if (out.includes('gif')) return '.gif';
    if (out.includes('webp')) return '.webp';
    if (out.includes('svg')) return '.svg';
    if (out.includes('pdf')) return '.pdf';
  } catch {}
  return '.png';
}

async function main() {
  console.log('=== Fix Outline Attachment URLs ===\n');

  const allDocs = db.prepare('SELECT id, text FROM documents').all();
  const urlRegex = /(?:https?:\/\/[^\s)"]*)?\/api\/outline\/attachments\.redirect\?id=[a-f0-9-]+(?:&[^\s)"]*)?/g;

  const urlMap = {};
  for (const { text } of allDocs) {
    const matches = text.match(urlRegex);
    if (!matches) continue;
    for (const url of [...new Set(matches)]) {
      if (!urlMap[url]) urlMap[url] = null;
    }
  }

  const uniqueUrls = Object.keys(urlMap);
  console.log(`Found ${uniqueUrls.length} unique attachment URLs\n`);

  // Deduplicate by attachment ID (same ID may appear with different URL prefixes)
  const idToFile = {};
  let attCount = 0;

  for (const url of uniqueUrls) {
    const idMatch = url.match(/id=([a-f0-9-]+)/);
    if (!idMatch) continue;
    const attId = idMatch[1];

    if (idToFile[attId]) {
      urlMap[url] = idToFile[attId];
      continue;
    }

    try {
      const tmpPath = pathMod.join(UPLOADS_DIR, `tmp-${attId}`);
      downloadWithCurl(attId, tmpPath);
      
      const stat = fs.statSync(tmpPath);
      if (stat.size === 0) { fs.unlinkSync(tmpPath); throw new Error('Empty file'); }
      
      const ext = guessExt(tmpPath);
      const filename = `migrated-${attId}${ext}`;
      const finalPath = pathMod.join(UPLOADS_DIR, filename);
      fs.renameSync(tmpPath, finalPath);

      const localUrl = `/api/uploads/files/${filename}`;
      urlMap[url] = localUrl;
      idToFile[attId] = localUrl;
      attCount++;
      process.stdout.write(`  Downloaded: ${attCount}\r`);
    } catch (e) {
      console.warn(`\n  Warn: ${attId}: ${e.message}`);
    }
  }

  console.log(`\n\n  Downloaded ${attCount} attachments`);

  // Rewrite URLs in documents
  const succeeded = Object.entries(urlMap).filter(([, v]) => v);
  if (succeeded.length > 0) {
    console.log(`  Rewriting ${succeeded.length} URL mappings in documents...`);
    const updateText = db.prepare('UPDATE documents SET text = ? WHERE id = ?');
    let rewritten = 0;
    for (const { id, text } of allDocs) {
      let newText = text;
      for (const [oldUrl, newUrl] of succeeded) {
        newText = newText.split(oldUrl).join(newUrl);
      }
      if (newText !== text) {
        updateText.run(newText, id);
        rewritten++;
      }
    }
    console.log(`  Rewritten URLs in ${rewritten} documents`);

    // Also rewrite in revisions
    const allRevs = db.prepare('SELECT id, data_json FROM document_revisions WHERE data_json IS NOT NULL').all();
    const updateRev = db.prepare('UPDATE document_revisions SET data_json = ? WHERE id = ?');
    let revRewritten = 0;
    for (const { id, data_json } of allRevs) {
      let newJson = data_json;
      for (const [oldUrl, newUrl] of succeeded) {
        newJson = newJson.split(oldUrl).join(newUrl);
      }
      if (newJson !== data_json) {
        updateRev.run(newJson, id);
        revRewritten++;
      }
    }
    console.log(`  Rewritten URLs in ${revRewritten} revisions`);

    // Also rewrite in comments
    const allComments = db.prepare('SELECT id, data_json FROM document_comments WHERE data_json IS NOT NULL').all();
    const updateCmt = db.prepare('UPDATE document_comments SET data_json = ? WHERE id = ?');
    let cmtRewritten = 0;
    for (const { id, data_json } of allComments) {
      let newJson = data_json;
      for (const [oldUrl, newUrl] of succeeded) {
        newJson = newJson.split(oldUrl).join(newUrl);
      }
      if (newJson !== data_json) {
        updateCmt.run(newJson, id);
        cmtRewritten++;
      }
    }
    console.log(`  Rewritten URLs in ${cmtRewritten} comments`);
  }

  // Rebuild FTS
  try {
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')");
    console.log('  FTS index rebuilt');
  } catch (e) {}

  console.log(`\n=== Done: ${attCount} attachments downloaded, URLs rewritten ===`);
  db.close();
}

main().catch(e => { console.error('Failed:', e); process.exit(1); });
