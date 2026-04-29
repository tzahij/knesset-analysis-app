const path = require("path");
const { LAW_AXIS_DEFINITIONS } = require("./law-analysis-service");
const { resolveMemberByName } = require("./member-registry");
const { fileExists, readJson, writeJson } = require("./utils");

const NEUTRAL_AXIS_SCORE = 5;
const MIN_SUBSTANTIATED_VOTE_COUNT = 5;

function clampAxisScore(value) {
  return Math.max(1, Math.min(10, Number(value || 0)));
}

function roundAxisBucket(value) {
  return Math.max(1, Math.min(10, Math.round(clampAxisScore(value))));
}

function formatAxisScore(value) {
  const numeric = Number(value || 0);

  if (!Number.isFinite(numeric)) {
    return "0";
  }

  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function extractLawScores(analysis) {
  return Object.fromEntries(
    LAW_AXIS_DEFINITIONS.map((axis) => [axis.key, Number(analysis?.axes?.[axis.key]?.score || 0)]),
  );
}

function getAdjustedAxisScore(score, voteDirection) {
  const numericScore = Number(score || 0);

  if (!Number.isFinite(numericScore) || numericScore < 1 || numericScore > 10) {
    return 0;
  }

  if (voteDirection === "against") {
    if (numericScore === NEUTRAL_AXIS_SCORE) {
      return NEUTRAL_AXIS_SCORE;
    }

    return clampAxisScore(11 - numericScore);
  }

  return clampAxisScore(numericScore);
}

function buildAdjustedLawScores(scores, voteDirection) {
  return Object.fromEntries(
    LAW_AXIS_DEFINITIONS.map((axis) => [axis.key, getAdjustedAxisScore(scores?.[axis.key], voteDirection)]),
  );
}

function getVoteDirectionLabel(voteDirection) {
  return voteDirection === "against" ? "נגד" : "בעד";
}

function hasCompleteLawScores(scores) {
  return LAW_AXIS_DEFINITIONS.every((axis) => {
    const value = Number(scores?.[axis.key] || 0);
    return Number.isFinite(value) && value >= 1 && value <= 10;
  });
}

function buildScoreLeanText(axis, averageScore) {
  if (averageScore >= 7.5) {
    return `נוטה באופן חד לקוטב ${axis.highLabel}`;
  }

  if (averageScore >= 5.6) {
    return `נוטה לצד ${axis.highLabel}`;
  }

  if (averageScore <= 2.5) {
    return `נוטה באופן חד לקוטב ${axis.lowLabel}`;
  }

  if (averageScore <= 4.4) {
    return `נוטה לצד ${axis.lowLabel}`;
  }

  return "נמצא באזור האמצע של הסקאלה";
}

function buildEvidenceFromLaws(laws, axis, averageScore) {
  if (!Array.isArray(laws) || !laws.length) {
    return [];
  }

  const byScoreAsc = [...laws].sort((left, right) => {
    const leftScore = Number(left.axisScores?.[axis.key] || 0);
    const rightScore = Number(right.axisScores?.[axis.key] || 0);
    return leftScore - rightScore;
  });
  let selected = [];

  if (averageScore >= 5.6) {
    selected = byScoreAsc.slice(-2).reverse();
  } else if (averageScore <= 4.4) {
    selected = byScoreAsc.slice(0, 2);
  } else {
    selected = [];

    if (byScoreAsc[0]) {
      selected.push(byScoreAsc[0]);
    }

    if (byScoreAsc[byScoreAsc.length - 1] && byScoreAsc.length > 1) {
      selected.push(byScoreAsc[byScoreAsc.length - 1]);
    }
  }

  const seen = new Set();
  return selected
    .filter((law) => {
      if (!law || seen.has(law.billId)) {
        return false;
      }

      seen.add(law.billId);
      return true;
    })
    .map((law) => ({
      protocolHeading: `${law.title}${law.shortDateLabel ? ` (${law.shortDateLabel})` : ""}`,
      quote:
        law.voteDirection === "against"
          ? `החוק דורג ${formatAxisScore(law.lawAxisScores?.[axis.key])}/10 בציר הזה, והח"כ הצביע נגדו. לכן התרומה שלו לפרופיל ההצבעות היא ${formatAxisScore(law.axisScores?.[axis.key])}/10.`
          : `החוק דורג ${formatAxisScore(law.axisScores?.[axis.key])}/10 בציר הזה, והח"כ הצביע בעדו. לכן זו גם התרומה שלו לפרופיל ההצבעות.`,
      explanation:
        law.overallSummary ||
        "החוק הזה נכלל בתוך פרופיל ההצבעות של חבר הכנסת ולכן השפיע על מיקומו בציר.",
      href: law.href,
    }));
}

function collectAxisLawSamples(countedLaws, axisKey) {
  const scoredLaws = (Array.isArray(countedLaws) ? countedLaws : [])
    .map((law) => ({
      law,
      score: Number(law?.axisScores?.[axisKey] || 0),
    }))
    .filter(({ score }) => Number.isFinite(score) && score >= 1 && score <= 10);

  const nonNeutralLaws = scoredLaws.filter(({ score }) => score !== NEUTRAL_AXIS_SCORE);
  const usedLaws = nonNeutralLaws.length ? nonNeutralLaws : scoredLaws;

  return {
    usedLaws,
    ignoredNeutralCount: nonNeutralLaws.length ? scoredLaws.length - nonNeutralLaws.length : 0,
  };
}

function buildAxisExplanation(axis, countedLaws) {
  const { usedLaws, ignoredNeutralCount } = collectAxisLawSamples(countedLaws, axis.key);
  const scores = usedLaws.map(({ score }) => score);

  if (!scores.length) {
    return null;
  }

  const averageScore = Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1));
  const leanText = buildScoreLeanText(axis, averageScore);
  const evidence = buildEvidenceFromLaws(
    usedLaws.map(({ law }) => law),
    axis,
    averageScore,
  );
  const voteDirectionCounts = (Array.isArray(countedLaws) ? countedLaws : []).reduce(
    (accumulator, law) => {
      if (law?.voteDirection === "against") {
        accumulator.against += 1;
      } else {
        accumulator.for += 1;
      }

      return accumulator;
    },
    { for: 0, against: 0 },
  );
  const dominantLaws = evidence
    .map((item) => item.protocolHeading)
    .filter(Boolean)
    .slice(0, 2);

  const explanationBullets = [
    `הציון הזה מחושב מתוך ${usedLaws.length.toLocaleString("he-IL")} חוקים רלוונטיים בציר הזה, שנכללו בפרופיל ההצבעות.`,
    `הממוצע בציר ${axis.label} הוא ${formatAxisScore(averageScore)}/10, ולכן המיקום הכולל ${leanText}.`,
  ];

  explanationBullets.push(
    `בפרופיל המלא נכללו ${voteDirectionCounts.for.toLocaleString("he-IL")} הצבעות בעד ו-${voteDirectionCounts.against.toLocaleString("he-IL")} הצבעות נגד. בהצבעה נגד, ציון החוק בציר מומר ל-11 פחות ציון החוק, חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5.`,
  );

  if (ignoredNeutralCount > 0) {
    explanationBullets.push(
      `${ignoredNeutralCount.toLocaleString("he-IL")} חוקים נוספים שקיבלו 5/10 בציר הזה לאחר חישוב כיוון ההצבעה הוצאו מהממוצע, כדי שלא יטשטשו חוקים ברורים יותר.`,
    );
  }

  if (dominantLaws.length) {
    explanationBullets.push(`בין החוקים שממחישים היטב את המיקום הזה בלטו: ${dominantLaws.join(", ")}.`);
  }

  return {
    score: averageScore,
    bucketScore: roundAxisBucket(averageScore),
    explanationBullets,
    evidence,
  };
}

