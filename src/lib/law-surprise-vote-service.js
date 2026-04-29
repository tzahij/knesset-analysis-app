const { LAW_AXIS_DEFINITIONS } = require("./law-analysis-service");
const { hasInsufficientVoteCoverage, MIN_SUBSTANTIATED_VOTE_COUNT } = require("./member-vote-profile-service");
const { mapWithConcurrency } = require("./utils");

const SURPRISE_THRESHOLD = 7;
const MEMBER_ANALYSIS_SOURCE_TYPE = "small";

function extractLawScores(analysis) {
  const axes = analysis?.axes || {};

  return Object.fromEntries(
    LAW_AXIS_DEFINITIONS.map((axis) => [axis.key, Number(axes[axis.key]?.score || 0)]),
  );
}

function extractMemberScores(analysis) {
  const axes = analysis?.quantitativeAnalysis?.textBased || {};

  return Object.fromEntries(
    LAW_AXIS_DEFINITIONS.map((axis) => [axis.key, Number(axes[axis.key]?.score || 0)]),
  );
}

function hasCompleteScores(scores) {
  return LAW_AXIS_DEFINITIONS.every((axis) => Number.isFinite(scores[axis.key]) && scores[axis.key] >= 1);
}

class LawSurpriseVoteService {
  constructor(options = {}) {
    this.lawStore = options.lawStore;
    this.lawVoteStore = options.lawVoteStore;
    this.lawAnalysisService = options.lawAnalysisService;
    this.memberAnalysisService = options.memberAnalysisService;
    this.memberVoteProfileService = options.memberVoteProfileService || null;
  }

  buildMethodology() {
    return [
      "הבדיקה משתמשת רק בחוקים שהושלמו עבורם גם ניתוח חוק וגם התאמת הצבעה במליאה.",
      "לכל חבר כנסת נלקחים רק ציוני הניתוח הכמותי על סמך הטקסט מתוך ניתוח הפרופיל המבוסס על הקובץ הקטן.",
      `הצבעה מסומנת כמפתיעה רק אם חבר הכנסת הצביע בעד, למרות פער של ${SURPRISE_THRESHOLD} נקודות או יותר לפחות באחד מארבעת הצירים בין החוק לבין החבר.`,
      `חברי כנסת עם פחות מ-${MIN_SUBSTANTIATED_VOTE_COUNT.toLocaleString("he-IL")} הצבעות על חוקים בפרופיל ההצבעות אינם נכללים ברשימת ההצבעות המפתיעות, כי הפרופיל שלהם עדיין לא מבוסס היטב.`,
      "חברי כנסת ללא ניתוח פרופיל קטן זמין או ללא ציונים מלאים אינם נכללים בבדיקה.",
    ];
  }

