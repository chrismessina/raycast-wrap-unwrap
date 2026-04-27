// src/wrap-text.ts
import { getPreferenceValues } from "@raycast/api";
import {
  type BaseLaunchContext,
  NoTextError,
  OversizeError,
  deliver,
  failureToast,
  guardSize,
  parseWidth,
  readContent,
  type LaunchProps,
} from "./lib/pipeline.js";
import { wrap } from "./lib/wrap.js";

type WrapContext = BaseLaunchContext & {
  width?: number;
};

export default async function Command(
  props: LaunchProps<{ launchContext?: WrapContext }>,
) {
  const prefs = getPreferenceValues<Preferences.WrapText>();
  try {
    const input =
      props.launchContext?.text ?? (await readContent(prefs.source));
    guardSize(input);
    const width = props.launchContext?.width ?? parseWidth(prefs.width);
    const result = wrap(input, { width });
    await deliver({
      launchContext: props.launchContext,
      prefs: {
        action: prefs.action,
        hideHUD: prefs.hideHUD,
        popToRoot: prefs.popToRoot,
      },
      result,
      noun: "wrapped",
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
      await failureToast("Failed to wrap text", message);
    }
  }
}