function buildLawEntry(law, analysisRecord, voteDirection) {
  const lawAxisScores = extractLawScores(analysisRecord?.analysis);

  return {
    billId: String(law.billId),
    title: law.title,
    shortDateLabel: law.shortDateLabel || "",
    longDateLabel: law.longDateLabel || law.shortDateLabel || "",
    sortValue: Date.parse(law.publicationDate || "") || Date.parse(law.date || "") || 0,
    href: `/law/${encodeURIComponent(law.billId)}`,
    overallSummary: analysisRecord?.analysis?.overallSummary || "",
    voteDirection,
    voteDirectionLabel: getVoteDirectionLabel(voteDirection),
    lawAxisScores,
    axisScores: buildAdjustedLawScores(lawAxisScores, voteDirection),
  };
}

function getVoteProfileCount(profile) {
  return Number(profile?.countedLawCount ?? profile?.supportedLawCount ?? 0);
}

function hasInsufficientVoteCoverage(profile) {
  return getVoteProfileCount(profile) < MIN_SUBSTANTIATED_VOTE_COUNT;
}

function isLowSubstantiationVoteProfile(profile) {
  const countedLawCount = getVoteProfileCount(profile);
  return countedLawCount > 0 && countedLawCount < MIN_SUBSTANTIATED_VOTE_COUNT;
}

