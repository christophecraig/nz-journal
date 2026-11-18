import test from "node:test";
import assert from "node:assert/strict";
import { withRetry, isRetryable, waitForOnline } from "../public/js/uploader.js";

const netErr = () => new TypeError("Failed to fetch");
const httpErr = (status) => Object.assign(new Error("HTTP " + status), { status });
const noSleep = () => Promise.resolve();

test("isRetryable : réseau et 5xx oui, 4xx définitifs non", () => {
  assert.ok(isRetryable(netErr()) && isRetryable(httpErr(500)) && isRetryable(httpErr(503)) && isRetryable(httpErr(408)) && isRetryable(httpErr(429)));
  assert.ok(!isRetryable(httpErr(401)) && !isRetryable(httpErr(413)) && !isRetryable(httpErr(415)) && !isRetryable(httpErr(400)));
});

test("réussit au bout de quelques échecs, avec attente croissante", async () => {
  let n = 0;
  const waits = [], retries = [];
  const out = await withRetry(async () => { if (++n < 3) throw netErr(); return "ok"; }, {
    delays: [10, 20, 40], sleep: async (ms) => waits.push(ms), isOnline: () => true, onRetry: (r) => retries.push([r.attempt, r.max]),
  });
  assert.equal(out, "ok");
  assert.equal(n, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.deepEqual(retries, [[1, 3], [2, 3]]);
});

test("échec définitif après les tentatives prévues : l'erreur est relancée", async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw httpErr(502); }, { delays: [1, 1], sleep: noSleep, isOnline: () => true }), { status: 502 });
  assert.equal(n, 3); // 1 essai + 2 réessais
});

test("erreur non réessayable : un seul essai", async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw httpErr(415); }, { sleep: noSleep, isOnline: () => true }), { status: 415 });
  assert.equal(n, 1);
});

test("réseau coupé : on attend son retour sans consommer de tentative, puis ça réussit", async () => {
  let online = false, n = 0, offlineCalls = 0, release;
  const gate = new Promise((r) => (release = r));
  const p = withRetry(async () => { n++; if (!online) throw netErr(); return "envoyé"; }, {
    delays: [1], sleep: noSleep, isOnline: () => online, onOffline: () => offlineCalls++,
    waitOnline: async () => { await gate; },
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(n, 1); // bloqué en attente du réseau
  online = true; release();
  assert.equal(await p, "envoyé");
  assert.equal(offlineCalls, 1);
  assert.equal(n, 2);
});

test("longue coupure : plus de tentatives consommées que de retours réseau", async () => {
  let n = 0;
  const flaps = 10; // 10 coupures successives, bien plus que les 2 réessais prévus
  let online = false;
  const out = await withRetry(async () => { n++; if (n <= flaps) { online = false; throw netErr(); } return "ok"; }, {
    delays: [1, 1], sleep: noSleep, isOnline: () => online, waitOnline: async () => { online = true; },
  });
  assert.equal(out, "ok");
});

test("waitForOnline : immédiat si en ligne, sinon attend l'événement", async () => {
  await waitForOnline({ navigator: { onLine: true } });
  let handler;
  const target = { navigator: { onLine: false }, addEventListener: (_, h) => (handler = h), removeEventListener() {} };
  let done = false;
  const p = waitForOnline(target).then(() => (done = true));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(done, false);
  handler();
  await p;
  assert.equal(done, true);
});
