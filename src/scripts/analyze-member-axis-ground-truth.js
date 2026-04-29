const fs = require("fs/promises");
const path = require("path");

const { LawStore } = require("../lib/law-store");
const { LawVoteStore } = require("../lib/law-vote-store");
const { MemberProtocolService } = require("../lib/member-protocol-service");
const { MemberVoteProfileService } = require("../lib/member-vote-profile-service");
const { LAW_AXIS_DEFINITIONS } = require("../lib/law-analysis-service");

const DEFAULT_SOURCE_TYPE = "small";
const DEFAULT_PERMUTATION_ITERATIONS = 50000;
const DEFAULT_BOOTSTRAP_ITERATIONS = 20000;
const DEFAULT_SEED = 20260403;

function parseArgs(argv) {
  const options = {
    sourceType: DEFAULT_SOURCE_TYPE,
    write: false,
    permutationIterations: DEFAULT_PERMUTATION_ITERATIONS,
    bootstrapIterations: DEFAULT_BOOTSTRAP_ITERATIONS,
    seed: DEFAULT_SEED,
  };

  for (const argument of argv) {
    if (argument === "--write") {
      options.write = true;
      continue;
    }

    if (argument.startsWith("--sourceType=")) {
      const value = String(argument.split("=")[1] || "").trim().toLowerCase();
      options.sourceType = value === "full" ? "full" : "small";
      continue;
    }

    if (argument.startsWith("--permutations=")) {
      const value = Number(argument.split("=")[1]);

      if (Number.isFinite(value) && value > 0) {
        options.permutationIterations = Math.floor(value);
      }

      continue;
    }

    if (argument.startsWith("--bootstraps=")) {
      const value = Number(argument.split("=")[1]);

      if (Number.isFinite(value) && value > 0) {
        options.bootstrapIterations = Math.floor(value);
      }

      continue;
    }

    if (argument.startsWith("--seed=")) {
      const value = Number(argument.split("=")[1]);

      if (Number.isFinite(value)) {
        options.seed = Math.floor(value);
      }
    }
  }

  return options;
}

function mulberry32(seed) {
  let state = seed >>> 0;

  return function nextRandom() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function mean(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || !sortedValues.length) {
    return null;
  }

  const position = (sortedValues.length - 1) * p;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function bootstrapMeanDifference(differences, iterations, random) {
  if (!differences.length) {
    return null;
  }

  const distribution = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;

    for (let index = 0; index < differences.length; index += 1) {
      const sampleIndex = Math.floor(random() * differences.length);
      sum += differences[sampleIndex];
    }

    distribution.push(sum / differences.length);
  }

  distribution.sort((left, right) => left - right);

  return {
    low: round(percentile(distribution, 0.025)),
    high: round(percentile(distribution, 0.975)),
  };
}

function permutationPValue(differences, iterations, random) {
  if (!differences.length) {
    return null;
  }

  const observed = Math.abs(mean(differences));
  let extremeCount = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;

    for (const difference of differences) {
      sum += (random() < 0.5 ? 1 : -1) * difference;
    }

    const statistic = Math.abs(sum / differences.length);

    if (statistic >= observed - 1e-12) {
      extremeCount += 1;
    }
  }

  return round((extremeCount + 1) / (iterations + 1), 6);
}

function pearsonCorrelation(leftValues, rightValues) {
  if (
    !Array.isArray(leftValues) ||
    !Array.isArray(rightValues) ||
    leftValues.length !== rightValues.length ||
    leftValues.length < 2
  ) {
    return null;
  }

  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < leftValues.length; index += 1) {
    const leftDiff = leftValues[index] - leftMean;
    const rightDiff = rightValues[index] - rightMean;

    numerator += leftDiff * rightDiff;
    leftVariance += leftDiff * leftDiff;
    rightVariance += rightDiff * rightDiff;
  }

  if (!leftVariance || !rightVariance) {
    return null;
  }

  return numerator / Math.sqrt(leftVariance * rightVariance);
}

