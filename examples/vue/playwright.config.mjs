import { defineConfig } from "@playwright/test";

const url = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: url, channel: "msedge" },
  webServer: {
    command: "npm exec -- vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url,
    reuseExistingServer: false,
  },
});
