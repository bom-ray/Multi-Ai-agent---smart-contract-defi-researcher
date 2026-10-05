const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:14b";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

export const AGENT_MODELS = {
  researcher: process.env.OLLAMA_MODEL_RESEARCHER || DEFAULT_MODEL,
  architect: process.env.OLLAMA_MODEL_ARCHITECT || DEFAULT_MODEL,
  security: process.env.OLLAMA_MODEL_SECURITY || DEFAULT_MODEL,
  economic: process.env.OLLAMA_MODEL_ECONOMIC || DEFAULT_MODEL,
  implementer: process.env.OLLAMA_MODEL_IMPLEMENTER || DEFAULT_MODEL,
  reviewer: process.env.OLLAMA_MODEL_REVIEWER || DEFAULT_MODEL,
  tester: process.env.OLLAMA_MODEL_TESTER || DEFAULT_MODEL,
  remediation: process.env.OLLAMA_MODEL_REMEDIATION || DEFAULT_MODEL,
  auditor: process.env.OLLAMA_MODEL_AUDITOR || DEFAULT_MODEL
};

async function ollama(path, payload) {
  const response = await fetch(`${OLLAMA_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function askModel(messages, tools = [], options = {}) {
  return ollama("/api/chat", {
    model: options.model ?? DEFAULT_MODEL,
    messages,
    tools,
    stream: false,
    think: options.think ?? true,
    options: {
      temperature: options.temperature ?? 0.1,
      ...(options.extraOptions ?? {})
    }
  });
}

export async function embedTexts(input) {
  const texts = Array.isArray(input) ? input : [input];
  const result = await ollama("/api/embed", {
    model: OLLAMA_EMBED_MODEL,
    input: texts
  });
  return result.embeddings;
}

export async function modelInfo(model = DEFAULT_MODEL) {
  return ollama("/api/show", { name: model });
}
