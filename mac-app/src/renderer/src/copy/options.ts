// All settings' words: a plain label and one line of help for every Xenon
// option, in sentence case. With technical details off nothing here shows an
// option key, environment name, command or path; Xenon's own description and
// the raw name appear only with them on. The catalog (optionCatalog.ts) takes
// every one of its words from here and adds which group each option is in.
//
// An option Essentials also shows has the label of its Essentials row, taken
// from copy/settings.ts so the two can't drift. A secret says where to add it
// (Keys & accounts) and describes no value to type: the form never offers a box.
import { SETTINGS } from './settings';

const E = SETTINGS.essentials.labels;
const G = SETTINGS.essentials.groups;

export const OPTIONS = {
  /** The group names, in the order All settings lists them. The first five are Essentials' own. */
  groups: {
    phones: G.phones,
    tests: G.tests,
    history: G.history,
    sharing: G.sharing,
    ai: G.ai,
    health: 'Phone health',
    network: 'Network',
    storage: 'Storage & logs',
    /** Options this app has no words for yet (a newer Xenon's), after the rest. */
    more: 'More'
  },

  entries: {
    // ─── Phones ──────────────────────────────────────────────────────────────
    platform: {
      label: E.platform,
      help: 'Choose whether Xenon looks for Android phones, iPhones or both.'
    },
    androidDeviceType: {
      label: E.androidDeviceType,
      help: 'Choose whether Xenon uses real Android phones, emulators or both.'
    },
    iosDeviceType: {
      label: E.iosDeviceType,
      help: 'Choose whether Xenon uses real iPhones, simulators or both.'
    },
    simulators: {
      label: 'Simulators to offer',
      help: 'Limits Xenon to the iPhone simulators you list, by name and iOS version; leave it empty to offer every one it finds.'
    },
    emulators: {
      label: 'Emulators to start',
      help: 'The Android emulators Xenon starts for you each time the server starts.'
    },
    bootedSimulators: {
      label: E.bootedSimulators,
      help: 'Xenon ignores simulators that are switched off, which helps on a Mac with many of them installed.'
    },
    bootedEmulators: {
      label: E.bootedEmulators,
      help: 'Xenon ignores emulators that are switched off and uses only the ones already running.'
    },
    adbRemote: {
      label: 'Other computers with Android phones',
      help: 'Other computers whose Android phones Xenon should find too, one per entry, written as address:port such as 192.168.1.50:5037.'
    },
    derivedDataPath: {
      label: 'Xcode build file locations',
      help: 'Folders with a ready-made build of the helper app Xenon puts on iPhones, one for real iPhones and one for simulators; Xenon copies it for each phone.'
    },
    skipChromeDownload: {
      label: 'Skip the Chrome driver download',
      help: 'When on, Xenon doesn’t download Chrome’s driver for Android phones, so testing websites and hybrid apps on them won’t work without one; turn it off to let Xenon manage Chrome for you.'
    },

    // ─── Tests ───────────────────────────────────────────────────────────────
    maxSessions: {
      label: E.maxSessions,
      help: 'How many tests run at the same time; the others wait their turn, and a number below 1 means no limit.'
    },
    deviceAvailabilityTimeoutMs: {
      label: E.deviceAvailabilityTimeoutMs,
      help: 'How long a test waits for a phone to come free before it gives up, in milliseconds.'
    },
    deviceAvailabilityQueryIntervalMs: {
      label: 'How often to look for a free phone',
      help: 'While a test waits for a phone, how often Xenon looks again, in milliseconds; a shorter gap starts the test sooner.'
    },
    newCommandTimeoutSec: {
      label: 'Idle time before a test ends',
      help: 'How many seconds a test can go without a command before Xenon ends it, unless the test says otherwise.'
    },
    autowait: {
      label: 'Wait for elements automatically',
      help: 'Sets whether tests keep trying to find an element, and wait until it is ready, before they give up; it is off unless you turn it on, and a test can change it for itself.'
    },
    sessionHeartbeatIntervalMs: {
      label: 'How often a running test checks in',
      help: 'How often, in milliseconds, a running test reports that it is still alive, so Xenon can spot ones that were abandoned.'
    },

    // ─── Recording & history ─────────────────────────────────────────────────
    enableDashboard: {
      label: E.enableDashboard,
      help: 'Saves each test’s steps, screenshots and logs for the dashboard; without it the dashboard doesn’t list tests on this Mac’s own phones.'
    },
    buildCleanupDays: {
      label: E.buildCleanupDays,
      help: 'Test history older than this many days is deleted automatically.'
    },
    buildCleanupMaxCount: {
      label: 'Most test runs to keep',
      help: 'Once history holds more test runs than this, the oldest are deleted first, whatever their age.'
    },
    buildCleanupSchedule: {
      label: 'When history is cleaned up',
      help: 'When old history is deleted, written as a cron schedule such as 0 0 * * * for every night at midnight, which is the default.'
    },
    deleteBuildAssets: {
      label: 'Delete videos and screenshots too',
      help: 'When old history is cleaned up, its videos and screenshots are deleted from this Mac as well as its entries.'
    },
    recordingCleanupDays: {
      label: 'Keep live recordings for',
      help: 'Screen recordings made from the dashboard’s live view are deleted after this many days.'
    },
    recordingCleanupMaxCount: {
      label: 'Most live recordings to keep',
      help: 'Once there are more live recordings than this, the oldest are deleted first.'
    },
    recordingFailedCleanupDays: {
      label: 'Keep failed recordings for',
      help: 'A failed recording has nothing to play, so it is deleted after this many days, which is usually sooner than the others.'
    },
    maxConcurrentRecordings: {
      label: 'Live recordings at the same time',
      help: 'The most live screen recordings that can run at once across everyone; recordings of tests don’t count.'
    },
    recordingsAssetsPath: {
      label: 'Live recordings folder',
      help: 'The folder where live recordings are saved; when it is empty Xenon picks one for you.'
    },
    sessionMetrics: {
      label: 'Record phone performance during tests',
      help: 'Records the phone’s processor and memory use during each test for the dashboard; it needs the full record of each test to be on.'
    },
    streaming: {
      label: 'Live screen streaming',
      help: 'How an Android phone’s screen is streamed to the dashboard’s live view.'
    },

    // ─── Sharing & sign-in ───────────────────────────────────────────────────
    authDisabled: {
      // The option is "sign-in is off"; the label and the help say the switch's own side, as Essentials does.
      label: E.signIn,
      help: 'When off, anyone who can reach this Mac can use the dashboard without signing in, so turn it off only on a Mac that is yours alone.'
    },
    hub: {
      label: E.hubAddress,
      help: 'The address of the lab hub this Mac shares its phones with; leave it empty to run on its own.'
    },
    remoteMachineProxyIP: {
      label: 'Public address of this Mac',
      help: 'The address other computers should use to reach this Mac when it sits behind a reverse proxy or a router that hides its own address.'
    },
    bindHostOrIp: {
      label: 'This Mac’s address in links',
      help: 'The address Xenon puts in phone links and in the dashboard; leave it as auto to use one that other computers on your network can reach.'
    },
    sendNodeDevicesToHubIntervalMs: {
      label: 'How often to update the hub',
      help: 'How often, in milliseconds, this Mac sends its list of phones to its hub; it only matters when a hub address is set.'
    },
    checkStaleDevicesIntervalMs: {
      label: 'How often a hub drops silent phones',
      help: 'How often, in milliseconds, a hub removes the phones of Macs that have stopped reporting in.'
    },

    // ─── AI help ─────────────────────────────────────────────────────────────
    enableSelfHealing: {
      label: E.enableSelfHealing,
      help: 'When a test can’t find an element, Xenon tries other ways to find it, ending with AI, before the test fails.'
    },
    aiProvider: {
      label: E.aiProvider,
      help: 'Which AI service Xenon asks when it repairs lookups and reads screenshots; it uses Gemini if you don’t choose.'
    },
    aiModel: {
      label: 'AI model',
      help: 'Which model of the AI service to use instead of Xenon’s own choice.'
    },
    aiBaseUrl: {
      label: E.aiBaseUrl,
      help: 'The address of a local Ollama or another compatible AI service, for Xenon to use instead of the provider’s own.'
    },
    geminiApiKey: {
      label: E.geminiKey,
      help: 'Add or change the key for Gemini in Keys & accounts.'
    },
    openaiApiKey: {
      label: E.openaiKey,
      help: 'Add or change the key for OpenAI in Keys & accounts.'
    },
    anthropicApiKey: {
      label: E.anthropicKey,
      help: 'Add or change the key for Claude in Keys & accounts.'
    },

    // ─── Phone health ────────────────────────────────────────────────────────
    healthCheckIntervalMs: {
      label: 'How often to check phones',
      help: 'How often, in milliseconds, Xenon checks each phone’s battery and heat in the background, unless a schedule is set.'
    },
    healthCheckSchedule: {
      label: 'Phone check schedule',
      help: 'Runs the phone checks at set times, written as a cron schedule such as 0 * * * * for every hour, instead of at regular gaps.'
    },
    checkBlockedDevicesIntervalMs: {
      label: 'How often to recheck blocked phones',
      help: 'How often, in milliseconds, Xenon rechecks phones someone blocked and frees phones left busy by tests that ended.'
    },
    removeDevicesFromDatabaseBeforeRunningThePlugin: {
      label: 'Forget phone details at every start',
      help: 'Each time Xenon starts, this Mac’s phones lose their team, tags, maintenance and reservations and come back as new phones.'
    },

    // ─── Network ─────────────────────────────────────────────────────────────
    proxy: {
      label: 'Proxy',
      help: 'Sends Xenon’s own calls to other Xenon servers and cloud providers through a proxy; its password is added in Keys & accounts.'
    },
    tlsRejectUnauthorized: {
      label: 'Check security certificates',
      help: 'When on, this server’s calls to other Xenon servers, such as a hub and its nodes, go ahead only if their security certificate checks out (AI services and other outside calls aren’t covered); turn it off only for testing.'
    },
    interceptor: {
      label: 'Network capture',
      help: 'Sets whether tests on this Mac’s Android phones capture their network traffic by default, which sends the phone’s web traffic through Xenon; a test can say otherwise.'
    },
    cloud: {
      label: 'Cloud phones',
      help: 'Connects Xenon to a cloud phone provider; the provider’s access key is added in Keys & accounts.'
    },

    // ─── Storage & logs ──────────────────────────────────────────────────────
    databaseProvider: {
      label: 'Database type',
      help: 'No longer used, since Xenon always keeps its data in SQLite.'
    },
    databaseUrl: {
      label: 'Database file',
      help: 'Where Xenon keeps its data; set it in Keys & accounts.'
    },
    enableJsonLogging: {
      label: 'Machine-readable logs',
      help: 'Writes logs as structured lines other tools can read, instead of plain text.'
    }
  }
} as const;
