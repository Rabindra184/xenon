import { z } from 'zod';
import { defineTool } from '../tool';
import { invokeApi } from '../invokeApi';
import { answerOf } from '../toolCall';
import { callerOrigin } from '../publicOrigin';

/**
 * The recording tools, ported from Xenon Studio's `appium-mcp-plugin`
 * (`src/tools/recordings.ts`) with its names, descriptions, arguments and
 * answers. `authToken` is accepted and ignored: the caller is the one
 * `/xenon/mcp` signed in. Each runs its REST route in process
 * (`POST /recordings`, `POST /recordings/:groupId/stop`), so the busy check,
 * the concurrency cap, team visibility and the scope rule are REST's.
 */

/** `POST /recordings`'s answer, as far as the tool reads it. */
interface StartRecordingAnswer {
  groupId: string;
}

const startRecordingParams = z.object({
  authToken: z.string().optional(),
  udids: z.array(z.union([z.string(), z.object({ udid: z.string(), host: z.string() })])).min(1),
});

/** `xenon_start_recording`: `POST /recordings` with the udids, as the caller. */
export const startRecordingTool = defineTool({
  name: 'xenon_start_recording',
  scope: 'xenon:recordings',
  description:
    'Start recording on one or more devices. Params: ' +
    'udids (non-empty array; each entry is a device UDID, or { udid, host } to name the phone ' +
    'on one server when two servers have a phone with that UDID). Returns {groupId}. ' +
    'Errors: 409 → device_busy (device is busy or concurrency cap reached); ' +
    '409 → ambiguous_phone (two or more servers have a phone with that UDID: ' +
    'the message lists their hosts; pass { udid, host } with one of them).',
  params: startRecordingParams,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(args, caller) {
    const answer: StartRecordingAnswer = answerOf(
      await invokeApi(caller, { method: 'POST', path: '/recordings', body: { udids: args.udids } }),
    );
    return { groupId: answer.groupId };
  },
});

const stopRecordingParams = z.object({
  authToken: z.string().optional(),
  groupId: z.string(),
});

/**
 * `xenon_stop_recording`: `POST /recordings/:groupId/stop`, and where the
 * group's proof bundle is on this server (the origin the agent reached it at).
 */
export const stopRecordingTool = defineTool({
  name: 'xenon_stop_recording',
  scope: 'xenon:recordings',
  description:
    'Stop recording for a group (identified by groupId) and get the proof bundle download URL. ' +
    'Params: groupId (recording group ID). ' +
    'Returns {proofBundleUrl}, the URL of the proof bundle ZIP on this Xenon server. ' +
    'The URL is not pre-signed: the caller must attach their own auth ' +
    '(e.g. an Authorization: Bearer header) when fetching it.',
  params: stopRecordingParams,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(args, caller) {
    const groupId = encodeURIComponent(args.groupId);
    answerOf(await invokeApi(caller, { method: 'POST', path: `/recordings/${groupId}/stop` }));
    return { proofBundleUrl: `${callerOrigin(caller)}/xenon/api/recordings/${groupId}/bundle.zip` };
  },
});
