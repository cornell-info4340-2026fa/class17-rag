import { ref } from "vue";
// import { MarkdownTextSplitter } from "@langchain/textsplitters";
import DocumentIndex, { IndexStatus } from "../lib/DocumentIndex";
import { llmEngine, EMBEDDING_QUERY_PREFIX } from "./localLlm";

export { IndexStatus };

export const indexStatus = ref(IndexStatus.EMPTY);

// only one index (it has its own module so that it won't be rebuilt on hot reload)
export const documentIndex = new DocumentIndex(llmEngine, {
  queryPrefix: EMBEDDING_QUERY_PREFIX,
  onStatusChange: (nextStatus) => (indexStatus.value = nextStatus),
});

// every markdown file in src/assets/documents/, bundled into the app as text
// TODO: import documents to chunk

// the documents to search: each file's "# Title" heading (or its file name) and its text
// TODO: read document contents

// the text of the first "# Title" heading: a line that starts with "# " (the m flag makes ^ and $ match each line)
function getTitle(markdown) {
  return markdown.match(/^# (.+)$/m)?.[1];
}

// Other apps add their own documents as { title, text }, for example:
//   plain text:         documentIndex.addDocuments([{ title: "Notes", text: notes }])
//   uploaded text file: documentIndex.addDocuments([{ title: file.name, text: await file.text() }])
//   PDFs with text:     documentIndex.addDocuments([{ title: file.name, text: await pdfToText(file) }]);
//
// Extracting the text from a PDF (npm install pdfjs-dist):
//   import * as pdfjs from "pdfjs-dist";
//   import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
//   pdfjs.GlobalWorkerOptions.workerSrc = workerUrl; // pdf.js reads PDFs in a web worker
//
//   async function pdfToText(file) {
//     const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
//     const pages = [];
//     for (let i = 1; i <= pdf.numPages; i++) {
//       const content = await (await pdf.getPage(i)).getTextContent();
//       pages.push(content.items.map((item) => item.str ?? "").join(" "));
//     }
//     return pages.join("\n\n");
//   }
//
// Scanned PDFs are images with no text, so this returns nothing for them (they'd need OCR).

// Pick the splitter that matches your documents (all from "@langchain/textsplitters"):
//   plain text, PDF:           leave out the splitter option (default: RecursiveCharacterTextSplitter,
//                              which splits at paragraphs, then lines, then words)
//   markdown:                  new MarkdownTextSplitter()  (headings, then paragraphs)
//   web pages (HTML):          RecursiveCharacterTextSplitter.fromLanguage("html")  (block tags like <p> and <div>)
//   one known separator:       new CharacterTextSplitter({ separator: "---" })  (only that separator)
//   small records (recipes):   null  (doesn't split: one record = one chunk)
// The splitters take { chunkSize, chunkOverlap }: the maximum characters per chunk, and how many repeat between chunks.

// start indexing now (after the model loads).
// TODO: add courseDocuments to documentIndex
