const path = require("path");

const { LAW_AXIS_DEFINITIONS } = require("./law-analysis-service");
const { SURPRISE_THRESHOLD } = require("./law-surprise-vote-service");
const { LAW_MATCH_MAX_DAYS } = require("./law-vote-store");
const {
  MIN_MEMBER_UTTERANCE_WORDS,
  SMALL_UTTERANCE_PROTOCOL_LIMIT,
} = require("./member-protocol-service");
const {
  COMPARISON_DEFINITIONS,
  MIN_COMPARISON_UTTERANCE_WORDS,
  MIN_MEMBER_WORDS_FOR_COMPARISON,
} = require("./member-comparison-service");
const { KNOW_YOUR_MK_VIEW_CONFIG } = require("./landing-page-service");
const { MEMBER_PROTOCOL_SINCE_DATE } = require("./member-registry");
const { ensureDirectory, fileExists, readJson, writeJson } = require("./utils");

const COMMITTEE_WINDOW_YEARS = 5;
const LANDING_RECENT_PROTOCOL_SCAN_LIMIT = 28;
const METHODOLOGY_SNAPSHOT_FILENAME = "methodology-documentation.json";
const DOCUMENTATION_GENERATION_PROMPT = `מטרה:
ליצור מסמך מתודולוגיה ציבורי, ברור ומפורט, שמסביר איך האתר אוסף, שומר, מעבד ומציג את הנתונים והתוצרים שהוא מציג למשתמשים.

דרישות מחייבות:
- לכתוב בעברית פשוטה, נגישה ולא טכנית מדי.
- להסתמך על הקוד הפעיל בפועל, על הקבועים שבו, על נתיבי הנתונים, ועל מודלי ה-LLM שמחוברים במערכת.
- לחלק את המסמך לפרקים נפרדים לפי סוגי התוצרים באתר.
- בכל פרק להסביר:
  - מאיפה מגיע המידע
  - איפה הוא נשמר
  - אילו שלבי עיבוד הוא עובר
  - האם מעורב LLM או לא
  - איפה התוצר מופיע באתר
- להוסיף רשימות תבליטים ותרשימי זרימה קצרים וקלים להבנה.
- לכלול פרק נפרד של פרומפטים, עם:
  - שם התוצר
  - ספק ה-LLM
  - שם המודל
  - הקלטים
  - הפלטים
  - הפרומפט עצמו
- לכלול גם את הפרומפט שמגדיר איך מסמך המתודולוגיה הזה צריך להיווצר.
- לציין את תאריך יצירת המסמך.

גבולות:
- לא לכלול מנגנונים שלא חשופים כרגע באתר הציבורי.
- לא להמציא שלבים או מקורות מידע שלא מופיעים בקוד.
- לא לסכם באופן כללי מדי; כל הסבר צריך להיות קשור לרכיב אמיתי במערכת.`;

const generatedAtFormatter = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Jerusalem",
});

function formatGeneratedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "לא זמין" : generatedAtFormatter.format(date);
}

function wrapGeminiPrompt(instructions) {
  return `הנחיות:\n${instructions}\n\nחומר לניתוח:\n<הקלט שנבנה במיוחד עבור המשימה הזאת>`;
}

async function readItemCount(filePath) {
  if (!(await fileExists(filePath))) {
    return 0;
  }

  try {
    const payload = await readJson(filePath);
    return Array.isArray(payload?.items) ? payload.items.length : 0;
  } catch {
    return 0;
  }
}

