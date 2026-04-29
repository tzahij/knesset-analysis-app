const fs = require("fs");
const profile = JSON.parse(fs.readFileSync("profile.cpuprofile", "utf8"));
const timeByNode = {};

// Count samples per node
for (const sample of profile.samples) {
  timeByNode[sample] = (timeByNode[sample] || 0) + 1;
}

// Sort nodes by sample count descending
const sortedNodes = Object.entries(timeByNode).sort((a, b) => b[1] - a[1]);

console.log("Top 10 CPU Consuming Functions:");
for (let i = 0; i < Math.min(10, sortedNodes.length); i++) {
  const nodeId = sortedNodes[i][0];
  const count = sortedNodes[i][1];
  const node = profile.nodes.find((n) => n.id == nodeId);
  if (node) {
    console.log(`${count} samples: ${node.callFrame.functionName || "(anonymous)"} at ${node.callFrame.url || "(unknown)"}:${node.callFrame.lineNumber}`);
  }
}