function buildVoteProfileSubstantiationWarning(memberName, countedLawCount) {
  if (!(countedLawCount > 0 && countedLawCount < MIN_SUBSTANTIATED_VOTE_COUNT)) {
    return "";
  }

  const subject = memberName ? `פרופיל ההצבעות של ${memberName}` : "פרופיל ההצבעות";
  return `${subject} נשען כרגע רק על ${countedLawCount.toLocaleString(
    "he-IL",
  )} הצבעות על חוקים. זה מעט מדי כדי לבסס פרופיל יציב, ולכן צריך לקרוא את התוצאות בזהירות.`;
}

function buildVoteProfileSubstantiationMeta(memberName, countedLawCount) {
  return {
    minimumSubstantiatedVoteCount: MIN_SUBSTANTIATED_VOTE_COUNT,
    hasInsufficientVoteCoverage: countedLawCount < MIN_SUBSTANTIATED_VOTE_COUNT,
    isLowSubstantiation: countedLawCount > 0 && countedLawCount < MIN_SUBSTANTIATED_VOTE_COUNT,
    substantiationWarning: buildVoteProfileSubstantiationWarning(memberName, countedLawCount),
  };
}

function buildMemberVoteSummary(memberName, countedLawCount) {
  const baseSummary = `פרופיל זה נשען על ${countedLawCount.toLocaleString(
    "he-IL",
  )} חוקים שבהם ${memberName} הצביע בעד או נגד ושיש להם גם מפת הצבעה וגם ניתוח צירים. בהצבעה נגד, ציון החוק בציר מומר ל-11 פחות ציון החוק, חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5; ובכל ציר מוציאים מהממוצע ציוני 5/10 ניטרליים כשיש חוקים רלוונטיים יותר.`;
  const warning = buildVoteProfileSubstantiationWarning(memberName, countedLawCount);
  return warning ? `${baseSummary} ${warning}` : baseSummary;
}

function buildDenseRankMap(items) {
  const rankBySlug = new Map();
  let previousScore = null;
  let currentRank = 0;

  items.forEach((item, index) => {
    if (previousScore === null || item.score !== previousScore) {
      currentRank = index + 1;
      previousScore = item.score;
    }

    rankBySlug.set(item.slug, currentRank);
  });

  return rankBySlug;
}

function assignVoteAxisRankings(profilesBySlug) {
  const profiles = Array.from(profilesBySlug.values());

  for (const axis of LAW_AXIS_DEFINITIONS) {
    const scoredProfiles = profiles
      .map((profile) => ({
        slug: profile.slug,
        name: profile.name,
        axisRecord: profile.axes?.[axis.key] || null,
        score: Number(profile.axes?.[axis.key]?.score || 0),
      }))
      .filter(
        (item) => item.axisRecord && Number.isFinite(item.score) && item.score >= 1 && item.score <= 10,
      );

    if (!scoredProfiles.length) {
      continue;
    }

    const byHighPole = [...scoredProfiles].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return String(left.name || "").localeCompare(String(right.name || ""), "he");
    });
    const byLowPole = [...scoredProfiles].sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return String(left.name || "").localeCompare(String(right.name || ""), "he");
    });

    const highRankBySlug = buildDenseRankMap(byHighPole);
    const lowRankBySlug = buildDenseRankMap(byLowPole);
    const totalMembers = scoredProfiles.length;

    for (const item of scoredProfiles) {
      item.axisRecord.voteRanking = {
        totalMembers,
        overallRank: highRankBySlug.get(item.slug) || totalMembers,
        towardLowRank: lowRankBySlug.get(item.slug) || totalMembers,
        towardHighRank: highRankBySlug.get(item.slug) || totalMembers,
      };
    }
  }
}

