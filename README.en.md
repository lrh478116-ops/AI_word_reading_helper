# AI Tip: Read & Explore

Follow questions, keep context.

[简体中文](README.md) · [Mac App Store fields](docs/release/app-store-connect-config.template.md) · [Image provenance](store-assets/README.md)

AI Tip is a reading workspace for papers, textbooks, technical specifications and policy documents. Ask beside a source passage, explore an idea inside a reply, and revisit the branches of your discussion in Tip Tree.

![Ask beside a document passage; layout preview requiring Mac recapture](store-assets/showcase/en/01-source.png)

## A conversation that stays connected to reading

- **Source-anchored Tips:** select text to start a conversation tied to that location. Choose a plain-language, detailed or technical explanation, or an example.
- **Follow-up branches:** create a child Tip from a reply. Keep the parent conversation in view and return to it when you close the child.
- **Tip Tree:** name, locate and revisit questions. Each Tip keeps its own chat, with optional memory from other Tip summaries.
- **Original-layout PDFs:** read the original pages, select native text, run local Chinese/English OCR on scans and export annotated PDF copies without overwriting the source.
- **Relevant long-document context:** on-device text retrieval supplies selected passages to the model. It does not imply that the model has read every page.
- **Your choice of model:** use a compatible online API or download/import compatible GGUF models with the bundled inference runtime. Model weights are separate downloads and require sufficient disk space and memory.

![Explore a reply with its parent in view; layout preview](store-assets/showcase/en/02-follow-up.png)

![Revisit a branch in Tip Tree; layout preview](store-assets/showcase/en/03-tree.png)

## Local-first, with explicit choices

Documents, edits and chats are saved locally by default. Signing in does not upload them. Cloud copies require an explicit upload per document; the current quota is 5 MB per user.

Web search is off by default. Search and online model calls are different: an online AI provider still receives your question and relevant context even when search is off. Provider charges and terms may apply.

Reading and importing do not require a model API. AI replies require a working API or a downloaded, loaded local model. OCR, AI answers and calculation tools have limitations; review results against the original source.

![Choose a compatible local model; layout preview](store-assets/showcase/en/04-models.png)

Available in Simplified Chinese and English. Windows desktop builds and a Mac App Store build configuration are included; this is not a claim of App Store availability.

Screenshots show the real client with original example documents and authored demonstration responses. They were captured on Windows and are **not submission-ready Mac screenshots or model-quality evidence**. Mac submission requires recapture and testing of the signed candidate. See the [Chinese developer guide](README.md#开发与实现说明) for build instructions, implementation details and limitations.
