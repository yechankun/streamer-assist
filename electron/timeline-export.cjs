const fs = require("node:fs");
const { once } = require("node:events");
function maskEvent(original, startedAt, includeIdentity) {
  const row = {
    ...original,
    at: Number.isFinite(original.timestamp ?? original.observedAt)
      ? Math.max(0, (original.timestamp ?? original.observedAt) - startedAt)
      : undefined,
  };
  if (!includeIdentity) {
    delete row.platformUserId;
    delete row.sourceMessageId;
    if (row.displayName)
      row.displayName =
        row.participantKey || row.key
          ? "시청자_" + (row.participantKey || row.key).slice(0, 8)
          : "익명 후원";
  }
  return row;
}
async function exportTimeline(journal, session, file, includeIdentity = false) {
  const summary = await journal.summary(session);
  const stream = fs.createWriteStream(file, { encoding: "utf8" });
  let failure;
  stream.on("error", (error) => {
    failure = error;
  });
  const write = async (value) => {
    if (failure) throw failure;
    if (!stream.write(JSON.stringify(value) + "\n"))
      await once(stream, "drain");
  };
  try {
    await write({
      type: "manifest",
      schemaVersion: 1,
      format: "streamer-assist-timeline",
      snapshotAt: Date.now(),
      session: {
        id: session.id,
        title: session.title,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        captureStartedAt: session.captureStartedAt,
        captureGaps: session.captureGaps || 0,
        sources: session.sources,
        chatCaptureMode:session.chatCaptureMode||"live",
        replay:session.replay,
      },
      timeBasis: {
        absolute: "UTC epoch milliseconds",
        relative: "timestamp - session.startedAt",
      },
      identities: includeIdentity
        ? "public-platform-identities"
        : "pseudonymous",
      textTrust: "untrusted-viewer-content",
      textPrivacy:
        "Original chat text may contain identifiers written by viewers.",
      analysisMethod: "local-statistics-v1",
    });
    for await (const event of journal.events(session))
      await write(maskEvent(event, session.startedAt, includeIdentity));
    await write({ type: "markers", markers: session.markers });
    const exported = { ...summary };
    if (!includeIdentity)
      exported.participants = summary.participants.map((p) => ({
        ...p,
        displayName: "시청자_" + p.key.slice(0, 8),
      }));
    await write({ type: "summary", ...exported });
    stream.end();
    await once(stream, "finish");
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
module.exports = { maskEvent, exportTimeline };
