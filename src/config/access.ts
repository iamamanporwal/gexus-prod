/**
 * Where the sign-in wall sits.
 *
 * Two behaviours are always on and are not configurable, because the share
 * feature depends on them:
 *   - Viewing a shared model never requires an account.
 *   - Remixing or prompting FROM a shared model always does — it writes into
 *     someone's workspace, so there has to be a someone.
 *
 * The knob below covers the genuinely product-level question: whether a
 * first-time visitor can generate in the main app as a guest before signing
 * in.
 *
 * `false` (current): guests can generate immediately. This is what makes a
 * shared link convert — the visitor sees the thing work before being asked for
 * anything — and matches the existing anonymous-session design, where guest
 * work is preserved into the account on sign-in.
 *
 * `true`: prompting anywhere opens the sign-in dialog first. Flip this one
 * constant and the gate applies to the landing page and the editor input;
 * nothing else needs changing.
 */
export const REQUIRE_SIGN_IN_TO_GENERATE = false;