  async getLawSurprisingVotes(billId) {
    const law = await this.lawStore.getLawById(billId);

    if (!law) {
      return null;
    }

    const [lawAnalysisRecord, lawVotesRecord] = await Promise.all([
      this.lawAnalysisService.getLawAnalysisRecord(billId),
      this.lawVoteStore.getLawVotes(billId),
    ]);

    if (!lawAnalysisRecord?.analysis) {
      return {
        status: "missing_law_analysis",
        threshold: SURPRISE_THRESHOLD,
        sourceType: MEMBER_ANALYSIS_SOURCE_TYPE,
        methodology: this.buildMethodology(),
        summary: {
          consideredSupportVotes: 0,
          skippedMissingMemberAnalysis: 0,
          skippedLowVoteCoverage: 0,
          surprisingSupportVotes: 0,
          againstVotesNotFlaggedByRule: 0,
        },
        surprisingVotes: [],
      };
    }

    if (lawVotesRecord?.status !== "matched" || !lawVotesRecord.vote) {
      return {
        status: "missing_vote_breakdown",
        threshold: SURPRISE_THRESHOLD,
        sourceType: MEMBER_ANALYSIS_SOURCE_TYPE,
        methodology: this.buildMethodology(),
        summary: {
          consideredSupportVotes: 0,
          skippedMissingMemberAnalysis: 0,
          skippedLowVoteCoverage: 0,
          surprisingSupportVotes: 0,
          againstVotesNotFlaggedByRule: 0,
        },
        surprisingVotes: [],
      };
    }

    const lawScores = extractLawScores(lawAnalysisRecord.analysis);
    const supportVotes = Array.isArray(lawVotesRecord.vote.groups?.for) ? lawVotesRecord.vote.groups.for : [];
    const againstVotes = Array.isArray(lawVotesRecord.vote.groups?.against)
      ? lawVotesRecord.vote.groups.against
      : [];
    const memberRecordCache = new Map();
    const memberVoteProfileCache = new Map();
    let skippedMissingMemberAnalysis = 0;
    let skippedLowVoteCoverage = 0;

    const surprisingVotes = (
      await mapWithConcurrency(supportVotes, 6, async (voteItem) => {
        if (!voteItem.routeSlug) {
          skippedMissingMemberAnalysis += 1;
          return null;
        }

        if (this.memberVoteProfileService) {
          let voteProfile = memberVoteProfileCache.get(voteItem.routeSlug);

          if (!voteProfile) {
            voteProfile = await this.memberVoteProfileService.getStoredMemberVoteProfile(voteItem.routeSlug);
            memberVoteProfileCache.set(voteItem.routeSlug, voteProfile);
          }

          if (hasInsufficientVoteCoverage(voteProfile)) {
            skippedLowVoteCoverage += 1;
            return null;
          }
        }

        let memberAnalysisRecord = memberRecordCache.get(voteItem.routeSlug);

        if (!memberAnalysisRecord) {
          memberAnalysisRecord = await this.memberAnalysisService.getMemberAnalysisRecord(
            voteItem.routeSlug,
            MEMBER_ANALYSIS_SOURCE_TYPE,
          );
          memberRecordCache.set(voteItem.routeSlug, memberAnalysisRecord);
        }

        if (!memberAnalysisRecord?.analysis) {
          skippedMissingMemberAnalysis += 1;
          return null;
        }

        const memberScores = extractMemberScores(memberAnalysisRecord.analysis);

        if (!hasCompleteScores(memberScores)) {
          skippedMissingMemberAnalysis += 1;
          return null;
        }

        const axisDiffs = LAW_AXIS_DEFINITIONS.map((axis) => {
          const lawScore = lawScores[axis.key];
          const memberScore = memberScores[axis.key];
          return {
            key: axis.key,
            label: axis.label,
            lowLabel: axis.lowLabel,
            highLabel: axis.highLabel,
            lawScore,
            memberScore,
            difference: Math.abs(lawScore - memberScore),
          };
        });
        const surpriseAxes = axisDiffs.filter((axis) => axis.difference >= SURPRISE_THRESHOLD);

        if (!surpriseAxes.length) {
          return null;
        }

        return {
          memberName: voteItem.displayName,
          partyName: voteItem.partyName || voteItem.member?.partyName || "",
          routeSlug: voteItem.routeSlug,
          voteDirection: "for",
          voteLabel: "בעד",
          sourceType: MEMBER_ANALYSIS_SOURCE_TYPE,
          sourceLabel: "קובץ קטן",
          maximumDifference: Math.max(...surpriseAxes.map((axis) => axis.difference)),
          surpriseAxes,
          allAxisDiffs: axisDiffs,
        };
      })
    )
      .filter(Boolean)
      .sort((left, right) => right.maximumDifference - left.maximumDifference);

    return {
      status: "ready",
      threshold: SURPRISE_THRESHOLD,
      sourceType: MEMBER_ANALYSIS_SOURCE_TYPE,
      methodology: this.buildMethodology(),
      summary: {
        consideredSupportVotes: supportVotes.length,
        skippedMissingMemberAnalysis,
        skippedLowVoteCoverage,
        surprisingSupportVotes: surprisingVotes.length,
        againstVotesNotFlaggedByRule: againstVotes.length,
      },
      surprisingVotes,
    };
  }

  async getLawsWithSurprisingVotes() {
    const laws = await this.lawStore.getLaws();
    let failedLaws = 0;

    const items = (
      await mapWithConcurrency(laws, 4, async (law) => {
        try {
          const payload = await this.getLawSurprisingVotes(law.billId);

          if (!payload || payload.status !== "ready" || !payload.surprisingVotes.length) {
            return null;
          }

          return {
            ...law,
            surprisingVoteCount: payload.surprisingVotes.length,
            maximumDifference: Math.max(
              ...payload.surprisingVotes.map((vote) => Number(vote.maximumDifference) || 0),
            ),
            topSurprisingMembers: payload.surprisingVotes.slice(0, 3).map((vote) => ({
              memberName: vote.memberName,
              partyName: vote.partyName,
              routeSlug: vote.routeSlug,
              maximumDifference: vote.maximumDifference,
            })),
          };
        } catch {
          failedLaws += 1;
          return null;
        }
      })
    ).filter(Boolean);

    return {
      status: "ready",
      threshold: SURPRISE_THRESHOLD,
      sourceType: MEMBER_ANALYSIS_SOURCE_TYPE,
      methodology: this.buildMethodology(),
      summary: {
        totalLaws: laws.length,
        lawsWithSurprisingVotes: items.length,
        totalSurprisingVotes: items.reduce(
          (sum, item) => sum + Number(item.surprisingVoteCount || 0),
          0,
        ),
        failedLaws,
      },
      items,
    };
  }
}

module.exports = {
  LawSurpriseVoteService,
  SURPRISE_THRESHOLD,
};
