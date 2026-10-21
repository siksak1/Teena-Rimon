<div dir="rtl">

# נוסח פרטיות להסכם הלקוח

## עברית

> **עיבוד החשבוניות.** LedgerMatch קורא ומעבד את קובצי החשבוניות בתוך דפדפן האינטרנט במחשב הלקוח, כולל זיהוי תווים (OCR) בחשבוניות סרוקות. החשבונית של הלקוח עצמו אינה יוצאת מהדפדפן לעולם.
>
> **קריאה בעזרת AI [אם הוסכם].** כאשר אף אחד מהקוראים בדפדפן אינו מצליח לקרוא חשבונית ספק (בדרך כלל ספק שחשבוניותיו לא נקראו עד כה), קובץ חשבונית הספק והטקסט שחולץ ממנו נשלחים לשרת הספק (Amazon Web Services, פרנקפורט), ומשם לשירות ה-AI של Anthropic (Claude) לקריאה. התשובה נבדקת מול החשבונית עצמה לפני שהיא מוצגת. שרת הספק אינו שומר את הקובץ או את תוכנו; הוא שומר רק את מבנה החשבונית של אותו ספק (שמות העמודות והכותרות), כדי שחשבוניות הבאות של אותו ספק ייקראו בדפדפן ללא שליחה, וכן מוני שימוש. Anthropic מעבדת את הנתונים לפי התנאים המסחריים שלה ואינה משתמשת בהם לאימון מודלים. המסך מודיע למשתמש לפני שליחה כזו.
>
> **אכיפה טכנית.** מדיניות אבטחה שהדפדפן אוכף (Content Security Policy) מתירה לתוכנה ליצור קשר רק עם שירות הסטטיסטיקה שלנו ועם שרת הקריאה בעזרת AI, וחוסמת כל שליחת נתונים לכל כתובת אחרת.
>
> **סטטיסטיקת שימוש.** לאחר כל השוואה נשלחת לשירות הסטטיסטיקה (PostHog, באיחוד האירופי) הודעה הכוללת נתונים מספריים בלבד:
> - מספר השורות בכל חשבונית;
> - האם חשבונית הספק הייתה סרוקה, ובכמה משורותיה זיהוי התווים לא אומת;
> - איך נקראה חשבונית הספק (קורא ייעודי, קורא כללי, מבנה שנלמד או AI);
> - מספר ההתאמות, הפערים והשורות שלא הותאמו;
> - זמן העיבוד;
> - גרסת התוכנה וסוג הדפדפן;
> - [אם הוסכם:] סכום הפער הכולל, מעוגל ל-10 ₪.
>
> אם ההשוואה נכשלה, נשלח קוד שגיאה קבוע. ההודעה מזוהה לפי שם הלקוח בלבד, ואינה מזהה את המשתמש. ההודעה לעולם אינה כוללת שמות ספקים, מספרי חשבוניות או תעודות, שמות מוצרים, כמויות או מחירים של שורות, או שמות קבצים. איננו שומרים כתובות IP ואיננו מנהלים יומני גישה לאתר.
>
> **גישה.** הגישה לתוכנה היא באמצעות קישור אישי לחברה, שיש לשמור כסוד. הספק רשאי להחליף או לבטל את הקישור, בין היתר אם הקישור דלף או עם סיום ההתקשרות.
>
> **אימות.** הלקוח רשאי לוודא את האמור בכל עת, באמצעות כלי המפתחים של הדפדפן. הספק יספק לשם כך הנחיות כתובות.

## English

