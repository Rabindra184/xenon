---
title: AI failure analysis
description: How Xenon sorts a failed session into a category, how it asks an AI provider for the likely cause, what the AI is sent, and where the results appear.
---

When a session fails, Xenon does two things to help you see why. It always sorts the failure into a category, such as `Element Not Found` or `Timeout`. When an AI provider is set up, it also asks the provider for the likely cause and a suggested fix. Both appear on the session's page, under **Why it failed**. This page explains what each step reads, when it runs, what you need for the AI part, where the results show up, and exactly what data leaves the server.

## What it reads

| Input | The category uses it | The AI is sent it |
|---|---|---|
| The failure reason | Yes | Yes |
| The session's commands | The text of the last 5 commands that got an error | The last 10 commands, whether they worked or not: each one's name, whether it succeeded, and the first 500 characters of its response |
| The device log | No | The last 50 lines |
| A screenshot | No | The newest screenshot among those last 10 commands, if one was kept |

Nothing else about the session is read: not the video, the capabilities or any credentials.

## When it runs

Xenon runs the analysis when a session ends as **Failed**, however it ended:

- the test's commands failed and it set no result of its own;
- the test set the result to `failed` with `xenon: setSessionStatus`;
- Appium or Xenon ended the session itself, for example at the new-command timeout, because the driver shut down unexpectedly, or because the session stopped answering its health checks. A session Appium ends at its new-command timeout gets Appium's own reason, such as `New Command Timeout of 60 seconds expired.`, and Xenon's idle release `Session timed out due to inactivity`, so both are filed as **Timeout**.

It doesn't run for a session that passed. It needs the session's record, so the server must have its dashboard on. See [Sessions and builds](./sessions.md#what-you-need). On a hub, it runs for a session on a node's phone too, but the hub has no device log for that session, so the AI is sent none.

The category is saved before the call that ends the session, such as `driver.quit()`, returns. The AI analysis runs after the session has ended, and the end doesn't wait for it, so `ai_analysis` may still be empty when `driver.quit()` returns. It is saved when the provider answers, usually within seconds. Xenon gives up on a call after 2 minutes, and runs at most 4 analyses at once; the others wait their turn. A session page that was open at that moment may need a reload to show the category and the analysis.

## The category

Xenon looks for known phrases in the failure reason and in the last 5 failed commands, together and in any case. The first category in this list with a match wins:

| Category | It looks for |
|---|---|
| **Element Not Found** | `NoSuchElementError`, `unable to find an element`, `An element could not be located`, `no such element` |
| **App Crash** | `Appium crashed`, `process has died`, `activity has died`, `The application has crashed`, `Application not responding`, and the message that the application under test with a bundle id is not running or cannot be found |
| **Timeout** | `timeout`, `timed out`, `TimeoutException`, `New Command Timeout`, `socket hang up` |
| **Permission Blocked** | `Permission alert`, `Security alert`, `Always Allow`, `Allow while using app` |
| **Wda Failure** | `WebDriverAgent`, `WDA`, `xcodebuild failed`, `crashed with code`, `Unable to connect to WDA`, `Session does not exist`, `the session is not in a running state` |
| **Xenon Command Failure** | `Command failed`, `telemetry failed`, `interceptor error` |
| **System Overload** | `OutOfMemory`, `MemoryLimit`, `thermal throttling`, `too many open files` |
| **Unknown** | None of the above |

The category follows the words, not the cause. A failure that mentions a timeout in passing is filed as `Timeout`, and one that says both `no such element` and `timed out` is `Element Not Found`, since that comes first.

One more category is set outside the analysis: **Hub Restart**, on a session that was running when the server restarted and couldn't be picked up again. It has no AI analysis.

In the API the category is the stored, upper-case name, such as `ELEMENT_NOT_FOUND`.

## The AI analysis

The AI analysis needs an AI provider. Xenon supports Gemini (the default), OpenAI, Anthropic and Ollama. Set the provider and its key in the environment of the Appium server, for example `XENON_AI_PROVIDER` and `XENON_GEMINI_API_KEY`, or the provider with the `aiProvider` option. Ollama needs no key. A super admin can switch to another provider on the dashboard's **AI engine** page, and Xenon uses it from the next analysis and keeps the choice when the server restarts. [AI providers](./ai-providers.md) explains the setup, the models, their settings and that page.

With no provider set up, no AI analysis is made and no request goes anywhere. The category is still saved.

Xenon sends the provider one request for each failed session, asking it to say whether the failure was an app bug, a flaky selector, a system dialog or a problem with the infrastructure. It asks for a short summary that starts with `Root Cause:` and a specific fix, in Markdown. The text is saved with the session.

Only an answer is saved. A provider that is rate-limited or out of quota, a call that fails, and one that takes longer than 2 minutes save no analysis, and an analysis saved earlier for the session stays. When the provider keeps failing, Xenon stops asking it. After five server errors, time-outs, rate limits or network failures in a row, calls to that provider and model are skipped for 60 seconds. A session that fails during that time gets a category and no analysis.

## What leaves the server

Only the request described above, and only to the provider you set up:

- **Gemini, OpenAI and Anthropic:** the provider's own API. With OpenAI, `XENON_AI_BASE_URL` can point Xenon at another service that speaks the OpenAI API, and that service then receives the request.
- **Ollama:** the Ollama server at `XENON_AI_BASE_URL`, which is `http://localhost:11434` by default.

The request holds the session's id, the failure reason, the last 10 commands, the last 50 device log lines and the screenshot, as [listed above](#what-it-reads). Xenon doesn't filter these before it sends them: a command response or a log line that holds personal data goes as it is. When that matters, use Ollama on a machine you control, or set up no AI provider: no provider's key in the server's environment, config file or command line, `GEMINI_API_KEY` included, and no Ollama chosen, on the **AI engine** page or anywhere else. Leaving the provider unset isn't enough, because the provider is then Gemini. See [AI providers](./ai-providers.md#what-uses-the-provider).

## Where the results appear

- **The session's page.** The **Result** tile shows the category, and **Why it failed** shows it beside its heading, with the **AI analysis** below the reason and the first failed command. A long analysis is cut short, and **Show all** opens the rest. The analysis shows paragraphs, **bold** text and `code`. **Copy** adds the analysis to the failure report it puts on the clipboard. **Open runbook** opens a short guide for the category in a new tab: which messages put a failure there, what usually causes it and what to try. Every category has one. See [Sessions and builds](./sessions.md#result-and-why).
- **A bug report.** The analysis is in the zip as `ai-summary.txt` and in its `README.md`. See [Bug reports](./sessions.md#bug-reports).
- **A build's CSV export.** It has a `failure_category` column. It doesn't hold the analysis.
- **The API.** A session's record has `failure_category` and `ai_analysis`.

## When there is no analysis

If a failed session shows a category but no AI analysis, check these in order:

1. The server's dashboard is on. Without it, there is no record to analyse.
2. An AI provider is set up: its key is in the server's environment, or it is Ollama.
3. The provider answered. The server's log shows `Analysis failed` for a call that failed, and `No analysis for <session id>` for a rate limit or a call that took longer than 2 minutes. A call skipped because the provider kept failing is logged as `Analysis skipped`, at debug level.
4. The session ended as **Failed**. A session that passed, or was marked passed by the test, has no analysis.
5. The session page was opened before Xenon wrote the analysis, which comes after the session has ended. Reload it.

## Related

- [Sessions and builds](./sessions.md): the session's page, bug reports and exports.
- [AI providers](./ai-providers.md): choosing and setting up a provider.
- [Self-healing](./self-healing.md): the tiers that also use an AI provider.
