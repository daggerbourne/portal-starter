import { register } from "node:module";
import { renderGallery } from "../../gallery/gallery.mjs";

register(new URL("../../gallery/gallery-loader.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { startupRefusal } = await import("../../../core/startup-guard/startup-guard.js");

export const config = {
  path: "/portal-starter/dev/gallery",
  nodeBundler: "none",
  includedFiles: [
    "../../../ui/**",
    "../../gallery/**/*.mjs",
    "../../../contracts/**",
    "../../../core/startup-guard/**",
  ],
};

export default function gallery() {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return refused;
  return renderGallery({ deployContext: process.env.APP_DEPLOY_CONTEXT });
}
