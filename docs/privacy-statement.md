<div dir="rtl">

# נוסח פרטיות להסכם הלקוח

## עברית

> **עיבוד החשבוניות.** LedgerMatch קורא ומעבד את קובצי החשבוניות בתוך דפדפן האינטרנט במחשב הלקוח בלבד. קובצי החשבוניות ותוכנם אינם מועלים, אינם נשמרים ואינם מעובדים בשרתי הספק או אצל צד שלישי כלשהו.
>
> **אכיפה טכנית.** התוכנה מסופקת כקבצים סטטיים, ללא קוד צד-שרת. מדיניות אבטחה שהדפדפן אוכף (Content Security Policy) מתירה לתוכנה ליצור קשר רק עם שירות הסטטיסטיקה שלנו, וחוסמת כל שליחת נתונים לכל כתובת אחרת.
>
> **סטטיסטיקת שימוש.** לאחר כל השוואה נשלחת לשירות הסטטיסטיקה (PostHog, באיחוד האירופי) הודעה הכוללת נתונים מספריים בלבד:
> - מספר השורות בכל חשבונית;
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

> **Invoice processing.** LedgerMatch reads and processes invoice files only inside the web browser on the customer's computer. Invoice files and their contents are never uploaded to, stored on, or processed by the provider's servers or any third party.
>
> **Technical enforcement.** The software is delivered as static files with no server-side code. A security policy enforced by the browser (Content Security Policy) allows it to contact only our usage-statistics service and blocks sending data to any other address.
>
> **Usage statistics.** After each comparison, a message containing only numbers is sent to the statistics service (PostHog, in the EU):
> - the number of lines on each invoice;
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
- המשפט "איננו מנהלים יומני גישה" נכון כי יומני הגישה של CloudFront כבויים, וגם ה-Lambda הישן ויומני הלוג שלו נמחקו.
- הנוסח נמנע בכוונה מהבטחה מוחלטת. CSP מגן מפני טעויות ומפני ספריות צד שלישי, אבל לא מפני כוונה זדונית של מפתח התוכנה עצמו. לכן מה שמובטח הוא עיבוד מקומי שהלקוח יכול לאמת בעצמו.
- אם משנים את רשימת השדות הנשלחים (`core/src/analytics.ts`), צריך לעדכן גם את הבדיקה `core/test/analytics.test.ts`, את המסמך הזה ואת `docs/it-verification-he.md`.

</div>
