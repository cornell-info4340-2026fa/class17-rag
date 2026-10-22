<script setup>
import { ref, computed } from "vue";
import { PhPaperPlaneRight, PhStop, PhCpu, PhBooks, PhFileMagnifyingGlass, PhBrain } from "@phosphor-icons/vue";
import { llmEngine, status, progress, Status } from "./services/localLlm";
import { documentIndex, indexStatus, IndexStatus } from "./services/localRag";

import ChatView from "./components/ChatView.vue";

const EXAMPLE_QUESTIONS = [
  "How many slip days do I get?",
  "How do I use my slip days?",
  "Can I use a slip day on a group assignment?"
];

const NO_RAG_PROMPT = `You are the syllabus assistant for INFO 4340/5440 at Cornell University. Answer the student's question. Keep your answer short.`;

// TODO: system prompt that includes the retrieved chunks
function buildRagPrompt(sources) {
  return NO_RAG_PROMPT;
}

const useRag = ref(false);
const prompt = ref("");
const messages = ref([]);
const response = ref("");
const sources = ref([]);
const answeredWithRag = ref(false); // whether the current response uses RAG (useRag can change after sending)
const isRetrieving = ref(false);
const hasResponseError = ref(false);

const canSend = computed(
  () =>
    status.value === Status.READY &&
    !isRetrieving.value &&
    (!useRag.value || indexStatus.value === IndexStatus.READY)
);

async function sendPrompt() {
  if (!canSend.value) return;
  const question = prompt.value.trim();
  if (question === "") return;

  // show the question right away; retrieving takes a moment
  messages.value = [{ role: "user", content: question }];
  response.value = "";
  sources.value = [];
  answeredWithRag.value = useRag.value;
  hasResponseError.value = false;

  try {
    let systemPromptText = NO_RAG_PROMPT;

    isRetrieving.value = true;
    if (answeredWithRag.value) {
      // TODO: search documentIndex for the 3 chunks - save to sources.value

      // TODO: update systemPromptText with call buildRagPrompt()
    }
    isRetrieving.value = false;

    messages.value = [
      { role: "system", content: systemPromptText },
      { role: "user", content: question },
    ];
    await llmEngine.generate(messages.value, {
      onResponse: (text) => (response.value = text),
    });
  } catch (error) {
    console.error("Failed to generate a response:", error);
    hasResponseError.value = true;
  } finally {
    isRetrieving.value = false;
  }
}

function useExample(question) {
  prompt.value = question;
}

function stopResponse() {
  llmEngine.stop();
}
</script>

<template>
  <div class="flex flex-col h-screen w-screen p-4 gap-4">

    <div v-if="sources.length" class="card bg-base-100 p-4 gap-2 max-h-72 overflow-y-auto shrink-0">
      <details v-for="(source, i) in sources" :key="i" class="collapse collapse-arrow bg-base-200">
        <summary class="collapse-title text-sm flex items-center gap-2 pe-12">
          <span class="badge badge-sm badge-neutral font-mono" title="Relevance to the question (higher is better)">{{ source.score.toFixed(3) }}</span>
          <span class="truncate">[{{ i + 1 }}] {{ source.title }}</span>
        </summary>
        <div class="collapse-content text-sm whitespace-pre-wrap">{{ source.text }}</div>
      </details>
    </div>

    <ChatView class="flex-1" show-system-prompt :messages="messages" :response="response" :is-generating="isRetrieving || status === Status.GENERATING">
      <template #response-header>
        <span class="flex items-center gap-1 text-xs opacity-70">
          <template v-if="answeredWithRag">
            <PhFileMagnifyingGlass :size="14" /> RAG
          </template>
          <template v-else>
            <PhBrain :size="14" /> Model Only
          </template>
        </span>
      </template>
    </ChatView>

    <progress v-if="status === Status.INITIALIZING" class="progress progress-primary w-full" :value="progress.fraction" max="1" :title="progress.text"></progress>

    <div class="flex flex-col card bg-base-100 p-4 gap-3 shrink-0">
      <div v-if="status === Status.ERROR" class="alert alert-error alert-soft text-sm">
        The model failed to initialize.
      </div>
      <div v-else-if="indexStatus === IndexStatus.ERROR" class="alert alert-error alert-soft text-sm">
        The documents couldn't be indexed.
      </div>
      <div v-else-if="hasResponseError" class="alert alert-error alert-soft text-sm">
        Something went wrong while generating a response.
      </div>

      <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div class="flex flex-wrap items-center gap-2 flex-1 min-w-0 min-h-8">
          <button v-for="question in EXAMPLE_QUESTIONS" :key="question" class="btn btn-xs btn-soft" @click="useExample(question)">
            {{ question }}
          </button>
        </div>

        <div class="flex items-center gap-2 shrink-0 ml-auto">
          <div class="join" role="radiogroup" aria-label="Answer from">
            <label class="join-item btn btn-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2" :class="{ 'btn-soft btn-primary': useRag }" title="Answer from the course documents (RAG)">
              <input v-model="useRag" :value="true" type="radio" name="rag-mode" class="sr-only" />
              <PhFileMagnifyingGlass :size="16" />
              RAG
            </label>
            <label class="join-item btn btn-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2" :class="{ 'btn-soft btn-primary': !useRag }" title="Answer from the model alone">
              <input v-model="useRag" :value="false" type="radio" name="rag-mode" class="sr-only" />
              <PhBrain :size="16" />
              Model Only
            </label>
          </div>
        </div>
      </div>

      <textarea v-model="prompt" rows="3" class="textarea w-full resize-none" placeholder="Ask about the syllabus or course policies…" aria-label="Message" @keydown.enter.exact.prevent="sendPrompt"></textarea>

      <div class="flex flex-wrap items-center gap-2 justify-end">
        <div class="flex flex-col items-start gap-1 min-w-0 mr-auto">
          <div class="flex items-center gap-2 text-sm min-w-0 max-w-full">
            <PhCpu :size="20" class="shrink-0" />
            <span class="font-mono truncate" :title="llmEngine.modelId">{{ llmEngine.modelId }}</span>
            <span class="badge badge-sm" :class="{
              'badge-success': status === Status.READY,
              'badge-info': status === Status.GENERATING || status === Status.INITIALIZING,
              'badge-error': status === Status.ERROR,
            }">{{ status }}</span>
          </div>
          <div class="flex items-center gap-2 text-sm min-w-0 max-w-full">
            <PhBooks :size="20" class="shrink-0" />
            <span class="truncate">{{ documentIndex.documents.length }} documents</span>
            <span class="badge badge-sm" :class="{
              'badge-success': indexStatus === IndexStatus.READY,
              'badge-info': indexStatus === IndexStatus.EMPTY || indexStatus === IndexStatus.INDEXING,
              'badge-error': indexStatus === IndexStatus.ERROR,
            }">{{ indexStatus }}</span>
          </div>
        </div>

        <button :disabled="status !== Status.GENERATING" class="btn btn-neutral btn-square" aria-label="Stop" title="Stop" @click="stopResponse">
          <PhStop :size="20" weight="fill" />
        </button>
        <button class="btn btn-primary" :disabled="!canSend" @click="sendPrompt">
          <PhPaperPlaneRight :size="20" weight="fill" />
          Send
        </button>
      </div>

    </div>
  </div>
</template>
