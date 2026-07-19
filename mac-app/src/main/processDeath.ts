// Whether a GPU / renderer / utility process death is worth flagging as a
// possible hang. It only is when it happens WHILE THE APP IS RUNNING.
//
// During app teardown (Cmd-Q, logout, restart) the parent SIGTERMs its whole
// child tree — renderer, GPU and utility all die together with reason='killed'.
// That is not a GPU stall; it's normal shutdown. The first diagnostics build
// logged exactly such a teardown ("Renderer process gone" + "type=GPU", all
// reason=killed exitCode=15, within 0.12s) and it nearly got read as a
// confirmed GPU crash. Gate it out.
//
// A real GPU compositor stall is the GPU process dying *alone* (renderer
// survives, app keeps running) — reason 'crashed'/'oom'/'launch-failed'/…, or
// 'killed' by the OS watchdog *while the app is not quitting*. Those still pass.
export function isReportableProcessDeath(reason: string, isQuitting: boolean): boolean {
  if (isQuitting) return false; // app is tearing its own process tree down
  if (reason === 'clean-exit') return false; // orderly, expected
  return true;
}
