---
name: sp-downloader-protocol
description: Execution protocol for SP-Downloader — a Node.js/yt-dlp based web video downloader (RTL/Persian UI, SSE real-time progress, admin panel) that is about to be published as a public open-source repo on GitHub. MUST be read and internalized before starting ANY task in this project — coding, bug-fix, UI/UX polish, admin-panel work, download-engine work, or repo-readiness work. Encodes the project's real architecture (server.js, public/app.js, SSE, yt-dlp spawn engine), Amir's non-negotiable output discipline (no commit, no scope creep, no explanation padding, minimal diff), a hard-minimum UI/UX red-line checklist that no agent is allowed to skip (loading/empty/error states, interruption handling, animation, responsiveness, RTL), a full-stack coherence rule, and a public-repo readiness checklist (secrets, README, license, no leaked local paths). Trigger this skill whenever the user mentions SP-Downloader, SP Downloader, this yt-dlp downloader project, its server.js/app.js, its admin panel, or asks for GitHub-release prep on it.
---

# SP-Downloader Agent Protocol — v1

این اسکیل استاندارد اجرایی برای پروژه **SP Downloader** است (وب‌اپ دانلودر ویدیو/صوت مبتنی بر Node.js + yt-dlp، رابط فارسی/RTL). این پروژه قرار است به‌زودی روی گیت‌هاب منتشر و عمومی شود، پس کیفیت کد و UI/UX باید در سطح یک پروژه‌ی متن‌باز قابل‌ارائه باشد. قبل از شروع هر تسک این فایل را کامل بخوان. اگر دستور صریح امیر در همان پیام با این اسکیل تناقض داشت، دستور همان پیام اولویت دارد.

---

## 0. قانون طلایی خروجی (بدون استثنا)

- **هرگز `git commit` نزن.** فقط فایل‌ها را تغییر بده و همان‌جا متوقف شو. کامیت فقط با دستور صریح "کامیت کن" مجاز است.
- **کشش نده (scope creep ممنوع).** فقط دقیقاً همان چیزی که در تسک خواسته شده انجام شود؛ اگر باگ/نقص دیگری دیدی فقط در یک خط اشاره کن، خودسرانه تغییرش نده یا فایل‌های اضافه دست‌نخورده را بازسازی نکن.
- **توضیح اضافه ممنوع.** بدون مقدمه، بدون شرح تئوری، بدون گزارش گام‌به‌گام. خروجی = کد. اگر توضیح لازم است، حداکثر چند خط لیست‌وار از فایل‌ها/بخش‌های تغییر‌کرده، همین.
- **verify/syntax-check جداگانه اجرا نکن** مگر تسک صراحتاً بخواهد.
- **فقط بخش تغییر‌یافته را بده، نه فایل کامل**، مگر تغییرات آنقدر گسترده باشد که دیف غیرقابل‌خواندن شود یا فایل جدید باشد.
- **minimal diff همیشه هدف است:** کمترین خط تغییر، بیشترین reuse از الگوی موجود در همان فایل. برای حل یک مشکل ساختار/فایل/کلاس جدید نساز وقتی معادلش با یک اصلاح کوچک قابل حل است.

---

## 1. شناخت پروژه (واقعیت فعلی کدبیس — حدس نزن)

```
SP-Downloader/
├── bin/yt-dlp.exe, phantomjs.exe
├── public/index.html, app.js, style.css, Logo.png, favicon/, fontawesome/, fonts/
├── server.js            ← بک‌اند اصلی، Node.js خام (http/https)، بدون Express
├── update-ytdlp.js
├── package.json
├── .env
```