> **Invoice processing.** LedgerMatch reads and processes invoice files inside the web browser on the customer's computer, including text recognition (OCR) of scanned invoices. The customer's own document never leaves the browser.
>
> **AI reading [if agreed].** When none of the readers in the browser can read a supplier invoice (usually a supplier whose invoices have not been read before), the supplier invoice file and the text extracted from it are sent to the provider's server (Amazon Web Services, Frankfurt) and from there to Anthropic's AI service (Claude) to be read. The answer is checked against the invoice itself before it is shown. The provider's server does not store the file or its contents; it keeps only that supplier's invoice layout (column names and labels), so that the supplier's next invoices are read in the browser without being sent, and usage counters. Anthropic processes the data under its commercial terms and does not use it to train models. The screen tells the user before such a send.
>
> **Technical enforcement.** A security policy enforced by the browser (Content Security Policy) allows the software to contact only our usage-statistics service and the AI reading server, and blocks sending data to any other address.
>
> **Usage statistics.** After each comparison, a message containing only numbers is sent to the statistics service (PostHog, in the EU):
> - the number of lines on each invoice;
> - whether the supplier invoice was a scan, and on how many of its lines the text recognition could not be confirmed;
> - how the supplier invoice was read (its own reader, a generic reader, a learned layout, or the AI);
> - the number of matches, discrepancies and unmatched lines;
> - processing time;
> - the software version and browser type;
> - [if agreed:] the total discrepancy amount, rounded to ₪10.
>
> When a comparison fails, a fixed error code is sent instead. The message identifies the customer only, not the user. It never includes supplier names, invoice or document numbers, product names, line quantities or prices, or file names. We do not store IP addresses or keep access logs.
>
> **Access.** Access is through a link that is personal to the customer's company and must be kept confidential. The provider may replace or revoke the link, among other reasons if it is leaked or when the agreement ends.
>
> **Verification.** The customer may verify the above at any time using the browser's developer tools. The provider will supply written instructions for this.

---

**הערות פנימיות (לא לכלול בהסכם):**
- הסעיף "[אם הוסכם]" תואם להגדרה `analytics.sendDiscrepancyAmount` בקובץ `customers/<slug>/config.json`. אצל תאנה ורימון ההגדרה מופעלת. אם לקוח לא מסכים, משנים אותה ל-`false` ומשחררים גרסה. כך הסכום לא נשלח בכלל.
- המשפט "איננו שומרים כתובות IP" נכון רק כשההגדרה **Discard client IP data** מופעלת בפרויקט ב-PostHog. יש לוודא שהיא מופעלת.
- המשפט "איננו מנהלים יומני גישה" נכון כי יומני הגישה של CloudFront כבויים. ל-Lambda של קריאת ה-AI יש יומן CloudWatch שנשמר 14 יום, והוא כולל רק מונים ותוצאות (שם הלקוח, מספר שורות, אומת או לא, טוקנים). אין בו טקסט מחשבונית, שמות קבצים, מספרי עוסק או את הקישור הסודי. `backend/test/app.test.ts` בודק זאת.
- הסעיף "קריאה בעזרת AI [אם הוסכם]" תואם להגדרה `aiFallback` בקובץ `customers/<slug>/config.json`. כשהיא כבויה, האפליקציה לא פונה לשרת בכלל, וכל הנוסח הישן ("הקבצים לא יוצאים מהדפדפן") נכון. אצל תאנה ורימון ההגדרה מופעלת מתצורה 6. **יש לקבל את הסכמת הלקוח לפני שחרור גרסה שמפעילה אותה.**
- לפני שליחת הנוסח: לוודא את תנאי שמירת הנתונים העדכניים של Anthropic ל-API (משך שמירה, אי-שימוש לאימון) ולעדכן את המשפט אם צריך. אם נדרש, אפשר לבקש מ-Anthropic Zero Data Retention לחשבון.
- הנוסח נמנע בכוונה מהבטחה מוחלטת. CSP מגן מפני טעויות ומפני ספריות צד שלישי, אבל לא מפני כוונה זדונית של מפתח התוכנה עצמו. לכן מה שמובטח הוא עיבוד מקומי שהלקוח יכול לאמת בעצמו.
- אם משנים את רשימת השדות הנשלחים (`core/src/analytics.ts`), צריך לעדכן גם את הבדיקה `core/test/analytics.test.ts`, את המסמך הזה ואת `docs/it-verification-he.md`.

</div>
