if (process.env.STAGING_PORT && !process.env.SHARE_PORT) {
  process.env.SHARE_PORT = process.env.STAGING_PORT;
}

require("./cloudflare-quick-tunnel");
