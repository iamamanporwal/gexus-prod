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
 * `true` (current): the landing page and the editor render in full — the
 * prompt box, the model picker, the whole surface — and a visitor can type and
 * attach images freely. The Google dialog opens when they press send. That is
 * the point: the app has to be touchable before it can be worth signing up
 * for, so the wall goes at the moment of generating, not at the door.
 *
 * `false`: guests generate immediately and are only asked to sign in when they
 * want to keep the result. Cheaper conversion, but every visitor — including
 * every crawler that executes JS — consumes generation capacity.
 *
 * Enforced in one place, `TextAreaChat.handleSubmit`, so both entry points get
 * it from the same check; `PromptView.handleGenerate` and
 * `ChatSession.handleSend` re-assert it for sends that do not come from the
 * composer.
 */
export const REQUIRE_SIGN_IN_TO_GENERATE = true;