function averageRanks(values, options = {}) {
  const items = values.map((value, index) => ({ value, index }));
  const descending = Boolean(options.descending);

  items.sort((left, right) => (descending ? right.value - left.value : left.value - right.value));

  const ranks = new Array(values.length);
  let startIndex = 0;

  while (startIndex < items.length) {
    let endIndex = startIndex + 1;

    while (endIndex < items.length && items[endIndex].value === items[startIndex].value) {
      endIndex += 1;
    }

    const rank = (startIndex + 1 + endIndex) / 2;

    for (let index = startIndex; index < endIndex; index += 1) {
      ranks[items[index].index] = rank;
    }

    startIndex = endIndex;
  }

  return ranks;
}

function spearmanCorrelation(leftValues, rightValues) {
  if (leftValues.length < 2 || leftValues.length !== rightValues.length) {
    return null;
  }

  return pearsonCorrelation(averageRanks(leftValues), averageRanks(rightValues));
}

function pairwiseAccuracy(rows, predictionKey) {
  if (!rows.length) {
    return null;
  }

  let correct = 0;
  let total = 0;

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const voteDiff = rows[leftIndex].votes - rows[rightIndex].votes;

      if (voteDiff === 0) {
        continue;
      }

      const predictionDiff = rows[leftIndex][predictionKey] - rows[rightIndex][predictionKey];
      total += 1;

      if (predictionDiff === 0) {
        correct += 0.5;
        continue;
      }

      if (
        (voteDiff > 0 && predictionDiff > 0) ||
        (voteDiff < 0 && predictionDiff < 0)
      ) {
        correct += 1;
      }
    }
  }

  return total ? correct / total : null;
}

function rankMae(rows, predictionKey) {
  if (!rows.length) {
    return null;
  }

  const voteRanks = averageRanks(
    rows.map((row) => row.votes),
    { descending: true },
  );
  const predictionRanks = averageRanks(
    rows.map((row) => row[predictionKey]),
    { descending: true },
  );

  return mean(voteRanks.map((voteRank, index) => Math.abs(predictionRanks[index] - voteRank)));
}

function summarizeRows(rows) {
  if (!rows.length) {
    return {
      count: 0,
    };
  }

  const explicitErrors = rows.map((row) => Math.abs(row.explicit - row.votes));
  const implicitErrors = rows.map((row) => Math.abs(row.implicit - row.votes));
  const explicitMinusImplicit = explicitErrors.map(
    (explicitError, index) => explicitError - implicitErrors[index],
  );

  return {
    count: rows.length,
    explicitMae: round(mean(explicitErrors)),
    implicitMae: round(mean(implicitErrors)),
    maeDifferenceExplicitMinusImplicit: round(mean(explicitMinusImplicit)),
    explicitRmse: round(Math.sqrt(mean(rows.map((row) => (row.explicit - row.votes) ** 2)))),
    implicitRmse: round(Math.sqrt(mean(rows.map((row) => (row.implicit - row.votes) ** 2)))),
    explicitWithin1: round(explicitErrors.filter((error) => error <= 1).length / explicitErrors.length),
    implicitWithin1: round(implicitErrors.filter((error) => error <= 1).length / implicitErrors.length),
    explicitExact: round(explicitErrors.filter((error) => error === 0).length / explicitErrors.length),
    implicitExact: round(implicitErrors.filter((error) => error === 0).length / implicitErrors.length),
    explicitSpearman: round(
      spearmanCorrelation(
        rows.map((row) => row.explicit),
        rows.map((row) => row.votes),
      ),
    ),
    implicitSpearman: round(
      spearmanCorrelation(
        rows.map((row) => row.implicit),
        rows.map((row) => row.votes),
      ),
    ),
    explicitPairwiseAccuracy: round(pairwiseAccuracy(rows, "explicit")),
    implicitPairwiseAccuracy: round(pairwiseAccuracy(rows, "implicit")),
    explicitRankMae: round(rankMae(rows, "explicit")),
    implicitRankMae: round(rankMae(rows, "implicit")),
    wins: rows.reduce(
      (accumulator, row) => {
        const explicitError = Math.abs(row.explicit - row.votes);
        const implicitError = Math.abs(row.implicit - row.votes);

        if (explicitError < implicitError) {
          accumulator.explicit += 1;
        } else if (implicitError < explicitError) {
          accumulator.implicit += 1;
        } else {
          accumulator.tie += 1;
        }

        return accumulator;
      },
      { explicit: 0, implicit: 0, tie: 0 },
    ),
  };
}

