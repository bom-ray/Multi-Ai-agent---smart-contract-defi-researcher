import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { ChromaClient } from "chromadb";
import { embedTexts } from "./model.js";

const ROOT = path.resolve(process.env.RESEARCH_DIR ?? "./research");
const STATE_FILE = path.resolve("./.research-manifest.json");
const CHROMA_HOST = process.env.CHROMA_HOST ?? "localhost";
const CHROMA_PORT = Number(process.env.CHROMA_PORT ?? 8000);
const COLLECTION = process.env.CHROMA_COLLECTION ?? "defi_research";

const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });

function cleanText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function chunkText(text, maxChars = 4500, overlap = 700) {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf(" ", end)
      );
      if (boundary > start + maxChars * 0.65) end = boundary + 1;
    }

    chunks.push(normalized.slice(start, end).trim());

    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

async function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}

async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch {
    return { files: {} };
  }
}

async function writeManifest(manifest) {
  await fs.writeFile(STATE_FILE, JSON.stringify(manifest, null, 2), "utf8");
}

async function extractPdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push({ pageNumber, text: cleanText(text) });
  }

  return pages;
}

async function getCollection() {
  await client.heartbeat();
  return client.getOrCreateCollection({
    name: COLLECTION,
    metadata: { description: "Local DeFi protocol research" }
  });
}

export async function indexResearch({ force = false } = {}) {
  const collection = await getCollection();
  
  const manifest = await readManifest();
  const entries = [];

  const files = (await fs.readdir(ROOT, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map(entry => path.join(ROOT, entry.name));

  if (files.length === 0) {
    throw new Error(`No PDF files found in ${ROOT}`);
  }

  const current = new Map(files.map(file => [path.basename(file), file]));
  let indexedFiles = 0;
  let skippedFiles = 0;

  // Remove records for PDFs that no longer exist.
  for (const source of Object.keys(manifest.files)) {
    
    if (!current.has(source)) {
      await collection.delete({ where: { source } });
      delete manifest.files[source];
    }
  }

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const hash = await sha256File(filePath);

    if (!force && manifest.files[fileName]?.hash === hash) {
      skippedFiles++;
      continue;
    }

    // Replacing a changed PDF must remove its previous chunks.
    await collection.delete({ where: { source: fileName } });

    const pages = await extractPdf(filePath);

    for (const page of pages) {
      for (const [chunkIndex, chunk] of chunkText(page.text).entries()) {
        entries.push({
          id: crypto.createHash("sha256")
            .update(`${fileName}:${hash}:${page.pageNumber}:${chunkIndex}:${chunk}`)
            .digest("hex"),
          document: chunk,
          metadata: {
            source: fileName,
            page: page.pageNumber,
            chunk: chunkIndex,
            path: path.relative(process.cwd(), filePath),
            fileHash: hash
          }
        });
      }
    }

    manifest.files[fileName] = { hash, indexedAt: new Date().toISOString() };
    indexedFiles++;
  }

  const batchSize = 64;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const embeddings = await embedTexts(batch.map(x => x.document));

    await collection.upsert({
      ids: batch.map(x => x.id),
      documents: batch.map(x => x.document),
      metadatas: batch.map(x => x.metadata),
      embeddings
    });

    console.log(`Embedded ${Math.min(i + batch.length, entries.length)}/${entries.length} changed chunks`);
  }

  await writeManifest(manifest);

  return {
    success: true,
    filesFound: files.length,
    filesIndexed: indexedFiles,
    filesSkipped: skippedFiles,
    chunksAdded: entries.length,
    collection: COLLECTION
  };
}

export async function searchResearch(query, topK = Number(process.env.RESEARCH_TOP_K ?? 8)) {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) {
    throw new Error("Research collection is empty. Run research:index first.");
  }

  const [queryEmbedding] = await embedTexts(query);

  const result = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    include: ["documents", "metadatas", "distances"]
  });

  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return documents.map((document, i) => ({
    text: document,
    source: metadatas[i],
    distance: distances[i]
  }));
}

export async function researchStats() {
  const collection = await getCollection();
  return { chunks: await collection.count(), collection: COLLECTION };
}
