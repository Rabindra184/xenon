---
title: AI failure analysis
description: How Xenon sorts a failed session into a category, how it asks an AI provider for the likely cause, what the AI is sent, and where the results appear.
---

When a session fails, Xenon does two things to help you see why. It always sorts the failure into a category, such as `Element Not Found` or `Timeout`. When an AI provider is set up, it also asks the provider for the likely cause and a suggested fix. Both appear on the session's page, under **Why it failed**. This page explains what each step reads, when it runs, what you need for the AI part, where the results show up, and exactly what data leaves the server.

## What it reads

| Input | The category uses it | The AI is sent it |
|---|---|---|
| The failure reason | Yes | Yes |
| The session's commands | The error code and message of the last 5 commands that got an error, never their stack traces | The last 10 commands, whether they worked or not: each one's name, whether it succeeded, and the first 500 characters of its response |
| The device log | No | The last 50 lines |
| A screenshot | No | The newest screenshot among those last 10 commands, if one was kept |

Nothing else about the session is read: not the video, the capabilities or any credentials.

## When it runs

Xenon runs the analysis when a session ends as **Failed**, however it ended:

- the test's commands failed and it set no result of its own;
- the test set the result to `failed` with `xenon: setSessionStatus`;
- Appium or Xenon ended the session itself, for example at the new-command timeout, because the driver shut down unexpectedly, or because the session stopped answering its health checks. A session Appium ends at its new-command timeout gets Appium's own reason, such as `New Command Timeout of 60 seconds expired.`, and Xenon's idle release `Session timed out due to inactivity`, so both are filed as **Timeout**.

It doesn't run for a session that passed. It needs the session's record, so the server must have its dashboard on. See [Sessions and builds](./sessions.md#what-you-need). On a hub, it runs for a session on a node's phone too, with the device log the hub collected from the node.

The category is saved before the call that ends the session, such as `driver.quit()`, returns. The AI analysis runs after the session has ended, and the end doesn't wait for it, so `ai_analysis` may still be empty when `driver.quit()` returns. It is saved when the provider answers, usually within seconds. Xenon gives up on a call after 2 minutes, and runs at most 4 analyses at once; the others wait their turn. A session page that was open at that moment may need a reload to show the category and the analysis.

## The category

Xenon reads the failure that ended the session: the failure reason, together with the error of the command it came from. Only an error's code and message count, never its stack trace. A session with no reason at all is read from its failed commands, newest first. The first category in this list with a match wins:

| Category | It looks for |
|---|---|
| **Hub Restart** | The reason `Hub shutdown`: the server ended the session as it shut down |
| **System Overload** | `OutOfMemoryError`, `too many open files`, `connect EMFILE` |
| **Session Lost** | `Could not proxy command to the remote server`, `instrumentation process is not running`, `Session does not exist`, `A session is either terminated or not started`, `The driver was unexpectedly shut down!`, `Appium did not get any response from`, `Chromedriver quit unexpectedly`, the code `invalid session id`, and Xenon's own reasons when it loses a session: `Session heartbeat timeout`, `Session terminal failure`, and a node it can't reach |
| **App Crash** | `is not running, possibly crashed` (an iPhone app), and a test's own `The application has crashed`, `Application not responding`, `process has died` or `activity has died` |
| **Stale Element** | The code `stale element reference`, `no longer attached to the DOM`, `does not exist in DOM anymore`, `is not present in the cache or has expired`, `is not present in the current view anymore`, `expired from the internal cache`, `Element does not exist in cache` |
| **Timeout** | `New Command Timeout of`, `timed out due to inactivity`, `did not complete before its timeout expired`, `hogging the main UI thread`, Xenon's autowait waiting for an element `to be enabled`, a few of WebDriverAgent's time-outs, and the codes `timeout` and `script timeout` |
| **Element Not Found** | The code `no such element`, `An element could not be located`, `didn't match any elements`, Xenon's own `Autowait timed out` and `Xenon found nothing on the screen matching`, and a test's own `NoSuchElement` |
| **Permission Blocked** | The code `unexpected alert open` and `A modal dialog was open` (a web page on an iPhone), and a test's own `Permission alert`, `Security alert`, `Always Allow` or `Allow while using app` |
| **Unknown** | None of the above |

The failure that ended the session decides alone. An error the test recovered from earlier in the run doesn't, and a reason that matches nothing is `Unknown`. The codes, such as `no such element`, are only in what a hub records for a session on a node's phone; a server's own sessions keep the message.

Two failures phones don't report as such. An Android app that crashes outright gives the test no error of its own, so its session is filed `Element Not Found` or `Stale Element`; its crash report is in **Device logs**, where the session has them. A native permission prompt shows up as `Element Not Found`.

**Hub Restart** is also set outside the analysis, on a session that was running when the server restarted and couldn't be picked up again. It has no AI analysis.

Sessions filed by Xenon 2.15 or earlier keep the category they were given, which may be **Wda Failure** or **Xenon Command Failure**. Neither is used any more: their sessions are now **Session Lost** and **Stale Element**.

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