async function loadMemberAnalysisManifests(rootDir, sourceType) {
  const analysisDir = path.join(rootDir, "data", "member-analyses");
  const files = await fs.readdir(analysisDir);
  const manifests = [];

  for (const file of files) {
    const isWantedFile =
      sourceType === "small"
        ? file.endsWith(".json") && file.includes("__analysis-small__")
        : file.endsWith(".json") && file.includes("__analysis__") && !file.includes("__analysis-small__");

    if (!isWantedFile) {
      continue;
    }

    const fullPath = path.join(analysisDir, file);
    const rawContent = await fs.readFile(fullPath, "utf8");
    const manifest = JSON.parse(rawContent);

    if (
      !manifest?.memberSlug ||
      !manifest?.analysis?.quantitativeAnalysis?.textBased ||
      !manifest?.analysis?.quantitativeAnalysis?.betweenTheLines
    ) {
      continue;
    }

    manifests.push({
      file,
      path: fullPath,
      manifest,
    });
  }

  return manifests;
}

async function countAnalysisFiles(rootDir) {
  const analysisDir = path.join(rootDir, "data", "member-analyses");
  const files = await fs.readdir(analysisDir);

  return {
    full: files.filter(
      (file) => file.endsWith(".json") && file.includes("__analysis__") && !file.includes("__analysis-small__"),
    ).length,
    small: files.filter((file) => file.endsWith(".json") && file.includes("__analysis-small__")).length,
  };
}

async function buildSimpleLawAnalysisService(rootDir) {
  const analysisDir = path.join(rootDir, "data", "law-analyses");
  const files = await fs.readdir(analysisDir);
  const recordsByBillId = new Map();
  let lastCompletedAt = null;

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const fullPath = path.join(analysisDir, file);
    const rawContent = await fs.readFile(fullPath, "utf8");
    const manifest = JSON.parse(rawContent);

    if (!manifest?.billId || !manifest?.analysis?.axes) {
      continue;
    }

    recordsByBillId.set(String(manifest.billId), {
      analysis: manifest.analysis,
    });

    if (manifest.generatedAt && (!lastCompletedAt || manifest.generatedAt > lastCompletedAt)) {
      lastCompletedAt = manifest.generatedAt;
    }
  }

  return {
    async getLawAnalysisRecord(billId) {
      return recordsByBillId.get(String(billId)) || null;
    },
    getBulkStatus() {
      return { lastCompletedAt };
    },
  };
}

