<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  messages: { type: Array, required: true },
  response: { type: String, default: "" },
  isGenerating: { type: Boolean, default: false },
  showSystemPrompt: { type: Boolean, default: false },
});

const chatView = ref(null);

let isFollowing = true;

function handleScroll() {
  const { scrollTop, scrollHeight, clientHeight } = chatView.value;
  isFollowing = scrollHeight - scrollTop - clientHeight < 40;
}

function scrollToBottom() {
  chatView.value.scrollTop = chatView.value.scrollHeight;
}

// if a new message was sent, jump to the bottom
watch(
  () => props.messages,
  () => {
    isFollowing = true;
    scrollToBottom();
  },
  { flush: "post" }
);

watch(
  () => [props.response, props.isGenerating],
  () => {
    if (isFollowing) scrollToBottom();
  },
  { flush: "post" }
);
</script>

<template>
  <div ref="chatView" class="overflow-y-auto card bg-base-100 p-4 min-h-0" @scroll="handleScroll">
    <template v-if="messages.length">
      <template v-for="(message, i) in messages" :key="i">
        <!-- render the system prompt differently from the chat messages -->
        <div v-if="message.role === 'system' && showSystemPrompt" class="mb-4">
          <div class="text-xs opacity-70 mb-1">System prompt</div>
          <div class="bg-base-200 rounded-box p-3 text-xs font-mono whitespace-pre-wrap">{{ message.content }}</div>
        </div>
        <div v-else-if="message.role !== 'system'" class="chat" :class="message.role === 'assistant' ? 'chat-start' : 'chat-end'">
          <div class="chat-bubble text-sm whitespace-pre-wrap" :class="{
            'chat-bubble-primary': message.role === 'user',
          }">{{ message.content }}</div>
        </div>
      </template>

      <div v-if="response || isGenerating" class="chat chat-start">
        <div v-if="$slots['response-header']" class="chat-header">
          <slot name="response-header" />
        </div>
        <div class="chat-bubble text-sm whitespace-pre-wrap">
          <span v-if="response">{{ response }}</span>
          <span v-else class="loading loading-dots loading-sm"></span>
        </div>
      </div>
    </template>
  </div>
</template>
