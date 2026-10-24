-- Transaction-only regression; run with psql -v ON_ERROR_STOP=1. No bot execution.
begin;
do $$
declare e uuid:=gen_random_uuid(); team uuid:=gen_random_uuid(); a jsonb; b jsonb;
  token uuid; expired uuid; receipt uuid; j uuid; snap jsonb; c mvp_cutoff_captures;
  submission uuid:=gen_random_uuid(); rejected boolean:=false;
begin
  insert into mvp_participants(id,name,name_key,created_at) values(team,'Capture SQL','capture-'||team,now());
  insert into mvp_tournaments(id,name,status,seed,created_at) values(e,'Capture SQL','draft',7,now());
  insert into mvp_tournament_entries(id,tournament_id,participant_id,seed_order) values(gen_random_uuid(),e,team,1);
  insert into mvp_official_setups(tournament_id,config) values(e,jsonb_build_object(
    'cutoff',clock_timestamp()-interval '1 hour','mapsPublished',true));
  insert into mvp_repo_connections(id,event_id,team_id,repo_id,repository,branch,approved)
    values(gen_random_uuid(),e,team,991,'https://github.com/example/capture','main',true);
  a:=mvp_cutoff_claim(e,team);
  if a->>'ok'<>'true' or a->>'token' is null then raise exception 'claim failed: %',a; end if;
  token:=(a->>'token')::uuid;
  b:=mvp_cutoff_claim(e,team);
  if b->>'busy'<>'true' then raise exception 'reservation did not exclude second writer'; end if;
  b:=mvp_cutoff_pin(e,team,gen_random_uuid(),repeat('a',40));
  if b->>'error'<>'capture_lease_lost' then raise exception 'wrong token accepted'; end if;
  expired:=token;
  update mvp_cutoff_captures set lease_until=now()-interval '1 minute' where event_id=e;
  a:=mvp_cutoff_claim(e,team); token:=(a->>'token')::uuid;
  if token=expired then raise exception 'reclaim reused token'; end if;
  b:=mvp_cutoff_pin(e,team,expired,repeat('b',40));
  if b->>'error'<>'capture_lease_lost' then raise exception 'stale writer accepted'; end if;
  b:=mvp_cutoff_pin(e,team,token,repeat('a',40));
  if b->>'ok'<>'true' then raise exception 'pin failed: %',b; end if;
  receipt:=(b->>'receipt_id')::uuid;
  a:=mvp_cutoff_claim(e,team);
  if a->>'pinned'<>'true' then raise exception 'pin was not authoritative'; end if;
  b:=mvp_cutoff_pin(e,team,token,repeat('b',40));
  if b->>'already_pinned'<>'true' then raise exception 'duplicate pin not idempotent'; end if;
  if (select commit_sha from mvp_github_receipts where id=receipt)<>repeat('a',40)
    or (select count(*) from mvp_repo_sync_jobs where event_id=e)<>1 then raise exception 'HEAD changed after pin'; end if;
  begin
    update mvp_repo_connections set branch='changed' where event_id=e;
    raise exception 'repo mutation accepted';
  exception when serialization_failure then null; end;
  begin
    update mvp_official_setups set config=config||'{"cutoff":"2099-01-01T00:00:00Z"}' where tournament_id=e;
    raise exception 'cutoff mutation accepted';
  exception when serialization_failure then null; end;
  begin
    delete from mvp_tournament_entries where tournament_id=e;
    raise exception 'roster mutation accepted';
  exception when serialization_failure then null; end;
  select job_id into j from mvp_github_receipts where id=receipt;
  if not exists(select 1 from mvp_cutoff_captures where event_id=e and receipt_id=receipt
    and captured_at>=cutoff and commit_sha=repeat('a',40)) then raise exception 'capture evidence missing'; end if;
  select * into c from mvp_cutoff_captures where event_id=e;
  insert into mvp_submissions(id,participant_id,status,sha256,storage_path)
    values(submission,team,'valid',repeat('c',64),submission||'.py');
  snap:=jsonb_build_object('schemaVersion','campus-round-snapshot.v1','eventId',e,'roundId','group',
    'contentHash',repeat('e',64),'cutoff',c.cutoff,'bots',jsonb_build_array(jsonb_build_object(
      'participantId',team,'submissionId',submission,'artifactKey',submission||'.py',
      'sourceSha256',repeat('c',64),'sourceKind','github','repositoryId','991',
      'commitSha',c.commit_sha,'resolvedAt',c.captured_at,'capturePolicy',c.policy,'receiptId',receipt)));
  begin
    perform mvp_official_open_round(e,'group',snap,repeat('f',64));
  exception when raise_exception then
    if sqlerrm<>'receipt_mismatch' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'pending receipt accepted'; end if;
  update mvp_github_receipts set status='valid',source_hash=repeat('c',64),submission_id=submission where id=receipt;
  -- A pre-cutoff historical receipt for the same SHA is permissible only through
  -- this authoritative capture; capture time is separate from receipt creation.
  update mvp_github_receipts set resolved_at=now()-interval '2 hours' where id=receipt;
  b:=mvp_official_open_round(e,'group',snap,repeat('f',64));
  if b->>'ok'<>'true' then raise exception 'valid exact receipt rejected: %',b; end if;
  rejected:=false;
  begin
    insert into mvp_official_rounds(event_id,round_id,snapshot,snapshot_hash,genesis_hash,chain_hash)
      values(e,'tampered',jsonb_set(jsonb_set(snap,'{roundId}','"tampered"'),
        '{bots,0,receiptId}',to_jsonb(gen_random_uuid()::text)),repeat('e',64),repeat('f',64),repeat('f',64));
  exception when raise_exception then
    if sqlerrm<>'capture_mismatch' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'tampered receipt accepted'; end if;
  if has_table_privilege('anon','mvp_cutoff_captures','select')
    or has_function_privilege('authenticated','mvp_cutoff_claim(uuid,uuid)','execute')
    or has_function_privilege('anon','mvp_cutoff_pin(uuid,uuid,uuid,text,uuid)','execute')
    then raise exception 'capture permissions exposed'; end if;
  raise notice 'PASS capture reservation/reclaim/stale fence/idempotency/context locks/actual timestamp';
  raise notice 'PASS transactional round provenance/pending receipt/tamper rejection/private permissions';
end $$;
rollback;