async function buildMatchedDataset(rootDir, sourceType) {
  const [analysisCounts, memberAnalysisEntries, simpleLawAnalysisService] = await Promise.all([
    countAnalysisFiles(rootDir),
    loadMemberAnalysisManifests(rootDir, sourceType),
    buildSimpleLawAnalysisService(rootDir),
  ]);

  const memberAnalysesBySlug = new Map(
    memberAnalysisEntries.map((entry) => [entry.manifest.memberSlug, entry]),
  );

  const lawStore = new LawStore({ rootDir });
  const lawVoteStore = new LawVoteStore({ rootDir, lawStore });
  const memberProtocolService = new MemberProtocolService({ rootDir });
  const memberVoteProfileService = new MemberVoteProfileService({
    lawStore,
    lawVoteStore,
    lawAnalysisService: simpleLawAnalysisService,
    memberProtocolService,
  });

  const voteData = await memberVoteProfileService.buildProfiles();
  const rowsByAxis = Object.fromEntries(LAW_AXIS_DEFINITIONS.map((axis) => [axis.key, []]));
  const matchedMembers = [];
  const unmatchedAnalysisSlugs = [];

  for (const [slug, entry] of memberAnalysesBySlug.entries()) {
    const voteProfile = voteData.profilesBySlug.get(slug);

    if (!voteProfile) {
      unmatchedAnalysisSlugs.push(slug);
      continue;
    }

    const perAxis = {};
    let hasCompleteAxisSet = true;

    for (const axis of LAW_AXIS_DEFINITIONS) {
      const explicit = Number(
        entry.manifest.analysis?.quantitativeAnalysis?.textBased?.[axis.key]?.score || 0,
      );
      const implicit = Number(
        entry.manifest.analysis?.quantitativeAnalysis?.betweenTheLines?.[axis.key]?.score || 0,
      );
      const votes = Number(voteProfile.axes?.[axis.key]?.score || 0);

      if (
        !Number.isFinite(explicit) ||
        !Number.isFinite(implicit) ||
        !Number.isFinite(votes) ||
        explicit < 1 ||
        explicit > 10 ||
        implicit < 1 ||
        implicit > 10 ||
        votes < 1 ||
        votes > 10
      ) {
        hasCompleteAxisSet = false;
        break;
      }

      const row = {
        slug,
        name: entry.manifest.memberName,
        partyName: entry.manifest.partyName,
        explicit,
        implicit,
        votes,
      };

      rowsByAxis[axis.key].push(row);
      perAxis[axis.key] = row;
    }

    if (!hasCompleteAxisSet) {
      continue;
    }

    matchedMembers.push({
      slug,
      name: entry.manifest.memberName,
      partyName: entry.manifest.partyName,
      perAxis,
    });
  }

  return {
    analysisCounts,
    memberAnalysisCount: memberAnalysisEntries.length,
    voteProfileCount: voteData.profilesBySlug.size,
    matchedMembers,
    unmatchedAnalysisSlugs,
    rowsByAxis,
  };
}

