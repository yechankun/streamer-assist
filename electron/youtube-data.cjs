// Consent removal is deliberately separate from stopping a connection.
// Mixed derived results cannot be separated reliably, so they are discarded;
// other platforms' original messages and user-authored markers are preserved.
const fs = require("node:fs");
const path = require("node:path");
const YOUTUBE = "youtube";
function targetsYoutube(value) {
  return value?.platform === YOUTUBE || value?.platforms?.includes(YOUTUBE) || !!value?.youtubeId;
}
function stripEvents(events = []) {
  return events.flatMap(event => {
    if (event.platform === YOUTUBE) return [];
    if (event.type === "viewers") {
      const sources = (event.sources || []).filter(source => source.platform !== YOUTUBE);
      return sources.length ? [{ ...event, sources }] : [];
    }
    return [event];
  });
}
function stripSession(session, counts) {
  if (!session) return session;
  const affected = !session.sources?.length || counts?.removed || (session.sources || []).some(targetsYoutube) || (session.polls || []).some(targetsYoutube)
    || ["chats", "donations", "participants", "events"].some(key => (session[key] || []).some?.(targetsYoutube));
  const next = { ...session, sources: (session.sources || []).filter(source => !targetsYoutube(source)),
    polls: (session.polls || []).filter(poll => !targetsYoutube(poll)) };
  // Automatic labels may include samples from multiple platforms, including legacy
  // records without source metadata. Keep manual bookmarks and their text intact.
  next.markers = affected ? (session.markers || []).filter(marker => marker.kind === "manual" || !marker.kind && !marker.evidence) : session.markers || [];
  for (const key of ["chats", "donations", "participants", "events"])
    if (Array.isArray(session[key])) next[key] = stripEvents(session[key]);
  if (session.replay) next.replay = { ...session.replay, sources: (session.replay.sources || []).filter(source => !targetsYoutube(source)) };
  if (counts) next.telemetry = { ...counts.telemetry };
  else if (affected) next.telemetry = { chats: 0, donations: 0, participants: 0, viewerSamples: 0 };
  if (session.recordingMode !== "manual" && (session.sources || []).some(source => source.platform === YOUTUBE && source.title === session.title))
    next.title = next.sources.find(source => source.title)?.title || "방송 기록";
  if (next.captureError) delete next.captureError;
  if (affected) { delete next.analysisComputedAt; next.analysisDeferred = true; }
  return next;
}
function stripYoutubeRecords(saved, updated = []) {
  const counts = new Map(updated.map(row => [row.id, row]));
  const audience = { ...(saved.audience || {}) };
  if (audience.raffle) {
    const raffle = audience.raffle;
    const platforms = raffle.config?.platforms || raffle.platforms || [];
    const mixed = platforms.includes(YOUTUBE) || (raffle.candidates || []).some(p => p.platform === YOUTUBE);
    const retained = platforms.filter(p => p !== YOUTUBE);
    audience.raffle = { ...raffle,
      ...(raffle.config ? { config: { ...raffle.config, platforms: retained } } : { platforms: retained }),
      candidates: (raffle.candidates || []).filter(p => p.platform !== YOUTUBE),
      draws: mixed ? [] : (raffle.draws || []).filter(draw => draw.winner?.platform !== YOUTUBE),
      latestDraw: mixed || raffle.latestDraw?.winner?.platform === YOUTUBE ? null : raffle.latestDraw };
    if (!retained.length) audience.raffle = null;
    if (mixed) audience.raffleReel = null;
  }
  if ((audience.raffleReel?.participants || []).some(p => p.platform === YOUTUBE)) audience.raffleReel = null;
  if (targetsYoutube(audience.donationPoll)) audience.donationPoll = null;
  audience.donationSeen = (audience.donationSeen || []).filter(key => !key.startsWith("youtube:"));
  audience.donationVoters = (audience.donationVoters || []).filter(([key]) => !key.startsWith("youtube:"));
  return { ...saved,
    current: stripSession(saved.current, counts.get(saved.current?.id)),
    sessions: (saved.sessions || []).map(session => stripSession(session, counts.get(session.id))),
    poll: targetsYoutube(saved.poll) ? null : saved.poll,
    seen: (saved.seen || []).filter(key => !/(^|:)youtube:/.test(key)),
    voters: (saved.voters || []).filter(([key]) => !key.startsWith("youtube:")), audience,
    monitorSuppression: (saved.monitorSuppression || []).filter(([key]) => !key.startsWith("youtube:")),
  };
}
function expiredSession(session, before) {
  const since = session.youtubeRetentionStartedAt ?? session.captureStartedAt ?? session.startedAt;
  return !Number.isFinite(since) || since <= before;
}
function expireYoutubeRecords(saved, updated = [], before) {
  const all = stripYoutubeRecords(saved, updated), affected = new Set(updated.filter(row => row.removed).map(row => row.id));
  const cleanSession = (session, cleaned) => session && (expiredSession(session, before) || affected.has(session.id) || session.chatCaptureMode === "replay" && !session.youtubeLiveCaptured) ? cleaned : session;
  const audience = saved.audience || {};
  const expired = value => value && (!Number.isFinite(value.openedAt ?? value.startedAt) || (value.openedAt ?? value.startedAt) <= before);
  const nextAudience = { ...all.audience,
    raffle: expired(audience.raffle) ? all.audience.raffle : audience.raffle,
    raffleReel: expired(audience.raffle) ? all.audience.raffleReel : audience.raffleReel,
    donationPoll: expired(audience.donationPoll) ? all.audience.donationPoll : audience.donationPoll,
    donationSeen: expired(audience.donationPoll) ? all.audience.donationSeen : audience.donationSeen || [],
    donationVoters: expired(audience.donationPoll) ? all.audience.donationVoters : audience.donationVoters || [],
  };
  return { ...all, current: cleanSession(saved.current, all.current),
    sessions: (saved.sessions || []).map((session, index) => cleanSession(session, all.sessions[index])),
    poll: expired(saved.poll) ? all.poll : saved.poll,
    voters: !saved.poll || expired(saved.poll) ? all.voters : saved.voters || [],
    seen: (saved.current || saved.sessions?.[0]) && !expiredSession(saved.current || saved.sessions[0], before) ? saved.seen || [] : all.seen,
    monitorSuppression: saved.monitorSuppression || [],
    audience: nextAudience };
}
function cleanRecordRecovery(records, updated, before) {
  for (const name of fs.readdirSync(records.directory).filter(name =>
    /^(records(?:-legacy-.+)?\.enc(?:\.corrupt-\d+)?(?:\.tmp)?|sessions\.json(?:\.corrupt-\d+)?)$/.test(name)
    && name !== "records.enc")) {
    const file = path.join(records.directory, name);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error("복구 기록 경로를 확인하세요.");
    let saved;
    try {
      saved = JSON.parse(name.startsWith("sessions.json") ? fs.readFileSync(file, "utf8")
        : records.storage.decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      if (saved.rawLegacyDataBase64) saved = JSON.parse(Buffer.from(saved.rawLegacyDataBase64, "base64").toString());
    } catch { throw new Error("읽을 수 없는 복구 기록이 남아 YouTube 데이터 정리를 완료하지 못했습니다. 복구 기록을 확인한 뒤 재시도하세요."); }
    if (Array.isArray(saved)) saved = { sessions: saved };
    const cleaned = before == null ? stripYoutubeRecords(saved, updated) : expireYoutubeRecords(saved, updated, before);
    if (JSON.stringify(cleaned) === JSON.stringify(saved)) continue;
    if (name.startsWith("sessions.json")) {
      // Recovery files also migrate to encryption; plaintext is removed only after save.
      const destination = path.join(records.directory, "records-legacy-" + name + ".enc");
      fs.writeFileSync(destination + ".tmp", records.storage.encryptString(JSON.stringify(cleaned)).toString("base64"), { flush: true });
      fs.renameSync(destination + ".tmp", destination); fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file + ".cleanup", records.storage.encryptString(JSON.stringify(cleaned)).toString("base64"), { flush: true });
      fs.renameSync(file + ".cleanup", file);
    }
  }
}
module.exports = { stripYoutubeRecords, cleanRecordRecovery, expiredSession, expireYoutubeRecords };
