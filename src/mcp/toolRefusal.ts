/**
 * A tool's refusal, carrying what REST answered: its `error` code and
 * message, given to the agent as a tool error (runTool). Its own module,
 * importing nothing, so the in-process dispatchers (invokeApi.ts) can throw
 * one without loading the tool runner.
 */
export class ToolRefusal extends Error {
  constructor(
    readonly error: unknown,
    message: string,
    /** REST's status; 5xx is a failure, anything else a refusal. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ToolRefusal';
  }
}