function createEmptyProfile(member) {
  return {
    slug: member.slug,
    routeSlug: member.id || member.slug,
    name: member.name,
    partyName: member.partyName || "",
    sourceLabel: "פרופיל הצבעות",
    countedLawCount: 0,
    countedLaws: [],
    supportedLawCount: 0,
    supportedLaws: [],
    summary: "",
    axes: {},
    ...buildVoteProfileSubstantiationMeta(member.name, 0),
  };
}

function compactProfileForSnapshot(profile) {
  return {
    slug: profile.slug,
    routeSlug: profile.routeSlug,
    name: profile.name,
    partyName: profile.partyName,
    sourceLabel: profile.sourceLabel,
    countedLawCount: profile.countedLawCount,
    supportedLawCount: profile.supportedLawCount,
    summary: profile.summary,
    axes: profile.axes,
    minimumSubstantiatedVoteCount: Number(profile.minimumSubstantiatedVoteCount || MIN_SUBSTANTIATED_VOTE_COUNT),
    hasInsufficientVoteCoverage: Boolean(profile.hasInsufficientVoteCoverage),
    isLowSubstantiation: Boolean(profile.isLowSubstantiation),
    substantiationWarning: profile.substantiationWarning || "",
  };
}

function resolveVoteItemMember(voteItem, memberMap) {
  const routeCandidates = [voteItem?.routeSlug, voteItem?.member?.routeSlug].filter(Boolean);

  for (const routeCandidate of routeCandidates) {
    const member = memberMap.get(routeCandidate);

    if (member) {
      return member;
    }
  }

  const nameCandidates = [voteItem?.member?.name, voteItem?.displayName, voteItem?.rawName].filter(Boolean);

  for (const nameCandidate of nameCandidates) {
    const resolved = resolveMemberByName(nameCandidate);

    if (!resolved) {
      continue;
    }

    const member =
      memberMap.get(resolved.routeSlug || resolved.id || resolved.slug) ||
      memberMap.get(resolved.slug) ||
      null;

    if (member) {
      return member;
    }
  }

  return null;
}

class MemberVoteProfileService {
  constructor(options = {}) {
    this.lawStore = options.lawStore;
    this.lawVoteStore = options.lawVoteStore;
    this.lawAnalysisService = options.lawAnalysisService;
    this.memberProtocolService = options.memberProtocolService;
    this.dataDir = options.dataDir || path.join(process.cwd(), "data");
    this.snapshotPath =
      options.snapshotPath || path.join(this.dataDir, "member-vote-profiles.snapshot.json");
    this.cachedResult = null;
    this.cachedSignature = null;
    this.buildPromise = null;
    this.persistedSnapshot = null;
    this.persistedSnapshotLoaded = false;
  }

  async loadPersistedSnapshot() {
    if (this.persistedSnapshotLoaded) {
      return this.persistedSnapshot;
    }

    this.persistedSnapshotLoaded = true;

    if (!(await fileExists(this.snapshotPath))) {
      return null;
    }

    try {
      const payload = await readJson(this.snapshotPath);
      const entries = Array.isArray(payload?.profiles) ? payload.profiles : [];

      this.persistedSnapshot = {
        generatedAt: payload?.generatedAt || null,
        signature: payload?.signature || null,
        summary: payload?.summary || {},
        profilesBySlug: new Map(entries.map((profile) => [profile.slug, profile])),
      };
    } catch (error) {
      console.warn("Unable to read persisted member vote profiles:", error?.message || String(error));
    }

    return this.persistedSnapshot;
  }

  async persistSnapshot(result, signature) {
    const payload = {
      generatedAt: result.generatedAt,
      signature,
      summary: result.summary,
      profiles: Array.from(result.profilesBySlug.values()).map(compactProfileForSnapshot),
    };

    await writeJson(this.snapshotPath, payload);
    this.persistedSnapshot = {
      generatedAt: payload.generatedAt,
      signature: payload.signature,
      summary: payload.summary,
      profilesBySlug: new Map(payload.profiles.map((profile) => [profile.slug, profile])),
    };
    this.persistedSnapshotLoaded = true;
  }

