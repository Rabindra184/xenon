---
title: AI providers
description: "Set up the AI provider Xenon's AI features use, Gemini, OpenAI, Anthropic or a local Ollama: the environment variables and options, the default models, the AI engine page, and what each feature sends."
---

Some of Xenon's features ask an AI model: two of the self-healing tiers, the failure analysis of a failed session, and the screen commands that work from a description. They all use one provider you set up for the server: Google Gemini, OpenAI, Anthropic, or a local Ollama. Without one, these features are off and nothing is sent anywhere, and the rest of Xenon works as usual. This page explains how to set a provider up, which model each one uses, what the **AI engine** page does, and what each feature sends.

## Choose a provider

Set the provider and its key in the environment of the Appium server, then start it. Keep the key there rather than in a config file: [In the server's config file](#in-the-servers-config-file) says why.

```bash
export XENON_AI_PROVIDER=anthropic
export XENON_ANTHROPIC_API_KEY='<your Anthropic API key>'
appium server --use-plugins=xenon --plugin-xenon-enable-dashboard
```

| Provider | `XENON_AI_PROVIDER` | Key | Default model | Base URL |
|---|---|---|---|---|
| Google Gemini | `gemini` (the default) | `XENON_GEMINI_API_KEY`, or `GEMINI_API_KEY` | `gemini-3-flash-preview` | Not used. |
| OpenAI | `openai` | `XENON_OPENAI_API_KEY`, or `OPENAI_API_KEY` | `gpt-4o` | `XENON_AI_BASE_URL`, for another service that speaks the OpenAI API. |
| Anthropic | `anthropic` | `XENON_ANTHROPIC_API_KEY`, or `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | Not used. |
| Ollama | `ollama` | None | `llama3` | `XENON_AI_BASE_URL`, `http://localhost:11434` by default. |

- **Without a key,** Gemini, OpenAI and Anthropic stay off, and the server's log says `No valid API key found for <provider>. AI features disabled.` With no provider variable at all, the provider is Gemini, so a server with no Gemini key has no AI features.
- **The unprefixed names,** such as `GEMINI_API_KEY`, are read only when the `XENON_` one isn't set.
- **Ollama** needs no key, but the screenshot features need a model that can read images, and `llama3`, the default, is a text model. Choose a vision model with `XENON_OLLAMA_MODEL`, for example `llava`.

### Choose a model

Each provider has its own variable for the model, and one variable covers them all:

| Variable | Model for |
|---|---|
| `XENON_GEMINI_MODEL` | Gemini |
| `XENON_OPENAI_MODEL` | OpenAI |
| `XENON_ANTHROPIC_MODEL` | Anthropic |
| `XENON_OLLAMA_MODEL` | Ollama |
| `XENON_AI_MODEL` | Whichever provider is chosen, when its own variable isn't set. |

The model is the provider's own variable, else `XENON_AI_MODEL`, else the default in the table above.

### In the server's config file

The provider, the general model, the base URL and the keys can also be options in the config file:

```yaml
server:
  use-plugins: [xenon]
  plugin:
    xenon:
      aiProvider: ollama
      aiModel: llava
      aiBaseUrl: http://localhost:11434
```

An option wins over its variable: `aiProvider` over `XENON_AI_PROVIDER`, `aiModel` over `XENON_AI_MODEL`, and `aiBaseUrl` over `XENON_AI_BASE_URL`. The keys have options too, `geminiApiKey`, `openaiApiKey` and `anthropicApiKey`, which win over the variables, but a key in a config file is easy to leak: keep keys in the environment. The provider's own model variable, such as `XENON_OLLAMA_MODEL`, still wins over `aiModel`. A provider chosen on the **AI engine** page, and a model or base URL saved while the server runs, win over both: see [Change them while the server runs](#change-them-while-the-server-runs). [Configuration](./configuration.md) lists the options.

Xenon reads the provider in force at each AI call, so a provider chosen only in the options works from the first call, as one chosen in the environment does.

### Change them while the server runs

A super admin can change the provider, the models and the base URL without a restart: the provider on the [AI engine page](#the-ai-engine-page), and any of them with `POST /xenon/api/config`, called with a super admin's access key and token, with the `admin` scope ([Roles and scopes](./roles-and-scopes.md)). Its fields have the options' names, `aiProvider`, `aiModel` and `aiBaseUrl`, and one model field per provider, `geminiModel`, `openaiModel`, `anthropicModel` and `ollamaModel`:

```bash
curl -X POST http://localhost:4723/xenon/api/config \
  -H 'content-type: application/json' \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -d '{"aiProvider": "ollama", "ollamaModel": "llava", "aiBaseUrl": "http://gpu-box.lab:11434"}'
```

- **Saved, and kept across restarts.** Xenon keeps each value in its database. It replaces the option and the environment variable, and applies from the next AI call.
- **An empty value goes back** to the option or the variable, or to the provider's default when neither is set, for example `{"ollamaModel": ""}`.
- **A provider's own model wins over `aiModel`,** saved or not, as the variables do.
- **A value that can't work is refused,** with `400 invalid_setting` and the field's name, and nothing is saved: a provider other than the four, a model name with spaces or of more than 200 characters, or a base URL that isn't an `http` or `https` address or that holds a user name, password or query.
- **Keys can't be set this way.** Xenon ignores a key sent here and never saves one.
- **The values belong to the server they are saved on.** Saving them on a hub doesn't change a node's provider: see [On a hub](#on-a-hub).

## What uses the provider

| Feature | When it calls the provider | What it sends |
|---|---|---|
| [Visual AI healing tier](./self-healing.md#visual-ai) | A find failed, and the earlier tiers didn't find the element. | A screenshot, and a description made from the selector. |
| [LLM healing tier](./self-healing.md#llm) | A find failed, and Visual AI didn't find the element either. | The selector and its strategy, the first 10,000 characters of the page source, and a screenshot. |
| [Failure analysis](./failure-analysis.md) | A session ends failed. | The session's id, its failure reason, its last 10 commands, its last 50 device log lines and its newest screenshot. |
| [`-custom:ai-icon`](./omni-vision.md#locator-strategies), `visualTap`, and `smartTap` with an icon or description | The test asks. | A screenshot, and the description the test gave. |
| [`assertVisualState`](./execute-commands.md#on-screen-actions) | The test asks. | A screenshot, and the condition to check. |
| [`analyzeScreen`](./execute-commands.md#on-screen-actions), and device control's [scan](./omni-vision.md#omni-vision-in-device-control) | The test, or someone calling the API, asks. | A screenshot. |
| Device control's [locator test](./omni-vision.md#omni-vision-in-device-control) with `-custom:ai-icon` | Someone calling the API asks. | A screenshot, and the description. |
| **Test Connection** on the AI engine page | A super admin clicks it. | A one-line test prompt, and no screenshot. |

These never call it: the Resilio, Fuzzy XML and OCR healing tiers, text found with `-custom:ai-text` or `smartTap` with text, `uiInventory`, the [inspector](./inspector.md), and [Selector health](./selector-health.md).

Xenon sets no temperature or top P on these calls, and asks OpenAI and Anthropic for answers of at most 500 tokens. Each call has 30 seconds to answer, and failure analysis 2 minutes. A call that takes longer is cancelled and counts as a failed call.

A screenshot or a page source holds whatever the app shows, personal data included, and Xenon sends it as it is. When that matters, run a model on a machine you control with Ollama, or leave the provider unset. A session can also keep healing from sending its screenshots to the provider with [`healingTiers`](./self-healing.md#choose-tiers-for-one-session): with `[1, 2, 3]`, healing never calls the provider, and a value Xenon can't read runs those three tiers only. It doesn't cover [failure analysis](./failure-analysis.md), which still sends a failed session's newest screenshot, when one was kept.

## The AI engine page

**AI engine** in the dashboard's sidebar shows the provider the server uses. Admins can open it. Only a super admin can save a change on it or test a connection.

- **Provider registry** lists the four providers, Gemini, OpenAI and Anthropic each with its default model and Ollama as `Local / self-hosted — no API key required`, and counts how many are set up, such as `2 / 4 configured`. A provider whose key is set shows **READY**, one without shows **Not set** and can't be chosen, and the one selected shows **Active**, or **Active — no key** when its key is missing. Ollama counts as set up when a model or base URL is set for it: `XENON_OLLAMA_MODEL`, `XENON_AI_MODEL` or `XENON_AI_BASE_URL`, the `aiModel` or `aiBaseUrl` option, or a value saved while the server runs. Point at a provider that is **Not set** to see what the server needs: its key's variable, or for Ollama `XENON_OLLAMA_MODEL` or `XENON_AI_BASE_URL`.
- **Choosing a provider:** click one that is **READY**, then **Save configuration**. Xenon uses it from its next AI call, for the healing tiers, failure analysis and the screen commands alike. Xenon saves the choice: it replaces the provider the option or the environment names, and stays after a restart. The page has no way back to the server's own provider; send `{"aiProvider": ""}` to `POST /xenon/api/config` for that ([Change them while the server runs](#change-them-while-the-server-runs)).
- **Runtime configuration** shows the provider selected on the page, even before you save it, with its model and, for OpenAI and Ollama, its base URL. Gemini and Anthropic use no base URL, so none is shown for them. **Default** beside the model means the server sets no model for that provider, and the provider's default, shown, is used. A user name, password or query value in the base URL shows as `***`. The model and the base URL come from the environment, the options and `POST /xenon/api/config`; the page doesn't change them.
- **Test Connection** sends the provider selected on the page a one-line prompt with the server's key, and says whether it answered and how long it took. A provider that answers that it is rate-limited or out of quota fails the test, and the message says so, since no AI call would work until it has quota again. A provider that doesn't answer in 30 seconds fails it too. Nothing is saved.

The dashboard never asks for, stores or shows a key. The page only says whether each one is set.

## Ollama

Ollama runs the model on a machine you choose, so nothing leaves your network.

- Xenon checks that Ollama answers at its base URL before asking it. A check that worked is kept for a minute, and one that failed is tried again at the next call. While it doesn't answer, Xenon skips the AI step as if no provider were set.
- Each request has 30 seconds to answer.
- Run the model on a machine with enough memory for it; a slow answer holds up a healing find while it waits.

## When the provider keeps failing

After five failed calls in a row, Xenon stops calling that provider and model for 60 seconds. Failures that count are server errors, timeouts, network errors and rate limits. A request the provider refuses, such as one with a wrong key or an unknown model, doesn't count, and fails each time it is made.

While the provider is skipped, or when a call fails, each feature goes on as if there were no provider: the AI healing tiers find nothing and the next tier runs, a failed session gets its category but no analysis, `analyzeScreen` answers with `ai_insights_error`, and `assertVisualState`, `visualTap` and `smartTap` with an icon fail and say why. See [Execute commands](./execute-commands.md#when-a-command-cant-look).

## On a hub

Each server uses its own provider settings and keys.

- **A session on a node's phone** runs its commands on the node, so its healing tiers and screen commands use the node's provider.
- **Device control's scan and locator test** for a node's phone run on the hub, with the hub's provider, on a screenshot the node takes.

Set a provider on every server whose features should use one.

## Related

- [How healing works](./self-healing.md): the tiers that call the provider.
- [Failure analysis](./failure-analysis.md): what a failed session sends, and where the answer shows.
- [Omni-Vision](./omni-vision.md): finding things on the screen by text or description.
- [Configuration](./configuration.md): the AI options, with the other server options.
