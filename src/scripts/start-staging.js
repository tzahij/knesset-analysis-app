process.env.START_PORT = process.env.STAGING_PORT || process.env.START_PORT || "3001";
process.env.APP_ENV = process.env.APP_ENV || "staging";

require("../server");
