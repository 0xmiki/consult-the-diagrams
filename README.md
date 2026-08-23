# Diagrams

Enter any situation to generate a directed graph of possible future states. Follow-up prompts revise the current graph or add hypothetical branches.

## Run locally

Create `.env` from `.env.example` and add an OpenAI API key. Diagram generation uses `gpt-5.6-sol` with medium reasoning.

```sh
bun install
bun run dev
```

The server sends prompts and the current graph to the OpenAI Responses API. Diagrams and version history remain in the browser's local storage. PNG and JSON exports run in the browser.

## Verify

```sh
bun run check
bun run build
```