  buildSignature(laws) {
    const lawMetadata = this.lawStore?.getMetadataInfo?.() || {};
    const voteStatus = this.lawVoteStore?.getRefreshStatus?.() || {};
    const analysisStatus = this.lawAnalysisService?.getBulkStatus?.() || {};

    return JSON.stringify({
      lawCount: Array.isArray(laws) ? laws.length : 0,
      lawBillIds: Array.isArray(laws) ? laws.map((law) => String(law.billId)) : [],
      lawSyncedAt: lawMetadata.syncedAt || null,
      voteUpdatedAt: voteStatus.lastCompletedAt || null,
      analysisUpdatedAt: analysisStatus.lastCompletedAt || null,
    });
  }

  async buildProfiles() {
    const laws = await this.lawStore.getLaws();
    await this.lawVoteStore.ensureLoaded();
    const voteCoverage = this.lawVoteStore.getCoverageSummaryForLaws(laws, {
      retryErrors: true,
      retryUnmatched: true,
    });

    const signature = this.buildSignature(laws);

    if (this.cachedResult && this.cachedSignature === signature) {
      return this.cachedResult;
    }

    if (this.buildPromise) {
      return this.buildPromise;
    }

    this.buildPromise = (async () => {
      const voteRecords = await this.lawVoteStore.getAllLawVoteRecords();
      const voteRecordMap = new Map(voteRecords.map((record) => [String(record.billId), record]));
      const memberMap = new Map();

      for (const member of this.memberProtocolService.members || []) {
        memberMap.set(member.slug, member);
        memberMap.set(member.routeSlug || member.id || member.slug, member);
        memberMap.set(member.id || member.slug, member);
      }

      const profilesBySlug = new Map();
      let profiledLawCount = 0;
      let countedVotesCount = 0;

      for (const law of laws) {
        const voteRecord = voteRecordMap.get(String(law.billId));

        if (voteRecord?.status !== "matched" || !voteRecord.vote) {
          continue;
        }

        const analysisRecord = await this.lawAnalysisService.getLawAnalysisRecord(law.billId);
        const lawScores = extractLawScores(analysisRecord?.analysis);

        if (!analysisRecord?.analysis || !hasCompleteLawScores(lawScores)) {
          continue;
        }

        const voteGroups = [
          {
            direction: "for",
            items: Array.isArray(voteRecord.vote.groups?.for) ? voteRecord.vote.groups.for : [],
          },
          {
            direction: "against",
            items: Array.isArray(voteRecord.vote.groups?.against) ? voteRecord.vote.groups.against : [],
          },
        ].filter((group) => group.items.length);

        if (!voteGroups.length) {
          continue;
        }

        profiledLawCount += 1;
        for (const voteGroup of voteGroups) {
          const lawEntry = buildLawEntry(law, analysisRecord, voteGroup.direction);

          for (const voteItem of voteGroup.items) {
            const member = resolveVoteItemMember(voteItem, memberMap);

            if (!member) {
              continue;
            }

            if (!profilesBySlug.has(member.slug)) {
              profilesBySlug.set(member.slug, {
                ...createEmptyProfile(member),
                _lawIds: new Set(),
              });
            }

            const profile = profilesBySlug.get(member.slug);

            if (profile._lawIds.has(lawEntry.billId)) {
              continue;
            }

            profile._lawIds.add(lawEntry.billId);
            countedVotesCount += 1;
            profile.countedLaws.push({ ...lawEntry });
          }
        }
      }

      for (const profile of profilesBySlug.values()) {
        profile.countedLaws.sort((left, right) => {
          if ((right.sortValue || 0) !== (left.sortValue || 0)) {
            return (right.sortValue || 0) - (left.sortValue || 0);
          }

          return String(left.title || "").localeCompare(String(right.title || ""), "he");
        });
        profile.countedLawCount = profile.countedLaws.length;
        profile.supportedLawCount = profile.countedLawCount;
        profile.supportedLaws = profile.countedLaws;
        profile.summary = buildMemberVoteSummary(profile.name, profile.countedLawCount);
        profile.axes = Object.fromEntries(
          LAW_AXIS_DEFINITIONS.map((axis) => [axis.key, buildAxisExplanation(axis, profile.countedLaws)]),
        );
        Object.assign(profile, buildVoteProfileSubstantiationMeta(profile.name, profile.countedLawCount));
        delete profile._lawIds;
      }

      assignVoteAxisRankings(profilesBySlug);

      const result = {
        generatedAt: new Date().toISOString(),
        summary: {
          profiledLawCount,
          countedVotesCount,
          supportVotesCount: countedVotesCount,
          availableMembers: profilesBySlug.size,
          missingVoteCoverageCount: voteCoverage.refreshNeededCount,
          billIdsMissingVoteCoverage: voteCoverage.billIdsNeedingRefresh,
        },
        profilesBySlug,
      };

      this.cachedResult = result;
      this.cachedSignature = signature;
      await this.persistSnapshot(result, signature);
      return result;
    })().finally(() => {
      this.buildPromise = null;
    });

    return this.buildPromise;
  }

