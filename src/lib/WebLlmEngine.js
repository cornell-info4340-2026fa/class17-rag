import { CreateMLCEngine } from "@mlc-ai/web-llm";

/**
 * What the engine is doing. (The values can be displayed as-is.)
 * @readonly
 * @enum {string}
 */
export const Status = Object.freeze({
  // created, but init() hasn't been called yet
  IDLE: "Idle",
  // downloading and loading the model
  INITIALIZING: "Initializing",
  // streaming a response
  GENERATING: "Generating",
  // waiting for a request
  READY: "Ready",
  // the model failed to load; the engine can't be used
  ERROR: "Error",
});

/**
 * A message in the conversation.
 * @typedef {object} Message
 * @property {"system" | "user" | "assistant"} role
 * @property {string} content
 */

/**
 * How far along loading the model is.
 * @typedef {object} Progress
 * @property {string} text what the engine is doing (e.g., which file it's fetching)
 * @property {number} fraction from 0 to 1
 */

/**
 * Settings for a single response.
 * @typedef {object} GenerateOptions
 * @property {(text: string) => void} [onResponse] the response so far (called as each piece streams in)
 * @property {number} [temperature] randomness: 0 is predictable, higher is more creative
 * @property {number} [top_p] only sample from the most likely tokens that add up to this probability
 * @property {number} [max_tokens] the maximum length of the response
 */

/**
 * Engine settings, and the callbacks the engine uses to report what it's doing.
 * @typedef {object} Options
 * @property {string} [embeddingModelId] also load this web-llm embedding model, so embed() can be used
 *   (e.g., "snowflake-arctic-embed-s-q0f32-MLC-b4")
 * @property {(status: Status) => void} [onStatusChange] the status changed
 * @property {(progress: Progress) => void} [onProgress] loading the model made progress
 */

/**
 * Chat with an LLM that runs in the browser (using web-llm), and optionally embed text for search (RAG).
 *
 * @example
 * const engine = new WebLlmEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC");
 * const reply = await engine.generate([{ role: "user", content: "Hi!" }], {
 *   onResponse: (text) => console.log(text),
 * });
 */
export default class WebLlmEngine {
  #modelId;
  #embeddingModelId;
  #onStatusChange;
  #onProgress;

  #engine = null;
  #initPromise = null;
  #status = Status.IDLE;
  #progress = { text: "", fraction: 0 };

  // the model can only generate one response at a time, so each request waits for the one before it
  #lastRequest = Promise.resolve();

  /**
   * @param {string} modelId a web-llm model id (e.g., "Llama-3.2-1B-Instruct-q4f16_1-MLC")
   * @param {Options} [options]
   */
  constructor(modelId, { embeddingModelId, onStatusChange, onProgress } = {}) {
    this.#modelId = modelId;
    this.#embeddingModelId = embeddingModelId;
    this.#onStatusChange = onStatusChange;
    this.#onProgress = onProgress;
  }

  /** @returns {string} */
  get modelId() {
    return this.#modelId;
  }

  /** @returns {Status} */
  get status() {
    return this.#status;
  }

  /** @returns {Progress} */
  get progress() {
    return this.#progress;
  }

  /**
   * Download and load the model. Safe to call more than once: every call waits on the same load.
   * (generate() calls this for you, but calling it early starts the download sooner.)
   * @returns {Promise<void>} rejects if the model fails to load
   */
  init() {
    this.#initPromise ??= this.#load();
    return this.#initPromise;
  }

  /**
   * Generate the assistant's next response to the conversation.
   * Streams the response to options.onResponse, then returns the full response.
   * If another response is being generated, this one waits for it to finish first.
   * @param {Message[]} messages the entire conversation so far
   * @param {GenerateOptions} [options]
   * @returns {Promise<string>} the response (rejects if the model failed to load or the response failed)
   */
  async generate(messages, { onResponse, ...options } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError("messages must be a non-empty array of { role, content } objects");
    }

    await this.init();

    // start after the previous request finishes
    const request = this.#lastRequest.then(() => this.#streamResponse(messages, options, onResponse));
    // keep the line moving even if this request fails
    this.#lastRequest = request.catch(() => {});
    return request;
  }

  /**
   * Turn each text into an embedding: a list of numbers where texts with similar meanings are close together.
   * Needs the embeddingModelId option. Like generate(), this waits for the request before it to finish.
   * @param {string[]} texts each must be under the embedding model's limit (512 tokens for snowflake-arctic-embed)
   * @returns {Promise<number[][]>} one embedding per text, in the same order
   */
  async embed(texts) {
    if (!this.#embeddingModelId) {
      throw new Error("embed() needs an embedding model: pass the embeddingModelId option to the constructor");
    }
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new TypeError("texts must be a non-empty array of strings");
    }

    await this.init();

    const request = this.#lastRequest.then(async () => {
      const { data } = await this.#engine.embeddings.create({ model: this.#embeddingModelId, input: texts });
      return data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    });
    this.#lastRequest = request.catch(() => {});
    return request;
  }

  /**
   * Stop the response that is being generated. (Its generate() returns what was generated so far.)
   */
  stop() {
    if (this.#status === Status.GENERATING) {
      this.#engine.interruptGenerate();
    }
  }

  async #load() {
    this.#setStatus(Status.INITIALIZING);

    try {
      // one engine holds both models, so they share the GPU instead of competing for it
      const modelIds = this.#embeddingModelId ? [this.#modelId, this.#embeddingModelId] : this.#modelId;
      this.#engine = await CreateMLCEngine(modelIds, {
        initProgressCallback: (report) => this.#setProgress(report.text, report.progress),
      });
      this.#setStatus(Status.READY);
    } catch (error) {
      this.#setStatus(Status.ERROR);
      throw error;
    }
  }

  async #streamResponse(messages, options, onResponse) {
    this.#setStatus(Status.GENERATING);

    try {
      const chunks = await this.#engine.chat.completions.create({
        ...options,
        // required when the engine has more than one model loaded
        model: this.#modelId,
        messages,
        stream: true,
      });

      // Stream the response: call the handler with the accumulated text after each chunk
      let text = "";
      let handlerError = null;
      for await (const chunk of chunks) {
        text += chunk.choices?.[0]?.delta?.content ?? "";

        // if the handler threw, stop generating but keep reading (don't break:
        // the stream must finish so web-llm is ready for the next request)
        if (handlerError) continue;
        try {
          onResponse?.(text);
        } catch (error) {
          handlerError = error;
          this.#engine.interruptGenerate();
        }
      }

      if (handlerError) throw handlerError;
      return text;
    } finally {
      // the model is still loaded, so a failed response doesn't stop the next one
      this.#setStatus(Status.READY);
    }
  }

  #setStatus(status) {
    if (status === this.#status) return;
    this.#status = status;
    this.#onStatusChange?.(status);
  }

  #setProgress(text, fraction) {
    this.#progress = { text: text ?? "", fraction: fraction ?? 0 };
    this.#onProgress?.(this.#progress);
  }
}
