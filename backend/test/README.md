Run `npm run test:unit` for video metadata regressions without any services.

Run `npm run test:integration` with `mongod` on PATH for real HTTP, JWT,
validation and MongoDB tests. The suite starts a temporary MongoDB instance;
it does not connect to the application's database.

Run `npm run test:browser` with Playwright and Chromium installed. To use an
existing installation, set `PLAYWRIGHT_MODULE` to the Playwright package path
and `CHROME_PATH` to the browser executable. This suite starts Vite and the
isolated backend, then checks create/update forms, route reloads, a simulated
30.11 MB chunk upload, failed chunk retries, metadata-only retries after a
refresh, editorial URLs, and deletion.

Redis's blocklist, Judge0 responses and Cloudinary calls are test doubles.
These tests verify application integration and failure handling; they do not
verify cloud credentials, Judge0 execution, or decoding a real uploaded video.
