import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { create, insertMultiple, search } from "@orama/orama";
import { stopwords } from "@orama/stopwords/english";

/**
 * What the index is doing. (The values can be displayed as-is.)
 * @readonly
 * @enum {string}
 */
export const IndexStatus = Object.freeze({
  // no documents have been added yet
  EMPTY: "No documents",
  // splitting and embedding documents
  INDEXING: "Indexing",
  // ready to search
  READY: "Indexed",
  // the last addDocuments() failed (documents added before it can still be searched)
  ERROR: "Error",
});

/**
 * A document to search: plain text, any length. Convert other formats (markdown, PDF, JSON, ...) to text first.
 * @typedef {object} Document
 * @property {string} title where the text came from (added to the start of each chunk, so the chunk keeps its context)
 * @property {string} text
 */

/**
 * A piece of a document found by search().
 * @typedef {object} SearchResult
 * @property {string} title the document's title
 * @property {string} text the chunk (starts with the title)
 * @property {number} score how relevant the chunk is (higher is better)
 */

/**
 * Splits text into chunks. Every LangChain text splitter works
 * (e.g., new MarkdownTextSplitter(), RecursiveCharacterTextSplitter.fromLanguage("html")).
 * @typedef {{ splitText: (text: string) => Promise<string[]> }} Splitter
 */

/**
 * Settings, and the callbacks the index uses to report what it's doing.
 * @typedef {object} Options
 * @property {string} [queryPrefix] put in front of every search query (some embedding models are trained with one)
 * @property {Splitter} [splitter] how addDocuments() splits documents, unless it's given one
 *   (by default, at paragraphs, then lines, then words, into chunks of up to 800 characters)
 * @property {(status: IndexStatus) => void} [onStatusChange] the status changed
 */

/**
 * Search documents by meaning and by keyword: the "retrieval" in retrieval-augmented generation (RAG).
 * Splits documents into chunks, embeds them, then finds the chunks most relevant to a query.
 *
 * @example
 * const index = new DocumentIndex(engine);
 * await index.addDocuments([{ title: "Syllabus", text: syllabusText }]);
 * const results = await index.search("How many slip days do I get?");
 * console.log(results[0].text);
 */
export default class DocumentIndex {
  #engine;
  #queryPrefix;
  #splitter;
  #onStatusChange;

  #db = null;
  #documents = [];
  #status = IndexStatus.EMPTY;

  // documents are added one batch at a time, and searches wait for the batches added before them
  #lastAdd = Promise.resolve();

  /**
   * @param {{ embed: (texts: string[]) => Promise<number[][]> }} engine anything with embed() (e.g., a WebLlmEngine)
   * @param {Options} [options]
   */
  constructor(engine, { queryPrefix = "", splitter, onStatusChange } = {}) {
    this.#engine = engine;
    this.#queryPrefix = queryPrefix;
    this.#splitter = splitter ?? new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });
    this.#onStatusChange = onStatusChange;
  }

  /** @returns {Document[]} every document added so far */
  get documents() {
    return this.#documents;
  }

  /** @returns {IndexStatus} */
  get status() {
    return this.#status;
  }

  /**
   * Split, embed, and add documents to the index. Can be called any time (e.g., when the user uploads a file).
   * @param {Document[]} documents
   * @param {object} [options]
   * @param {Splitter | null} [options.splitter] how to split these documents
   *   (null: don't split; each document is already a small chunk, like a product or a recipe)
   * @returns {Promise<void>} rejects if indexing fails
   */
  addDocuments(documents, { splitter = this.#splitter } = {}) {
    const add = this.#lastAdd.then(() => this.#add(documents, splitter));
    // keep the line moving even if this batch fails
    this.#lastAdd = add.catch(() => {});
    return add;
  }

  /**
   * Find the k chunks most relevant to the query (hybrid search: by meaning and by keyword).
   * Waits for documents that are still being added.
   * @param {string} query
   * @param {number} [k] how many chunks
   * @returns {Promise<SearchResult[]>} most relevant first (empty if there are no documents)
   */
  async search(query, k = 4) {
    await this.#lastAdd;
    if (!this.#db) return [];

    const [queryVector] = await this.#engine.embed([this.#queryPrefix + query]);
    const results = await search(this.#db, {
      mode: "hybrid",
      term: query,
      properties: ["text"],
      vector: { value: queryVector, property: "embedding" },
      // Orama's default (0.8) filters out most matches; small embedding models score lower
      similarity: 0.2,
      limit: k,
    });
    return results.hits.map(({ document, score }) => ({ title: document.title, text: document.text, score }));
  }

  async #add(documents, splitter) {
    if (documents.length === 0) return;
    this.#setStatus(IndexStatus.INDEXING);

    try {
      const chunks = [];
      for (const { title, text } of documents) {
        const pieces = splitter ? await splitter.splitText(text) : [text];
        chunks.push(...pieces.map((piece) => ({ title, text: `${title}\n\n${piece}` })));
      }

      const vectors = await this.#engine.embed(chunks.map((chunk) => chunk.text));

      // the embedding model decides the vector size, so the database is created once the first vectors exist
      this.#db ??= create({
        schema: { title: "string", text: "string", embedding: `vector[${vectors[0].length}]` },
        // for keyword search: ignore words like "how" and "I", and match "day" to "days"
        components: { tokenizer: { stemming: true, stopWords: stopwords } },
      });
      await insertMultiple(this.#db, chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })));

      this.#documents.push(...documents);
      this.#setStatus(IndexStatus.READY);
    } catch (error) {
      this.#setStatus(IndexStatus.ERROR);
      throw error;
    }
  }

  #setStatus(status) {
    if (status === this.#status) return;
    this.#status = status;
    this.#onStatusChange?.(status);
  }
}
