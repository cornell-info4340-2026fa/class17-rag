import { ref } from "vue";
import WebLlmEngine, { Status } from "../lib/WebLlmEngine";

export { Status };

const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const EMBEDDING_MODEL_ID = "snowflake-arctic-embed-s-q0f32-MLC-b4";

// Note: snowflake-arctic-embed was trained with this prefix for search queries
export const EMBEDDING_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

export const status = ref(Status.IDLE);
export const progress = ref({ text: "", fraction: 0 });

// only one engine (it has its own module so that it won't be reloaded on hot reload)
// loading the model is slow; only do it once
export const llmEngine = new WebLlmEngine(MODEL_ID, {
  embeddingModelId: EMBEDDING_MODEL_ID,
  onStatusChange: (nextStatus) => (status.value = nextStatus),
  onProgress: (nextProgress) => (progress.value = nextProgress),
});

// start downloading the model now
llmEngine.init().catch((error) => {
  console.error("Failed to load the model:", error);
});
