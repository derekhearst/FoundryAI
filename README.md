# FoundryAI

AI-powered DM assistant module for [Foundry VTT](https://foundryvtt.com/) v13.

FoundryAI adds an intelligent chat assistant to your Foundry game that can read your journals and actors, answer questions about your world, generate session recaps, and help you run your game — all powered by [OpenRouter](https://openrouter.ai/).

## Features

- **AI Chat** — Sidebar tab and popout window with streaming responses
- **RAG (Retrieval-Augmented Generation)** — Indexes your journals, actors, and scenes into a local vector store so the AI can search and reference your world content
- **Tool Calling** — The AI can search journals, look up actors, read scenes, create/update journal entries, and roll on tables
- **Session Chat History** — Conversations are saved as journal entries in a dedicated folder
- **Session Recaps** — Generate polished narrative summaries of your sessions with AI
- **OpenRouter Integration** — Access any model available on OpenRouter (GPT-4o, Claude, Llama, Mistral, etc.)
- **Fully Client-Side** — Vector store uses IndexedDB; no external database needed

## Requirements

- Foundry VTT v13
- An [OpenRouter](https://openrouter.ai/) API key

## Installation

1. In Foundry VTT, go to **Settings → Add-on Modules → Install Module**
2. Paste the manifest URL:
   ```
   https://github.com/derekhearst/FoundryAI/releases/latest/download/module.json
   ```
3. Click **Install**
4. Enable **FoundryAI** in your world's Module Management
5. Open module settings and enter your OpenRouter API key

## Configuration

After enabling the module, open **Settings → Module Settings → FoundryAI**:

| Setting                    | Description                                      |
| -------------------------- | ------------------------------------------------ |
| **API Key**                | Your OpenRouter API key                          |
| **Chat Model**             | Model for chat responses (e.g. `openai/gpt-4o`)  |
| **Embedding Model**        | Model for RAG embeddings                         |
| **Journal Folders**        | Which journal folders to index for RAG           |
| **Actor Folders**          | Which actor folders to index for RAG             |
| **Temperature**            | Response creativity (0.0–2.0)                    |
| **Max Tokens**             | Maximum response length                          |
| **Stream Responses**       | Enable/disable streaming                         |
| **Auto-Index on Startup**  | Automatically index content when the world loads |
| **Enable Tool Calling**    | Allow the AI to use Foundry tools                |
| **System Prompt Override** | Custom instructions for the AI                   |

## Usage

### Chat

Click the **FoundryAI** tab in the sidebar, or use the scene controls button to open a popout window. Type a message and the AI will respond with context from your world.

### RAG Indexing

Use the **Reindex** button in the chat window to index your journals and actors. The AI will then be able to search and reference that content when answering questions.

### Session Recaps

Click **Generate Recap** to create a polished narrative summary from your chat sessions. Recaps are saved as journal entries in a "Session Recaps" folder.

## Development

### Prerequisites

- [Bun](https://bun.sh/) (or Node.js 18+)

### Setup

```bash
git clone https://github.com/derekhearst/FoundryAI.git
cd FoundryAI
bun install
```

### Scripts

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `bun run build`     | Production build → `dist/`                        |
| `bun run dev`       | Watch mode (rebuilds on changes)                  |
| `bun run package`   | Build + create `foundry-ai.zip` for release       |
| `bun run link`      | Symlink `dist/` into local Foundry modules folder |
| `bun run test`      | Run tests                                         |
| `bun run typecheck` | TypeScript type checking                          |

### Project Structure

```
src/
├── module.ts                 # Entry point (Hooks, settings, init)
├── settings.ts               # Foundry settings registration
├── core/
│   ├── openrouter-service.ts # OpenRouter API client (streaming, embeddings)
│   ├── vector-store.ts       # IndexedDB vector store with cosine similarity
│   ├── embedding-service.ts  # Document chunking + embedding pipeline
│   ├── collection-reader.ts  # Reads journals, actors, scenes from Foundry
│   ├── tool-system.ts        # Function-calling tool definitions + executor
│   ├── chat-session-manager.ts   # Persists chat sessions as journal entries
│   ├── session-recap-manager.ts  # AI-generated session recaps
│   └── system-prompt.ts      # Dynamic system prompt builder
├── ui/
│   ├── svelte-application.ts # Foundry ApplicationV2 ↔ Svelte 5 bridge
│   └── components/
│       ├── ChatWindow.svelte    # Main chat interface
│       ├── MessageBubble.svelte # Message rendering (markdown, tool results)
│       ├── SettingsPanel.svelte # Settings UI
│       └── SessionList.svelte   # Session browser
├── styles/
│   └── foundry-ai.scss       # Module styles
└── types/
    └── foundry-types.d.ts    # Foundry VTT type declarations
```

### Releasing

```bash
# Bump version in module.json, then:
bun run package
git add -A && git commit -m "v0.2.0"
git tag v0.2.0
git push --tags
```

Create a GitHub Release for the tag and upload:

- `foundry-ai.zip`
- `dist/module.json`

## Tech Stack

- **Svelte 5** (runes mode) — UI components
- **Vite 6** — Build tooling
- **TypeScript 5** — Type safety
- **OpenRouter API** — LLM chat + embeddings
- **IndexedDB** — Client-side vector storage
- **micromark** — Markdown rendering

## License

[MIT](LICENSE)
