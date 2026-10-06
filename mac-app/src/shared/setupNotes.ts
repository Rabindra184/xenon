/** Step id main reports for the go-ios installer; the renderer matches on it. */
export const GO_IOS_STEP = 'install-go-ios';

/**
 * What setup tells the user when the installed Xenon plugin has no go-ios
 * installer, so real iPhones can't be set up from here. Main emits it as the
 * detail of a finished, ok go-ios step; the renderer compares against it to show
 * a warning instead of a tick. Lives in shared/ (no Node imports) so both sides
 * use one string.
 */
export const GO_IOS_SKIP_NOTE =
  "This Xenon version can't set up iPhones from here. Update Xenon, then run Set up again.";
