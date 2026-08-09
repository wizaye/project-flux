import { definePlugin } from "../../plugin-sdk/src/index";

export default definePlugin({
  activate(context) {
    context.capabilities.has("vault.read");
  },
});
