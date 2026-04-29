const inspector = require("inspector");
const fs = require("fs");
const session = new inspector.Session();
session.connect();

session.post("Profiler.enable", () => {
  session.post("Profiler.start", () => {
    // Start the server
    require("./src/server.js");

    // Stop profiling after 5 seconds and save the result
    setTimeout(() => {
      session.post("Profiler.stop", (err, { profile }) => {
        if (!err) {
          fs.writeFileSync("./profile.cpuprofile", JSON.stringify(profile));
          console.log("Profile saved to profile.cpuprofile");
        } else {
          console.error("Profiler stop error:", err);
        }
        process.exit(0);
      });
    }, 5000);
  });
});
