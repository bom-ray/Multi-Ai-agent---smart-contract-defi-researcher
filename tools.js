import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { indexResearch, searchResearch } from "./research.js";

const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");

function safeWorkspacePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Path must be relative to ./workspace");
  }

  const resolved = path.resolve(WORKSPACE, relativePath);
  const relative = path.relative(WORKSPACE, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes ./workspace");
  }

  return resolved;
}

async function runCommand(command, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: WORKSPACE,
      shell: false,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });

    child.on("error", error => {
      clearTimeout(timer);
      if (!finished) reject(error);
    });

    child.on("close", code => {
      clearTimeout(timer);
      finished = true;
      resolve({ code, stdout, stderr });
    });
  });
}


const PROJECT_ROOT = path.resolve(".");

async function runCommandFromRoot(command, args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      shell: false,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export const tools = [
  {
    type: "function",
    function: {
      name: "research_index",
      description: "Index all PDF files in ./research into the local ChromaDB vector database. Use after research PDFs are added or changed.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "research_search",
      description: "Semantic-search the indexed DeFi research PDFs. Use focused queries about mechanisms, accounting, liquidation, oracles, interest indexes, risks, invariants, and implementation details. Returns source filename and page for each result.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          topK: { type: "integer", minimum: 1, maximum: 20 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read an existing text file inside ./workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files recursively inside ./workspace.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or replace a text file inside ./workspace. Parent directories are created automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "compile_contract",
      description: "Run npx hardhat compile in ./workspace and return stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "test_contract",
      description: "Run npx hardhat test in ./workspace and return stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "economic_analysis",
      description: "Run the economic-analysis layer against the current Hardhat workspace. It scans Solidity/tests for lending accounting risks, checks for invariant/fuzz/liquidation coverage, runs targeted economic tests when available, then falls back to the full Hardhat suite. It writes workspace/ECONOMIC_ANALYSIS.json.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clean_hardhat",
      description: "Run npx hardhat clean in ./workspace.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  }
];

export async function executeTool(name, args = {}) {
  switch (name) {
    case "research_index":
      return indexResearch();

    case "research_search":
      return searchResearch(args.query, args.topK);

    case "read_file": {
      const filePath = safeWorkspacePath(args.path);
      return {
        path: args.path,
        content: await fs.readFile(filePath, "utf8")
      };
    }

    case "list_files": {
      const results = [];
      async function walk(dir) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const rel = path.relative(WORKSPACE, full);
          if (entry.isDirectory()) await walk(full);
          else results.push(rel);
        }
      }
      await walk(WORKSPACE);
      return results;
    }

    case "write_file": {
      const filePath = safeWorkspacePath(args.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.content, "utf8");
      return { success: true, path: args.path };
    }

    case "compile_contract":
      return runCommand("npx", ["hardhat", "compile"]);

    case "test_contract":
      return runCommand("npx", ["hardhat", "test"]);

    case "economic_analysis":
      return runCommandFromRoot("node", ["economic_analysis.js"], 180_000);

    case "clean_hardhat":
      return runCommand("npx", ["hardhat", "clean"]);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