function buildReport(results) {
  const sourceLabel = results.sourceType === "full" ? "full quotes" : "small quotes";
  const overallWinner =
    results.memberLevel.meanErrorDifferenceExplicitMinusImplicit < 0 ? "explicit quotes" : "between-the-lines";
  const overallImprovement = Math.abs(
    (results.overall.implicitMae - results.overall.explicitMae) / results.overall.implicitMae,
  );

  const lines = [
    "# Member Axis Ground-Truth Analysis",
    "",
    `- Generated at: ${results.generatedAt}`,
    `- Source type analyzed: ${sourceLabel}`,
    `- Available member-analysis files: ${results.availableAnalysisFiles.small} small, ${results.availableAnalysisFiles.full} full`,
    `- Member analyses used: ${results.memberAnalysisCount}`,
    `- Vote profiles available: ${results.voteProfileCount}`,
    `- Matched MKs with all three signals: ${results.matchedMembers}`,
    "",
    "## Verdict",
    "",
    `${overallWinner} are closer to vote-based ground truth overall in this dataset.`,
    `On mean absolute error, explicit quotes score ${results.overall.explicitMae} versus ${results.overall.implicitMae} for between-the-lines, a ${round(overallImprovement * 100, 2)}% relative improvement.`,
    `At the member level, the mean error difference (explicit minus implicit) is ${results.memberLevel.meanErrorDifferenceExplicitMinusImplicit} with a 95% bootstrap CI of [${results.memberLevel.ci.low}, ${results.memberLevel.ci.high}] and a paired permutation p-value of ${results.memberLevel.pValue}.`,
    "",
    "## Overall Metrics",
    "",
    `- Explicit MAE: ${results.overall.explicitMae}`,
    `- Implicit MAE: ${results.overall.implicitMae}`,
    `- Explicit Spearman: ${results.overall.explicitSpearman}`,
    `- Implicit Spearman: ${results.overall.implicitSpearman}`,
    `- Explicit pairwise accuracy: ${results.overall.explicitPairwiseAccuracy}`,
    `- Implicit pairwise accuracy: ${results.overall.implicitPairwiseAccuracy}`,
    `- Explicit rank MAE: ${results.overall.explicitRankMae}`,
    `- Implicit rank MAE: ${results.overall.implicitRankMae}`,
    `- Member-level wins: explicit ${results.memberLevel.wins.explicit}, implicit ${results.memberLevel.wins.implicit}, tie ${results.memberLevel.wins.tie}`,
    "",
    "## Axis Breakdown",
    "",
  ];

  for (const axis of results.axes) {
    lines.push(`### ${axis.label}`);
    lines.push("");
    lines.push(`- Explicit MAE: ${axis.metrics.explicitMae}`);
    lines.push(`- Implicit MAE: ${axis.metrics.implicitMae}`);
    lines.push(`- Explicit Spearman: ${axis.metrics.explicitSpearman}`);
    lines.push(`- Implicit Spearman: ${axis.metrics.implicitSpearman}`);
    lines.push(`- Explicit pairwise accuracy: ${axis.metrics.explicitPairwiseAccuracy}`);
    lines.push(`- Implicit pairwise accuracy: ${axis.metrics.implicitPairwiseAccuracy}`);
    lines.push(
      `- Mean member-level error difference (explicit minus implicit): ${axis.memberLevel.meanDifference} | 95% CI [${axis.memberLevel.ci.low}, ${axis.memberLevel.ci.high}] | p=${axis.memberLevel.pValue}`,
    );
    lines.push("");
  }

  lines.push("## Biggest Explicit Advantages");
  lines.push("");

  for (const row of results.memberLevel.topExplicitAdvantages) {
    lines.push(
      `- ${row.name} (${row.partyName}): explicit ${row.explicitAvgMae}, implicit ${row.implicitAvgMae}, difference ${row.explicitMinusImplicit}`,
    );
  }

  lines.push("");
  lines.push("## Biggest Implicit Advantages");
  lines.push("");

  for (const row of results.memberLevel.topImplicitAdvantages) {
    lines.push(
      `- ${row.name} (${row.partyName}): explicit ${row.explicitAvgMae}, implicit ${row.implicitAvgMae}, difference ${row.explicitMinusImplicit}`,
    );
  }

  lines.push("");

  if (results.sourceType === "small" && results.availableAnalysisFiles.full < 20) {
    lines.push("## Note");
    lines.push("");
    lines.push(
      `Only ${results.availableAnalysisFiles.full} full-analysis files currently exist, so the evaluation uses the small-quotes analyses to avoid a distorted sample.`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

async function writeOutputs(rootDir, sourceType, results, reportMarkdown) {
  const baseName = `member-axis-ground-truth-${sourceType}`;
  const jsonPath = path.join(rootDir, "data", `${baseName}.json`);
  const markdownPath = path.join(rootDir, "data", `${baseName}.md`);

  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(results, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownPath, `${reportMarkdown}\n`, "utf8"),
  ]);

  return {
    jsonPath,
    markdownPath,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(__dirname, "..", "..");
  const dataset = await buildMatchedDataset(rootDir, options.sourceType);
  const overallRows = LAW_AXIS_DEFINITIONS.flatMap((axis) => dataset.rowsByAxis[axis.key]);
  const memberLevelDifferences = dataset.matchedMembers.map((member) =>
    mean(
      LAW_AXIS_DEFINITIONS.map(
        (axis) =>
          Math.abs(member.perAxis[axis.key].explicit - member.perAxis[axis.key].votes) -
          Math.abs(member.perAxis[axis.key].implicit - member.perAxis[axis.key].votes),
      ),
    ),
  );
  const bootstrapRandom = mulberry32(options.seed);
  const permutationRandom = mulberry32(options.seed + 1);
  const memberScores = dataset.matchedMembers.map((member) => {
    const explicitAvgMae = mean(
      LAW_AXIS_DEFINITIONS.map((axis) =>
        Math.abs(member.perAxis[axis.key].explicit - member.perAxis[axis.key].votes),
      ),
    );
    const implicitAvgMae = mean(
      LAW_AXIS_DEFINITIONS.map((axis) =>
        Math.abs(member.perAxis[axis.key].implicit - member.perAxis[axis.key].votes),
      ),
    );

    return {
      slug: member.slug,
      name: member.name,
      partyName: member.partyName,
      explicitAvgMae: round(explicitAvgMae),
      implicitAvgMae: round(implicitAvgMae),
      explicitMinusImplicit: round(explicitAvgMae - implicitAvgMae),
    };
  });

  const axes = LAW_AXIS_DEFINITIONS.map((axis, index) => {
    const rows = dataset.rowsByAxis[axis.key];
    const memberDifferences = rows.map(
      (row) => Math.abs(row.explicit - row.votes) - Math.abs(row.implicit - row.votes),
    );

    return {
      key: axis.key,
      label: axis.label,
      lowLabel: axis.lowLabel,
      highLabel: axis.highLabel,
      metrics: summarizeRows(rows),
      memberLevel: {
        meanDifference: round(mean(memberDifferences)),
        ci: bootstrapMeanDifference(
          memberDifferences,
          options.bootstrapIterations,
          mulberry32(options.seed + 10 + index),
        ),
        pValue: permutationPValue(
          memberDifferences,
          options.permutationIterations,
          mulberry32(options.seed + 20 + index),
        ),
      },
    };
  });

  const overallMetrics = summarizeRows(overallRows);

  overallMetrics.explicitSpearman = round(mean(axes.map((axis) => axis.metrics.explicitSpearman)));
  overallMetrics.implicitSpearman = round(mean(axes.map((axis) => axis.metrics.implicitSpearman)));
  overallMetrics.explicitPairwiseAccuracy = round(
    mean(axes.map((axis) => axis.metrics.explicitPairwiseAccuracy)),
  );
  overallMetrics.implicitPairwiseAccuracy = round(
    mean(axes.map((axis) => axis.metrics.implicitPairwiseAccuracy)),
  );
  overallMetrics.explicitRankMae = round(mean(axes.map((axis) => axis.metrics.explicitRankMae)));
  overallMetrics.implicitRankMae = round(mean(axes.map((axis) => axis.metrics.implicitRankMae)));

  const results = {
    generatedAt: new Date().toISOString(),
    sourceType: options.sourceType,
    seed: options.seed,
    permutationIterations: options.permutationIterations,
    bootstrapIterations: options.bootstrapIterations,
    availableAnalysisFiles: dataset.analysisCounts,
    memberAnalysisCount: dataset.memberAnalysisCount,
    voteProfileCount: dataset.voteProfileCount,
    matchedMembers: dataset.matchedMembers.length,
    unmatchedAnalysisCount: dataset.unmatchedAnalysisSlugs.length,
    overall: overallMetrics,
    memberLevel: {
      meanErrorDifferenceExplicitMinusImplicit: round(mean(memberLevelDifferences)),
      ci: bootstrapMeanDifference(
        memberLevelDifferences,
        options.bootstrapIterations,
        bootstrapRandom,
      ),
      pValue: permutationPValue(
        memberLevelDifferences,
        options.permutationIterations,
        permutationRandom,
      ),
      wins: memberScores.reduce(
        (accumulator, row) => {
          if (row.explicitAvgMae < row.implicitAvgMae) {
            accumulator.explicit += 1;
          } else if (row.implicitAvgMae < row.explicitAvgMae) {
            accumulator.implicit += 1;
          } else {
            accumulator.tie += 1;
          }

          return accumulator;
        },
        { explicit: 0, implicit: 0, tie: 0 },
      ),
      topExplicitAdvantages: [...memberScores]
        .sort((left, right) => left.explicitMinusImplicit - right.explicitMinusImplicit)
        .slice(0, 10),
      topImplicitAdvantages: [...memberScores]
        .sort((left, right) => right.explicitMinusImplicit - left.explicitMinusImplicit)
        .slice(0, 10),
    },
    axes,
  };

  const reportMarkdown = buildReport(results);
  let outputPaths = null;

  if (options.write) {
    outputPaths = await writeOutputs(rootDir, options.sourceType, results, reportMarkdown);
  }

  const output = {
    ...results,
    outputPaths,
    reportMarkdown,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
