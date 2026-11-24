// Switches for the landing page. Edit this file when the rest of the console changes.
export const CONFIG = {
  // true once app/twin/index.js exists and createTwin(host, ctx, { interactive: false, camera: 'cinematic' }) works.
  // While false the live mission is drawn as a plan view by landing/command.js. "?twin=1" or "?twin=0" in the address overrides it.
  twin: true,
  // The 2 to 4 minute video. Leave null until there is a real address; the link is hidden while it is null.
  video: null,
  code: 'https://github.com/rishith-c/hound-ultra',
};
