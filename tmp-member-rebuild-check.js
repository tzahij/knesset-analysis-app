const { MemberProtocolService } = require('./src/lib/member-protocol-service');
const { ProtocolStore } = require('./src/lib/protocol-store');
const { CommitteeProtocolStore } = require('./src/lib/committee-protocol-store');

(async () => {
  const svc = new MemberProtocolService({ protocolStore: new ProtocolStore(), committeeProtocolStore: new CommitteeProtocolStore() });
  await svc.initialize();
  const targets = ['בני גנץ', 'יואב סגלוביץ\'', 'יאסר חג\'יראת', 'ירון לוי'];
  const results = [];
  for (const targetName of targets) {
    const member = svc.members.find((entry) => entry.name === targetName);
    if (!member) continue;
    const status = await svc.ensureMemberUtteranceFileReady(member.id || member.slug, 'full');
    results.push({
      name: targetName,
      status: status?.status || null,
      protocolCount: status?.protocolCount || null,
      utteranceCount: status?.utteranceCount || null,
      generatedAt: status?.generatedAt || null,
    });
  }
  console.log(JSON.stringify(results, null, 2));
})();
