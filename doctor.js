import { ChromaClient } from "chromadb";
import { modelInfo } from "./model.js";
import { researchStats } from "./research.js";

const chroma = new ChromaClient({
  host: process.env.CHROMA_HOST ?? "localhost",
  port: Number(process.env.CHROMA_PORT ?? 8000)
});

try {
  console.log("Chroma:", await chroma.heartbeat());
  console.log("Ollama model:", (await modelInfo()).details?.family ?? "reachable");
  console.log("Research:", await researchStats());
  console.log("OK");
} catch (error) {
  console.error("Doctor check failed:", error.message);
  process.exit(1);
}
