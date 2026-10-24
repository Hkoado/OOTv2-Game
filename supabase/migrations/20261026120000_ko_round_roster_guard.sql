-- Huy review 24/10/2026 — cho phép mở vòng knockout 2 đội sau khi cutoff đã pin nguồn.
--
-- `20261025100000_cutoff_capture.sql` đặt trigger `mvp_cutoff_verify_round` bắt buộc
-- `count(mvp_tournament_entries) = jsonb_array_length(snapshot->'bots')` cho MỌI round.
-- Với vòng knockout, snapshot chỉ pin 2 đội của series ⇒ mở series luôn bị
-- `capture_roster_mismatch` (E2E 24/10/2026 phát hiện, xem docs/handoff/Huy.md).
--
-- Migration additive này chỉ nới điều kiện roster cho round không phải `group`; mọi kiểm
-- provenance khác (capture/receipt/submission/hash/roster membership) giữ nguyên.
-- CHƯA apply: workspace không còn kênh DDL (không SUPABASE_ACCESS_TOKEN/SUPABASE_DB_URL).

create or replace function public.mvp_cutoff_verify_round() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare b jsonb; c mvp_cutoff_captures; r mvp_github_receipts; s mvp_submissions;
begin
  perform 1 from mvp_tournaments where id=new.event_id for update;
  if not exists(select 1 from mvp_cutoff_captures where event_id=new.event_id)
    and not exists(select 1 from jsonb_array_elements(new.snapshot->'bots') bot
      where bot->>'capturePolicy'='cutoff-first-resolution.v1') then return new; end if;
  -- Vòng bảng: pin đủ roster. Vòng knockout: chỉ 2 đội của series nhưng không vượt roster.
  if new.round_id = 'group'
    and (select count(*) from mvp_tournament_entries where tournament_id=new.event_id)
      <> jsonb_array_length(new.snapshot->'bots') then
    raise exception 'capture_roster_mismatch';
  end if;
  if new.round_id <> 'group'
    and jsonb_array_length(new.snapshot->'bots')
      > (select count(*) from mvp_tournament_entries where tournament_id=new.event_id) then
    raise exception 'capture_roster_mismatch';
  end if;
  for b in select * from jsonb_array_elements(new.snapshot->'bots') loop
    select * into c from mvp_cutoff_captures where event_id=new.event_id and team_id=(b->>'participantId')::uuid;
    if not found or c.receipt_id is null or c.policy is distinct from b->>'capturePolicy'
      or c.cutoff is distinct from (new.snapshot->>'cutoff')::timestamptz
      or c.captured_at is distinct from (b->>'resolvedAt')::timestamptz
      or c.commit_sha is distinct from b->>'commitSha'
      or c.receipt_id::text is distinct from b->>'receiptId' then raise exception 'capture_mismatch'; end if;
    select * into r from mvp_github_receipts where id=c.receipt_id for share;
    if not found or r.status<>'valid' or r.team_id<>c.team_id or r.event_id<>c.event_id
      or r.commit_sha<>c.commit_sha or r.repo_id::text is distinct from b->>'repositoryId'
      or r.submission_id::text is distinct from b->>'submissionId'
      or r.source_hash is distinct from b->>'sourceSha256' then raise exception 'receipt_mismatch'; end if;
    select * into s from mvp_submissions where id=r.submission_id for share;
    if not found or s.status<>'valid' or s.participant_id<>c.team_id
      or s.sha256 is distinct from r.source_hash or s.storage_path is distinct from b->>'artifactKey'
      then raise exception 'submission_mismatch'; end if;
    if not exists(select 1 from mvp_tournament_entries where tournament_id=new.event_id and participant_id=c.team_id)
      then raise exception 'capture_roster_mismatch'; end if;
  end loop;
  return new;
end $$;

notify pgrst, 'reload schema';