class MethodologyService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = path.join(this.rootDir, "data");
    this.snapshotPath = path.join(this.dataDir, METHODOLOGY_SNAPSHOT_FILENAME);
    this.memberProtocolService = options.memberProtocolService;
    this.memberAnalysisService = options.memberAnalysisService;
    this.memberComparisonService = options.memberComparisonService;
    this.lawAnalysisService = options.lawAnalysisService;
    this.lawSurpriseExplanationService = options.lawSurpriseExplanationService;
    this.snapshotPromise = null;
  }

  async buildSnapshotCards() {
    const [plenumCount, committeeCount, lawCount] = await Promise.all([
      readItemCount(path.join(this.dataDir, "protocols.json")),
      readItemCount(path.join(this.dataDir, "committee-protocols.json")),
      readItemCount(path.join(this.dataDir, "laws.json")),
    ]);

    return [
      { label: "פרוטוקולי מליאה במטמון", value: plenumCount.toLocaleString("he-IL") },
      { label: "פרוטוקולי ועדות במטמון", value: committeeCount.toLocaleString("he-IL") },
      { label: "חוקים במטמון", value: lawCount.toLocaleString("he-IL") },
      {
        label: "חברי כנסת ברשימה",
        value: this.memberProtocolService.members.length.toLocaleString("he-IL"),
      },
      {
        label: "מדדי השוואה בקוד",
        value: COMPARISON_DEFINITIONS.length.toLocaleString("he-IL"),
      },
      { label: "סף הפתעה", value: `${SURPRISE_THRESHOLD}/10` },
    ];
  }

  buildOverviewSection(generatedDateLabel) {
    return {
      id: "overview",
      navLabel: "מבט כללי",
      eyebrow: "סקירה",
      title: "איך האתר עובד מאחורי הקלעים",
      intro:
        "העמוד הזה מסביר, בשפה פשוטה, איך המידע מגיע לאתר, איך הוא נשמר, מתי הוא מחושב רק בקוד, ומתי מופעל מודל שפה.",
      bullets: [
        `התיעוד הזה נוצר ב-${generatedDateLabel} מתוך הלוגיקה הפעילה כרגע בקוד.`,
        "לרוב יש חמישה שלבים: מקור רשמי -> שמירה מקומית -> פענוח/עיבוד -> ניתוח -> תצוגה.",
        "לא כל תוצר עובר דרך LLM: חלק מהמסכים באתר הם דטרמיניסטיים לגמרי.",
      ],
      cards: [
        {
          title: "המסלול הכללי של רוב התוצרים",
          description: "כך חומר רשמי של הכנסת נהפך למסך קריא באתר.",
          flow: {
            title: "הצינור הראשי",
            steps: [
              { title: "מקור רשמי", detail: "פידי OData, אתר ההצבעות, וקבצי Word/PDF רשמיים." },
              { title: "שמירה", detail: "קבצים ו-JSON נשמרים מקומית תחת data." },
              { title: "עיבוד", detail: "פענוח טקסט, ניקוי, חלוקה לפסקאות, התאמות שמות ואינדקסים." },
              { title: "ניתוח", detail: "או קוד קשיח, או Gemini עם סכמת JSON קשיחה." },
              { title: "תצוגה", detail: "העמודים הציבוריים קוראים את הפלט מה-API ומציגים אותו." },
            ],
          },
        },
      ],
    };
  }

  buildProtocolsSection() {
    return {
      id: "protocols",
      navLabel: "פרוטוקולים",
      eyebrow: "מקורות",
      title: "פרוטוקולי המליאה והוועדות",
      intro:
        "לפרוטוקולים יש שני מסלולי איסוף: אחד לישיבות המליאה ואחד לישיבות הוועדות. שניהם מסתיימים בטקסט מפוענח לפסקאות.",
      cards: [
        {
          title: "פרוטוקולי מליאה",
          description: "מיפוי מלא של ישיבות המליאה, עם עמוד קריאה והורדת קובץ מקור.",
          sources: [
            "פיד OData: KNS_DocumentPlenumSession",
            "קובצי מקור: fs.knesset.gov.il",
          ],
          outputs: ["רשימת ישיבות מליאה", "עמוד קריאה", "הורדת קובץ מקורי"],
          bullets: [
            "המטא-דאטה נשמר במאגר מטא-דאטה שרתי.",
            "הקבצים הגולמיים נשמרים באחסון שרתי פנימי.",
            "הטקסט המפוענח נשמר במאגר טקסטים שרתי.",
          ],
          flow: {
            title: "מליאה: מטא-דאטה -> קובץ -> טקסט",
            steps: [
              { title: "שליפת מטא-דאטה", detail: "מזהה מסמך, תאריך, שעה ומספר ישיבה." },
              { title: "הורדת קובץ", detail: "שמירה מקומית של הקובץ הרשמי." },
              { title: "פענוח", detail: "חילוץ טקסט DOC/DOCX וניקוי רעש טכני." },
              { title: "חלוקה לפסקאות", detail: "שמירת JSON של פסקאות לשימוש בעמוד הקריאה." },
            ],
          },
        },
        {
          title: "פרוטוקולי ועדות הכנסת",
          description: "תהליך דומה למליאה, אבל רק עבור חלון הזמן של חמש השנים האחרונות.",
          sources: [
            "פיד OData: KNS_DocumentCommitteeSession",
            "קובצי מקור: fs.knesset.gov.il",
          ],
          outputs: ["רשימת ועדות", "עמוד קריאה", "סינון לפי שם וסוג ועדה"],
          bullets: [
            `הפיד נסרק רק עבור ${COMMITTEE_WINDOW_YEARS} השנים האחרונות.`,
            "המטא-דאטה נשמר במאגר מטא-דאטה שרתי.",
            "הטקסט המפוענח נשמר במאגר טקסטים שרתי.",
          ],
          flow: {
            title: "ועדות: סינון זמן -> קובץ -> תצוגה",
            steps: [
              { title: "סינון חלון זמן", detail: "נמשכים רק פרוטוקולים חדשים מחמש השנים האחרונות." },
              { title: "שמירת מטא-דאטה", detail: "כולל שם ועדה, סוג ועדה, סטטוס ומספר ישיבה." },
              { title: "פענוח טקסט", detail: "אותו מנגנון פענוח וניקוי כמו במליאה." },
              { title: "עמוד קריאה", detail: "הטקסט המפוענח מוצג בעמוד הקריאה של הוועדה." },
            ],
          },
        },
        {
          title: "איך הקובץ נהפך לטקסט",
          description: "כל הפרוטוקולים עוברים ניקוי אחיד לפני חיפוש, ניתוח או הצגה.",
          bullets: [
            "DOCX מפוענח באמצעות mammoth, ו-DOC ישן מפוענח באמצעות word-extractor.",
            "אחר כך מוסרים תווי בקרה, שבירות עמוד, רווחים כפולים ורעש כמו PAGEREF.",
            "לבסוף הטקסט מחולק לפסקאות - זה המבנה שעליו נשענים כל התוצרים האישיים באתר.",
          ],
        },
      ],
    };
  }

  buildLawsSection() {
    return {
      id: "laws",
      navLabel: "חוקים והצבעות",
      eyebrow: "חוקים",
      title: "חוקים, הצבעות והצבעות מפתיעות",
      intro:
        "עמוד חוק באתר מחבר שלוש שכבות: רשימת חוקים בקריאה שלישית, מפת הצבעה מתאימה, ואז ניתוח אידיאולוגי של החוק.",
      cards: [
        {
          title: "איך נאספת רשימת החוקים",
          description: "האתר מציג רק חוקים שהתקבלו בקריאה שלישית, ושומר את כל החוקים האלה שנאספו עד כה במאגר האתר.",
          sources: ["פיד OData: KNS_Bill", "מסמכי Word/PDF רשמיים של הכנסת"],
          outputs: ["רשימת חוקים", "עמוד חוק מלא", "הורדת קובצי מקור"],
          bullets: [
            "הסינון מתבצע לפי סטטוס קריאה שלישית רשמי של הכנסת.",
            "כל חוק בקריאה שלישית שנמצא בסנכרון נשמר במאגר, ללא תקרת 100.",
            "המטא-דאטה והטקסט הקריא נשמרים באחסון שרתי פנימי.",
          ],
          flow: {
            title: "חוק חדש באתר",
            steps: [
              { title: "מטא-דאטה", detail: "שליפת שם, מזהים, תאריך וקישורי מסמכים." },
              { title: "בחירת מסמכים", detail: "המערכת מעדיפה PDF רשמי ו-Word קריא אם קיים." },
              { title: "שמירה", detail: "הקבצים נשמרים באחסון שרתי פנימי." },
              { title: "פענוח", detail: "קובץ Word מפוענח לטקסט ולפסקאות קריאות." },
            ],
          },
        },
        {
          title: "איך מותאמת מפת ההצבעה לחוק",
          description: "ההתאמה נעשית בנפרד, כי רשימת החוקים אינה מגיעה יחד עם פירוט הצבעה מלא.",
          sources: [
            "עמוד ההצבעות של הכנסת",
            "WebSiteApi/knessetapi/Votes",
            "WebSiteApi/knessetapi/PrintPdf",
          ],
          outputs: ["טבלת ההצבעות בעמוד חוק", "בסיס לפרופיל מבוסס הצבעות"],
          bullets: [
            "ההתאמה מבוססת על כותרת חוק מנורמלת זהה ועל קרבת תאריך.",
            `החוק חייב להתאים להצבעה בטווח של עד ${LAW_MATCH_MAX_DAYS} ימים.`,
            "נשמרת רק הצבעה שמלמדת בבירור על קבלה בקריאה שלישית.",
            "הפלט נשמר במאגר תאמות הצבעות שרתי.",
          ],
          flow: {
            title: "חוק -> חיפוש הצבעות -> התאמה אחת",
            steps: [
              { title: "שליפת כותרות", detail: "שאילת כותרות הצבעה בחלון זמנים סביב החוקים." },
              { title: "נרמול כותרת", detail: "נטרול גרשיים, מקפים וסימני פיסוק." },
              { title: "בדיקת קבלה", detail: "מסננים החוצה הצבעות שאינן אישור סופי." },
              { title: "שמירת פירוט", detail: "נשמרים בעד, נגד, נמנע ונוכח." },
            ],
          },
        },
        {
          title: "איך מסומנות הצבעות מפתיעות",
          description: "רק הצבעות בעד נבדקות, ורק אם יש גם ניתוח חוק וגם ניתוח קטן של חבר הכנסת.",
          outputs: ["לשונית הצבעות מפתיעות", "פיד חדשות הצבעות בעמוד הבית"],
          bullets: [
            "נבדקים פערים בין ציוני החוק לבין ציוני 'על סמך הטקסט' של חבר הכנסת מן הקובץ הקטן.",
            `הצבעה מסומנת רק אם יש פער של ${SURPRISE_THRESHOLD} נקודות או יותר לפחות בציר אחד.`,
            "הזיהוי עצמו נבנה רק בקוד, בלי LLM.",
          ],
        },
        {
          title: "איך נוצר הסבר להצבעה מפתיעה",
          description: "הכפתור מפעיל LLM שמסתמך רק על שני מקורות: החוק והקובץ הקטן של החבר.",
          outputs: ["עמוד הסבר להצבעה מפתיעה", "השערות + ראיות"],
          bullets: [
            "הפלט מחולק לשורה תחתונה, 2–4 השערות, והסתייגות.",
            "לכל השערה יש ראיות מדברי חבר הכנסת וראיות מתוך החוק.",
            "התוצאה נשמרת באחסון תוצרים שרתי.",
          ],
        },
      ],
    };
  }

  buildMembersSection() {
    return {
      id: "members",
      navLabel: "עמודי ח\"כים",
      eyebrow: "חברי הכנסת",
      title: "עמודי חברי הכנסת, קבצי ציטוטים וניתוחים",
      intro:
        "עמוד חבר כנסת נבנה מתוך זיהוי דובר בפרוטוקולים, קבצי ציטוטים שמופקים אוטומטית, ואז ניתוחים שמופעלים על הקבצים האלה.",
      cards: [
        {
          title: "איך מזהים איפה חבר הכנסת דיבר",
          description: "המערכת סורקת פרוטוקולים מפוענחים מאז 2022 ומחפשת התאמות שמות ואליאסים.",
          outputs: ["לשונית פרוטוקולים בעמוד חבר הכנסת", "אינדקס דוברים"],
          bullets: [
            `הסריקה מתחילה ב-${MEMBER_PROTOCOL_SINCE_DATE}.`,
            "לכל חבר כנסת יש רשימת אליאסים שמאפשרת להתמודד עם סדרי שם ואיותים חלופיים.",
            "האינדקס נשמר במאגר אינדקוס שרתי.",
          ],
          flow: {
            title: "פרוטוקול -> זיהוי דובר -> אינדקס אישי",
            steps: [
              { title: "שורת דובר", detail: "המערכת מזהה כותרת שמציינת מי הדובר." },
              { title: "התאמת אליאסים", detail: "שם הדובר נבדק מול רשימת האליאסים של כל חבר." },
              { title: "שמירת התאמה", detail: "נשמר קשר בין החבר לבין הפרוטוקול." },
            ],
          },
        },
        {
          title: "איך נבנים קובצי הציטוטים",
          description: "נשמרים רק קטעי דיבור ארוכים מספיק כדי שאפשר יהיה לנתח אותם.",
          outputs: ["הקובץ המלא", "הקובץ הקטן", "לשונית ציטוטים נבחרים"],
          bullets: [
            `נשמרים רק קטעי דיבור באורך של לפחות ${MIN_MEMBER_UTTERANCE_WORDS} מילים.`,
            `הקובץ הקטן כולל רק את ${SMALL_UTTERANCE_PROTOCOL_LIMIT} הפרוטוקולים האחרונים שבהם נשמר ציטוט כזה.`,
            "הקבצים נשמרים באחסון שרתי פנימי יחד עם מניפסט של זמן ותנאי היצירה.",
          ],
          flow: {
            title: "אינדקס אישי -> חילוץ קטעים -> שני קבצים",
            steps: [
              { title: "חילוץ קטעים", detail: "מכל פרוטוקול נשלפים רק קטעי דיבור של אותו חבר." },
              { title: "סף מילים", detail: "קטעים קצרים מדי אינם נשמרים לקובץ הציטוטים." },
              { title: "פיצול", detail: "נשמר קובץ מלא וגם קובץ קטן של 10 פרוטוקולים אחרונים." },
            ],
          },
        },
        {
          title: "איך נוצר הניתוח הפוליטי",
          description: "הניתוח משתמש בקובץ הציטוטים ומפיק גם פרופיל כללי, גם ציטוטים מודגשים וגם ציוני צירים.",
          outputs: ["לשונית ניתוח פוליטי", "לשונית ציטוטים נבחרים", "בסיס לעמודים נוספים"],
          bullets: [
            "יש ניתוח מהקובץ המלא ויש ניתוח מהקובץ הקטן.",
            "כברירת מחדל מוצג קודם ניתוח הקובץ הקטן, ומתחתיו הודעה שהוא נשען רק על עשרת הפרוטוקולים האחרונים הרלוונטיים.",
            "הפלט כולל פרופיל כללי, ציטוטים מודגשים, קריאה מפורשת, קריאה משתמעת וארבעה צירים בכל שכבה.",
            "התוצאות נשמרות באחסון תוצרים שרתי.",
          ],
        },
      ],
    };
  }

  buildKnowYourMkSection() {
    return {
      id: "know-your-mk",
      navLabel: "הכירו את הח\"כים",
      eyebrow: "צירים",
      title: "הכירו את חברי הכנסת, הפוליטיקאי של השעה ופידים חיים",
      intro:
        "העמודים והכרטיסים האלה מחברים יחד ניתוחים שמורים, מפת הצבעות, וכללי דירוג קשיחים כדי להראות גם מה הח\"כ אומר, גם מה משתמע, וגם איך הוא מצביע בפועל.",
      cards: [
        {
          title: "שלוש התצוגות של 'הכירו את חברי הכנסת'",
          description: "המסך הזה מציג שלוש מפות שונות של אותו חבר כנסת.",
          outputs: ["מפורש", "משתמע", "מבוסס הצבעות", "אחד בפה - אחד בלב"],
          bullets: [
            `התצוגה '${KNOW_YOUR_MK_VIEW_CONFIG.explicit.label}' נשענת על ציוני 'על סמך הטקסט'.`,
            `התצוגה '${KNOW_YOUR_MK_VIEW_CONFIG.implicit.label}' נשענת על ציוני 'בין השורות'.`,
            `התצוגה '${KNOW_YOUR_MK_VIEW_CONFIG.votesBased.label}' מחשבת ממוצע של החוקים שנכללו בפרופיל ההצבעות: הצבעה בעד נספרת כפי שהיא, הצבעה נגד נספרת כ-11 פחות ציון החוק חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5, ובכל ציר מוציאים מן הממוצע ציוני 5/10 אם קיימים גם חוקים לא-נייטרליים.`,
            "המדד 'אחד בפה - אחד בלב' מסכם את הפער המוחלט בין התצוגה המפורשת לבין תצוגת ההצבעות.",
          ],
        },
        {
          title: "הפוליטיקאי של השעה",
          description: "כרטיס הבית המתחלף בוחר חבר כנסת אקראי מתוך מי שכבר יש להם ניתוח קטן שמור.",
          outputs: ["כרטיס 'הפוליטיקאי של השעה'"],
          bullets: [
            "הטקסט מגיע מן הפרופיל הכולל של הניתוח הקטן.",
            "הציטוט המודגש נלקח מקבוצות הציטוטים המודגשים של אותו ניתוח.",
          ],
        },
        {
          title: "פיד הציטוטים העדכני בעמוד הבית",
          description: "הפיד הזה מחושב רק בקוד, בלי LLM, מתוך פרוטוקולים אחרונים שבהם חברי הכנסת באמת דיברו.",
          outputs: ["'קולות עדכניים מהאולם ומהוועדות'"],
          bullets: [
            `נסרקים ${LANDING_RECENT_PROTOCOL_SCAN_LIMIT} הפרוטוקולים החדשים ביותר ממליאה ומוועדות יחד.`,
            "לכל מועמד לפיד מחושב ניקוד קשיח על בסיס מילים טעונות, רגש, אחריות שלטונית ודפוסים רטוריים.",
            "יש מכסות פר-חבר ופר-פרוטוקול כדי לשמור על מגוון.",
          ],
          flow: {
            title: "פרוטוקולים חדשים -> ציטוטים מועמדים -> ניקוד -> פיד",
            steps: [
              { title: "חילוץ ציטוטים", detail: "נשלפים ציטוטים עדכניים של חברי הכנסת מתוך פרוטוקולים חדשים." },
              { title: "ניקוד קשיח", detail: "כל ציטוט מקבל ניקוד לפי אותות פרובוקטיביים ורטוריים." },
              { title: "איזון", detail: "נבחרים רק הציטוטים שעומדים גם במגבלות גיוון." },
            ],
          },
        },
        {
          title: "כרטיסי הבית: קטגוריות, חדשות הצבעות וקצוות",
          description: "כמה מן התוצרים הבולטים בעמוד הראשי הם למעשה תקצירים של מנועים אחרים באתר.",
          outputs: ["כרטיסי הקטגוריות", "פיד חדשות הצבעות", "תקציר 'הכירו את חברי הכנסת'"],
          bullets: [
            "כרטיסי הקטגוריות נבנים ממנייני הפרוטוקולים, החוקים, חברי הכנסת ומדדי ההשוואה שכבר שמורים באתר.",
            "פיד חדשות ההצבעות נשען על רשימת החוקים שבהם נמצאו הצבעות מפתיעות, וממוין לפי מספר ההפתעות וגודל הפערים.",
            "תקציר 'הכירו את חברי הכנסת' בעמוד הבית מציג רק את הקצוות של שלוש שכבות המיפוי, ולא את כל המפה המלאה.",
          ],
        },
      ],
    };
  }

  buildComparisonsSection() {
    return {
      id: "comparisons",
      navLabel: "השוואות",
      eyebrow: "קוד בלבד",
      title: "עמוד ההשוואות נבנה בלי מודל שפה",
      intro:
        "עמוד ההשוואות הוא הדוגמה הבולטת ביותר לתוצר שנבנה כולו בקוד קשיח: מונחים מוגדרים מראש, ספירה, ונרמול.",
      bullets: [
        `נספרים רק קטעי דיבור של לפחות ${MIN_COMPARISON_UTTERANCE_WORDS} מילים.`,
        `חבר כנסת צריך לפחות ${MIN_MEMBER_WORDS_FOR_COMPARISON} מילים מצטברות כדי להיכלל בדירוג.`,
        "הציון בכל מדד מחושב כהופעות לכל 1,000 מילים.",
        "הציון המפלגתי הוא ממוצע של החברים הזכאים במפלגה.",
      ],
      cards: [
        {
          title: "המדדים עצמם",
          description: "כל המדדים הבאים מוגדרים מראש בקוד, בלי פרשנות של מודל שפה.",
          bullets: COMPARISON_DEFINITIONS.map(
            (definition) => `${definition.title}: ${definition.shortDescription}`,
          ),
        },
        {
          title: "איך נולד ציון השוואה",
          description: "המערכת עוברת על הדיבור של חברי הכנסת, סופרת מונחים רלוונטיים ומנרמלת.",
          flow: {
            title: "דיבור -> מונחים -> נרמול",
            steps: [
              { title: "קטעי דיבור", detail: `נסרקים רק פרוטוקולים מאז ${MEMBER_PROTOCOL_SINCE_DATE}.` },
              { title: "מילון מונחים", detail: "לכל מדד יש מילון קשיח של מילים וביטויים." },
              { title: "נרמול", detail: "הספירה מומרת להופעות לכל 1,000 מילים." },
              { title: "איגוד למפלגות", detail: "נוצר גם ממוצע מפלגתי על בסיס חברים זכאים בלבד." },
            ],
          },
        },
      ],
    };
  }

  buildPromptsSection() {
    return {
      id: "prompts",
      navLabel: "פרומפטים ומודלים",
      eyebrow: "LLM",
      title: "אילו פרומפטים ומודלים רצים בפועל",
      intro:
        "שלושת התוצרים הציבוריים שמפעילים כיום מודל שפה הם: ניתוח חבר כנסת, ניתוח חוק, והסבר להצבעה מפתיעה.",
      bullets: [
        "כל הקריאות האלו עוברות דרך GeminiAnalysisClient ומבקשות JSON לפי סכמת תשובה קשיחה.",
        "שאר התוצרים הציבוריים המרכזיים - כמו השוואות, זיהוי הצבעות מפתיעות ופיד הציטוטים - נבנים רק בקוד.",
      ],
      cards: [
        {
          title: "פרומפט: יצירת מסמך המתודולוגיה",
          description:
            "זהו פרומפט-העל שמגדיר מה חייב להיכלל במסמך המתודולוגיה. המסמך עצמו מורכב בקוד ונשמר כסנאפשוט, לא נכתב בזמן אמת על ידי מודל.",
          provider: "ללא LLM",
          model: "מחולל מתודולוגיה קשיח בקוד",
          inputs: [
            "קבועים ונתיבים מתוך הקוד",
            "שירותי איסוף, עיבוד וניתוח",
            "שמות מודלים ופרומפטים של הקריאות הציבוריות",
            "קבצי מטא-דאטה שמורים באחסון הפנימי של המערכת",
          ],
          outputs: [
            "מסמך מתודולוגיה שמור",
            "פרקי הסבר מחולקים לפי תוצרים",
            "רשימת פרומפטים ומודלים",
          ],
          bullets: [
            "הפרומפט הזה מתאר את כללי היצירה של מסמך המתודולוגיה.",
            "המסמך שנשמר מוצג שוב ושוב כפי שנוצר, עד שאדמין בוחר ליצור אותו מחדש.",
            "העמוד הציבורי מציג רק תיאור עקרוני של כללי ההנחיה ולא את הנוסח המלא.",
          ],
        },
        {
          title: "פרומפט: ניתוח חבר כנסת",
          description: "מייצר פרופיל, ציטוטים מודגשים, קריאה מפורשת, קריאה משתמעת וציוני צירים.",
          model: this.memberAnalysisService.analysisClient.model,
          provider: this.memberAnalysisService.analysisClient.provider,
          inputs: [
            "שם חבר הכנסת ושם הסיעה",
            "קובץ ציטוטים קטן או מלא",
            "טווח הפרוטוקולים הרלוונטי",
          ],
          outputs: [
            "overallProfile",
            "highlightedQuotes",
            "analysisSections",
            "quantitativeAnalysis",
          ],
          bullets: [
            "הקריאה הזאת מבקשת פלט JSON קשיח לפרופיל כללי, ציטוטים מודגשים, אזורי ניתוח וצירים כמותיים.",
            "העמוד הציבורי מציג רק תיאור עקרוני של כללי הניתוח ולא את הנוסח המלא.",
          ],
        },
        {
          title: "פרומפט: ניתוח חוק",
          description: "ממקם את החוק על ארבעת הצירים ומחזיר ציון, נימוקים וקטעי תמיכה.",
          model: this.lawAnalysisService.analysisClient.model,
          provider: this.lawAnalysisService.analysisClient.provider,
          inputs: ["מטא-דאטה של החוק", "תקציר רשמי", "נוסח קריא של החוק"],
          outputs: ["overallSummary", "axes"],
          bullets: [
            "הקריאה הזאת מבקשת פלט JSON קשיח עם סיכום כללי וציוני צירים אידיאולוגיים.",
            "העמוד הציבורי מציג רק תיאור עקרוני של כללי הניתוח ולא את הנוסח המלא.",
          ],
        },
        {
          title: "פרומפט: הסבר להצבעה מפתיעה",
          description: "מסביר פער בין פרופיל חבר הכנסת לבין תמיכתו בחוק מסוים.",
          model: this.lawSurpriseExplanationService.analysisClient.model,
          provider: this.lawSurpriseExplanationService.analysisClient.provider,
          inputs: ["קובץ אמירות קטן", "טקסט החוק", "פערי הצירים", "סיכום החוק"],
          outputs: ["bottomLine", "hypotheses", "caution"],
          bullets: [
            "הקריאה הזאת מבקשת פלט JSON קשיח עם שורה תחתונה, השערות מובחנות והסתייגות.",
            "העמוד הציבורי מציג רק תיאור עקרוני של כללי הניתוח ולא את הנוסח המלא.",
          ],
        },
        {
          title: "תוצרים ציבוריים ללא LLM",
          description: "אלה התוצרים המרכזיים באתר שנבנים בלי מודל שפה כלל.",
          bullets: [
            "עמוד ההשוואות וכל המדדים שבו.",
            "פיד הציטוטים העדכני בעמוד הבית.",
            "זיהוי הצבעות מפתיעות עצמו.",
            "התצוגה 'מבוסס הצבעות' והפער 'אחד בפה - אחד בלב'.",
            "התאמת הצבעות לחוקים ואינדקס הפרוטוקולים האישיים של חברי הכנסת.",
          ],
        },
      ],
    };
  }

  async getPublicPayload() {
    if (await fileExists(this.snapshotPath)) {
      try {
        return await readJson(this.snapshotPath);
      } catch {
        return this.recreatePublicPayload();
      }
    }

    return this.recreatePublicPayload();
  }

  async recreatePublicPayload() {
    if (this.snapshotPromise) {
      return this.snapshotPromise;
    }

    this.snapshotPromise = this.buildAndPersistPublicPayload().finally(() => {
      this.snapshotPromise = null;
    });

    return this.snapshotPromise;
  }

  async buildAndPersistPublicPayload() {
    await ensureDirectory(this.dataDir);

    const generatedAt = new Date().toISOString();
    const generatedDateLabel = formatGeneratedAt(generatedAt);
    const payload = {
      generatedAt,
      generatedDateLabel,
      snapshotCards: await this.buildSnapshotCards(),
      sections: [
        this.buildOverviewSection(generatedDateLabel),
        this.buildProtocolsSection(),
        this.buildLawsSection(),
        this.buildMembersSection(),
        this.buildKnowYourMkSection(),
        this.buildComparisonsSection(),
        this.buildPromptsSection(),
      ],
    };

    await writeJson(this.snapshotPath, payload);
    return payload;
  }
}

module.exports = {
  MethodologyService,
};
