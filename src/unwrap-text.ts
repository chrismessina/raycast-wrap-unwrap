// src/unwrap-text.ts
import { getPreferenceValues } from "@raycast/api";
import {
  type BaseLaunchContext,
  NoTextError,
  OversizeError,
  deliver,
  failureToast,
  guardSize,
  readContent,
  type LaunchProps,
} from "./lib/pipeline.js";
import { unwrap } from "./lib/unwrap.js";

type UnwrapContext = BaseLaunchContext & {
  hyphenation?: boolean;
  keepBlankLines?: boolean;
};

export default async function Command(
  props: LaunchProps<{ launchContext?: UnwrapContext }>,
) {
  const prefs = getPreferenceValues<Preferences.UnwrapText>();
  try {
    const input =
      props.launchContext?.text ?? (await readContent(prefs.source));
    guardSize(input);
    const hyphenation = props.launchContext?.hyphenation ?? prefs.hyphenation;
    const keepBlankLines =
      props.launchContext?.keepBlankLines ?? prefs.keepBlankLines;
    const result = unwrap(input, { hyphenation, keepBlankLines });
    await deliver({
      launchContext: props.launchContext,
      prefs: {
        action: prefs.action,
        hideHUD: prefs.hideHUD,
        popToRoot: prefs.popToRoot,
      },
      result,
      noun: "unwrapped",
    });
  } catch (error) {
    if (error instanceof NoTextError) {
      await failureToast(
        "No text available",
        "Select text or copy it to the clipboard.",
      );
    } else if (error instanceof OversizeError) {
      await failureToast(
        "Text exceeds 1MB limit",
        "Use a text editor for documents this large.",
      );
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      await failureToast("Failed to unwrap text", message);
    }
  }
}