- بک‌اند با ماژول native `http`/`https` نوشته شده، **نه Express** — الگوهای route/middleware استایل Express را اختراع نکن مگر migration صریح خواسته شود.
- دانلود واقعی از طریق `child_process.spawn` روی باینری `yt-dlp` انجام می‌شود؛ merge نهایی به mp4 با ffmpeg (باید سیستمی نصب باشد).
- state مدیریت دانلودها **in-memory (Map)** است؛ MongoDB در `package.json`/`.env` تعریف شده ولی در کد فعلی استفاده نمی‌شود — قبل از اضافه‌کردن persistence واقعی، صراحتاً از امیر بپرس یا طبق تسک مشخص عمل کن، پیش‌فرض نگیر که باید MongoDB وصل شود.
- realtime از طریق `GET /events` (Server-Sent Events) است — برای هر آپدیت progress/status جدید از همین کانال استفاده کن، polling اضافه نساز.
- endpoint های موجود (جدول کامل در فایل Overview پروژه) شامل meta/download/cancel/pause/resume/remove/config/proxy-test/open-folder/admin/* است — قبل از ساخت endpoint جدید چک کن معادلش از قبل نیست.
- پلتفرم‌های پشتیبانی‌شده با آیکون تشخیص خودکار: YouTube, TikTok, Instagram, Twitter/X, Vimeo, Twitch, Dailymotion, PornHub, XHamster + fallback icon.
- فرانت کاملاً Vanilla JS است (بدون فریمورک) — کتابخانه/فریمورک جدید اضافه نکن مگر صراحتاً خواسته شود.
- فونت فارسی Shabnam، آیکون‌ها Font Awesome — از همین ست استفاده کن، آیکون/فونت جدید اضافه نکن مگر لازم.

---

## 2. خط قرمز UI/UX (حداقل غیرقابل‌عبور — در هیچ تسکی نباید حذف/نادیده گرفته شود)

این پروژه قرار است روی گیت‌هاب دیده شود، پس این‌ها "nice to have" نیستند، خط قرمزند. اگر تسک درباره‌ی یک کامپوننت/بخش UI است، همه‌ی این موارد باید رعایت شوند حتی اگر صریحاً در متن تسک نیامده باشند:

1. **هیچ اکشن async بدون فیدبک بصری نیست** — هر دکمه/عملیات (دانلود، لغو، توقف، ادامه، حذف، آپدیت هسته) باید state لودینگ/spinner/progress مخصوص به خودش داشته باشد؛ کاربر هرگز نباید در حالت "منتظرم ولی چیزی نمی‌بینم" بماند.
2. **مدیریت وقفه (Interruption Handling) اجباری است:**
   - قطع شبکه یا بستن تب حین دانلود نباید state را خراب کند؛ روی reconnect باید وضعیت واقعی (via `/events` یا fetch وضعیت) از سرور sync شود، نه فرض حالت قبلی در کلاینت.
   - Pause/Resume باید واقعاً روی پردازش yt-dlp اثر بگذارد (نه فقط مخفی‌کردن UI)؛ اگر خطای شبکه یا قطعی رخ داد باید پیام فارسی روشن نشان داده شود و گزینه‌ی retry/resume در دسترس باشد، نه صرفاً "Error".
   - Cancel باید child process را واقعاً kill کند و فایل ناقص را پاک/علامت‌گذاری کند، fake-cancel در UI ممنوع.
3. **حالت خالی/خطا/لودینگ برای هر لیست** (صف دانلود، پیش‌نمایش‌ها، تاریخچه، آمار ادمین) باید مرکز/وسط ناحیه رندر شود با پیام فارسی مناسب، نه جدول/کارت خالی بی‌معنا.
4. **انیمیشن‌ها سبک، هدفمند و ظریف باشند** — transition روی state change ها (progress bar، تغییر status badge، ظاهرشدن/حذف preview card، toast) اجباری است، ولی نباید jank/lag ایجاد کند یا UX را کند کند؛ از `transform`/`opacity` برای انیمیشن استفاده کن نه `top/left/width` (که reflow سنگین دارند).
5. **سادگی کامل هم‌زمان با جذابیت بصری** — هیچ overlay/مودال/عنصر تزئینی اضافه که به کاربرد اصلی (چسباندن لینک → دانلود) کمکی نمی‌کند اضافه نشود. اگر یک ویژگی بصری جدید اضافه می‌شود باید عملکردی هم داشته باشد.
6. **واکنش‌گرا (Responsive) واقعی در همه‌ی breakpoint ها** — دسکتاپ/تبلت/موبایل، بدون overflow افقی، بدون overlap در preview grid (که تا ۵ کارت هم‌زمان دارد).
7. **RTL کامل** — جهت آیکون‌ها (فلش‌ها، دکمه‌ی progress/cancel)، جهت progress bar، جهت toast، همه باید منطق RTL درست را رعایت کنند، نه کپی‌شده از یک الگوی LTR.
8. **پیام‌های خطا همیشه فارسی و قابل‌فهم برای کاربر نهایی باشند** — پیام خام yt-dlp/stderr مستقیم به کاربر نمایش داده نشود؛ باید map به پیام فارسی مشخص شود (مشابه هندلینگ اختصاصی موجود برای XHamster).
9. **دسترسی به فایل نهایی و پوشه‌ی دانلود همیشه یک کلیک باشد** (دکمه‌ی open-folder / دانلود مستقیم فایل) — این جزو حداقل تجربه‌ی کاربری است، نباید در بازطراحی گم شود.

اگر تسک فقط یک بخش کوچک را هدف گرفته ولی این خط‌قرمزها در همان بخش رعایت نشده بودند، اصلاحشان جزو همان تسک است (نه scope creep)، چون این‌ها حداقل پایه‌ی پروژه‌اند نه فیچر اضافه.

---

## 3. Performance و هزینه‌ی اجرا

پروژه لوکال ران می‌شود (منابع کاربر در دسترس) ولی همچنان باید بهینه باشد چون قرار است عمومی و مورد بررسی کد باشد:

- از `/events` (SSE) برای آپدیت استفاده کن؛ هرگز setInterval polling روی endpoint وضعیت اضافه نکن.
- عملیات سنگین (spawn، parse خروجی yt-dlp، فایل‌های بزرگ) نباید event loop اصلی Node را بلاک کنند — parsing استریم‌محور (`data` event روی stdout) باشد نه بافر کامل در حافظه قبل از پردازش.
- در فرانت، از debounce برای input هایی مثل URL بار (اگر preview auto-fetch دارد) استفاده کن تا request اضافه به `/api/meta` نزنی.
- Map مدیریت دانلود در حافظه رشد نامحدود نداشته باشد — دانلودهای done/error/cancelled قدیمی باید قابل remove/cleanup باشند (چه با اکشن کاربر چه با یک حد بالای منطقی)، از leak حافظه جلوگیری کن.
- کد اضافه/کتابخانه‌ی سنگین جدید (فریمورک فرانت، ORM سنگین، ...) بدون درخواست صریح اضافه نکن — سبک‌ماندن استک فعلی (native http + vanilla JS) عمدی است.
- CSS/JS جدید باید minimal-footprint باشد؛ از الگوی موجود در `style.css`/`app.js` reuse کن، فایل موازی جدید برای همان مسئولیت نساز.

---

## 4. Full-Stack بودن اجباری وقتی لازم است

اگر تغییر UI/فیچر نیاز به داده یا رفتار جدید از سمت سرور دارد (endpoint جدید، فیلد جدید در state دانلود، تغییر در progress payload SSE و ...):

- کلاینت و سرور باید هر دو، هم‌زمان و sync، در همان تسک تغییر کنند — تحویل نصفه (فقط UI با داده‌ی mock) قابل قبول نیست مگر صراحتاً خواسته شود.
- payload جدید در `/events` باید backward-compatible باشد با کلاینت‌های/کدهای دیگری که همان event را می‌خوانند (فیلد اضافه کن، فیلد موجود را rename/حذف نکن مگر ضروری).
- هر endpoint جدید باید همان الگوی error-handling و ساختار پاسخ (JSON با فیلدهای مشابه بقیه‌ی endpoint ها) را رعایت کند، نه فرمت متفاوت.

---

## 5. آمادگی انتشار عمومی روی گیت‌هاب

از آنجا که این ریپو عمومی می‌شود، در هر تسکی که به فایل‌های ریشه/config/ساختار پروژه مربوط است این‌ها را رعایت کن (بدون اینکه گزارش مفصل بدهی، صرفاً fix کن یا اگر خارج از scope تسک است یک‌خطی اشاره کن):

- **هیچ secret واقعی نباید commit یا در کد hardcode بماند** — `ADMIN_PASSWORD`, `MONGODB_URI` و مشابه باید فقط در `.env` (که در `.gitignore` است) بمانند؛ اگر فایل نمونه لازم است `.env.example` با مقادیر placeholder بساز، نه مقدار واقعی.
- مسیرهای لوکال ویندوزی/شخصی (مثل `C:\Users\...`) نباید در کد یا مستندات نمونه به‌صورت hardcoded باقی بمانند؛ از placeholder یا مسیر نسبی استفاده کن.
- اگر تسک به README/مستندات مربوط است: باید شامل نصب، اجرا، env variables لازم، و پیش‌نیاز ffmpeg باشد — بدون اطلاعات اضافه‌ی غیرمرتبط.
- ناسازگاری بین `package.json` scripts (که به `src/server.js` اشاره دارند) و ساختار واقعی (`server.js` در ریشه) اگر در مسیر تسک دیدی، اصلاح کن یا حداقل یک‌خط اشاره کن؛ خودسرانه کل package.json را بازنویسی نکن.
- کد باید تمیز و بدون console.log های دیباگ فراموش‌شده تحویل داده شود.

---

## 6. چک‌لیست پایان تسک (سریع، بدون گزارش‌نویسی)

- [ ] هیچ commit زده نشد
- [ ] scope دقیقاً همان چیزی بود که خواسته شد
- [ ] خط‌قرمزهای بخش ۲ (لودینگ/خالی/خطا/وقفه/انیمیشن/ریسپانسیو/RTL) در بخش تغییر‌یافته رعایت شد
- [ ] اگر SSE/state سرور درگیر بود، کلاینت+سرور هر دو sync آپدیت شدند
- [ ] هیچ secret/مسیر لوکال جدیدی hardcode نشد
- [ ] خروجی فقط دیف/کد تغییرات + حداکثر چند خط لیست فایل‌های تغییر‌کرده است