  async getMemberVoteProfile(slug, options = {}) {
    const member = this.memberProtocolService.resolveMember(slug);

    if (!member) {
      return null;
    }

    const data = await this.buildProfiles();
    const fullProfile = data.profilesBySlug.get(member.slug);

    if (!fullProfile) {
      return {
        ...createEmptyProfile(member),
        generatedAt: data.generatedAt,
        status: "missing",
        missingVoteCoverageCount: Number(data.summary?.missingVoteCoverageCount || 0),
        billIdsMissingVoteCoverage: Array.isArray(data.summary?.billIdsMissingVoteCoverage)
          ? [...data.summary.billIdsMissingVoteCoverage]
          : [],
      };
    }

    const lawLimit =
      Number.isFinite(Number(options.lawLimit)) && Number(options.lawLimit) > 0
        ? Number(options.lawLimit)
        : null;

    return {
      ...fullProfile,
      generatedAt: data.generatedAt,
      status: "ready",
      missingVoteCoverageCount: Number(data.summary?.missingVoteCoverageCount || 0),
      billIdsMissingVoteCoverage: Array.isArray(data.summary?.billIdsMissingVoteCoverage)
        ? [...data.summary.billIdsMissingVoteCoverage]
        : [],
      countedLaws: lawLimit ? fullProfile.countedLaws.slice(0, lawLimit) : [...fullProfile.countedLaws],
      totalCountedLaws: fullProfile.countedLawCount,
      supportedLaws: lawLimit ? fullProfile.supportedLaws.slice(0, lawLimit) : [...fullProfile.supportedLaws],
      totalSupportedLaws: fullProfile.supportedLawCount,
    };
  }

  async getStoredMemberVoteProfile(slug) {
    const member = this.memberProtocolService.resolveMember(slug);

    if (!member) {
      return null;
    }

    if (this.cachedResult?.profilesBySlug instanceof Map) {
      const cachedProfile = this.cachedResult.profilesBySlug.get(member.slug);

      if (cachedProfile) {
        return {
          ...cachedProfile,
          generatedAt: this.cachedResult.generatedAt || null,
          status: "ready",
        };
      }
    }

    await this.loadPersistedSnapshot();
    const fullProfile = this.persistedSnapshot?.profilesBySlug?.get(member.slug) || null;

    if (!fullProfile) {
      return {
        ...createEmptyProfile(member),
        generatedAt: this.persistedSnapshot?.generatedAt || null,
        status: "missing",
      };
    }

    return {
      ...fullProfile,
      generatedAt: this.persistedSnapshot?.generatedAt || null,
      status: "ready",
    };
  }

  async getSummary() {
    const data = await this.buildProfiles();
    return {
      generatedAt: data.generatedAt,
      ...data.summary,
    };
  }
}

module.exports = {
  MIN_SUBSTANTIATED_VOTE_COUNT,
  MemberVoteProfileService,
  buildVoteProfileSubstantiationMeta,
  buildVoteProfileSubstantiationWarning,
  getVoteProfileCount,
  hasInsufficientVoteCoverage,
  isLowSubstantiationVoteProfile,
};
