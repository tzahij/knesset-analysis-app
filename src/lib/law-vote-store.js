const path = require("path");

const { resolveMemberByName } = require("./member-registry");
const { LawVoteClient } = require("./law-vote-client");
const {
  ensureDirectory,
  fileExists,
  formatDateParts,
  normalizeSearchText,
  readJson,
  toErrorMessage,
  writeJson,
} = require("./utils");

const LAW_VOTE_CACHE_VERSION = 1;
const LAW_MATCH_MAX_DAYS = 90;
const RECENT_ERROR_LIMIT = 8;

function normalizeVoteTitle(value) {
  return normalizeSearchText(
    String(value || "")
      .normalize("NFKC")
      .replace(/[“”„‟"׳״']/g, "")
      .replace(/[–—−]/g, "-"),
  );
}

function parseDateValue(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnlyString(date) {
  if (!date) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const nextDate = new Date(date.getTime());
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function differenceInDays(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(Math.round((left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000)));
}

function extractPossibleKnessetNumbers(laws) {
  const numbers = new Set();

  for (const law of laws) {
    for (const document of law.documents || []) {
      const match = String(document.fileUrl || "").match(/fs\.knesset\.gov\.il\/(\d+)\//);

      if (match) {
        numbers.add(Number(match[1]));
      }
    }
  }

  return Array.from(numbers).filter(Number.isFinite);
}

function normalizeVoteHeader(entry) {
  const voteDate = entry.VoteDate || null;
  const dateParts = formatDateParts(voteDate);

  return {
    voteId: String(entry.VoteId),
    voteDate,
    voteDateStr: entry.VoteDateStr || dateParts.shortDateLabel,
    voteTimeStr: entry.VoteTimeStr || dateParts.timeLabel || "",
    voteType: entry.VoteType || "",
    itemTitle: entry.ItemTitle || "",
    normalizedTitle: normalizeVoteTitle(entry.ItemTitle || ""),
    knessetId: Number(entry.KnessetId || 0) || null,
    sessionId: entry.SessionId ? String(entry.SessionId) : null,
    dateSortValue: parseDateValue(voteDate)?.getTime() || 0,
  };
}

function classifyVoteBucket(title) {
  const normalizedTitle = String(title || "").trim();

  if (normalizedTitle.includes("בעד")) {
    return "for";
  }

  if (normalizedTitle.includes("נגד")) {
    return "against";
  }

  if (normalizedTitle.includes("נמנע")) {
    return "abstained";
  }

  if (normalizedTitle.includes("נוכח")) {
    return "present";
  }

  return "other";
}

function buildEmptyVoteGroups() {
  return {
    for: [],
    against: [],
    abstained: [],
    present: [],
    other: [],
  };
}

function normalizeVoteDetailRow(entry) {
  const member = resolveMemberByName(entry.MkName || "");

  return {
    rawName: entry.MkName || "",
    displayName: member?.name || entry.MkName || "",
    partyName: entry.FactionName || member?.partyName || "",
    resultTitle: entry.Title || "",
    resultId: Number(entry.VoteResultId || 0) || null,
    routeSlug: member?.routeSlug || null,
    member: member
      ? {
          name: member.name,
          partyName: member.partyName,
          routeSlug: member.routeSlug,
        }
      : null,
  };
}

function normalizeVoteDetailsPayload(headerEntry, payload, pdfUrl) {
  const voteHeader = Array.isArray(payload.VoteHeader) ? payload.VoteHeader[0] || {} : {};
  const counters = Array.isArray(payload.VoteCounters)
    ? payload.VoteCounters.map((counter) => ({
        title: counter.Title || "",
        count: Number(counter.countOfResult || 0) || 0,
        order: Number(counter.rn || 0) || null,
        colorName: counter.ColorName || "",
      }))
    : [];
  const groups = buildEmptyVoteGroups();

  for (const detail of Array.isArray(payload.VoteDetails) ? payload.VoteDetails : []) {
    const normalizedDetail = normalizeVoteDetailRow(detail);
    groups[classifyVoteBucket(normalizedDetail.resultTitle)].push(normalizedDetail);
  }

  return {
    voteId: String(headerEntry.voteId),
    voteDate: voteHeader.VoteDate || headerEntry.voteDate,
    voteDateStr: voteHeader.VoteDateStr || headerEntry.voteDateStr,
    voteTimeStr: voteHeader.VoteTimeStr || headerEntry.voteTimeStr,
    voteType: voteHeader.VoteType || headerEntry.voteType,
    voteTypeId: Number(voteHeader.VoteTypeId || 0) || null,
    itemTitle: voteHeader.ItemTitle || headerEntry.itemTitle,
    decision: voteHeader.Decision || "",
    acceptedText: voteHeader.AcceptedText || "",
    chairmanName: voteHeader.ChairmanName || "",
    sessionNumber: Number(voteHeader.SessionNumber || 0) || null,
    isForAccepted: Boolean(voteHeader.IsForAccepted),
    counters,
    groups,
    pdfUrl: typeof pdfUrl === "string" ? pdfUrl : null,
    fetchedAt: new Date().toISOString(),
  };
}

function isThirdReadingAcceptance(voteRecord) {
  const text = `${voteRecord.decision || ""} ${voteRecord.acceptedText || ""}`;

  if (!/קריאה\s+שלישית/u.test(text)) {
    return false;
  }

  if (/להכנה\s+לקריאה/u.test(text)) {
    return false;
  }

  return true;
}

function createNoMatchRecord(law, options = {}) {
  return {
    billId: String(law.billId),
    lawTitle: law.title,
    publicationDate: law.publicationDate,
    status: "unmatched",
    matchedAt: new Date().toISOString(),
    searchWindow: options.searchWindow || null,
    candidateCount: Number(options.candidateCount || 0),
    reason: options.reason || "No accepted third-reading vote was matched to this law.",
    vote: null,
    cacheKey: `${law.billId}::${law.publicationDate || ""}::${normalizeVoteTitle(law.title)}`,
  };
}

function createErrorRecord(law, error, options = {}) {
  return {
    billId: String(law.billId),
    lawTitle: law.title,
    publicationDate: law.publicationDate,
    status: "error",
    matchedAt: new Date().toISOString(),
    searchWindow: options.searchWindow || null,
    candidateCount: Number(options.candidateCount || 0),
    reason: toErrorMessage(error),
    vote: null,
    cacheKey: `${law.billId}::${law.publicationDate || ""}::${normalizeVoteTitle(law.title)}`,
  };
}

function buildLawVoteResult(law, voteRecord, options = {}) {
  return {
    billId: String(law.billId),
    lawTitle: law.title,
    publicationDate: law.publicationDate,
    status: "matched",
    matchedAt: new Date().toISOString(),
    searchWindow: options.searchWindow || null,
    candidateCount: Number(options.candidateCount || 0),
    reason: null,
    vote: voteRecord,
    cacheKey: `${law.billId}::${law.publicationDate || ""}::${normalizeVoteTitle(law.title)}`,
  };
}

class LawVoteStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = options.dataDir || path.join(this.rootDir, "data");
    this.cacheFile = path.join(this.dataDir, "law-votes.json");
    this.lawStore = options.lawStore;
    this.promotionService = options.promotionService || null;
    this.voteClient = options.voteClient || new LawVoteClient({ rootDir: this.rootDir });
    this.cache = this.createEmptyCache();
    this.initialized = false;
    this.loadPromise = null;
    this.refreshPromise = null;
    this.coveragePromise = null;
    this.refreshStatus = this.createIdleRefreshStatus();
  }

  createEmptyCache() {
    return {
      version: LAW_VOTE_CACHE_VERSION,
      updatedAt: null,
      lastWindow: null,
      totalVoteHeaders: 0,
      laws: {},
    };
  }

  createIdleRefreshStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      lastCompletedAt: null,
      totalLaws: 0,
      processedLaws: 0,
      matchedLaws: 0,
      unmatchedLaws: 0,
      failedLaws: 0,
      totalVoteHeaders: 0,
      current: null,
      recentErrors: [],
      searchWindow: null,
    };
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await ensureDirectory(this.dataDir);
    this.initialized = true;
  }

  async loadCache() {
    await this.initialize();

    if (!(await fileExists(this.cacheFile))) {
      return this.cache;
    }

    const cached = await readJson(this.cacheFile);

    if (cached.version !== LAW_VOTE_CACHE_VERSION) {
      return this.cache;
    }

    this.cache = {
      ...this.createEmptyCache(),
      ...cached,
      laws: cached.laws || {},
    };

    if (this.cache.updatedAt) {
      this.refreshStatus.lastCompletedAt = this.cache.updatedAt;
    }

    return this.cache;
  }

  async ensureLoaded() {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadCache();

    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  async persistCache() {
    this.cache.updatedAt = new Date().toISOString();
    await writeJson(this.cacheFile, this.cache);
    this.promotionService?.requestPathPromotion(path.relative(this.rootDir, this.cacheFile));
  }

  getRefreshStatus() {
    return {
      ...this.refreshStatus,
      recentErrors: [...this.refreshStatus.recentErrors],
      current: this.refreshStatus.current ? { ...this.refreshStatus.current } : null,
      searchWindow: this.refreshStatus.searchWindow ? { ...this.refreshStatus.searchWindow } : null,
    };
  }

  pushRecentError(error) {
    this.refreshStatus.recentErrors = [
      toErrorMessage(error),
      ...this.refreshStatus.recentErrors,
    ].slice(0, RECENT_ERROR_LIMIT);
  }

  getLawCacheKey(law) {
    return `${law.billId}::${law.publicationDate || ""}::${normalizeVoteTitle(law.title)}`;
  }

  shouldRefreshLawRecord(law, record, options = {}) {
    if (!law) {
      return false;
    }

    if (!record) {
      return true;
    }

    if (record.cacheKey !== this.getLawCacheKey(law)) {
      return true;
    }

    if (options.forceRefresh) {
      return true;
    }

    if (options.retryErrors && record.status === "error") {
      return true;
    }

    if (options.retryUnmatched && record.status === "unmatched") {
      return true;
    }

    return false;
  }

  async ensureCoverageForLaws(laws, options = {}) {
    await this.ensureLoaded();

    const targetLaws = (Array.isArray(laws) ? laws : []).filter((law) =>
      this.shouldRefreshLawRecord(law, this.cache.laws[String(law.billId)], options),
    );

    if (!targetLaws.length) {
      return {
        refreshedLaws: 0,
        matchedLaws: 0,
        unmatchedLaws: 0,
        failedLaws: 0,
      };
    }

    if (this.coveragePromise) {
      return this.coveragePromise;
    }

    this.coveragePromise = (async () => {
      const summary = {
        refreshedLaws: targetLaws.length,
        matchedLaws: 0,
        unmatchedLaws: 0,
        failedLaws: 0,
      };

      const result = await this.voteClient.withSession((api) =>
        this.buildVoteRecordsForLaws(api, targetLaws, {
          onLawStarted: options.onLawStarted,
          onLawProcessed: (law, record) => {
            if (record?.status === "matched") {
              summary.matchedLaws += 1;
            } else if (record?.status === "error") {
              summary.failedLaws += 1;
            } else {
              summary.unmatchedLaws += 1;
            }

            if (typeof options.onLawProcessed === "function") {
              options.onLawProcessed(law, record);
            }
          },
        }),
      );

      for (const law of targetLaws) {
        const record = result.records.get(String(law.billId)) || createNoMatchRecord(law);
        this.cache.laws[String(law.billId)] = record;
      }

      this.cache.lastWindow = result.searchWindow;
      this.cache.totalVoteHeaders = result.totalVoteHeaders;
      await this.persistCache();
      this.refreshStatus.lastCompletedAt = this.cache.updatedAt;
      this.refreshStatus.searchWindow = result.searchWindow;
      this.refreshStatus.totalVoteHeaders = result.totalVoteHeaders;

      return summary;
    })().finally(() => {
      this.coveragePromise = null;
    });

    return this.coveragePromise;
  }

  async fetchVoteHeadersForLaws(api, laws) {
    const publicationDates = laws
      .map((law) => parseDateValue(law.publicationDate))
      .filter(Boolean)
      .sort((left, right) => left - right);

    const minDate = publicationDates[0] || new Date();
    const maxDate = publicationDates[publicationDates.length - 1] || new Date();
    const searchWindow = {
      fromDate: toDateOnlyString(addDays(minDate, -21)),
      toDate: toDateOnlyString(addDays(maxDate, 7)),
    };

    const mergeHeaders = (entries) => {
      const seen = new Set();
      const merged = [];

      for (const entry of entries) {
        const voteId = String(entry.VoteId || "");

        if (!voteId || seen.has(voteId)) {
          continue;
        }

        seen.add(voteId);
        merged.push(normalizeVoteHeader(entry));
      }

      return merged;
    };

    const attempts = [];

    attempts.push(async () => {
      const payload = await api.fetchVotesHeaders({
        searchType: 2,
        fromDate: searchWindow.fromDate,
        toDate: searchWindow.toDate,
      });
      return {
        headers: mergeHeaders(Array.isArray(payload?.Table) ? payload.Table : []),
        searchWindow,
      };
    });

    for (const knessetNum of extractPossibleKnessetNumbers(laws)) {
      attempts.push(async () => {
        const payload = await api.fetchVotesHeaders({
          searchType: 2,
          knessetNum,
          fromDate: searchWindow.fromDate,
          toDate: searchWindow.toDate,
        });
        return {
          headers: mergeHeaders(Array.isArray(payload?.Table) ? payload.Table : []),
          searchWindow,
        };
      });
    }

    attempts.push(async () => {
      const payload = await api.fetchVotesHeaders({ searchType: 1 });
      const headers = mergeHeaders(Array.isArray(payload?.Table) ? payload.Table : []).filter(
        (entry) => {
          const voteDate = parseDateValue(entry.voteDate);
          return differenceInDays(voteDate, minDate) <= 120 || differenceInDays(voteDate, maxDate) <= 120;
        },
      );

      return {
        headers,
        searchWindow,
      };
    });

    let lastError = null;

    for (const attempt of attempts) {
      try {
        const result = await attempt();

        if (result.headers.length) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `Unable to fetch Knesset vote headers for the current laws: ${toErrorMessage(lastError)}`,
    );
  }

  async getVoteDetailsCached(api, voteId, detailCache) {
    if (detailCache.has(voteId)) {
      return detailCache.get(voteId);
    }

    const payload = await api.fetchVoteDetails(voteId);
    let pdfUrl = null;

    try {
      pdfUrl = await api.fetchVotePdfUrl(voteId);
    } catch {
      pdfUrl = null;
    }

    const voteHeader = Array.isArray(payload?.VoteHeader) ? payload.VoteHeader[0] || {} : {};
    const headerEntry = normalizeVoteHeader({
      VoteId: voteId,
      VoteDate: voteHeader.VoteDate,
      VoteDateStr: voteHeader.VoteDateStr,
      VoteTimeStr: voteHeader.VoteTimeStr,
      VoteType: voteHeader.VoteType,
      ItemTitle: voteHeader.ItemTitle,
      KnessetId: voteHeader.KnessetId,
      SessionId: voteHeader.SessionId,
    });
    const normalized = normalizeVoteDetailsPayload(headerEntry, payload, pdfUrl);

    detailCache.set(voteId, normalized);
    return normalized;
  }

  async matchLawToVote(api, law, headersByTitle, detailCache, searchWindow) {
    const normalizedTitle = normalizeVoteTitle(law.title);
    const lawDate = parseDateValue(law.publicationDate);
    const candidates = (headersByTitle.get(normalizedTitle) || []).filter(
      (header) => differenceInDays(parseDateValue(header.voteDate), lawDate) <= LAW_MATCH_MAX_DAYS,
    );

    if (!candidates.length) {
      return createNoMatchRecord(law, {
        searchWindow,
        reason: "No vote with the exact law title was found in the Knesset votes feed.",
      });
    }

    const candidateVotes = [];

    for (const header of candidates) {
      const voteRecord = await this.getVoteDetailsCached(api, header.voteId, detailCache);

      candidateVotes.push({
        header,
        voteRecord,
        daysFromLaw: differenceInDays(parseDateValue(header.voteDate), lawDate),
      });
    }

    const acceptedThirdReadingVotes = candidateVotes
      .filter(({ voteRecord }) => isThirdReadingAcceptance(voteRecord))
      .sort((left, right) => {
        if (left.daysFromLaw !== right.daysFromLaw) {
          return left.daysFromLaw - right.daysFromLaw;
        }

        return right.header.dateSortValue - left.header.dateSortValue;
      });

    if (!acceptedThirdReadingVotes.length) {
      return createNoMatchRecord(law, {
        searchWindow,
        candidateCount: candidates.length,
        reason: "Votes were found for this title, but none of them was clearly an accepted third-reading vote.",
      });
    }

    return buildLawVoteResult(law, acceptedThirdReadingVotes[0].voteRecord, {
      searchWindow,
      candidateCount: candidates.length,
    });
  }

  async buildVoteRecordsForLaws(api, laws, options = {}) {
    const { headers, searchWindow } = await this.fetchVoteHeadersForLaws(api, laws);
    const headersByTitle = new Map();
    const detailCache = new Map();

    for (const header of headers) {
      const bucket = headersByTitle.get(header.normalizedTitle) || [];
      bucket.push(header);
      headersByTitle.set(header.normalizedTitle, bucket);
    }

    const records = new Map();

    for (const law of laws) {
      if (typeof options.onLawStarted === "function") {
        options.onLawStarted(law);
      }

      let record;

      try {
        record = await this.matchLawToVote(api, law, headersByTitle, detailCache, searchWindow);
      } catch (error) {
        record = createErrorRecord(law, error, {
          searchWindow,
        });
      }

      records.set(String(law.billId), record);

      if (typeof options.onLawProcessed === "function") {
        options.onLawProcessed(law, record);
      }
    }

    return {
      records,
      searchWindow,
      totalVoteHeaders: headers.length,
    };
  }

  async getLawVotes(billId, options = {}) {
    await this.ensureLoaded();
    const law = await this.lawStore.getLawById(billId);

    if (!law) {
      return null;
    }

    const cached = this.cache.laws[String(law.billId)];
    const allowImplicitRefresh = Boolean(options.allowImplicitRefresh);

    if (!this.shouldRefreshLawRecord(law, cached, {
      forceRefresh: Boolean(options.forceRefresh),
      retryErrors: Boolean(options.retryErrors),
      retryUnmatched: Boolean(options.retryUnmatched),
    })) {
      return cached;
    }

    if (!options.forceRefresh && !allowImplicitRefresh) {
      return cached || createNoMatchRecord(law, {
        reason: "No cached Knesset vote breakdown is available for this law yet.",
      });
    }

    await this.ensureCoverageForLaws([law], {
      forceRefresh: Boolean(options.forceRefresh),
      retryErrors: Boolean(options.retryErrors),
      retryUnmatched: Boolean(options.retryUnmatched),
    });

    return this.cache.laws[String(law.billId)] || createNoMatchRecord(law);
  }

  getCoverageSummaryForLaws(laws, options = {}) {
    const targetLaws = (Array.isArray(laws) ? laws : []).filter((law) =>
      this.shouldRefreshLawRecord(law, this.cache.laws[String(law.billId)], options),
    );

    return {
      refreshNeededCount: targetLaws.length,
      billIdsNeedingRefresh: targetLaws.map((law) => String(law.billId)),
    };
  }

  async getAllLawVoteRecords() {
    await this.ensureLoaded();

    return Object.values(this.cache.laws || {}).map((record) => ({
      ...record,
      vote: record?.vote
        ? {
            ...record.vote,
            counters: Array.isArray(record.vote.counters)
              ? record.vote.counters.map((counter) => ({ ...counter }))
              : [],
            groups: Object.fromEntries(
              Object.entries(record.vote.groups || {}).map(([groupKey, members]) => [
                groupKey,
                Array.isArray(members) ? members.map((member) => ({ ...member })) : [],
              ]),
            ),
          }
        : null,
    }));
  }

  async runRefreshAll(forceLawRefresh) {
    await this.ensureLoaded();

    this.refreshStatus = {
      ...this.createIdleRefreshStatus(),
      status: "running",
      startedAt: this.refreshStatus.startedAt || new Date().toISOString(),
    };

    try {
      const laws = await this.lawStore.getLaws({ forceRefresh: forceLawRefresh });
      this.refreshStatus.totalLaws = laws.length;
      this.refreshStatus.current = {
        billId: null,
        title: "מתחבר לאתר ההצבעות של הכנסת",
        shortDateLabel: "",
      };

      const result = await this.voteClient.withSession((api) =>
        this.buildVoteRecordsForLaws(api, laws, {
          onLawStarted: (law) => {
            this.refreshStatus.current = {
              billId: String(law.billId),
              title: law.title,
              shortDateLabel: law.shortDateLabel,
            };
          },
          onLawProcessed: (_law, record) => {
            this.refreshStatus.processedLaws += 1;

            if (record.status === "matched") {
              this.refreshStatus.matchedLaws += 1;
            } else if (record.status === "error") {
              this.refreshStatus.failedLaws += 1;
              this.pushRecentError(record.reason);
            } else {
              this.refreshStatus.unmatchedLaws += 1;
            }
          },
        }),
      );

      const activeBillIds = new Set(laws.map((law) => String(law.billId)));

      for (const billId of Object.keys(this.cache.laws)) {
        if (!activeBillIds.has(billId)) {
          delete this.cache.laws[billId];
        }
      }

      for (const law of laws) {
        const record = result.records.get(String(law.billId)) || createNoMatchRecord(law);
        this.cache.laws[String(law.billId)] = record;
      }

      this.cache.lastWindow = result.searchWindow;
      this.cache.totalVoteHeaders = result.totalVoteHeaders;
      await this.persistCache();

      this.refreshStatus = {
        ...this.refreshStatus,
        status: "completed",
        finishedAt: new Date().toISOString(),
        lastCompletedAt: this.cache.updatedAt,
        totalVoteHeaders: result.totalVoteHeaders,
        searchWindow: result.searchWindow,
        current: null,
      };
    } catch (error) {
      this.pushRecentError(error);
      this.refreshStatus = {
        ...this.refreshStatus,
        status: "failed",
        finishedAt: new Date().toISOString(),
        current: null,
      };
    } finally {
      this.refreshPromise = null;
    }
  }

  async startRefreshAll(options = {}) {
    if (this.refreshPromise) {
      return this.getRefreshStatus();
    }

    this.refreshStatus = {
      ...this.createIdleRefreshStatus(),
      status: "running",
      startedAt: new Date().toISOString(),
      current: {
        billId: null,
        title: "מתחבר לאתר ההצבעות של הכנסת",
        shortDateLabel: "",
      },
    };
    this.refreshPromise = this.runRefreshAll(Boolean(options.forceLawRefresh));
    return this.getRefreshStatus();
  }
}

module.exports = {
  LAW_MATCH_MAX_DAYS,
  LawVoteStore,
};
